import { gunzipSync } from 'node:zlib'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = resolve(root, 'functions/api/developer/_data')
const chunks = []

for (let index = 1; index <= 4; index += 1) {
  const modulePath = resolve(dataDir, `estrutura-${index}.js`)
  const module = await import(`${pathToFileURL(modulePath).href}?v=${Date.now()}-${index}`)
  chunks.push(String(module.default || ''))
}

const compressed = Buffer.from(chunks.join(''), 'base64')
const text = gunzipSync(compressed).toString('utf8')
const rows = JSON.parse(text)

if (!Array.isArray(rows) || rows.length === 0) {
  throw new Error('A Estrutura de Pessoas interna não contém registros válidos.')
}

const outputPath = resolve(dataDir, 'estrutura-runtime.js')
await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `export default ${JSON.stringify(rows)}\n`, 'utf8')

const generated = await readFile(outputPath, 'utf8')
console.log(`Estrutura de Pessoas preparada: ${rows.length} registros, ${Buffer.byteLength(generated)} bytes.`)
