const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
})

const TYPES = new Set(['TERRITORIO', 'REDE', 'ASSOCIATIVO'])

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
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw
  const parsed = Number(normalized.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

export async function onRequestPost({ request, env }) {
  const provided = request.headers.get('x-admin-key') || ''
  if (!env.PAINEL_ADMIN_KEY || provided !== env.PAINEL_ADMIN_KEY) return json({ erro: 'Acesso interno negado.' }, 401)

  let data = {}
  try { data = await request.json() } catch { /* corpo inválido */ }

  const regionalId = Number(data.regional_id || 0)
  const competence = normalizeText(data.competencia)
  const portfolioType = normalizeText(data.tipo_carteira).toUpperCase()
  const sourceFile = normalizeText(data.arquivo_origem)
  const sourceModifiedAt = normalizeText(data.origem_modificada_em) || null
  const rows = Array.isArray(data.linhas) ? data.linhas : []

  if (!regionalId || !/^\d{4}-\d{2}$/.test(competence) || !TYPES.has(portfolioType) || !sourceFile) {
    return json({ erro: 'Regional, competência, tipo de carteira e arquivo de origem são obrigatórios.' }, 400)
  }
  if (!rows.length) return json({ erro: 'Nenhuma linha de meta foi recebida.' }, 400)

  const regional = await env.DB.prepare('SELECT id FROM regionais WHERE id = ? AND ativo = 1').bind(regionalId).first()
  if (!regional) return json({ erro: 'Regional inválida ou inativa.' }, 404)

  const [districtResult, consultantResult] = await env.DB.batch([
    env.DB.prepare(`
      SELECT id, codigo FROM distritais
       WHERE regional_id = ? AND ativo = 1
    `).bind(regionalId),
    env.DB.prepare(`
      SELECT c.id, c.codigo
        FROM consultores c
        JOIN distritais d ON d.id = c.distrital_id
       WHERE d.regional_id = ? AND d.ativo = 1 AND c.ativo = 1
    `).bind(regionalId),
  ])

  const districts = new Map((districtResult.results || []).map((item) => [normalizeCode(item.codigo), Number(item.id)]))
  const consultants = new Map((consultantResult.results || []).map((item) => [normalizeCode(item.codigo), Number(item.id)]))
  const importId = `metas-${crypto.randomUUID()}`
  const now = new Date().toISOString()
  const accepted = []
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
    if (level === 'GD') {
      districtId = districts.get(sector) || null
      if (!districtId) {
        ignored.push({ setor: sector, colaborador: collaborator, motivo: 'Distrital não encontrada na Estrutura de Pessoas.' })
        continue
      }
    }
    if (level === 'CONSULTOR') {
      consultantId = consultants.get(sector) || null
      if (!consultantId) {
        ignored.push({ setor: sector, colaborador: collaborator, motivo: 'Consultor não encontrado na Estrutura de Pessoas.' })
        continue
      }
    }

    accepted.push({
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

  if (!accepted.length) {
    return json({ erro: 'Nenhuma meta pôde ser vinculada à estrutura da Regional.', ignoradas: ignored.slice(0, 20) }, 422)
  }

  const statements = [
    env.DB.prepare(`
      INSERT INTO metas_importacoes
        (id, regional_id, competencia, tipo_carteira, arquivo_origem, origem_modificada_em,
         status, total_recebido, total_importado, total_ignorado, mensagem, criado_em, finalizado_em)
      VALUES (?, ?, ?, ?, ?, ?, 'CONCLUIDO', ?, ?, ?, ?, ?, ?)
    `).bind(
      importId, regionalId, competence, portfolioType, sourceFile, sourceModifiedAt,
      rows.length, accepted.length, ignored.length,
      `${accepted.length} meta(s) vinculada(s); ${ignored.length} linha(s) ignorada(s).`, now, now,
    ),
    env.DB.prepare(`
      DELETE FROM metas_sellout
       WHERE regional_id = ? AND competencia = ? AND tipo_carteira = ?
    `).bind(regionalId, competence, portfolioType),
  ]

  for (const item of accepted) {
    statements.push(env.DB.prepare(`
      INSERT INTO metas_sellout
        (importacao_id, regional_id, distrital_id, consultor_id, competencia, tipo_carteira, nivel,
         regiao, setor, colaborador, cargo_original, meta_ol_sem_combate, meta_ol_prioritarios,
         meta_ol_lancamentos, meta_demanda_sem_combate, arquivo_origem, origem_modificada_em, importado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      importId, regionalId, item.districtId, item.consultantId, competence, portfolioType, item.level,
      item.region, item.sector, item.collaborator, item.originalRole, item.noCombat, item.priority,
      item.launches, item.demand, sourceFile, sourceModifiedAt, now,
    ))
  }

  await env.DB.batch(statements)

  return json({
    sucesso: true,
    importacao_id: importId,
    competencia: competence,
    tipo_carteira: portfolioType,
    total_recebido: rows.length,
    total_importado: accepted.length,
    total_ignorado: ignored.length,
    ignoradas: ignored.slice(0, 20),
  }, 201)
}
