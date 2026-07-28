import {
  createSession,
  ensureAuthSchema,
  json,
  publicUser,
  readBody,
  unauthorized,
  verifyPassword,
  badRequest,
} from '../_lib/security.js'

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) return json({ erro: 'Binding D1 DB não configurado no Cloudflare.' }, 503)
    await ensureAuthSchema(env)

    const data = await readBody(request)
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
       WHERE lower(u.email) = ? AND u.ativo = 1 AND r.ativo = 1
       ORDER BY u.id
       LIMIT 1
    `).bind(email).first()

    if (!user || !(await verifyPassword(senha, user.senha_hash))) return unauthorized()

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
