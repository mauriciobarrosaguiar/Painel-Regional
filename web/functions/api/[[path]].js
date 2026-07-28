const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
})

const badRequest = (erro) => json({ erro }, 400)
const unauthorized = (erro = 'Acesso não autorizado.') => json({ erro }, 401)
const forbidden = (erro = 'Seu perfil não possui permissão para esta operação.') => json({ erro }, 403)

async function body(request) {
  try { return await request.json() } catch { return {} }
}

async function sha256(value) {
  const data = new TextEncoder().encode(String(value))
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, '0')).join('')
}

function token() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return [...bytes].map((item) => item.toString(16).padStart(2, '0')).join('')
}

function normalizePath(params) {
  const value = params?.path
  return Array.isArray(value) ? value.join('/') : String(value || '')
}

async function session(request, env) {
  const authorization = request.headers.get('authorization') || ''
  const sessionToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (!sessionToken) return null
  return env.DB.prepare(`
    SELECT u.id, u.nome, u.email, u.perfil, u.regional_id, u.distrital_id, u.consultor_id,
           r.nome AS regional_nome, r.slug AS regional_slug
      FROM sessoes s
      JOIN usuarios u ON u.id = s.usuario_id
      JOIN regionais r ON r.id = u.regional_id
     WHERE s.token = ? AND s.expira_em > datetime('now') AND u.ativo = 1 AND r.ativo = 1
  `).bind(sessionToken).first()
}

function publicUser(row) {
  return {
    id: row.id,
    nome: row.nome,
    email: row.email,
    perfil: row.perfil,
    regional_id: row.regional_id,
    distrital_id: row.distrital_id,
    consultor_id: row.consultor_id,
  }
}

async function createSession(env, userId) {
  const value = token()
  await env.DB.prepare(`
    INSERT INTO sessoes (token, usuario_id, criado_em, expira_em)
    VALUES (?, ?, datetime('now'), datetime('now', '+7 days'))
  `).bind(value, userId).run()
  return value
}

async function listRegionais(env) {
  const { results = [] } = await env.DB.prepare(
    'SELECT id, nome, slug FROM regionais WHERE ativo = 1 ORDER BY nome'
  ).all()
  return json({ regionais: results })
}

async function setupStatus(url, env) {
  const regionalId = Number(url.searchParams.get('regional_id'))
  if (!regionalId) return badRequest('Regional inválida.')
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM usuarios WHERE regional_id = ? AND perfil = 'RG' AND ativo = 1"
  ).bind(regionalId).first()
  return json({ precisa_configurar: Number(row?.total || 0) === 0 })
}

async function setup(request, env) {
  const data = await body(request)
  const regionalId = Number(data.regional_id)
  const nome = String(data.nome || '').trim()
  const email = String(data.email || '').trim().toLowerCase()
  const senha = String(data.senha || '')
  if (!regionalId || nome.length < 3 || !email.includes('@') || senha.length < 8) {
    return badRequest('Informe nome, e-mail válido e senha com pelo menos 8 caracteres.')
  }
  const existing = await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM usuarios WHERE regional_id = ? AND perfil = 'RG' AND ativo = 1"
  ).bind(regionalId).first()
  if (Number(existing?.total || 0) > 0) return forbidden('A Regional já possui Gerente Regional cadastrado.')

  const passwordHash = await sha256(senha)
  const created = await env.DB.prepare(`
    INSERT INTO usuarios (regional_id, nome, email, senha_hash, perfil, ativo, criado_em)
    VALUES (?, ?, ?, ?, 'RG', 1, datetime('now'))
  `).bind(regionalId, nome, email, passwordHash).run()
  const user = await env.DB.prepare('SELECT * FROM usuarios WHERE id = ?').bind(created.meta.last_row_id).first()
  const sessionToken = await createSession(env, user.id)
  return json({ token: sessionToken, usuario: publicUser(user) }, 201)
}

async function login(request, env) {
  const data = await body(request)
  const regionalId = Number(data.regional_id)
  const email = String(data.email || '').trim().toLowerCase()
  const senha = String(data.senha || '')
  if (!regionalId || !email || !senha) return badRequest('Informe Regional, e-mail e senha.')
  const user = await env.DB.prepare(`
    SELECT * FROM usuarios WHERE regional_id = ? AND email = ? AND ativo = 1
  `).bind(regionalId, email).first()
  if (!user || user.senha_hash !== await sha256(senha)) return unauthorized('E-mail ou senha inválidos.')
  const sessionToken = await createSession(env, user.id)
  return json({ token: sessionToken, usuario: publicUser(user) })
}

async function me(request, env) {
  const user = await session(request, env)
  if (!user) return unauthorized()
  return json({
    usuario: publicUser(user),
    regional: { id: user.regional_id, nome: user.regional_nome, slug: user.regional_slug },
  })
}

async function logout(request, env) {
  const authorization = request.headers.get('authorization') || ''
  const sessionToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (sessionToken) await env.DB.prepare('DELETE FROM sessoes WHERE token = ?').bind(sessionToken).run()
  return json({ ok: true })
}

async function hierarchy(request, env) {
  const user = await session(request, env)
  if (!user) return unauthorized()

  let districtSql = 'SELECT id, nome, codigo, gerente_nome, ativo FROM distritais WHERE regional_id = ? AND ativo = 1'
  const districtParams = [user.regional_id]
  if (user.perfil !== 'RG') {
    districtSql += ' AND id = ?'
    districtParams.push(user.distrital_id || -1)
  }
  districtSql += ' ORDER BY nome'
  const { results: districts = [] } = await env.DB.prepare(districtSql).bind(...districtParams).all()

  const output = []
  for (const district of districts) {
    let consultantSql = 'SELECT id, nome, codigo, email, ativo FROM consultores WHERE distrital_id = ? AND ativo = 1'
    const consultantParams = [district.id]
    if (user.perfil === 'CONSULTOR') {
      consultantSql += ' AND id = ?'
      consultantParams.push(user.consultor_id || -1)
    }
    consultantSql += ' ORDER BY nome'
    const { results: consultants = [] } = await env.DB.prepare(consultantSql).bind(...consultantParams).all()
    output.push({ ...district, consultores: consultants })
  }

  return json({
    regional: { id: user.regional_id, nome: user.regional_nome, slug: user.regional_slug },
    distritais: output,
  })
}

async function dashboard(request, env, url) {
  const user = await session(request, env)
  if (!user) return unauthorized()

  let districtId = Number(url.searchParams.get('distrital_id')) || null
  let consultantId = Number(url.searchParams.get('consultor_id')) || null
  if (user.perfil === 'GD') districtId = user.distrital_id
  if (user.perfil === 'CONSULTOR') {
    districtId = user.distrital_id
    consultantId = user.consultor_id
  }

  const where = ['regional_id = ?']
  const params = [user.regional_id]
  if (districtId) { where.push('distrital_id = ?'); params.push(districtId) }
  if (consultantId) { where.push('consultor_id = ?'); params.push(consultantId) }

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
    const district = await env.DB.prepare('SELECT nome FROM distritais WHERE id = ? AND regional_id = ?')
      .bind(districtId, user.regional_id).first()
    escopo = district?.nome || 'Resultado Distrital'
  }
  if (consultantId) {
    const consultant = await env.DB.prepare('SELECT nome FROM consultores WHERE id = ?')
      .bind(consultantId).first()
    escopo = consultant?.nome || 'Resultado do Consultor'
  }
  return json({ escopo, ...row, atualizado_em: row?.atualizado_em || '' })
}

async function automations(request, env) {
  const user = await session(request, env)
  if (!user) return unauthorized()
  if (user.perfil !== 'RG') return forbidden()
  const { results = [] } = await env.DB.prepare(`
    SELECT id, nome, status, ultima_execucao, proxima_execucao
      FROM automacoes WHERE regional_id = ? ORDER BY nome
  `).bind(user.regional_id).all()
  return json({ automacoes: results })
}

async function createDistrict(request, env) {
  const user = await session(request, env)
  if (!user) return unauthorized()
  if (user.perfil !== 'RG') return forbidden()
  const data = await body(request)
  const nome = String(data.nome || '').trim()
  const codigo = String(data.codigo || '').trim()
  const gerente = String(data.gerente_nome || '').trim()
  if (!nome || !codigo) return badRequest('Informe nome e código da Distrital.')
  await env.DB.prepare(`
    INSERT INTO distritais (regional_id, nome, codigo, gerente_nome, ativo, criado_em)
    VALUES (?, ?, ?, ?, 1, datetime('now'))
  `).bind(user.regional_id, nome, codigo, gerente).run()
  return json({ ok: true }, 201)
}

async function createConsultant(request, env) {
  const user = await session(request, env)
  if (!user) return unauthorized()
  if (user.perfil !== 'RG') return forbidden()
  const data = await body(request)
  const districtId = Number(data.distrital_id)
  const nome = String(data.nome || '').trim()
  const codigo = String(data.codigo || '').trim()
  const email = String(data.email || '').trim().toLowerCase()
  const allowed = await env.DB.prepare('SELECT id FROM distritais WHERE id = ? AND regional_id = ?')
    .bind(districtId, user.regional_id).first()
  if (!allowed || !nome || !codigo) return badRequest('Distrital, nome e código são obrigatórios.')
  await env.DB.prepare(`
    INSERT INTO consultores (distrital_id, nome, codigo, email, ativo, criado_em)
    VALUES (?, ?, ?, ?, 1, datetime('now'))
  `).bind(districtId, nome, codigo, email).run()
  return json({ ok: true }, 201)
}

async function createUser(request, env) {
  const user = await session(request, env)
  if (!user) return unauthorized()
  if (user.perfil !== 'RG') return forbidden()
  const data = await body(request)
  const perfil = String(data.perfil || '').toUpperCase()
  const districtId = Number(data.distrital_id) || null
  const nome = String(data.nome || '').trim()
  const email = String(data.email || '').trim().toLowerCase()
  const senha = String(data.senha || '')
  if (!['RG', 'GD', 'CONSULTOR'].includes(perfil) || !nome || !email.includes('@') || senha.length < 8) {
    return badRequest('Preencha corretamente perfil, nome, e-mail e senha.')
  }
  if (perfil !== 'RG' && !districtId) return badRequest('Selecione a Distrital para GD ou Consultor.')
  if (districtId) {
    const allowed = await env.DB.prepare('SELECT id FROM distritais WHERE id = ? AND regional_id = ?')
      .bind(districtId, user.regional_id).first()
    if (!allowed) return badRequest('Distrital inválida.')
  }
  let consultantId = null
  if (perfil === 'CONSULTOR') {
    const consultant = await env.DB.prepare('SELECT id FROM consultores WHERE distrital_id = ? AND lower(email) = ?')
      .bind(districtId, email).first()
    consultantId = consultant?.id || null
  }
  await env.DB.prepare(`
    INSERT INTO usuarios (regional_id, distrital_id, consultor_id, nome, email, senha_hash, perfil, ativo, criado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
  `).bind(user.regional_id, districtId, consultantId, nome, email, await sha256(senha), perfil).run()
  return json({ ok: true }, 201)
}

async function createAutomation(request, env) {
  const user = await session(request, env)
  if (!user) return unauthorized()
  if (user.perfil !== 'RG') return forbidden()
  const data = await body(request)
  const nome = String(data.nome || '').trim()
  const next = String(data.proxima_execucao || '').trim() || null
  if (!nome) return badRequest('Informe o nome da automação.')
  await env.DB.prepare(`
    INSERT INTO automacoes (regional_id, nome, status, proxima_execucao, criado_em)
    VALUES (?, ?, 'ATIVO', ?, datetime('now'))
  `).bind(user.regional_id, nome, next).run()
  return json({ ok: true }, 201)
}

export async function onRequest(context) {
  const { request, env, params } = context
  if (!env.DB) return json({ erro: 'Binding D1 DB não configurado no Cloudflare.' }, 503)
  const url = new URL(request.url)
  const path = normalizePath(params).replace(/^\/+|\/+$/g, '')
  const method = request.method.toUpperCase()

  try {
    if (method === 'GET' && path === 'health') return json({ status: 'ok', database: 'ok' })
    if (method === 'GET' && path === 'regionais') return listRegionais(env)
    if (method === 'GET' && path === 'setup-status') return setupStatus(url, env)
    if (method === 'POST' && path === 'setup') return setup(request, env)
    if (method === 'POST' && path === 'login') return login(request, env)
    if (method === 'GET' && path === 'me') return me(request, env)
    if (method === 'POST' && path === 'logout') return logout(request, env)
    if (method === 'GET' && path === 'hierarquia') return hierarchy(request, env)
    if (method === 'GET' && path === 'dashboard') return dashboard(request, env, url)
    if (method === 'GET' && path === 'automacoes') return automations(request, env)
    if (method === 'POST' && path === 'admin/distritais') return createDistrict(request, env)
    if (method === 'POST' && path === 'admin/consultores') return createConsultant(request, env)
    if (method === 'POST' && path === 'admin/usuarios') return createUser(request, env)
    if (method === 'POST' && path === 'admin/automacoes') return createAutomation(request, env)
    return json({ erro: 'Rota não encontrada.' }, 404)
  } catch (error) {
    console.error(error)
    const detail = String(error?.message || error)
    if (detail.includes('UNIQUE constraint failed')) return json({ erro: 'Já existe um cadastro com estes dados.' }, 409)
    return json({ erro: 'Erro interno ao processar a solicitação.', detalhe: detail }, 500)
  }
}
