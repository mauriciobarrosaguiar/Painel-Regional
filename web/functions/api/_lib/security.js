const encoder = new TextEncoder()
const PASSWORD_ITERATIONS = 10000
const PASSWORD_PREFIX = 'pbkdf2-sha256'
const IMPORT_PASSWORD_PREFIX = 'estrutura-sha256'

export const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  },
})

export const badRequest = (erro) => json({ erro }, 400)
export const unauthorized = (erro = 'E-mail ou senha inválidos.') => json({ erro }, 401)
export const forbidden = (erro = 'Seu perfil não possui permissão para esta operação.') => json({ erro }, 403)

export async function readBody(request) {
  try { return await request.json() } catch { return {} }
}

const toHex = (bytes) => [...bytes].map((item) => item.toString(16).padStart(2, '0')).join('')
const fromHex = (value) => new Uint8Array(String(value).match(/.{1,2}/g)?.map((item) => Number.parseInt(item, 16)) || [])

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(String(value))))
}

async function derivePassword(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(String(password)),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt,
    iterations,
  }, key, 256)
  return new Uint8Array(bits)
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const derived = await derivePassword(password, salt, PASSWORD_ITERATIONS)
  return `${PASSWORD_PREFIX}$${PASSWORD_ITERATIONS}$${toHex(salt)}$${toHex(derived)}`
}

export async function hashImportedPassword(password, login, secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('A chave de proteção dos acessos importados ainda não foi configurada.')
  }
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)))
  const context = String(login || '').trim().toLowerCase()
  const digest = await sha256(`${IMPORT_PASSWORD_PREFIX}:${secret}:${context}:${String(password)}:${salt}`)
  return `${IMPORT_PASSWORD_PREFIX}$${salt}$${toHex(digest)}`
}

export async function verifyPassword(password, stored, secret = '', login = '') {
  const value = String(stored || '')

  if (value.startsWith(`${IMPORT_PASSWORD_PREFIX}$`)) {
    if (typeof secret !== 'string' || secret.length < 32) return false
    const parts = value.split('$')
    const salt = parts[1] || ''
    const expected = fromHex(parts[2] || '')
    if (!salt || !expected.length) return false
    const context = String(login || '').trim().toLowerCase()
    const actual = await sha256(`${IMPORT_PASSWORD_PREFIX}:${secret}:${context}:${String(password)}:${salt}`)
    if (actual.length !== expected.length) return false
    let mismatch = 0
    for (let index = 0; index < actual.length; index += 1) mismatch |= actual[index] ^ expected[index]
    return mismatch === 0
  }

  let iterations = PASSWORD_ITERATIONS
  let saltHex = ''
  let hashHex = ''

  if (value.startsWith(`${PASSWORD_PREFIX}$`)) {
    const parts = value.split('$')
    iterations = Number(parts[1])
    saltHex = parts[2] || ''
    hashHex = parts[3] || ''
  } else {
    // Compatibilidade com os primeiros cadastros feitos antes da otimização.
    const legacy = value.split(':')
    iterations = 150000
    saltHex = legacy[0] || ''
    hashHex = legacy[1] || ''
  }

  if (!Number.isInteger(iterations) || iterations < 1000 || !saltHex || !hashHex) return false
  const actual = await derivePassword(password, fromHex(saltHex), iterations)
  const expected = fromHex(hashHex)
  if (actual.length !== expected.length) return false

  let mismatch = 0
  for (let index = 0; index < actual.length; index += 1) mismatch |= actual[index] ^ expected[index]
  return mismatch === 0
}

function createToken() {
  return toHex(crypto.getRandomValues(new Uint8Array(32)))
}

export async function ensureAuthSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS desenvolvedores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        senha_hash TEXT NOT NULL,
        ativo INTEGER NOT NULL DEFAULT 1,
        criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ultimo_acesso_em TEXT
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS sessoes_acesso (
        token TEXT PRIMARY KEY,
        tipo_usuario TEXT NOT NULL CHECK (tipo_usuario IN ('DESENVOLVEDOR', 'USUARIO')),
        usuario_id INTEGER NOT NULL,
        criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expira_em TEXT NOT NULL
      )
    `),
  ])
}

export async function createSession(env, type, userId) {
  const value = createToken()
  await env.DB.prepare(`
    INSERT INTO sessoes_acesso (token, tipo_usuario, usuario_id, criado_em, expira_em)
    VALUES (?, ?, ?, datetime('now'), datetime('now', '+7 days'))
  `).bind(value, type, userId).run()
  return value
}

export async function getSession(request, env) {
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

export async function requireDeveloper(request, env) {
  const user = await getSession(request, env)
  if (!user) return { denial: unauthorized('Sessão expirada. Entre novamente.'), user: null }
  if (user.perfil !== 'DESENVOLVEDOR') return { denial: forbidden(), user }
  return { denial: null, user }
}

export async function requireRG(request, env) {
  const user = await getSession(request, env)
  if (!user) return { denial: unauthorized('Sessão expirada. Entre novamente.'), user: null }
  if (user.perfil !== 'RG') return { denial: forbidden('Apenas o Gerente Regional pode realizar esta operação.'), user }
  return { denial: null, user }
}

export function publicUser(row) {
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

async function encryptionKey(secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('A chave de proteção das credenciais ainda não foi configurada.')
  }
  const digest = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(`painel-regional:credenciais:v1:${secret}`),
  )
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt'])
}

export async function encryptCredentials(payload, secret) {
  const key = await encryptionKey(secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = encoder.encode(JSON.stringify(payload))
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext))
  return `v1.${toHex(iv)}.${toHex(encrypted)}`
}

export function maskEmail(email) {
  const value = String(email || '').trim().toLowerCase()
  const [name, domain] = value.split('@')
  if (!domain) return value ? `${value.slice(0, 3)}***` : ''
  return `${name.slice(0, Math.min(3, name.length))}${'*'.repeat(Math.max(3, name.length - 3))}@${domain}`
}
