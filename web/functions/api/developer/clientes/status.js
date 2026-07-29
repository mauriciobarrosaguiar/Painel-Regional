import { json, requireDeveloper } from '../../_lib/security.js'

export async function onRequestGet({ request, env }) {
  const { denial } = await requireDeveloper(request, env)
  if (denial) return denial

  const latest = await env.DB.prepare(`
    SELECT id, nome_arquivo, nome_planilha, status, total_recebido, total_importado,
           mensagem, criado_em, finalizado_em
      FROM painel_clientes_importacoes
     ORDER BY criado_em DESC
     LIMIT 1
  `).first()
  const total = await env.DB.prepare(`
    SELECT COUNT(*) AS total FROM painel_clientes WHERE ativo = 1
  `).first()
  return json({ ultima_importacao: latest || null, clientes_ativos: Number(total?.total || 0) })
}
