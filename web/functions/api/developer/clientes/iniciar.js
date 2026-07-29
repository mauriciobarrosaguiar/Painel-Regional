import { badRequest, json, readBody, requireDeveloper } from '../../_lib/security.js'

export async function onRequestPost({ request, env }) {
  const { denial, user } = await requireDeveloper(request, env)
  if (denial) return denial

  const data = await readBody(request)
  const fileName = String(data.nome_arquivo || '').trim()
  const sheetName = String(data.nome_planilha || 'PAINEL').trim()
  const total = Number(data.total_linhas || 0)
  if (!fileName || !total) return badRequest('Informe o arquivo e a quantidade de linhas.')

  const id = `clientes-${crypto.randomUUID()}`
  await env.DB.prepare(`
    INSERT INTO painel_clientes_importacoes
      (id, nome_arquivo, nome_planilha, status, total_recebido, total_importado, criado_por, criado_em)
    VALUES (?, ?, ?, 'ABERTA', ?, 0, ?, datetime('now'))
  `).bind(id, fileName, sheetName, total, user.id).run()

  return json({ id, status: 'ABERTA', mensagem: 'Importação iniciada.' }, 201)
}
