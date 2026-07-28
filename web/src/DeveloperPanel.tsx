import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import * as XLSX from 'xlsx'
import { api } from './api'
import type { PeopleImport, Regional, RegionalManager, SessionUser } from './types'
import './developer.css'

type Props = {
  user: SessionUser
  onLogout: () => void
}

type Structure = {
  regionais: Regional[]
  gerentes_regionais: RegionalManager[]
  importacoes: PeopleImport[]
}

type PeopleRow = {
  linha: number
  setor: string
  nome: string
  cargo: string
  situacao: string
  email_corporativo: string
  login_rede: string
  setor_gd: string
  nome_gd: string
  setor_gr: string
  nome_gr: string
}

type ImportResponse = {
  mensagem: string
  resumo: {
    linhas_recebidas: number
    regionais: number
    distritais: number
    consultores: number
    ignorados: number
  }
  avisos: string[]
}

const emptyStructure: Structure = { regionais: [], gerentes_regionais: [], importacoes: [] }
const normalizeHeader = (value: unknown) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toUpperCase()

const requiredHeaders = ['SETOR', 'NOME', 'CARGO', 'SITUACAO', 'E-MAIL', 'REDE', 'SETOR GD', 'NOME GD', 'SETOR GR', 'NOME GR']

function readPeopleFile(file: File): Promise<{ sheetName: string; rows: PeopleRow[] }> {
  return file.arrayBuffer().then((buffer) => {
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: false })
    let selectedName = workbook.SheetNames.find((name) => normalizeHeader(name) === 'MES ATUAL') || ''
    let matrix: unknown[][] = []
    let headerIndex = -1
    let headerMap = new Map<string, number>()

    for (const name of selectedName ? [selectedName] : workbook.SheetNames) {
      const sheet = workbook.Sheets[name]
      const candidate = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false }) as unknown[][]
      const index = candidate.findIndex((row) => {
        const headers = new Set(row.map(normalizeHeader))
        return requiredHeaders.every((header) => headers.has(header))
      })
      if (index >= 0) {
        selectedName = name
        matrix = candidate
        headerIndex = index
        headerMap = new Map<string, number>(
          candidate[index].map((value, column): [string, number] => [normalizeHeader(value), column]),
        )
        break
      }
    }

    if (!selectedName || headerIndex < 0) {
      throw new Error('Não encontrei uma aba com as colunas SETOR, NOME, REDE, SETOR GD, NOME GD, SETOR GR e NOME GR.')
    }

    const value = (row: unknown[], header: string) => String(row[headerMap.get(header) ?? -1] ?? '').trim()
    const rows = matrix.slice(headerIndex + 1).map((row, index): PeopleRow => ({
      linha: headerIndex + index + 2,
      setor: value(row, 'SETOR'),
      nome: value(row, 'NOME'),
      cargo: value(row, 'CARGO'),
      situacao: value(row, 'SITUACAO'),
      email_corporativo: value(row, 'E-MAIL'),
      login_rede: value(row, 'REDE'),
      setor_gd: value(row, 'SETOR GD'),
      nome_gd: value(row, 'NOME GD'),
      setor_gr: value(row, 'SETOR GR'),
      nome_gr: value(row, 'NOME GR'),
    })).filter((row) => row.setor || row.nome || row.login_rede)

    return { sheetName: selectedName, rows }
  })
}

const formatDate = (value?: string | null) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR')
}

export default function DeveloperPanel({ user, onLogout }: Props) {
  const [structure, setStructure] = useState<Structure>(emptyStructure)
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [importMode, setImportMode] = useState<'stored' | 'file' | ''>('')
  const [changing, setChanging] = useState<number[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])

  const managersByRegional = useMemo(
    () => new Map<number, RegionalManager>(
      structure.gerentes_regionais.map((item): [number, RegionalManager] => [Number(item.regional_id), item]),
    ),
    [structure.gerentes_regionais],
  )

  async function load() {
    setLoading(true)
    try {
      setStructure(await api<Structure>('developer/estrutura'))
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a estrutura.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  function showImportResult(result: ImportResponse) {
    setMessage(`${result.mensagem} Importados: ${result.resumo.regionais} Regionais, ${result.resumo.distritais} Distritais e ${result.resumo.consultores} Consultores.`)
    setWarnings(result.avisos || [])
  }

  async function importStoredBase() {
    setImporting(true)
    setImportMode('stored')
    setMessage('')
    setError('')
    setWarnings([])
    try {
      const result = await api<ImportResponse>('developer/importar-base-interna', { method: 'POST' })
      showImportResult(result)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível usar a base já carregada.')
    } finally {
      setImporting(false)
      setImportMode('')
    }
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    setImporting(true)
    setImportMode('file')
    setMessage('')
    setError('')
    setWarnings([])

    try {
      const parsed = await readPeopleFile(file)
      const result = await api<ImportResponse>('developer/importar-estrutura', {
        method: 'POST',
        body: JSON.stringify({
          nome_arquivo: file.name,
          nome_planilha: parsed.sheetName,
          linhas: parsed.rows,
        }),
      })
      showImportResult(result)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível importar a planilha.')
    } finally {
      input.value = ''
      setImporting(false)
      setImportMode('')
    }
  }

  async function toggleRegional(regional: Regional) {
    const next = Number(regional.ativo || 0) === 1 ? 0 : 1
    setChanging((current) => [...current, regional.id])
    setMessage('')
    setError('')
    try {
      const result = await api<{ mensagem: string }>('developer/regionais/ativar', {
        method: 'POST',
        body: JSON.stringify({ regional_id: regional.id, ativo: next }),
      })
      setMessage(result.mensagem)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível alterar a Regional.')
    } finally {
      setChanging((current) => current.filter((id) => id !== regional.id))
    }
  }

  const activeCount = structure.regionais.filter((item) => Number(item.ativo || 0) === 1).length

  return (
    <div className="developer-shell">
      <header className="developer-topbar">
        <div className="developer-brand"><span>D</span><div><strong>Painel Regional</strong><small>Administração do desenvolvedor</small></div></div>
        <div className="developer-profile"><b>{user.nome}</b><button onClick={onLogout}>Sair</button></div>
      </header>

      <main className="developer-content">
        <section className="developer-hero">
          <div><span>Fonte oficial da hierarquia</span><h1>Estrutura de Pessoas</h1><p>Importe a planilha atualizada. O sistema cria RGs, GDs, Consultores e seus acessos usando o login EMS e o setor.</p></div>
          <div className="developer-summary"><strong>{structure.regionais.length}</strong><span>Regionais encontradas</span><strong>{activeCount}</strong><span>Regionais ativas</span></div>
        </section>

        {error && <div className="developer-alert error">{error}</div>}
        {message && <div className="developer-alert success">{message}</div>}
        {!!warnings.length && <details className="developer-warning"><summary>{warnings.length} aviso(s) da importação</summary>{warnings.map((item) => <p key={item}>{item}</p>)}</details>}

        <section className="developer-import-card">
          <div className="developer-import-copy">
            <span className="developer-card-icon">X</span>
            <div><span className="developer-kicker">Atualização da base</span><h2>Importar Estrutura de Pessoas</h2><p>A base enviada em 28/07/2026 já está guardada no sistema. Também será possível selecionar uma versão nova depois.</p></div>
          </div>
          <div className="developer-import-actions">
            <button className="developer-stored-button" type="button" onClick={() => void importStoredBase()} disabled={importing}>
              {importMode === 'stored' ? 'Carregando base…' : 'Usar base já carregada'}
            </button>
            <label className={`developer-file-button ${importing ? 'disabled' : ''}`}>
              <input type="file" accept=".xlsx,.xls" onChange={(event) => void importFile(event)} disabled={importing} />
              {importMode === 'file' ? 'Importando planilha…' : 'Selecionar planilha nova'}
            </label>
          </div>
          <div className="developer-rules">
            <div><b>Base guardada</b><span>37 Regionais · 100 Distritais · 323 Consultores ativos</span></div>
            <div><b>Login</b><span>Coluna K: t0034327 ou t0034327@ems.com.br</span></div>
            <div><b>Senha inicial</b><span>Setor próprio: RG, GD ou Consultor</span></div>
            <div><b>Visibilidade</b><span>A Regional só aparece após ativar o GR</span></div>
          </div>
        </section>

        <section className="developer-list-card">
          <div className="developer-list-heading"><div><span>Ativação controlada</span><h2>Gerentes Regionais encontrados</h2></div><button onClick={() => void load()} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar'}</button></div>
          <div className="developer-table-wrap">
            <table>
              <thead><tr><th>Regional / setor</th><th>Gerente Regional</th><th>Login EMS</th><th>Equipe</th><th>Extração</th><th>Status</th></tr></thead>
              <tbody>
                {structure.regionais.map((regional) => {
                  const manager = managersByRegional.get(regional.id)
                  const active = Number(regional.ativo || 0) === 1
                  return (
                    <tr key={regional.id}>
                      <td><strong>{regional.nome}</strong><small className="developer-cell-note">Setor {regional.setor || '—'}</small></td>
                      <td>{manager?.nome || 'GR não localizado'}<small className="developer-cell-note">Senha inicial: {manager?.setor || regional.setor || '—'}</small></td>
                      <td>{manager?.login_rede || manager?.email || '—'}</td>
                      <td>{Number(regional.total_distritais || 0)} GD · {Number(regional.total_consultores || 0)} Consultores</td>
                      <td><span className={manager?.credencial_configurada ? 'credential-ready' : 'credential-pending'}>{manager?.credencial_configurada ? 'Bússola e Mercado Farma prontas' : 'Pendente'}</span></td>
                      <td><button className={active ? 'regional-disable' : 'regional-enable'} disabled={changing.includes(regional.id) || Number(regional.na_base_atual || 0) !== 1} onClick={() => void toggleRegional(regional)}>{changing.includes(regional.id) ? 'Aguarde…' : active ? 'Desativar GR' : 'Ativar GR'}</button></td>
                    </tr>
                  )
                })}
                {!structure.regionais.length && <tr><td colSpan={6} className="developer-empty">Use a base já carregada para cadastrar a hierarquia.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="developer-list-card">
          <div className="developer-list-heading"><div><span>Histórico</span><h2>Últimas atualizações da base</h2></div></div>
          <div className="developer-table-wrap">
            <table className="developer-history-table">
              <thead><tr><th>Data</th><th>Arquivo / aba</th><th>Linhas</th><th>Regionais</th><th>Distritais</th><th>Consultores</th></tr></thead>
              <tbody>
                {structure.importacoes.map((item) => <tr key={item.id}><td>{formatDate(item.criado_em)}</td><td><strong>{item.nome_arquivo}</strong><small className="developer-cell-note">{item.nome_planilha || '—'}</small></td><td>{item.total_linhas}</td><td>{item.total_regionais}</td><td>{item.total_distritais}</td><td>{item.total_consultores}</td></tr>)}
                {!structure.importacoes.length && <tr><td colSpan={6} className="developer-empty">Nenhuma atualização registrada.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}
