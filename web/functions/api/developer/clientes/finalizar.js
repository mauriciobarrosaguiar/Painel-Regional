import { badRequest, json, readBody, requireDeveloper } from '../../_lib/security.js'

export async function onRequestPost({ request, env }) {
  const { denial } = await requireDeveloper(request, env)
  if (denial) return denial

  const data = await readBody(request)
  const importId = String(data.importacao_id || '').trim()
  if (!importId) return badRequest('Importação inválida.')

  const current = await env.DB.prepare(`
    SELECT id, total_recebido, total_importado
      FROM painel_clientes_importacoes
     WHERE id = ? AND status = 'ABERTA'
  `).bind(importId).first()
  if (!current) return badRequest('A importação não está aberta.')
  if (Number(current.total_importado || 0) === 0) return badRequest('Nenhum cliente válido foi importado.')

  await env.DB.batch([
    env.DB.prepare('UPDATE painel_clientes SET ativo = 0 WHERE ativo = 1'),
    env.DB.prepare('UPDATE painel_clientes SET ativo = 1 WHERE importacao_id = ?').bind(importId),
    env.DB.prepare(`
      UPDATE painel_clientes_importacoes
         SET status = 'CONCLUIDA',
             mensagem = ?,
             finalizado_em = datetime('now')
       WHERE id = ?
    `).bind(`Base publicada com ${Number(current.total_importado || 0)} clientes.`, importId),
  ])

  return json({
    sucesso: true,
    total_importado: Number(current.total_importado || 0),
    mensagem: 'Painel de Clientes atualizado e separado por GR, GD e Consultor.',
  })
}
