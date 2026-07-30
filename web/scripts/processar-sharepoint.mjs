import * as XLSX from 'xlsx'

const PANEL_URL = String(process.env.PAINEL_URL || 'https://painel-regional.pages.dev').replace(/\/$/, '')
const ADMIN_KEY = String(process.env.PAINEL_ADMIN_KEY || '')
const TENANT_ID = String(process.env.MS_TENANT_ID || '')
const CLIENT_ID = String(process.env.MS_CLIENT_ID || '')
const CLIENT_SECRET = String(process.env.MS_CLIENT_SECRET || '')
const SHAREPOINT_HOST = String(process.env.SHAREPOINT_HOST || 'emspocbi.sharepoint.com')
const SHAREPOINT_SITE_PATH = String(process.env.SHAREPOINT_SITE_PATH || '/sites/CasadoGenricos')
const BASE_FOLDER = String(process.env.SHAREPOINT_METAS_FOLDER || 'PEX & Premiação/EMS/Metas/SELL OUT')

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

function required(name, value) {
  if (!value) throw new Error(`Variável obrigatória não configurada: ${name}`)
}

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

function numberValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const raw = String(value ?? '').trim()
  if (!raw) return 0
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw
  const parsed = Number(normalized.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function encodeGraphPath(path) {
  return path.split('/').filter(Boolean).map((part) => encodeURIComponent(part)).join('/')
}

async function panel(path, payload) {
  const response = await fetch(`${PANEL_URL}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-admin-key': ADMIN_KEY,
    },
    body: JSON.stringify(payload),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.erro || data.detalhe || `Painel respondeu HTTP ${response.status}`)
  return data
}

async function graphToken() {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  })
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(TENANT_ID)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.access_token) throw new Error(data.error_description || 'Não foi possível autenticar no Microsoft Graph.')
  return data.access_token
}

async function graphJson(token, path) {
  const response = await fetch(path.startsWith('http') ? path : `https://graph.microsoft.com/v1.0${path}`, {
    headers: { authorization: `Bearer ${token}` },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data?.error?.message || `Microsoft Graph respondeu HTTP ${response.status}`)
  return data
}

async function graphCollection(token, path) {
  const output = []
  let next = path
  while (next) {
    const data = await graphJson(token, next)
    output.push(...(Array.isArray(data.value) ? data.value : []))
    next = data['@odata.nextLink'] || ''
  }
  return output
}

function currentCompetence() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date())
  const year = Number(parts.find((item) => item.type === 'year')?.value)
  const month = Number(parts.find((item) => item.type === 'month')?.value)
  return { year, month, competence: `${year}-${String(month).padStart(2, '0')}` }
}

function resolveCompetence(parameters) {
  const explicit = String(parameters.competencia || '').trim()
  if (/^\d{4}-\d{2}$/.test(explicit)) {
    const [year, month] = explicit.split('-').map(Number)
    return { year, month, competence: explicit }
  }
  if (Number(parameters.ano) && Number(parameters.mes)) {
    const year = Number(parameters.ano)
    const month = Number(parameters.mes)
    return { year, month, competence: `${year}-${String(month).padStart(2, '0')}` }
  }
  return currentCompetence()
}

function classifyFile(name) {
  const value = normalize(name)
  if (!value.endsWith('.XLSX') && !value.endsWith('.XLS')) return null
  if (value.includes('ASSOC')) return 'ASSOCIATIVO'
  if (value.includes('REDE')) return 'REDE'
  if (value.includes('TERRITORIO')) return 'TERRITORIO'
  return null
}

function isMonthHeader(value) {
  const text = normalize(value)
  return /^(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)(\/\d{2,4})?$/.test(text)
}

function effectiveHeaders(matrix, rowIndex) {
  const current = matrix[rowIndex] || []
  const previous = matrix[rowIndex - 1] || []
  const previousTwo = matrix[rowIndex - 2] || []
  const size = Math.max(current.length, previous.length, previousTwo.length)
  return Array.from({ length: size }, (_, index) => {
    const here = current[index]
    if (normalize(here) && !isMonthHeader(here)) return normalize(here)
    if (normalize(previous[index])) return normalize(previous[index])
    return normalize(previousTwo[index])
  })
}

function findColumn(headers, candidates) {
  return headers.findIndex((header) => candidates.some((candidate) => header === candidate || header.includes(candidate)))
}

function parseWorkbook(buffer, fileName) {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, raw: true })
  for (const sheetName of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: true })
    const headerRow = matrix.findIndex((row, index) => {
      if (index > 30) return false
      const values = row.map(normalize)
      return values.some((item) => item === 'SETOR')
        && values.some((item) => item.includes('COLABORADOR'))
        && values.some((item) => item === 'CARGO')
    })
    if (headerRow < 0) continue

    const headers = effectiveHeaders(matrix, headerRow)
    const columns = {
      reg: findColumn(headers, ['REG']),
      setor: findColumn(headers, ['SETOR']),
      colaborador: findColumn(headers, ['COLABORADOR']),
      cargo: findColumn(headers, ['CARGO']),
      semCombate: findColumn(headers, ['OL SEM COMBATE']),
      prioritarios: findColumn(headers, ['OL PRIORITARIOS']),
      lancamentos: findColumn(headers, ['OL LANCAMENTOS']),
      demanda: findColumn(headers, ['DEMANDA SEM COMBATE']),
    }
    if (columns.setor < 0 || columns.colaborador < 0 || columns.cargo < 0) continue

    const lines = []
    for (const row of matrix.slice(headerRow + 1)) {
      const sector = row[columns.setor]
      const collaborator = row[columns.colaborador]
      const role = row[columns.cargo]
      if (!String(sector ?? '').trim() && !String(collaborator ?? '').trim() && !String(role ?? '').trim()) continue
      lines.push({
        reg: columns.reg >= 0 ? row[columns.reg] : '',
        setor: sector,
        colaborador: collaborator,
        cargo: role,
        meta_ol_sem_combate: columns.semCombate >= 0 ? numberValue(row[columns.semCombate]) : 0,
        meta_ol_prioritarios: columns.prioritarios >= 0 ? numberValue(row[columns.prioritarios]) : 0,
        meta_ol_lancamentos: columns.lancamentos >= 0 ? numberValue(row[columns.lancamentos]) : 0,
        meta_demanda_sem_combate: columns.demanda >= 0 ? numberValue(row[columns.demanda]) : 0,
      })
    }
    if (lines.length) return { sheetName, lines }
  }
  throw new Error(`Não encontrei a estrutura de metas esperada no arquivo ${fileName}.`)
}

async function run() {
  required('PAINEL_ADMIN_KEY', ADMIN_KEY)
  required('MS_TENANT_ID', TENANT_ID)
  required('MS_CLIENT_ID', CLIENT_ID)
  required('MS_CLIENT_SECRET', CLIENT_SECRET)

  const queue = await panel('/api/internal/automacoes', { acao: 'buscar', tipo: 'SHAREPOINT' })
  const command = queue.comando
  if (!command) {
    console.log('Nenhuma importação do SharePoint aguardando.')
    return
  }

  let totalImported = 0
  try {
    const parameters = JSON.parse(command.parametros_json || '{}')
    const { year, month, competence } = resolveCompetence(parameters)
    if (month < 1 || month > 12) throw new Error('Mês inválido para localizar a pasta do SharePoint.')

    const token = await graphToken()
    const site = await graphJson(token, `/sites/${SHAREPOINT_HOST}:${SHAREPOINT_SITE_PATH}`)
    const drive = await graphJson(token, `/sites/${encodeURIComponent(site.id)}/drive`)
    const folderName = `${String(month).padStart(2, '0')}. ${MONTHS[month - 1]} ${year}`
    const folderPath = `${BASE_FOLDER}/${year}/${folderName}`
    const files = await graphCollection(token, `/drives/${encodeURIComponent(drive.id)}/root:/${encodeGraphPath(folderPath)}:/children?$select=id,name,lastModifiedDateTime,file,folder`)

    const selected = new Map()
    for (const item of files) {
      const type = classifyFile(item.name)
      if (!type || !item.file) continue
      const existing = selected.get(type)
      if (!existing || String(item.lastModifiedDateTime || '') > String(existing.lastModifiedDateTime || '')) selected.set(type, item)
    }

    const missing = ['TERRITORIO', 'REDE', 'ASSOCIATIVO'].filter((type) => !selected.has(type))
    if (missing.length) throw new Error(`Arquivos não encontrados na pasta ${folderName}: ${missing.join(', ')}.`)

    for (const [type, item] of selected) {
      const response = await fetch(`https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(drive.id)}/items/${encodeURIComponent(item.id)}/content`, {
        headers: { authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error(`Falha ao baixar ${item.name}: HTTP ${response.status}`)
      const parsed = parseWorkbook(await response.arrayBuffer(), item.name)
      const imported = await panel('/api/internal/metas', {
        regional_id: Number(command.regional_id),
        competencia: competence,
        tipo_carteira: type,
        arquivo_origem: item.name,
        origem_modificada_em: item.lastModifiedDateTime || null,
        planilha: parsed.sheetName,
        linhas: parsed.lines,
      })
      totalImported += Number(imported.total_importado || 0)
      console.log(`${type}: ${imported.total_importado} metas importadas de ${item.name}`)
    }

    await panel('/api/internal/automacoes', {
      acao: 'finalizar',
      id: command.id,
      status: 'concluido',
      total_registros: totalImported,
      iniciado_em: command.iniciado_em,
      mensagem: `${totalImported} metas importadas do SharePoint para ${competence}.`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    await panel('/api/internal/automacoes', {
      acao: 'finalizar',
      id: command.id,
      status: 'erro',
      total_registros: totalImported,
      iniciado_em: command.iniciado_em,
      erro: message,
      mensagem: 'A importação das metas do SharePoint falhou.',
    }).catch((finalizeError) => console.error('Também falhou ao registrar o erro:', finalizeError))
    process.exitCode = 1
  }
}

await run()
