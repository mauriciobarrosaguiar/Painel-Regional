const PUBLIC_MODE = true

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
})

const badRequest = (erro) => json({ erro }, 400)

async function readBody(request) {
  try { return await request.json() } catch { return {} }
}

async function getRegional(env) {
  return env.DB.prepare(
    'SELECT id, nome, slug FROM regionais WHERE ativo = 1 ORDER BY id LIMIT 1'
  ).first()
}

function publicUser(regional) {
  return {
    id: 0,
    nome: 'Gerente Regional',
    email: '',
    perfil: 'RG',
    regional_id: regional.id,
    distrital_id: null,
    consultor_id: null,
  }
}

async function hierarchy(env, regional) {
  const { results: districts = [] } = await env.DB.prepare(`
    SELECT id, nome, codigo, gerente_nome, ativo
      FROM distritais
     WHERE regional_id = ? AND ativo = 1
     ORDER BY nome
  `).bind(regional.id).all()

  const output = []
  for (const district of districts) {
    const { results: consultants = [] } = await env.DB.prepare(`
      SELECT id, nome, codigo, email, ativo
        FROM consultores
       WHERE distrital_id = ? AND ativo = 1
       ORDER BY nome
    `).bind(district.id).all()
    output.push({ ...district, consultores: consultants })
  }

  return json({ regional, distritais: output })
}

async function dashboard(request, env, regional) {
  const url = new URL(request.url)
  const districtId = Number(url.searchParams.get('distrital_id')) || null
  const consultantId = Number(url.searchParams.get('consultor_id')) || null
  const where = ['regional_id = ?']
  const params = [regional.id]

  if (districtId) {
    const allowed = await env.DB.prepare(
      'SELECT id FROM distritais WHERE id = ? AND regional_id = ? AND ativo = 1'
    ).bind(districtId, regional.id).first()
    if (!allowed) return badRequest('Distrital inválida para esta Regional.')
    where.push('distrital_id = ?')
    params.push(districtId)
  }

  if (consultantId) {
    where.push('consultor_id = ?')
    params.push(consultantId)
  }

  const row = await env.DB.prepare(`
    SELECT
      COALESCE(SUM(ol_total_faturado), 0) AS ol_total_faturado,
      COALESCE(SUM(ol_sem_combate), 0) AS ol_sem_combate,
      COALESCE(SUM(ol_combate), 0) AS ol_combate,
      COALESCE(SUM(ol_prioritarios), 0) AS ol_prioritarios,
      COALESCE(SUM(ol_lancamentos), 0) AS ol_lancamentos,
      COALESCE(SUM(meta_ol_sem_combate), 0) AS meta_ol_sem_combate,
      COALESCE(SUM(meta_ol_prioritarios), 0) AS meta_ol_prioritarios,
      COALESCE(SUM(meta_ol_lancamentos), 0) AS meta_ol_lancamentos,
      COALESCE(SUM(clientes_com_venda), 0) AS clientes_com_venda,
      COALESCE(SUM(clientes_sem_venda), 0) AS clientes_sem_venda,
      COALESCE(SUM(pedidos_nao_faturados), 0) AS pedidos_nao_faturados,
      COALESCE(SUM(valor_nao_faturado), 0) AS valor_nao_faturado,
      MAX(atualizado_em) AS atualizado_em
    FROM resultados
    WHERE ${where.join(' AND ')}
  `).bind(...params).first()

  let escopo = 'Resultado Regional'
  if (districtId) {
    const district = await env.DB.prepare(
      'SELECT nome FROM distritais WHERE id = ? AND regional_id = ?'
    ).bind(districtId, regional.id).first()
    escopo = district?.nome || 'Resultado Distrital'
  }
  if (consultantId) {
    const consultant = await env.DB.prepare('SELECT nome FROM consultores WHERE id = ?')
      .bind(consultantId).first()
    escopo = consultant?.nome || 'Resultado do Consultor'
  }

  return json({ escopo, ...row, atualizado_em: row?.atualizado_em || '' })
}

async function automations(env, regional) {
  const { results = [] } = await env.DB.prepare(`
    SELECT id, nome, status, ultima_execucao, proxima_execucao
      FROM automacoes
     WHERE regional_id = ?
     ORDER BY nome
  `).bind(regional.id).all()
  return json({ automacoes: results })
}

async function createDistrict(request, env, regional) {
  const data = await readBody(request)
  const nome = String(data.nome || '').trim()
  const codigo = String(data.codigo || '').trim()
  const gerente = String(data.gerente_nome || '').trim()
  if (!nome || !codigo) return badRequest('Informe nome e código da Distrital.')

  await env.DB.prepare(`
    INSERT INTO distritais (regional_id, nome, codigo, gerente_nome, ativo, criado_em)
    VALUES (?, ?, ?, ?, 1, datetime('now'))
  `).bind(regional.id, nome, codigo, gerente).run()
  return json({ ok: true }, 201)
}

async function createConsultant(request, env, regional) {
  const data = await readBody(request)
  const districtId = Number(data.distrital_id)
  const nome = String(data.nome || '').trim()
  const codigo = String(data.codigo || '').trim()
  const email = String(data.email || '').trim().toLowerCase()
  const allowed = await env.DB.prepare(
    'SELECT id FROM distritais WHERE id = ? AND regional_id = ? AND ativo = 1'
  ).bind(districtId, regional.id).first()
  if (!allowed || !nome || !codigo) {
    return badRequest('Distrital, nome e código são obrigatórios.')
  }

  await env.DB.prepare(`
    INSERT INTO consultores (distrital_id, nome, codigo, email, ativo, criado_em)
    VALUES (?, ?, ?, ?, 1, datetime('now'))
  `).bind(districtId, nome, codigo, email).run()
  return json({ ok: true }, 201)
}

async function createAutomation(request, env, regional) {
  const data = await readBody(request)
  const nome = String(data.nome || '').trim()
  const next = String(data.proxima_execucao || '').trim() || null
  if (!nome) return badRequest('Informe o nome da automação.')

  await env.DB.prepare(`
    INSERT INTO automacoes (regional_id, nome, status, proxima_execucao, criado_em)
    VALUES (?, ?, 'ATIVO', ?, datetime('now'))
  `).bind(regional.id, nome, next).run()
  return json({ ok: true }, 201)
}

export async function onRequest(context) {
  if (!PUBLIC_MODE) return context.next()

  const { request, env } = context
  if (!env.DB) return json({ erro: 'Binding D1 DB não configurado no Cloudflare.' }, 503)

  const url = new URL(request.url)
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/^\/+|\/+$/g, '')
  const method = request.method.toUpperCase()
  const handled = new Set([
    'me',
    'hierarquia',
    'dashboard',
    'automacoes',
    'admin/distritais',
    'admin/consultores',
    'admin/automacoes',
    'logout',
  ])

  if (!handled.has(path)) return context.next()

  try {
    const regional = await getRegional(env)
    if (!regional) return json({ erro: 'Nenhuma Regional ativa foi encontrada.' }, 404)

    if (method === 'GET' && path === 'me') {
      return json({ usuario: publicUser(regional), regional })
    }
    if (method === 'GET' && path === 'hierarquia') return hierarchy(env, regional)
    if (method === 'GET' && path === 'dashboard') return dashboard(request, env, regional)
    if (method === 'GET' && path === 'automacoes') return automations(env, regional)
    if (method === 'POST' && path === 'admin/distritais') return createDistrict(request, env, regional)
    if (method === 'POST' && path === 'admin/consultores') return createConsultant(request, env, regional)
    if (method === 'POST' && path === 'admin/automacoes') return createAutomation(request, env, regional)
    if (method === 'POST' && path === 'logout') return json({ ok: true })

    return context.next()
  } catch (error) {
    console.error(error)
    const detail = String(error?.message || error)
    if (detail.includes('UNIQUE constraint failed')) {
      return json({ erro: 'Já existe um cadastro com estes dados.' }, 409)
    }
    return json({ erro: 'Erro interno ao processar a solicitação.', detalhe: detail }, 500)
  }
}
