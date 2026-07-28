import {
  badRequest,
  encryptCredentials,
  hashPassword,
  json,
  maskEmail,
  readBody,
  requireDeveloper,
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
    const { denial } = await requireDeveloper(request, env)
    if (denial) return denial

    const data = await readBody(request)
    const regionalId = Number(data.regional_id)
    const nome = String(data.nome || '').trim()
    const email = String(data.email || '').trim().toLowerCase()
    const senha = String(data.senha || '')

    if (!regionalId || nome.length < 3 || !email.includes('@') || senha.length < 8) {
      return badRequest('Informe Regional, nome, e-mail e senha com pelo menos 8 caracteres.')
    }

    const regional = await env.DB.prepare(
      'SELECT id FROM regionais WHERE id = ? AND ativo = 1',
    ).bind(regionalId).first()
    if (!regional) return badRequest('Regional inválida.')
    if (await emailInUse(env, email)) {
      return json({ erro: 'Este e-mail já possui acesso cadastrado.' }, 409)
    }

    const senhaHash = await hashPassword(senha)
    const credencial = await encryptCredentials({
      usuario: email,
      segredo: senha,
      regional_id: regionalId,
      salvo_em: new Date().toISOString(),
    }, env.PAINEL_REGIONAL_KEY)

    const created = await env.DB.prepare(`
      INSERT INTO usuarios (regional_id, nome, email, senha_hash, perfil, ativo, criado_em)
      VALUES (?, ?, ?, ?, 'RG', 1, datetime('now'))
    `).bind(regionalId, nome, email, senhaHash).run()

    const userId = Number(created.meta?.last_row_id)
    if (!userId) throw new Error('O banco não retornou o identificador do Gerente Regional.')

    const now = new Date().toISOString()
    try {
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
        credencial,
        'Credencial do Gerente Regional preparada para Bússola e Mercado Farma.',
        now,
      ).run()
    } catch (error) {
      await env.DB.prepare('DELETE FROM usuarios WHERE id = ?').bind(userId).run()
      throw error
    }

    return json({ ok: true, usuario_id: userId }, 201)
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : String(error)
    if (detalhe.includes('UNIQUE constraint failed')) {
      return json({ erro: 'Já existe um cadastro com estes dados.' }, 409)
    }
    if (detalhe.includes('no such table')) {
      return json({ erro: 'A atualização do banco ainda não foi aplicada.', detalhe }, 503)
    }
    return json({ erro: 'Não foi possível criar o Gerente Regional.', detalhe }, 500)
  }
}
