import { json, requireRG } from './_lib/security.js'

export async function onRequestGet({ request, env }) {
  const { denial, user } = await requireRG(request, env)
  if (denial) return denial

  const [commands, extractions, credentials] = await env.DB.batch([
    env.DB.prepare(`
      SELECT id, tipo, status, mensagem, erro, solicitado_em, iniciado_em, finalizado_em
        FROM comandos_automacao
       WHERE regional_id = ?
       ORDER BY solicitado_em DESC
       LIMIT 30
    `).bind(user.regional_id),
    env.DB.prepare(`
      SELECT id, tipo, status, total_registros, mensagem, erro, iniciado_em, finalizado_em, criado_em
        FROM extracoes
       WHERE regional_id = ?
       ORDER BY criado_em DESC
       LIMIT 30
    `).bind(user.regional_id),
    env.DB.prepare(`
      SELECT tipo, status, usuario_mascarado, atualizado_em
        FROM credenciais_integracoes
       WHERE regional_id = ?
    `).bind(user.regional_id),
  ])

  const credentialMap = Object.fromEntries((credentials.results || []).map((item) => [item.tipo, item]))
  const active = (commands.results || []).filter((item) => ['aguardando', 'executando'].includes(String(item.status).toLowerCase())).length

  return json({
    comandos: commands.results || [],
    extracoes: extractions.results || [],
    em_execucao: active,
    credencial_configurada: Boolean(credentialMap.BUSSOLA && credentialMap.MERCADO_FARMA),
    credenciais: {
      bussola: credentialMap.BUSSOLA || null,
      mercado_farma: credentialMap.MERCADO_FARMA || null,
    },
    atualizado_em: new Date().toISOString(),
  })
}
