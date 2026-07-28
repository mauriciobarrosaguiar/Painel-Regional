import {
  badRequest,
  hashPassword,
  json,
  readBody,
  requireRG,
} from '../_lib/security.js'

async function emailInUse(env, email) {
  const [developers, users] = await env.DB.batch([
    env.DB.prepare('SELECT id FROM desenvolvedores WHERE lower(email) = ? LIMIT 1').bind(email),
    env.DB.prepare('SELECT id FROM usuarios WHERE lower(email) = ? LIMIT 1').bind(email),
  ])
  return Boolean(developers.results?.length || users.results?.length)
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) return json({ erro: 'Binding D1 DB não configurado no Cloudflare.' }, 503)
    const { denial, user } = await requireRG(request, env)
    if (denial) return denial

    const data = await readBody(request)
    const perfil = String(data.perfil || '').toUpperCase()
    const distritalId = Number(data.distrital_id) || null
    const nome = String(data.nome || '').trim()
    const email = String(data.email || '').trim().toLowerCase()
    const senha = String(data.senha || '')

    if (!['GD', 'CONSULTOR'].includes(perfil) || !nome || !email.includes('@') || senha.length < 8) {
      return badRequest('Preencha corretamente perfil, nome, e-mail e senha.')
    }
    if (!distritalId) return badRequest('Selecione a Distrital.')

    const distrital = await env.DB.prepare(
      'SELECT id FROM distritais WHERE id = ? AND regional_id = ? AND ativo = 1',
    ).bind(distritalId, user.regional_id).first()
    if (!distrital) return badRequest('Distrital inválida.')
    if (await emailInUse(env, email)) {
      return json({ erro: 'Este e-mail já possui acesso cadastrado.' }, 409)
    }

    let consultorId = null
    if (perfil === 'CONSULTOR') {
      const consultor = await env.DB.prepare(`
        SELECT id FROM consultores
         WHERE distrital_id = ? AND lower(email) = ? AND ativo = 1
      `).bind(distritalId, email).first()
      if (!consultor) {
        return badRequest('Cadastre primeiro o Consultor na Distrital usando o mesmo e-mail do acesso.')
      }
      consultorId = consultor.id
    }

    await env.DB.prepare(`
      INSERT INTO usuarios
        (regional_id, distrital_id, consultor_id, nome, email, senha_hash, perfil, ativo, criado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
    `).bind(
      user.regional_id,
      distritalId,
      consultorId,
      nome,
      email,
      await hashPassword(senha),
      perfil,
    ).run()

    return json({ ok: true }, 201)
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : String(error)
    if (detalhe.includes('UNIQUE constraint failed')) {
      return json({ erro: 'Já existe um cadastro com estes dados.' }, 409)
    }
    return json({ erro: 'Não foi possível criar o acesso.', detalhe }, 500)
  }
}
