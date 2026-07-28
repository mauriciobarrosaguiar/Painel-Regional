import chunk1 from './_data/estrutura-1.js'
import chunk2 from './_data/estrutura-2.js'
import chunk3 from './_data/estrutura-3.js'
import chunk4 from './_data/estrutura-4.js'
import meta from './_data/estrutura-meta.js'
import { json, requireDeveloper } from '../_lib/security.js'
import { onRequestPost as importPeopleStructure } from './importar-estrutura.js'

function decodeBase64(value) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function embeddedRows() {
  const compressed = decodeBase64(`${chunk1}${chunk2}${chunk3}${chunk4}`)
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))
  const text = await new Response(stream).text()
  return JSON.parse(text)
}

export async function onRequestGet({ request, env }) {
  const { denial } = await requireDeveloper(request, env)
  if (denial) return denial
  return json({ disponivel: true, base: meta })
}

export async function onRequestPost({ request, env }) {
  const { denial } = await requireDeveloper(request, env)
  if (denial) return denial

  try {
    const rows = await embeddedRows()
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
