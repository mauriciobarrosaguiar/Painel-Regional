import {
  badRequest,
  createSession,
  ensureAuthSchema,
  forbidden,
  hashPassword,
  json,
  readBody,
} from '../_lib/security.js'

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) return json({ erro: 'Binding D1 DB não configurado no Cloudflare.' }, 503)
    await ensureAuthSchema(env)

    const existing = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM desenvolvedores WHERE ativo = 1',
    ).first()
    if (Number(existing?.total || 0) > 0) {
      return forbidden('O primeiro acesso do desenvolvedor já foi criado.')
    }

    const data = await readBody(request)
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

    const id = Number(created.meta?.last_row_id)
    if (!id) throw new Error('O banco não retornou o identificador do novo acesso.')

    const token = await createSession(env, 'DESENVOLVEDOR', id)
    return json({
      token,
      usuario: {
        id,
        nome,
        email,
        perfil: 'DESENVOLVEDOR',
        regional_id: null,
        distrital_id: null,
        consultor_id: null,
      },
    }, 201)
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : String(error)
    if (detalhe.includes('UNIQUE constraint failed')) {
      return json({ erro: 'Este e-mail já possui acesso cadastrado.' }, 409)
    }
    return json({ erro: 'Não foi possível criar o primeiro acesso.', detalhe }, 500)
  }
}
