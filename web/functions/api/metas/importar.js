import { forbidden, getSession, json, readBody, unauthorized } from '../_lib/security.js'

const TYPES = new Set(['TERRITORIO', 'REDE', 'ASSOCIATIVO'])
const MAX_ROWS = 5000

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

function normalizeCode(value) {
  const raw = normalizeText(value).replace(/\.0+$/, '')
  return raw.replace(/[^0-9A-Za-z_-]/g, '')
}

function normalizeRole(value) {
  const role = normalizeText(value).toUpperCase()
  if (role.includes('G REGIONAL') || role.includes('GERENTE REGIONAL')) return 'GR'
  if (role.includes('G DISTRITAL') || role.includes('GERENTE DISTRITAL')) return 'GD'
  if (role.includes('CONSULTOR VENDAS') || role.includes('COORDENADOR CONTAS') || role === 'CONSULTOR') return 'CONSULTOR'
  return null
}

function numberValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const raw = String(value ?? '').trim()
  if (!raw) return 0
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw
  const parsed = Number(normalized.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

async function requireUploader(request, env) {
  const user = await getSession(request, env)
  if (!user) return { denial: unauthorized('Sessão expirada. Entre novamente.'), user: null }
  if (!['DESENVOLVEDOR', 'RG'].includes(String(user.perfil))) {
    return { denial: forbidden('Somente o desenvolvedor e os Gerentes Regionais podem importar metas.'), user }
  }
  return { denial: null, user }
}

async function resolveRegional(env, user, requestedId) {
  const regionalId = user.perfil === 'RG' ? Number(user.regional_id || 0) : Number(requestedId || 0)
  if (!regionalId) return { error: 'Selecione a Regional que receberá as metas.' }

  const regional = await env.DB.prepare(`
    SELECT id, nome, setor, ativo
      FROM regionais
     WHERE id = ?
  `).bind(regionalId).first()
  if (!regional) return { error: 'Regional não encontrada.' }
  if (user.perfil === 'RG' && Number(regional.ativo || 0) !== 1) return { error: 'Sua Regional está inativa.' }
  return { regional }
}

export async function onRequestGet({ request, env }) {
  const { denial, user } = await requireUploader(request, env)
  if (denial) return denial

  const url = new URL(request.url)
  const resolved = await resolveRegional(env, user, url.searchParams.get('regional_id'))
  if (resolved.error) return json({ erro: resolved.error }, 400)

  const history = await env.DB.prepare(`
    SELECT id, competencia, tipo_carteira, arquivo_origem, status,
           total_recebido, total_importado, total_ignorado, mensagem,
           criado_em, finalizado_em
      FROM metas_importacoes
     WHERE regional_id = ?
     ORDER BY criado_em DESC
     LIMIT 12
  `).bind(resolved.regional.id).all()

  return json({
    regional: resolved.regional,
    importacoes: history.results || [],
  })
}

export async function onRequestPost({ request, env }) {
  const { denial, user } = await requireUploader(request, env)
  if (denial) return denial

  const data = await readBody(request)
  const resolved = await resolveRegional(env, user, data.regional_id)
  if (resolved.error) return json({ erro: resolved.error }, 400)
  const regional = resolved.regional

  const competence = normalizeText(data.competencia)
  const portfolioType = normalizeText(data.tipo_carteira).toUpperCase()
  const sourceFile = normalizeText(data.arquivo_origem)
  const sourceModifiedAt = normalizeText(data.origem_modificada_em) || null
  const rows = Array.isArray(data.linhas) ? data.linhas : []

  if (!/^\d{4}-\d{2}$/.test(competence)) return json({ erro: 'Informe a competência no formato AAAA-MM.' }, 400)
  if (!TYPES.has(portfolioType)) return json({ erro: 'O arquivo deve ser de Território, Rede ou Associativo.' }, 400)
  if (!sourceFile || !/\.xlsx?$/i.test(sourceFile)) return json({ erro: 'Envie uma planilha Excel válida.' }, 400)
  if (!rows.length) return json({ erro: 'Nenhuma linha de meta foi encontrada na planilha.' }, 400)
  if (rows.length > MAX_ROWS) return json({ erro: `A planilha excede o limite de ${MAX_ROWS} linhas.` }, 400)

  const [districtResult, consultantResult] = await env.DB.batch([
    env.DB.prepare(`
      SELECT id, codigo FROM distritais
       WHERE regional_id = ? AND ativo = 1
    `).bind(regional.id),
    env.DB.prepare(`
      SELECT c.id, c.codigo
        FROM consultores c
        JOIN distritais d ON d.id = c.distrital_id
       WHERE d.regional_id = ? AND d.ativo = 1 AND c.ativo = 1
    `).bind(regional.id),
  ])

  const districts = new Map((districtResult.results || []).map((item) => [normalizeCode(item.codigo), Number(item.id)]))
  const consultants = new Map((consultantResult.results || []).map((item) => [normalizeCode(item.codigo), Number(item.id)]))
  const regionalCode = normalizeCode(regional.setor)
  const acceptedBySector = new Map()
  const ignored = []

  for (const raw of rows) {
    const level = normalizeRole(raw.cargo || raw.cargo_original)
    const sector = normalizeCode(raw.setor)
    const collaborator = normalizeText(raw.colaborador)
    if (!level || !sector || !collaborator) {
      ignored.push({ setor: sector, colaborador: collaborator, motivo: 'Cargo, setor ou colaborador não reconhecido.' })
      continue
    }

    let districtId = null
    let consultantId = null
    if (level === 'GR') {
      if (!regionalCode || sector !== regionalCode) {
        ignored.push({ setor: sector, colaborador: collaborator, motivo: 'Gerente Regional pertence a outra Regional.' })
        continue
      }
    } else if (level === 'GD') {
      districtId = districts.get(sector) || null
      if (!districtId) {
        ignored.push({ setor: sector, colaborador: collaborator, motivo: 'Distrital não encontrada na Estrutura de Pessoas desta Regional.' })
        continue
      }
    } else {
      consultantId = consultants.get(sector) || null
      if (!consultantId) {
        ignored.push({ setor: sector, colaborador: collaborator, motivo: 'Consultor não encontrado na Estrutura de Pessoas desta Regional.' })
        continue
      }
    }

    acceptedBySector.set(sector, {
      level,
      districtId,
      consultantId,
      region: normalizeText(raw.reg || raw.regiao),
      sector,
      collaborator,
      originalRole: normalizeText(raw.cargo || raw.cargo_original),
      noCombat: numberValue(raw.meta_ol_sem_combate ?? raw.ol_sem_combate),
      priority: numberValue(raw.meta_ol_prioritarios ?? raw.ol_prioritarios),
      launches: numberValue(raw.meta_ol_lancamentos ?? raw.ol_lancamentos),
      demand: numberValue(raw.meta_demanda_sem_combate ?? raw.demanda_sem_combate),
    })
  }

  const accepted = [...acceptedBySector.values()]
  if (!accepted.length) {
    return json({
      erro: 'Nenhuma meta pôde ser vinculada à estrutura da Regional selecionada.',
      ignoradas: ignored.slice(0, 20),
    }, 422)
  }

  const importId = `metas-${crypto.randomUUID()}`
  const now = new Date().toISOString()
  const uploader = `${user.perfil}: ${user.nome || user.email}`
  const statements = [
    env.DB.prepare(`
      INSERT INTO metas_importacoes
        (id, regional_id, competencia, tipo_carteira, arquivo_origem, origem_modificada_em,
         status, total_recebido, total_importado, total_ignorado, mensagem, criado_em, finalizado_em)
      VALUES (?, ?, ?, ?, ?, ?, 'CONCLUIDO', ?, ?, ?, ?, ?, ?)
    `).bind(
      importId, regional.id, competence, portfolioType, sourceFile, sourceModifiedAt,
      rows.length, accepted.length, ignored.length,
      `${accepted.length} meta(s) vinculada(s); ${ignored.length} linha(s) ignorada(s). Upload por ${uploader}.`, now, now,
    ),
    env.DB.prepare(`
      DELETE FROM metas_sellout
       WHERE regional_id = ? AND competencia = ? AND tipo_carteira = ?
    `).bind(regional.id, competence, portfolioType),
  ]

  for (const item of accepted) {
    statements.push(env.DB.prepare(`
      INSERT INTO metas_sellout
        (importacao_id, regional_id, distrital_id, consultor_id, competencia, tipo_carteira, nivel,
         regiao, setor, colaborador, cargo_original, meta_ol_sem_combate, meta_ol_prioritarios,
         meta_ol_lancamentos, meta_demanda_sem_combate, arquivo_origem, origem_modificada_em, importado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      importId, regional.id, item.districtId, item.consultantId, competence, portfolioType, item.level,
      item.region, item.sector, item.collaborator, item.originalRole, item.noCombat, item.priority,
      item.launches, item.demand, sourceFile, sourceModifiedAt, now,
    ))
  }

  await env.DB.batch(statements)

  return json({
    sucesso: true,
    importacao_id: importId,
    regional: { id: Number(regional.id), nome: regional.nome },
    competencia: competence,
    tipo_carteira: portfolioType,
    total_recebido: rows.length,
    total_importado: accepted.length,
    total_ignorado: ignored.length,
    ignoradas: ignored.slice(0, 20),
    mensagem: `${sourceFile}: ${accepted.length} meta(s) importada(s) para ${regional.nome}.`,
  }, 201)
}
