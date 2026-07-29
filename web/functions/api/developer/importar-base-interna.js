import rows from './_data/estrutura-runtime.js'
import meta from './_data/estrutura-meta.js'
import { json, requireDeveloper } from '../_lib/security.js'
import { onRequestPost as importPeopleStructure } from './importar-estrutura.js'
import { repararHierarquiaImportada } from './_lib/reparar-hierarquia.js'

export async function onRequestGet({ request, env }) {
  const { denial } = await requireDeveloper(request, env)
  if (denial) return denial
  return json({ disponivel: true, base: meta })
}

export async function onRequestPost({ request, env }) {
  const { denial } = await requireDeveloper(request, env)
  if (denial) return denial

  try {
    if (!Array.isArray(rows) || !rows.length) {
      throw new Error('A base interna preparada não contém pessoas.')
    }

    const headers = new Headers(request.headers)
    headers.set('content-type', 'application/json')
    const forwarded = new Request(request.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        nome_arquivo: meta.nome_arquivo,
        nome_planilha: meta.nome_planilha,
        linhas: rows,
      }),
    })

    const importedResponse = await importPeopleStructure({ request: forwarded, env })
    const importedPayload = await importedResponse.json()
    if (!importedResponse.ok) return json(importedPayload, importedResponse.status)

    const reparo = await repararHierarquiaImportada(env)
    return json({
      ...importedPayload,
      mensagem: 'Estrutura atualizada e reconstruída pelos setores de GR, GD e Consultores.',
      reparo,
    }, 201)
  } catch (error) {
    return json({
      erro: 'Não foi possível abrir e reconstruir a Estrutura de Pessoas armazenada no sistema.',
      detalhe: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
