import { badRequest, json, readBody, requireRG } from '../_lib/security.js'

const TYPES = ['BUSSOLA', 'MERCADO_FARMA']

export async function onRequestPost({ request, env }) {
  const { denial, user } = await requireRG(request, env)
  if (denial) return denial

  const data = await readBody(request)
  const type = String(data.tipo || '').trim().toUpperCase()
  if (!TYPES.includes(type)) return badRequest('Tipo de automação inválido.')

  const credential = await env.DB.prepare(`
    SELECT id
      FROM credenciais_integracoes
     WHERE regional_id = ? AND tipo = ? AND status = 'CONFIGURADA'
  `).bind(user.regional_id, type).first()
  if (!credential) {
    const name = type === 'BUSSOLA' ? 'Bússola' : 'Mercado Farma'
    return badRequest(`Configure primeiro o login e a senha do ${name} na Administração.`)
  }

  const existing = await env.DB.prepare(`
    SELECT id
      FROM comandos_automacao
     WHERE regional_id = ? AND tipo = ? AND status IN ('aguardando', 'executando')
     LIMIT 1
  `).bind(user.regional_id, type).first()
  if (existing) return json({ erro: 'Esta extração já está aguardando ou em execução.' }, 409)

  const id = `cmd-${crypto.randomUUID()}`
  const now = new Date().toISOString()
  await env.DB.prepare(`
    INSERT INTO comandos_automacao
      (id, regional_id, tipo, parametros_json, status, solicitado_por, mensagem, solicitado_em, atualizado_em)
    VALUES (?, ?, ?, ?, 'aguardando', ?, ?, ?, ?)
  `).bind(
    id,
    user.regional_id,
    type,
    JSON.stringify({ regional_id: Number(user.regional_id), credencial_tipo: type }),
    user.email,
    'Solicitação registrada. O processador usará somente a credencial desta integração e desta Regional.',
    now,
    now,
  ).run()

  return json({
    sucesso: true,
    id,
    status: 'aguardando',
    mensagem: 'Solicitação registrada na fila regional.',
  }, 202)
}
