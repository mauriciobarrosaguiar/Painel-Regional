import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { api } from './api'
import type { Regional } from './types'
import './metas-upload.css'

type Props = {
  mode: 'DESENVOLVEDOR' | 'RG'
  regionalId?: number | null
  regionalName?: string
}

type PortfolioType = 'TERRITORIO' | 'REDE' | 'ASSOCIATIVO'

type MetaRow = {
  reg: unknown
  setor: unknown
  colaborador: unknown
  cargo: unknown
  meta_ol_sem_combate: number
  meta_ol_prioritarios: number
  meta_ol_lancamentos: number
  meta_demanda_sem_combate: number
}

type ParsedFile = {
  file: File
  type: PortfolioType
  sheetName: string
  rows: MetaRow[]
}

type ImportHistory = {
  id: string
  competencia: string
  tipo_carteira: PortfolioType
  arquivo_origem: string
  status: string
  total_importado: number
  total_ignorado: number
  criado_em: string
}

type HistoryResponse = {
  regional: Regional
  importacoes: ImportHistory[]
}

type DeveloperStructure = { regionais: Regional[] }

const normalize = (value: unknown) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toUpperCase()

const currentCompetence = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date())
  const year = parts.find((item) => item.type === 'year')?.value || String(new Date().getFullYear())
  const month = parts.find((item) => item.type === 'month')?.value || String(new Date().getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function classifyFile(name: string): PortfolioType | null {
  const value = normalize(name)
  if (!value.endsWith('.XLSX') && !value.endsWith('.XLS')) return null
  if (value.includes('ASSOC')) return 'ASSOCIATIVO'
  if (value.includes('REDE')) return 'REDE'
  if (value.includes('TERRITORIO')) return 'TERRITORIO'
  return null
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const raw = String(value ?? '').trim()
  if (!raw) return 0
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw
  const parsed = Number(normalized.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function isMonthHeader(value: unknown) {
  return /^(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)(\/\d{2,4})?$/.test(normalize(value))
}

function effectiveHeaders(matrix: unknown[][], rowIndex: number) {
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

function findColumn(headers: string[], candidates: string[]) {
  return headers.findIndex((header) => candidates.some((candidate) => header === candidate || header.includes(candidate)))
}

async function parseFile(file: File): Promise<ParsedFile> {
  const type = classifyFile(file.name)
  if (!type) throw new Error(`Não consegui identificar se “${file.name}” é Território, Rede ou Associativo.`)

  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true, raw: true })
  for (const sheetName of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1, defval: '', raw: true,
    }) as unknown[][]
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

    const rows: MetaRow[] = []
    for (const row of matrix.slice(headerRow + 1)) {
      const setor = row[columns.setor]
      const colaborador = row[columns.colaborador]
      const cargo = row[columns.cargo]
      if (!String(setor ?? '').trim() && !String(colaborador ?? '').trim() && !String(cargo ?? '').trim()) continue
      rows.push({
        reg: columns.reg >= 0 ? row[columns.reg] : '',
        setor,
        colaborador,
        cargo,
        meta_ol_sem_combate: columns.semCombate >= 0 ? numberValue(row[columns.semCombate]) : 0,
        meta_ol_prioritarios: columns.prioritarios >= 0 ? numberValue(row[columns.prioritarios]) : 0,
        meta_ol_lancamentos: columns.lancamentos >= 0 ? numberValue(row[columns.lancamentos]) : 0,
        meta_demanda_sem_combate: columns.demanda >= 0 ? numberValue(row[columns.demanda]) : 0,
      })
    }
    if (rows.length) return { file, type, sheetName, rows }
  }

  throw new Error(`Não encontrei as colunas SETOR, COLABORADOR e CARGO em “${file.name}”.`)
}

const dateLabel = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR')
}

export default function MetaUploadLauncher({ mode, regionalId, regionalName }: Props) {
  const [open, setOpen] = useState(false)
  const [regionals, setRegionals] = useState<Regional[]>([])
  const [selectedRegional, setSelectedRegional] = useState(String(regionalId || ''))
  const [competence, setCompetence] = useState(currentCompetence())
  const [files, setFiles] = useState<File[]>([])
  const [history, setHistory] = useState<ImportHistory[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [inputKey, setInputKey] = useState(0)

  useEffect(() => {
    if (mode !== 'DESENVOLVEDOR') return
    api<DeveloperStructure>('developer/estrutura')
      .then((data) => setRegionals(data.regionais || []))
      .catch(() => setRegionals([]))
  }, [mode])

  useEffect(() => {
    if (mode === 'RG' && regionalId) setSelectedRegional(String(regionalId))
  }, [mode, regionalId])

  const selectedTypes = useMemo(() => files.map((file) => ({ file, type: classifyFile(file.name) })), [files])
  const duplicateType = useMemo(() => {
    const found = new Set<string>()
    for (const item of selectedTypes) {
      if (!item.type) continue
      if (found.has(item.type)) return item.type
      found.add(item.type)
    }
    return ''
  }, [selectedTypes])

  const loadHistory = useCallback(async () => {
    if (!selectedRegional) return
    setLoadingHistory(true)
    try {
      const result = await api<HistoryResponse>(`metas/importar?regional_id=${encodeURIComponent(selectedRegional)}`)
      setHistory(result.importacoes || [])
    } catch {
      setHistory([])
    } finally {
      setLoadingHistory(false)
    }
  }, [selectedRegional])

  useEffect(() => {
    if (open && selectedRegional) void loadHistory()
  }, [open, selectedRegional, loadHistory])

  function chooseFiles(event: React.ChangeEvent<HTMLInputElement>) {
    setFiles(Array.from(event.currentTarget.files || []))
    setMessage('')
    setError('')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')
    setError('')
    if (!selectedRegional) return setError('Selecione a Regional.')
    if (!/^\d{4}-\d{2}$/.test(competence)) return setError('Selecione o mês das metas.')
    if (!files.length) return setError('Selecione pelo menos uma planilha.')
    if (selectedTypes.some((item) => !item.type)) return setError('Há uma planilha cujo nome não identifica Território, Rede ou Associativo.')
    if (duplicateType) return setError(`Selecione apenas um arquivo de ${duplicateType}.`)

    setImporting(true)
    let importedFiles = 0
    let importedRows = 0
    let ignoredRows = 0
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]
        setProgress(`Lendo ${index + 1} de ${files.length}: ${file.name}`)
        const parsed = await parseFile(file)
        setProgress(`Importando ${parsed.type}: ${file.name}`)
        const result = await api<{ total_importado: number; total_ignorado: number }>('metas/importar', {
          method: 'POST',
          body: JSON.stringify({
            regional_id: Number(selectedRegional),
            competencia: competence,
            tipo_carteira: parsed.type,
            arquivo_origem: file.name,
            origem_modificada_em: file.lastModified ? new Date(file.lastModified).toISOString() : null,
            planilha: parsed.sheetName,
            linhas: parsed.rows,
          }),
        })
        importedFiles += 1
        importedRows += Number(result.total_importado || 0)
        ignoredRows += Number(result.total_ignorado || 0)
      }
      setMessage(`${importedFiles} arquivo(s) importado(s): ${importedRows} metas vinculadas e ${ignoredRows} linhas ignoradas.`)
      setFiles([])
      setInputKey((value) => value + 1)
      await loadHistory()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível importar as metas.')
    } finally {
      setProgress('')
      setImporting(false)
    }
  }

  return (
    <>
      <button className="meta-upload-launcher" type="button" onClick={() => setOpen(true)}>
        <span>↑</span> Enviar metas
      </button>
      {open && (
        <div className="meta-upload-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !importing) setOpen(false) }}>
          <section className="meta-upload-modal" role="dialog" aria-modal="true" aria-label="Importar metas mensais">
            <header>
              <div><span className="meta-upload-kicker">Upload manual</span><h2>Metas mensais</h2><p>Envie as planilhas de Território, Rede e Associativo. O sistema vincula GR, GD e Consultores pelo setor.</p></div>
              <button type="button" onClick={() => setOpen(false)} disabled={importing} aria-label="Fechar">×</button>
            </header>

            {error && <div className="meta-upload-alert error">{error}</div>}
            {message && <div className="meta-upload-alert success">{message}</div>}

            <form onSubmit={submit}>
              <div className="meta-upload-fields">
                <label><span>Regional</span>{mode === 'DESENVOLVEDOR' ? (
                  <select value={selectedRegional} onChange={(event) => setSelectedRegional(event.target.value)} required>
                    <option value="">Selecione uma Regional</option>
                    {regionals.map((regional) => <option value={regional.id} key={regional.id}>{regional.nome} · Setor {regional.setor || '—'}</option>)}
                  </select>
                ) : <input value={regionalName || 'Minha Regional'} readOnly />}</label>
                <label><span>Mês das metas</span><input type="month" value={competence} onChange={(event) => setCompetence(event.target.value)} required /></label>
              </div>

              <label className="meta-upload-drop">
                <input key={inputKey} type="file" accept=".xlsx,.xls" multiple onChange={chooseFiles} disabled={importing} />
                <strong>Selecionar planilhas</strong>
                <span>Você pode enviar os três arquivos de uma vez.</span>
              </label>

              {!!selectedTypes.length && <div className="meta-upload-files">{selectedTypes.map(({ file, type }) => (
                <article key={`${file.name}-${file.lastModified}`}><div><strong>{file.name}</strong><span>{Math.max(file.size / 1024, 1).toFixed(0)} KB</span></div><b className={type ? 'recognized' : 'unknown'}>{type || 'Não identificado'}</b></article>
              ))}</div>}

              <div className="meta-upload-rules"><span>✓ Cabeçalhos podem estar até a linha 31</span><span>✓ O arquivo completo pode conter outras Regionais</span><span>✓ Um novo upload substitui o mesmo tipo e mês</span></div>
              {progress && <div className="meta-upload-progress">{progress}</div>}
              <button className="meta-upload-submit" type="submit" disabled={importing}>{importing ? 'Importando…' : 'Importar metas'}</button>
            </form>

            <section className="meta-upload-history">
              <div><h3>Últimos uploads</h3><button type="button" onClick={() => void loadHistory()} disabled={loadingHistory || !selectedRegional}>{loadingHistory ? 'Atualizando…' : 'Atualizar'}</button></div>
              {history.map((item) => <article key={item.id}><div><strong>{item.tipo_carteira} · {item.competencia}</strong><span>{item.arquivo_origem}</span></div><div><b>{item.total_importado} importadas</b><span>{dateLabel(item.criado_em)}</span></div></article>)}
              {!history.length && <p>{selectedRegional ? 'Nenhum upload registrado para esta Regional.' : 'Selecione uma Regional para ver o histórico.'}</p>}
            </section>
          </section>
        </div>
      )}
    </>
  )
}
