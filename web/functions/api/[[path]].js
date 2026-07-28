const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  },
})

const badRequest = (erro) => json({ erro }, 400)
const unauthorized = (erro = 'E-mail ou senha inválidos.') => json({ erro }, 401)
const forbidden = (erro = 'Seu perfil não possui permissão para esta operação.') => json({ erro }, 403)
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const toHex = (bytes) => [...bytes].map((item) => item.toString(16).padStart(2, '0')).join('')
const fromHex = (value) => new Uint8Array(String(value).match(/.{1,2}/g)?.map((item) => Number.parseInt(item, 16)) || [])

async function body(request) {
  try { return await request.json() } catch { return {} }
}

async function derivePassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(String(password)), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt,
    iterations: 150000,
  }, key, 256)
  return new Uint8Array(bits)
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const derived = await derivePassword(password, salt)
  return `${toHex(salt)}:${toHex(derived)}`
}

async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored || '').split(':')
  if (!saltHex || !hashHex) return false
  const actual = await derivePassword(password, fromHex(saltHex))
  const expected = fromHex(hashHex)
  if (actual.length !== expected.length) return false
  let mismatch = 0
  for (let index = 0; index < actual.length; index += 1) mismatch |= actual[index] ^ expected[index]
  return mismatch === 0
}

async function encryptionKey(secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('A chave de proteção das credenciais ainda não foi configurada.')
  }
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`painel-regional:credenciais:v1:${secret}`))
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

async function encryptCredentials(payload, secret) {
  const key = await encryptionKey(secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = encoder.encode(JSON.stringify(payload))
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext))
  return `v1.${toHex(iv)}.${toHex(encrypted)}`
}

function maskEmail(email) {
  const value = String(email || '').trim().toLowerCase()
  const [name, domain] = value.split('@')
  if (!domain) return value ? `${value.slice(0, 3)}***` : ''
  return `${name.slice(0, Math.min(3, name.length))}${'*'.repeat(Math.max(3, name.length - 3))}@${domain}`
}

function token() {
  return toHex(crypto.getRandomValues(new Uint8Array(32)))
}

function normalizePath(params) {
  const value = params?.path
  return Array.isArray(value) ? value.join('/') : String(value || '')
}

function publicUser(row) {
  return {
    id: Number(row.id),
    nome: row.nome,
    email: row.email,
    perfil: row.perfil,
    regional_id: row.regional_id == null ? null : Number(row.regional_id),
    distrital_id: row.distrital_id == null ? null : Number(row.distrital_id),
    consultor_id: row.consultor_id == null ? null : Number(row.consultor_id),
  }
}

async function createSession(env, type, userId) {
  const value = token()
  await env.DB.prepare(`
    INSERT INTO sessoes_acesso (token, tipo_usuario, usuario_id, criado_em, expira_em)
    VALUES (?, ?, ?, datetime('now'), datetime('now', '+7 days'))
  `).bind(value, type, userId).run()
  return value
}

async function session(request, env) {
  const authorization = request.headers.get('authorization') || ''
  const value = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (!value) return null

  const current = await env.DB.prepare(`
    SELECT tipo_usuario, usuario_id
      FROM sessoes_acesso
     WHERE token = ? AND expira_em > datetime('now')
  `).bind(value).first()
  if (!current) return null

  if (current.tipo_usuario === 'DESENVOLVEDOR') {
    const developer = await env.DB.prepare(`
      SELECT id, nome, email
        FROM desenvolvedores
       WHERE id = ? AND ativo = 1
    `).bind(current.usuario_id).first()
    return developer ? { ...developer, perfil: 'DESENVOLVEDOR', tipo_usuario: 'DESENVOLVEDOR' } : null
  }

  const user = await env.DB.prepare(`
    SELECT u.id, u.nome, u.email, u.perfil, u.regional_id, u.distrital_id, u.consultor_id,
           r.nome AS regional_nome, r.slug AS regional_slug
      FROM usuarios u
      JOIN regionais r ON r.id = u.regional_id
     WHERE u.id = ? AND u.ativo = 1 AND r.ativo = 1
  `).bind(current.usuario_id).first()
  return user ? { ...user, tipo_usuario: 'USUARIO' } : null
}

async function requireSession(request, env) {
  return session(request, env)
}

async function requireDeveloper(request, env) {
  const user = await requireSession(request, env)
  if (!user) return { denial: unauthorized('Sessão expirada. Entre novamente.'), user: null }
  if (user.perfil !== 'DESENVOLVEDOR') return { denial: forbidden(), user }
  return { denial: null, user }
}

async function requireRegionalUser(request, env) {
  const user = await requireSession(request, env)
  if (!user) return { denial: unauthorized('Sessão expirada. Entre novamente.'), user: null }
  if (user.perfil === 'DESENVOLVEDOR') return { denial: forbidden('Selecione uma função administrativa do desenvolvedor.'), user }
  return { denial: null, user }
}

async function requireRG(request, env) {
  const result = await requireRegionalUser(request, env)
  if (result.denial) return result
  if (result.user.perfil !== 'RG') return { denial: forbidden('Apenas o Gerente Regional pode realizar esta operação.'), user: result.user }
  return result
}

async function authStatus(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS total FROM desenvolvedores WHERE ativo = 1').first()
  return json({ desenvolvedor_configurado: Number(row?.total || 0) > 0 })
}

async function developerSetup(request, env) {
  const existing = await env.DB.prepare('SELECT COUNT(*) AS total FROM desenvolvedores WHERE ativo = 1').first()
  if (Number(existing?.total || 0) > 0) return forbidden('O primeiro acesso do desenvolvedor já foi criado.')

  const data = await body(request)
  const nome = String(data.nome || '').trim()
  const email = String(data.email || '').trim().toLowerCase()
  const senha = String(data.senha || '')
  if (nome.length < 3 || !email.includes('@') || senha.length < 8) {
    return badRequest('Informe nome, e-mail válido e senha com pelo menos 8 caracteres.')
  }

  const created = await env.DB.prepare(`
    INSERT INTO desenvolvedores (nome, email, senha_hash, ativo, criado_em)
    VALUES (?, ?, ?, 1, datetime('now'))
  `).bind(nome, email, await hashPassword(senha)).run()
  const id = Number(created.meta.last_row_id)
  const sessionToken = await createSession(env, 'DESENVOLVEDOR', id)
  return json({
    token: sessionToken,
    usuario: { id, nome, email, perfil: 'DESENVOLVEDOR', regional_id: null, distrital_id: null, consultor_id: null },
  }, 201)
}

async function login(request, env) {
  const data = await body(request)
  const email = String(data.email || '').trim().toLowerCase()
  const senha = String(data.senha || '')
  if (!email || !senha) return badRequest('Informe e-mail e senha.')

  const developer = await env.DB.prepare(`
    SELECT id, nome, email, senha_hash
      FROM desenvolvedores
     WHERE lower(email) = ? AND ativo = 1
  `).bind(email).first()
  if (developer && await verifyPassword(senha, developer.senha_hash)) {
    const now = new Date().toISOString()
    await env.DB.prepare('UPDATE desenvolvedores SET ultimo_acesso_em = ? WHERE id = ?').bind(now, developer.id).run()
    const sessionToken = await createSession(env, 'DESENVOLVEDOR', developer.id)
    return json({
      token: sessionToken,
      usuario: { id: developer.id, nome: developer.nome, email: developer.email, perfil: 'DESENVOLVEDOR', regional_id: null, distrital_id: null, consultor_id: null },
    })
  }

  const user = await env.DB.prepare(`
    SELECT u.*, r.nome AS regional_nome, r.slug AS regional_slug
      FROM usuarios u
      JOIN regionais r ON r.id = u.regional_id
     WHERE lower(u.email) = ? AND u.ativo = 1 AND r.ativo = 1
     ORDER BY u.id
     LIMIT 1
  `).bind(email).first()
  if (!user || !(await verifyPassword(senha, user.senha_hash))) return unauthorized()

  const sessionToken = await createSession(env, 'USUARIO', user.id)
  return json({
    token: sessionToken,
    usuario: publicUser(user),
    regional: { id: user.regional_id, nome: user.regional_nome, slug: user.regional_slug },
  })
}

async function me(request, env) {
  const user = await session(request, env)
  if (!user) return unauthorized('Sessão expirada. Entre novamente.')
  if (user.perfil === 'DESENVOLVEDOR') return json({ usuario: publicUser(user), regional: null })
  return json({
    usuario: publicUser(user),
    regional: { id: user.regional_id, nome: user.regional_nome, slug: user.regional_slug },
  })
}

async function logout(request, env) {
  const authorization = request.headers.get('authorization') || ''
  const value = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (value) await env.DB.prepare('DELETE FROM sessoes_acesso WHERE token = ?').bind(value).run()
  return json({ ok: true })
}

async function developerStructure(request, env) {
  const { denial } = await requireDeveloper(request, env)
  if (denial) return denial
  const [regionals, managers] = await env.DB.batch([
    env.DB.prepare(`SELECT id, nome, slug, ativo, criado_em FROM regionais ORDER BY nome`),
    env.DB.prepare(`
      SELECT u.id, u.nome, u.email, u.regional_id, u.ativo, r.nome AS regional_nome,
             CASE WHEN c.id IS NULL THEN 0 ELSE 1 END AS credencial_configurada,
             c.usuario_mascarado, c.status AS credencial_status, c.atualizado_em AS credencial_atualizada_em
        FROM usuarios u
        JOIN regionais r ON r.id = u.regional_id
        LEFT JOIN credenciais_extracao c ON c.usuario_id = u.id AND c.regional_id = u.regional_id
       WHERE u.perfil = 'RG'
       ORDER BY r.nome, u.nome
    `),
  ])
  return json({ regionais: regionals.results || [], gerentes_regionais: managers.results || [] })
}

async function createRegional(request, env) {
  const { denial } = await requireDeveloper(request, env)
  if (denial) return denial
  const data = await body(request)
  const nome = String(data.nome || '').trim()
  const slug = String(data.slug || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  if (nome.length < 3 || slug.length < 2) return badRequest('Informe o nome e o identificador da Regional.')
  await env.DB.prepare(`
    INSERT INTO regionais (nome, slug, ativo, criado_em)
    VALUES (?, ?, 1, datetime('now'))
  `).bind(nome, slug).run()
  return json({ ok: true }, 201)
}

async function emailInUse(env, email) {
  const [developers, users] = await env.DB.batch([
    env.DB.prepare('SELECT id FROM desenvolvedores WHERE lower(email) = ? LIMIT 1').bind(email),
    env.DB.prepare('SELECT id FROM usuarios WHERE lower(email) = ? LIMIT 1').bind(email),
  ])
  return Boolean(developers.results?.length || users.results?.length)
}

async function createRegionalManager(request, env) {
  const { denial } = await requireDeveloper(request, env)
  if (denial) return denial
  const data = await body(request)
  const regionalId = Number(data.regional_id)
  const nome = String(data.nome || '').trim()
  const email = String(data.email || '').trim().toLowerCase()
  const senha = String(data.senha || '')
  if (!regionalId || nome.length < 3 || !email.includes('@') || senha.length < 8) {
    return badRequest('Informe Regional, nome, e-mail e senha com pelo menos 8 caracteres.')
  }
  const regional = await env.DB.prepare('SELECT id FROM regionais WHERE id = ? AND ativo = 1').bind(regionalId).first()
  if (!regional) return badRequest('Regional inválida.')
  if (await emailInUse(env, email)) return json({ erro: 'Este e-mail já possui acesso cadastrado.' }, 409)

  const passwordHash = await hashPassword(senha)
  const encrypted = await encryptCredentials({
    usuario: email,
    segredo: senha,
    regional_id: regionalId,
    salvo_em: new Date().toISOString(),
  }, env.PAINEL_REGIONAL_KEY)

  const created = await env.DB.prepare(`
    INSERT INTO usuarios (regional_id, nome, email, senha_hash, perfil, ativo, criado_em)
    VALUES (?, ?, ?, ?, 'RG', 1, datetime('now'))
  `).bind(regionalId, nome, email, passwordHash).run()
  const userId = Number(created.meta.last_row_id)
  const now = new Date().toISOString()
  await env.DB.prepare(`
    INSERT INTO credenciais_extracao
      (regional_id, usuario_id, usuario_mascarado, credencial_cifrada, status, mensagem_status, atualizado_em)
    VALUES (?, ?, ?, ?, 'CONFIGURADA', ?, ?)
    ON CONFLICT(regional_id) DO UPDATE SET
      usuario_id = excluded.usuario_id,
      usuario_mascarado = excluded.usuario_mascarado,
      credencial_cifrada = excluded.credencial_cifrada,
      status = 'CONFIGURADA',
      mensagem_status = excluded.mensagem_status,
      atualizado_em = excluded.atualizado_em
  `).bind(
    regionalId,
    userId,
    maskEmail(email),
    encrypted,
    'Credencial do Gerente Regional preparada para Bússola e Mercado Farma.',
    now,
  ).run()
  return json({ ok: true, usuario_id: userId }, 201)
}

async function hierarchy(request, env) {
  const { denial, user } = await requireRegionalUser(request, env)
  if (denial) return denial
  if (user.perfil === 'CONSULTOR' && !user.consultor_id) return forbidden('Este Consultor ainda não está vinculado ao cadastro da equipe.')

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
  const { denial, user } = await requireRegionalUser(request, env)
  if (denial) return denial

  let districtId = Number(url.searchParams.get('distrital_id')) || null
  let consultantId = Number(url.searchParams.get('consultor_id')) || null
  if (user.perfil === 'GD') districtId = user.distrital_id
  if (user.perfil === 'CONSULTOR') {
    if (!user.consultor_id) return forbidden('Este Consultor ainda não está vinculado ao cadastro da equipe.')
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

  let scope = 'Resultado Regional'
  if (districtId) {
    const district = await env.DB.prepare('SELECT nome FROM distritais WHERE id = ? AND regional_id = ?').bind(districtId, user.regional_id).first()
    scope = district?.nome || 'Resultado Distrital'
  }
  if (consultantId) {
    const consultant = await env.DB.prepare('SELECT nome FROM consultores WHERE id = ?').bind(consultantId).first()
    scope = consultant?.nome || 'Resultado do Consultor'
  }
  return json({ escopo: scope, ...row, atualizado_em: row?.atualizado_em || '' })
}

async function integrationStatus(request, env) {
  const { denial, user } = await requireRG(request, env)
  if (denial) return denial
  const current = await env.DB.prepare(`
    SELECT usuario_mascarado, status, mensagem_status, testado_em, atualizado_em
      FROM credenciais_extracao
     WHERE regional_id = ? AND usuario_id = ?
  `).bind(user.regional_id, user.id).first()
  return json({
    configurada: Boolean(current),
    usuario_mascarado: current?.usuario_mascarado || maskEmail(user.email),
    status: current?.status || 'NAO_CONFIGURADA',
    mensagem: current?.mensagem_status || 'A credencial de extração ainda não foi preparada.',
    testado_em: current?.testado_em || null,
    atualizado_em: current?.atualizado_em || null,
  })
}

async function automations(request, env) {
  const { denial, user } = await requireRG(request, env)
  if (denial) return denial
  const [commands, extractions, credential] = await env.DB.batch([
    env.DB.prepare(`
      SELECT id, tipo, status, mensagem, erro, solicitado_em, iniciado_em, finalizado_em
        FROM comandos_automacao
       WHERE regional_id = ?
       ORDER BY solicitado_em DESC LIMIT 30
    `).bind(user.regional_id),
    env.DB.prepare(`
      SELECT id, tipo, status, total_registros, mensagem, erro, iniciado_em, finalizado_em, criado_em
        FROM extracoes
       WHERE regional_id = ?
       ORDER BY criado_em DESC LIMIT 30
    `).bind(user.regional_id),
    env.DB.prepare('SELECT id, status FROM credenciais_extracao WHERE regional_id = ? AND usuario_id = ?').bind(user.regional_id, user.id),
  ])
  const active = (commands.results || []).filter((item) => ['aguardando', 'executando'].includes(String(item.status).toLowerCase())).length
  return json({
    comandos: commands.results || [],
    extracoes: extractions.results || [],
    em_execucao: active,
    credencial_configurada: Boolean(credential.results?.length),
    atualizado_em: new Date().toISOString(),
  })
}

async function requestAutomation(request, env) {
  const { denial, user } = await requireRG(request, env)
  if (denial) return denial
  const data = await body(request)
  const type = String(data.tipo || '').trim().toUpperCase()
  if (!['BUSSOLA', 'MERCADO_FARMA'].includes(type)) return badRequest('Tipo de automação inválido.')
  const credential = await env.DB.prepare('SELECT id FROM credenciais_extracao WHERE regional_id = ? AND usuario_id = ?').bind(user.regional_id, user.id).first()
  if (!credential) return badRequest('A credencial de extração deste Gerente Regional ainda não está configurada.')
  const existing = await env.DB.prepare(`
    SELECT id FROM comandos_automacao
     WHERE regional_id = ? AND tipo = ? AND status IN ('aguardando', 'executando')
     LIMIT 1
  `).bind(user.regional_id, type).first()
  if (existing) return json({ erro: 'Esta extração já está aguardando ou em execução.' }, 409)
  const id = `cmd-${crypto.randomUUID()}`
  const now = new Date().toISOString()
  await env.DB.prepare(`
    INSERT INTO comandos_automacao
      (id, regional_id, tipo, parametros_json, status, solicitado_por, mensagem, solicitado_em, atualizado_em)
    VALUES (?, ?, ?, '{}', 'aguardando', ?, ?, ?, ?)
  `).bind(id, user.regional_id, type, user.email, 'Solicitação registrada. O processador regional usará a credencial vinculada ao RG.', now, now).run()
  return json({ sucesso: true, id, status: 'aguardando', mensagem: 'Solicitação registrada na fila regional.' }, 202)
}

async function createDistrict(request, env) {
  const { denial, user } = await requireRG(request, env)
  if (denial) return denial
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
  const { denial, user } = await requireRG(request, env)
  if (denial) return denial
  const data = await body(request)
  const districtId = Number(data.distrital_id)
  const nome = String(data.nome || '').trim()
  const codigo = String(data.codigo || '').trim()
  const email = String(data.email || '').trim().toLowerCase()
  const allowed = await env.DB.prepare('SELECT id FROM distritais WHERE id = ? AND regional_id = ?').bind(districtId, user.regional_id).first()
  if (!allowed || !nome || !codigo) return badRequest('Distrital, nome e código são obrigatórios.')
  await env.DB.prepare(`
    INSERT INTO consultores (distrital_id, nome, codigo, email, ativo, criado_em)
    VALUES (?, ?, ?, ?, 1, datetime('now'))
  `).bind(districtId, nome, codigo, email).run()
  return json({ ok: true }, 201)
}

async function createUser(request, env) {
  const { denial, user } = await requireRG(request, env)
  if (denial) return denial
  const data = await body(request)
  const profile = String(data.perfil || '').toUpperCase()
  const districtId = Number(data.distrital_id) || null
  const nome = String(data.nome || '').trim()
  const email = String(data.email || '').trim().toLowerCase()
  const senha = String(data.senha || '')
  if (!['GD', 'CONSULTOR'].includes(profile) || !nome || !email.includes('@') || senha.length < 8) {
    return badRequest('Preencha corretamente perfil, nome, e-mail e senha.')
  }
  if (!districtId) return badRequest('Selecione a Distrital.')
  const allowed = await env.DB.prepare('SELECT id FROM distritais WHERE id = ? AND regional_id = ?').bind(districtId, user.regional_id).first()
  if (!allowed) return badRequest('Distrital inválida.')
  if (await emailInUse(env, email)) return json({ erro: 'Este e-mail já possui acesso cadastrado.' }, 409)

  let consultantId = null
  if (profile === 'CONSULTOR') {
    const consultant = await env.DB.prepare('SELECT id FROM consultores WHERE distrital_id = ? AND lower(email) = ?').bind(districtId, email).first()
    if (!consultant) return badRequest('Cadastre primeiro o Consultor na Distrital usando o mesmo e-mail do acesso.')
    consultantId = consultant.id
  }
  await env.DB.prepare(`
    INSERT INTO usuarios (regional_id, distrital_id, consultor_id, nome, email, senha_hash, perfil, ativo, criado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
  `).bind(user.regional_id, districtId, consultantId, nome, email, await hashPassword(senha), profile).run()
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
    if (method === 'GET' && path === 'auth/status') return authStatus(env)
    if (method === 'POST' && path === 'auth/developer-setup') return developerSetup(request, env)
    if (method === 'POST' && path === 'auth/login') return login(request, env)
    if (method === 'GET' && path === 'me') return me(request, env)
    if (method === 'POST' && path === 'logout') return logout(request, env)
    if (method === 'GET' && path === 'developer/estrutura') return developerStructure(request, env)
    if (method === 'POST' && path === 'developer/regionais') return createRegional(request, env)
    if (method === 'POST' && path === 'developer/gerentes-regionais') return createRegionalManager(request, env)
    if (method === 'GET' && path === 'hierarquia') return hierarchy(request, env)
    if (method === 'GET' && path === 'dashboard') return dashboard(request, env, url)
    if (method === 'GET' && path === 'integracoes/status') return integrationStatus(request, env)
    if (method === 'GET' && path === 'automacoes') return automations(request, env)
    if (method === 'POST' && path === 'automacoes/solicitar') return requestAutomation(request, env)
    if (method === 'POST' && path === 'admin/distritais') return createDistrict(request, env)
    if (method === 'POST' && path === 'admin/consultores') return createConsultant(request, env)
    if (method === 'POST' && path === 'admin/usuarios') return createUser(request, env)
    return json({ erro: 'Rota não encontrada.' }, 404)
  } catch (error) {
    console.error(error)
    const detail = String(error?.message || error)
    if (detail.includes('UNIQUE constraint failed')) return json({ erro: 'Já existe um cadastro com estes dados.' }, 409)
    if (detail.includes('no such table')) return json({ erro: 'A atualização do banco ainda está sendo aplicada. Aguarde o deploy terminar.', detalhe: detail }, 503)
    return json({ erro: 'Erro interno ao processar a solicitação.', detalhe: detail }, 500)
  }
}
