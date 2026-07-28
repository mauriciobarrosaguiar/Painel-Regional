import { gunzipSync } from 'node:zlib'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = resolve(root, 'functions/api/developer/_data')

// Tamanhos exatos dos quatro blocos gerados a partir da aba "Mês Atual".
// Alguns arquivos foram salvos com conteúdo excedente depois do bloco correto;
// por isso usamos somente o início validado de cada um.
const expectedLengths = [8000, 8000, 8000, 6760]
const chunks = []

for (let index = 1; index <= expectedLengths.length; index += 1) {
  const modulePath = resolve(dataDir, `estrutura-${index}.js`)
  const module = await import(`${pathToFileURL(modulePath).href}?v=${Date.now()}-${index}`)
  const raw = String(module.default || '')
  const expectedLength = expectedLengths[index - 1]

  if (raw.length < expectedLength) {
    throw new Error(
      `O bloco ${index} da Estrutura de Pessoas está incompleto: `
      + `${raw.length} de ${expectedLength} caracteres.`,
    )
  }

  chunks.push(raw.slice(0, expectedLength))
}

const base64 = chunks.join('')
if (base64.length !== expectedLengths.reduce((total, length) => total + length, 0)) {
  throw new Error('A Estrutura de Pessoas interna foi montada com tamanho inválido.')
}

const compressed = Buffer.from(base64, 'base64')
const text = gunzipSync(compressed).toString('utf8')
const rows = JSON.parse(text)

if (!Array.isArray(rows) || rows.length !== 590) {
  throw new Error(
    `A Estrutura de Pessoas interna deveria conter 590 registros, mas contém ${Array.isArray(rows) ? rows.length : 0}.`,
  )
}

const outputPath = resolve(dataDir, 'estrutura-runtime.js')
await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `export default ${JSON.stringify(rows)}\n`, 'utf8')

const generated = await readFile(outputPath, 'utf8')
console.log(`Estrutura de Pessoas preparada: ${rows.length} registros, ${Buffer.byteLength(generated)} bytes.`)
