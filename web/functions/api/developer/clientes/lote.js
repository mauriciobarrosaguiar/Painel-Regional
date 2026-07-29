import { badRequest, json, readBody, requireDeveloper } from '../../_lib/security.js'

const text = (value) => String(value ?? '').trim()
const cleanCnpj = (value) => text(value).replace(/\D/g, '').padStart(14, '0').slice(-14)
const sector = (value) => text(value).replace(/\D/g, '')

export async function onRequestPost({ request, env }) {
  const { denial } = await requireDeveloper(request, env)
  if (denial) return denial

  const data = await readBody(request)
  const importId = text(data.importacao_id)
  const rows = Array.isArray(data.linhas) ? data.linhas : []
  if (!importId || !rows.length) return badRequest('Importação e linhas são obrigatórias.')
  if (rows.length > 600) return badRequest('Envie no máximo 600 clientes por lote.')

  const current = await env.DB.prepare(`
    SELECT id FROM painel_clientes_importacoes WHERE id = ? AND status = 'ABERTA'
  `).bind(importId).first()
  if (!current) return badRequest('A importação não está aberta.')

  const statements = []
  let valid = 0
  for (const row of rows) {
    const cnpj = cleanCnpj(row.cnpj)
    const gr = sector(row.setor_gr)
    const gd = sector(row.setor_gd)
    const consultant = sector(row.setor_consultor)
    const name = text(row.nome_pdv)
    if (cnpj.length !== 14 || !name || !gr || !gd || !consultant) continue
    valid += 1
    statements.push(env.DB.prepare(`
      INSERT INTO painel_clientes
        (importacao_id, cnpj, codigo_cliente, nome_pdv, grupo_economico, rede_associacao,
         endereco, bairro, cidade, uf, cep, situacao, classificacao_cliente,
         setor_gr, nome_gr, setor_gd, nome_gd, setor_consultor, nome_consultor,
         foco_pex, positivacao, ativo, criado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
      ON CONFLICT(importacao_id, cnpj, setor_consultor) DO UPDATE SET
        codigo_cliente = excluded.codigo_cliente,
        nome_pdv = excluded.nome_pdv,
        grupo_economico = excluded.grupo_economico,
        rede_associacao = excluded.rede_associacao,
        endereco = excluded.endereco,
        bairro = excluded.bairro,
        cidade = excluded.cidade,
        uf = excluded.uf,
        cep = excluded.cep,
        situacao = excluded.situacao,
        classificacao_cliente = excluded.classificacao_cliente,
        setor_gr = excluded.setor_gr,
        nome_gr = excluded.nome_gr,
        setor_gd = excluded.setor_gd,
        nome_gd = excluded.nome_gd,
        nome_consultor = excluded.nome_consultor,
        foco_pex = excluded.foco_pex,
        positivacao = excluded.positivacao
    `).bind(
      importId, cnpj, text(row.codigo_cliente), name, text(row.grupo_economico),
      text(row.rede_associacao), text(row.endereco), text(row.bairro), text(row.cidade),
      text(row.uf).toUpperCase(), text(row.cep), text(row.situacao), text(row.classificacao_cliente),
      gr, text(row.nome_gr), gd, text(row.nome_gd), consultant, text(row.nome_consultor),
      text(row.foco_pex), text(row.positivacao),
    ))
  }

  for (let index = 0; index < statements.length; index += 45) {
    await env.DB.batch(statements.slice(index, index + 45))
  }
  await env.DB.prepare(`
    UPDATE painel_clientes_importacoes
       SET total_importado = total_importado + ?
     WHERE id = ?
  `).bind(valid, importId).run()

  return json({ sucesso: true, recebidas: rows.length, importadas: valid })
}
