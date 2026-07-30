import { badRequest, forbidden, getSession, json, readBody, unauthorized } from '../_lib/security.js'

const TYPES = new Set(['PRODUTOS_MIX', 'PRODUTOS_MERCADO_FARMA'])
const MAX_ROWS = 30000

const text = (value) => String(value ?? '').trim().replace(/\s+/g, ' ')
const digits = (value) => text(value).replace(/\D/g, '')
const upper = (value) => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()

function normalizeMix(value) {
  const item = upper(value)
  if (!item) return 'SEM CLASSIFICACAO'
  if (item.includes('LANC')) return 'LANCAMENTO'
  if (item.includes('PRIOR')) return 'PRIORITARIO'
  if (item.includes('COMBATE') && !item.includes('SEM COMBATE')) return 'COMBATE'
  if (item.includes('LINHA') || item.includes('SEM COMBATE')) return 'LINHA'
  return 'SEM CLASSIFICACAO'
}

async function requireUploader(request, env) {
  const user = await getSession(request, env)
  if (!user) return { denial: unauthorized('Sessão expirada. Entre novamente.'), user: null }
  if (!['DESENVOLVEDOR', 'RG', 'GD'].includes(String(user.perfil))) {
    return { denial: forbidden('Somente o desenvolvedor, o GR e o GD podem atualizar as bases de produtos.'), user }
  }
  if (user.perfil === 'GD' && !user.distrital_id) {
    return { denial: forbidden('Este GD ainda não está vinculado a uma Distrital.'), user }
  }
  return { denial: null, user }
}

async function resolveScope(env, user, requestedRegionalId) {
  const regionalId = user.perfil === 'DESENVOLVEDOR'
    ? Number(requestedRegionalId || 0)
    : Number(user.regional_id || 0)
  if (!regionalId) return { error: 'Selecione a Regional.' }

  const regional = await env.DB.prepare(`
    SELECT id, nome, setor, ativo
      FROM regionais
     WHERE id = ?
  `).bind(regionalId).first()
  if (!regional) return { error: 'Regional não encontrada.' }
  if (user.perfil !== 'DESENVOLVEDOR' && Number(regional.ativo || 0) !== 1) {
    return { error: 'A Regional está inativa.' }
  }

  const districtId = user.perfil === 'GD' ? Number(user.distrital_id || 0) : 0
  let district = null
  if (districtId) {
    district = await env.DB.prepare(`
      SELECT id, nome, codigo, ativo
        FROM distritais
       WHERE id = ? AND regional_id = ?
    `).bind(districtId, regionalId).first()
    if (!district || Number(district.ativo || 0) !== 1) return { error: 'Distrital inválida ou inativa.' }
  }

  return { regional, district, regionalId, districtId }
}

async function countScope(env, regionalId, districtId) {
  const row = await env.DB.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN mix_importacao_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS produtos_mix,
      COALESCE(SUM(CASE WHEN mercado_farma_importacao_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS produtos_mercado_farma
      FROM produtos_catalogo
     WHERE regional_id = ? AND distrital_id = ?
  `).bind(regionalId, districtId).first()
  return {
    produtos_mix: Number(row?.produtos_mix || 0),
    produtos_mercado_farma: Number(row?.produtos_mercado_farma || 0),
  }
}

function baseStatus(own, regional, districtId, key) {
  const ownCount = Number(own[key] || 0)
  const regionalCount = Number(regional[key] || 0)
  if (districtId && ownCount > 0) return { total: ownCount, origem: 'DISTRITAL', proprio: true }
  if (districtId && regionalCount > 0) return { total: regionalCount, origem: 'REGIONAL', proprio: false }
  if (!districtId && ownCount > 0) return { total: ownCount, origem: 'REGIONAL', proprio: true }
  return { total: 0, origem: 'AUSENTE', proprio: false }
}

async function statusResponse(env, scope) {
  const own = await countScope(env, scope.regionalId, scope.districtId)
  const regional = scope.districtId ? await countScope(env, scope.regionalId, 0) : own
  const history = await env.DB.prepare(`
    SELECT id, tipo, nome_arquivo, total_importado, status, mensagem,
           enviado_por, criado_em, finalizado_em
      FROM produtos_importacoes
     WHERE regional_id = ? AND distrital_id = ?
     ORDER BY criado_em DESC
     LIMIT 12
  `).bind(scope.regionalId, scope.districtId).all()

  return {
    regional: scope.regional,
    distrital: scope.district,
    escopo: scope.districtId ? 'DISTRITAL' : 'REGIONAL',
    bases: {
      produtos_mix: baseStatus(own, regional, scope.districtId, 'produtos_mix'),
      produtos_mercado_farma: baseStatus(own, regional, scope.districtId, 'produtos_mercado_farma'),
    },
    importacoes: history.results || [],
  }
}

async function runBatches(env, statements, size = 80) {
  for (let index = 0; index < statements.length; index += size) {
    await env.DB.batch(statements.slice(index, index + size))
  }
}

export async function onRequestGet({ request, env }) {
  const { denial, user } = await requireUploader(request, env)
  if (denial) return denial
  const url = new URL(request.url)
  const scope = await resolveScope(env, user, url.searchParams.get('regional_id'))
  if (scope.error) return badRequest(scope.error)
  return json(await statusResponse(env, scope))
}

export async function onRequestPost({ request, env }) {
  const { denial, user } = await requireUploader(request, env)
  if (denial) return denial

  const data = await readBody(request)
  const scope = await resolveScope(env, user, data.regional_id)
  if (scope.error) return badRequest(scope.error)

  const type = upper(data.tipo)
  const sourceFile = text(data.nome_arquivo)
  const rows = Array.isArray(data.linhas) ? data.linhas : []
  if (!TYPES.has(type)) return badRequest('Selecione Produtos / Mix ou Produtos do Mercado Farma.')
  if (!sourceFile || !/\.(xlsx?|csv)$/i.test(sourceFile)) return badRequest('Envie uma planilha XLSX, XLS ou CSV válida.')
  if (!rows.length) return badRequest('Nenhuma linha de produto foi encontrada na planilha.')
  if (rows.length > MAX_ROWS) return badRequest(`A planilha excede o limite de ${MAX_ROWS} linhas.`)

  const unique = new Map()
  for (const raw of rows) {
    const ean = digits(raw?.ean)
    if (ean.length < 8 || ean.length > 14) continue
    const product = text(raw?.produto || raw?.descricao)
    const mix = normalizeMix(raw?.tipo_mix || raw?.classificacao || raw?.categoria)
    unique.set(ean, { ean, produto: product || `Produto ${ean}`, tipo_mix: mix })
  }

  const accepted = [...unique.values()]
  if (!accepted.length) return badRequest('A planilha não possui EANs válidos.')
  if (type === 'PRODUTOS_MIX' && !accepted.some((item) => item.tipo_mix !== 'SEM CLASSIFICACAO')) {
    return badRequest('A planilha de Produtos / Mix precisa ter a coluna TIPO MIX preenchida.')
  }

  const importId = `prod-${crypto.randomUUID()}`
  const now = new Date().toISOString()
  const statements = accepted.map((item) => {
    if (type === 'PRODUTOS_MIX') {
      return env.DB.prepare(`
        INSERT INTO produtos_catalogo
          (id, regional_id, distrital_id, ean, produto, tipo_mix, mix_importacao_id, atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(regional_id, distrital_id, ean) DO UPDATE SET
          produto = excluded.produto,
          tipo_mix = excluded.tipo_mix,
          mix_importacao_id = excluded.mix_importacao_id,
          atualizado_em = excluded.atualizado_em
      `).bind(`produto-${scope.regionalId}-${scope.districtId}-${item.ean}`, scope.regionalId, scope.districtId,
        item.ean, item.produto, item.tipo_mix, importId, now)
    }

    return env.DB.prepare(`
      INSERT INTO produtos_catalogo
        (id, regional_id, distrital_id, ean, produto, mercado_farma_importacao_id, atualizado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(regional_id, distrital_id, ean) DO UPDATE SET
        produto = CASE WHEN excluded.produto <> '' THEN excluded.produto ELSE produtos_catalogo.produto END,
        mercado_farma_importacao_id = excluded.mercado_farma_importacao_id,
        atualizado_em = excluded.atualizado_em
    `).bind(`produto-${scope.regionalId}-${scope.districtId}-${item.ean}`, scope.regionalId, scope.districtId,
      item.ean, item.produto, importId, now)
  })

  try {
    await runBatches(env, statements)
    if (type === 'PRODUTOS_MIX') {
      await env.DB.prepare(`
        UPDATE produtos_catalogo
           SET mix_importacao_id = NULL, tipo_mix = 'SEM CLASSIFICACAO', atualizado_em = ?
         WHERE regional_id = ? AND distrital_id = ?
           AND mix_importacao_id IS NOT NULL AND mix_importacao_id <> ?
      `).bind(now, scope.regionalId, scope.districtId, importId).run()
    } else {
      await env.DB.prepare(`
        UPDATE produtos_catalogo
           SET mercado_farma_importacao_id = NULL, atualizado_em = ?
         WHERE regional_id = ? AND distrital_id = ?
           AND mercado_farma_importacao_id IS NOT NULL AND mercado_farma_importacao_id <> ?
      `).bind(now, scope.regionalId, scope.districtId, importId).run()
    }

    await env.DB.batch([
      env.DB.prepare(`
        DELETE FROM produtos_catalogo
         WHERE regional_id = ? AND distrital_id = ?
           AND mix_importacao_id IS NULL AND mercado_farma_importacao_id IS NULL
      `).bind(scope.regionalId, scope.districtId),
      env.DB.prepare(`
        INSERT INTO produtos_importacoes
          (id, regional_id, distrital_id, tipo, nome_arquivo, total_recebido,
           total_importado, status, mensagem, enviado_por, criado_em, finalizado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'CONCLUIDO', ?, ?, ?, ?)
      `).bind(importId, scope.regionalId, scope.districtId, type, sourceFile, rows.length,
        accepted.length, `${accepted.length} produtos importados.`, user.email || user.nome || '', now, now),
    ])
  } catch (reason) {
    return json({ erro: reason instanceof Error ? reason.message : 'Não foi possível gravar a base de produtos.' }, 500)
  }

  return json({
    sucesso: true,
    total_importado: accepted.length,
    mensagem: `${accepted.length} produtos importados com sucesso.`,
    ...(await statusResponse(env, scope)),
  }, 201)
}
