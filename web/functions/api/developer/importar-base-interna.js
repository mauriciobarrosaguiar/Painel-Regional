import rows from './_data/estrutura-runtime.js'
import meta from './_data/estrutura-meta.js'
import { json, requireDeveloper } from '../_lib/security.js'
import { onRequestPost as importPeopleStructure } from './importar-estrutura.js'

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
    return importPeopleStructure({ request: forwarded, env })
  } catch (error) {
    return json({
      erro: 'Não foi possível abrir a Estrutura de Pessoas armazenada no sistema.',
      detalhe: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
