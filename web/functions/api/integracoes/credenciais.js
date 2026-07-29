import {
  badRequest,
  encryptCredentials,
  json,
  maskEmail,
  readBody,
  requireRG,
} from '../_lib/security.js'

const TYPES = ['BUSSOLA', 'MERCADO_FARMA']

function label(type) {
  return type === 'BUSSOLA' ? 'Bússola' : 'Mercado Farma'
}

export async function onRequestGet({ request, env }) {
  const { denial, user } = await requireRG(request, env)
  if (denial) return denial

  const result = await env.DB.prepare(`
    SELECT tipo, usuario_mascarado, status, mensagem_status, testado_em, atualizado_em
      FROM credenciais_integracoes
     WHERE regional_id = ?
     ORDER BY tipo
  `).bind(user.regional_id).all()

  const values = Object.fromEntries((result.results || []).map((item) => [item.tipo, item]))
  return json({
    bussola: values.BUSSOLA || null,
    mercado_farma: values.MERCADO_FARMA || null,
  })
}

export async function onRequestPost({ request, env }) {
  const { denial, user } = await requireRG(request, env)
  if (denial) return denial

  const data = await readBody(request)
  const type = String(data.tipo || '').trim().toUpperCase()
  const login = String(data.usuario || data.login || '').trim()
  const password = String(data.senha || '')

  if (!TYPES.includes(type)) return badRequest('Integração inválida.')
  if (login.length < 3 || password.length < 3) {
    return badRequest(`Informe o login e a senha do ${label(type)}.`)
  }

  const encrypted = await encryptCredentials({
    usuario: login,
    segredo: password,
    tipo: type,
    regional_id: Number(user.regional_id),
    usuario_id: Number(user.id),
    salvo_em: new Date().toISOString(),
  }, env.PAINEL_REGIONAL_KEY)

  const now = new Date().toISOString()
  await env.DB.prepare(`
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
    maskEmail(login),
    encrypted,
    `${label(type)} configurado com uma credencial própria, separada do acesso ao painel.`,
    now,
  ).run()

  return json({
    sucesso: true,
    tipo: type,
    usuario_mascarado: maskEmail(login),
    mensagem: `Acesso do ${label(type)} salvo com segurança.`,
  }, 201)
}
