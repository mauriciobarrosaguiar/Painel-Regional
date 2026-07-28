import { ensureAuthSchema, json } from '../_lib/security.js'

export async function onRequestGet({ env }) {
  try {
    if (!env.DB) return json({ erro: 'Binding D1 DB não configurado no Cloudflare.' }, 503)
    await ensureAuthSchema(env)
    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM desenvolvedores WHERE ativo = 1',
    ).first()
    return json({ desenvolvedor_configurado: Number(row?.total || 0) > 0 })
  } catch (error) {
    return json({
      erro: 'Não foi possível verificar o primeiro acesso.',
      detalhe: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
