import {
  createSession,
  ensureAuthSchema,
  hashImportedPassword,
  json,
  publicUser,
  readBody,
  unauthorized,
  verifyPassword,
  badRequest,
} from '../_lib/security.js'

function loginIdentity(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return { raw: '', local: '', email: '' }
  const local = raw.includes('@') ? raw.split('@')[0] : raw
  return {
    raw,
    local,
    email: raw.includes('@') ? raw : `${raw}@ems.com.br`,
  }
}

async function verifyUserPassword(password, user, env, identity) {
  const contexts = [...new Set([
    user.login_rede,
    user.email,
    identity.raw,
    identity.email,
    identity.local,
  ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))]

  for (const context of contexts) {
    if (await verifyPassword(password, user.senha_hash, env.PAINEL_REGIONAL_KEY, context)) {
      return context
    }
  }
  return ''
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) return json({ erro: 'Binding D1 DB não configurado no Cloudflare.' }, 503)
    await ensureAuthSchema(env)

    const data = await readBody(request)
    const identity = loginIdentity(data.email || data.login)
    const senha = String(data.senha || '')
    if (!identity.raw || !senha) return badRequest('Informe a matrícula ou o e-mail EMS e a senha.')

    const developer = await env.DB.prepare(`
      SELECT id, nome, email, senha_hash
        FROM desenvolvedores
       WHERE lower(email) = ? AND ativo = 1
    `).bind(identity.raw).first()

    if (developer && await verifyPassword(senha, developer.senha_hash)) {
      const now = new Date().toISOString()
      await env.DB.prepare(
        'UPDATE desenvolvedores SET ultimo_acesso_em = ? WHERE id = ?',
      ).bind(now, developer.id).run()
      const token = await createSession(env, 'DESENVOLVEDOR', developer.id)
      return json({
        token,
        usuario: {
          id: Number(developer.id),
          nome: developer.nome,
          email: developer.email,
          perfil: 'DESENVOLVEDOR',
          regional_id: null,
          distrital_id: null,
          consultor_id: null,
        },
        regional: null,
      })
    }

    const user = await env.DB.prepare(`
      SELECT u.*, r.nome AS regional_nome, r.slug AS regional_slug
        FROM usuarios u
        JOIN regionais r ON r.id = u.regional_id
       WHERE (
              lower(trim(u.email)) IN (?, ?)
           OR lower(trim(u.login_rede)) IN (?, ?)
       )
         AND u.ativo = 1
         AND u.na_base_atual = 1
         AND r.ativo = 1
         AND r.na_base_atual = 1
       ORDER BY
         CASE WHEN lower(trim(u.login_rede)) = ? THEN 0 ELSE 1 END,
         u.id
       LIMIT 1
    `).bind(
      identity.local,
      identity.email,
      identity.local,
      identity.email,
      identity.email,
    ).first()

    const matchedContext = user
      ? await verifyUserPassword(senha, user, env, identity)
      : ''

    if (!user || !matchedContext) {
      return unauthorized('Matrícula EMS ou senha do setor inválidos.')
    }

    // Corrige automaticamente acessos importados em versões antigas que usavam
    // a matrícula sem domínio como contexto do hash.
    const canonicalContext = String(user.login_rede || user.email || '').trim().toLowerCase()
    if (
      canonicalContext
      && matchedContext !== canonicalContext
      && String(user.senha_hash || '').startsWith('estrutura-sha256$')
    ) {
      const repairedHash = await hashImportedPassword(
        senha,
        canonicalContext,
        env.PAINEL_REGIONAL_KEY,
      )
      await env.DB.prepare(`
        UPDATE usuarios
           SET senha_hash = ?, atualizado_em = ?
         WHERE id = ?
      `).bind(repairedHash, new Date().toISOString(), user.id).run()
    }

    const token = await createSession(env, 'USUARIO', user.id)
    return json({
      token,
      usuario: publicUser(user),
      regional: {
        id: Number(user.regional_id),
        nome: user.regional_nome,
        slug: user.regional_slug,
      },
    })
  } catch (error) {
    return json({
      erro: 'Não foi possível entrar no painel.',
      detalhe: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
