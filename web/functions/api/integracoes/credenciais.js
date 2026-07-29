import {
  badRequest,
  encryptCredentials,
  json,
  maskEmail,
  readBody,
  requireRG,
} from '../_lib/security.js'

const TYPES = ['BUSSOLA', 'MERCADO_FARMA']

function upsertCredential(env, user, type, maskedLogin, encrypted, now) {
  return env.DB.prepare(`
    INSERT INTO credenciais_integracoes
      (regional_id, usuario_id, tipo, usuario_mascarado, credencial_cifrada,
       status, mensagem_status, atualizado_em)
    VALUES (?, ?, ?, ?, ?, 'CONFIGURADA', ?, ?)
    ON CONFLICT(regional_id, tipo) DO UPDATE SET
      usuario_id = excluded.usuario_id,
      usuario_mascarado = excluded.usuario_mascarado,
      credencial_cifrada = excluded.credencial_cifrada,
      status = 'CONFIGURADA',
      mensagem_status = excluded.mensagem_status,
      testado_em = NULL,
      atualizado_em = excluded.atualizado_em
  `).bind(
    user.regional_id,
    user.id,
    type,
    maskedLogin,
    encrypted,
    'Credencial única configurada para Bússola e Mercado Farma.',
    now,
  )
}

export async function onRequestGet({ request, env }) {
  const { denial, user } = await requireRG(request, env)
  if (denial) return denial

  const result = await env.DB.prepare(`
    SELECT tipo, usuario_mascarado, status, mensagem_status, testado_em, atualizado_em
      FROM credenciais_integracoes
     WHERE regional_id = ? AND status = 'CONFIGURADA'
     ORDER BY atualizado_em DESC
  `).bind(user.regional_id).all()

  const shared = (result.results || [])[0] || null
  return json({
    integracao: shared,
    bussola: shared,
    mercado_farma: shared,
  })
}

export async function onRequestPost({ request, env }) {
  const { denial, user } = await requireRG(request, env)
  if (denial) return denial

  const data = await readBody(request)
  const login = String(data.usuario || data.login || '').trim()
  const password = String(data.senha || '')

  if (login.length < 3 || password.length < 3) {
    return badRequest('Informe o login e a senha usados no Bússola e no Mercado Farma.')
  }

  const now = new Date().toISOString()
  const maskedLogin = maskEmail(login)
  const encryptedValues = await Promise.all(TYPES.map((type) => encryptCredentials({
    usuario: login,
    segredo: password,
    tipo: type,
    regional_id: Number(user.regional_id),
    usuario_id: Number(user.id),
    salvo_em: now,
  }, env.PAINEL_REGIONAL_KEY)))

  await env.DB.batch(TYPES.map((type, index) => upsertCredential(
    env,
    user,
    type,
    maskedLogin,
    encryptedValues[index],
    now,
  )))

  const shared = {
    tipo: 'COMPARTILHADA',
    usuario_mascarado: maskedLogin,
    status: 'CONFIGURADA',
    mensagem_status: 'Credencial única configurada para Bússola e Mercado Farma.',
    atualizado_em: now,
  }

  return json({
    sucesso: true,
    integracao: shared,
    bussola: shared,
    mercado_farma: shared,
    usuario_mascarado: maskedLogin,
    mensagem: 'Acesso único do Bússola e Mercado Farma salvo com segurança.',
  }, 201)
}
