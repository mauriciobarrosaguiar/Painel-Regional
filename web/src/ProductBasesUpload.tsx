import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import * as XLSX from 'xlsx'
import { api } from './api'
import type { Regional } from './types'
import './produtos-upload.css'

type Mode = 'DESENVOLVEDOR' | 'RG' | 'GD'
type BaseType = 'PRODUTOS_MIX' | 'PRODUTOS_MERCADO_FARMA'
type ProductRow = { ean: string; produto: string; tipo_mix?: string }
type BaseInfo = { total: number; origem: 'DISTRITAL' | 'REGIONAL' | 'AUSENTE'; proprio: boolean }
type ImportItem = {
  id: string
  tipo: BaseType
  nome_arquivo: string
  total_importado: number
  status: string
  mensagem?: string
  enviado_por?: string
  criado_em: string
}
type StatusResponse = {
  regional: Regional
  distrital?: { id: number; nome: string; codigo: string } | null
  escopo: 'REGIONAL' | 'DISTRITAL'
  bases: {
    produtos_mix: BaseInfo
    produtos_mercado_farma: BaseInfo
  }
  importacoes: ImportItem[]
}
type Props = {
  mode: Mode
  regionalId?: number | null
  regionalName?: string
  districtId?: number | null
}
type ImportState = { loading: boolean; message: string; error: string }

const EMPTY_IMPORT: ImportState = { loading: false, message: '', error: '' }
const normalize = (value: unknown) => String(value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase()
const key = (value: unknown) => normalize(value).replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '')
const dateLabel = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR')
}

const CARDS: Array<{
  type: BaseType
  statusKey: 'produtos_mix' | 'produtos_mercado_farma'
  title: string
  description: string
  expected: string
}> = [
  {
    type: 'PRODUTOS_MIX',
    statusKey: 'produtos_mix',
    title: 'Produtos / Mix',
    description: 'Classificação de cada EAN como Linha, Combate, Prioritário ou Lançamento.',
    expected: 'EAN, PRODUTO e TIPO MIX',
  },
  {
    type: 'PRODUTOS_MERCADO_FARMA',
    statusKey: 'produtos_mercado_farma',
    title: 'Produtos do Mercado Farma',
    description: 'EANs usados na extração automática de preços e estoques.',
    expected: 'EAN e PRODUTO',
  },
]

function hasHeader(row: unknown[], aliases: string[]) {
  const values = new Set(row.map(key))
  return aliases.some((alias) => values.has(alias))
}

function findColumn(headers: string[], aliases: string[]) {
  return headers.findIndex((header) => aliases.some((alias) => header === alias || header.includes(alias)))
}

async function readProducts(file: File, type: BaseType): Promise<ProductRow[]> {
  if (file.size > 20 * 1024 * 1024) throw new Error('O arquivo excede o limite de 20 MB.')
  if (!/\.(xlsx?|csv)$/i.test(file.name)) throw new Error('Use uma planilha XLSX, XLS ou CSV.')

  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false, raw: true })
  for (const sheetName of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1, defval: '', raw: true,
    }) as unknown[][]
    const headerIndex = matrix.findIndex((row, index) => index <= 30 && hasHeader(row, ['EAN', 'EAN13', 'GTIN', 'CODIGO_DE_BARRAS']))
    if (headerIndex < 0) continue

    const headers = (matrix[headerIndex] || []).map(key)
    const eanColumn = findColumn(headers, ['EAN', 'EAN13', 'GTIN', 'CODIGO_DE_BARRAS'])
    const productColumn = findColumn(headers, ['PRODUTO', 'DESCRICAO', 'NOME_PRODUTO'])
    const mixColumn = findColumn(headers, ['TIPO_MIX', 'CLASSIFICACAO', 'CATEGORIA', 'MIX'])
    if (eanColumn < 0) continue
    if (type === 'PRODUTOS_MIX' && mixColumn < 0) {
      throw new Error('A planilha de Produtos / Mix precisa ter a coluna TIPO MIX.')
    }

    const unique = new Map<string, ProductRow>()
    for (const row of matrix.slice(headerIndex + 1)) {
      const ean = digits(row[eanColumn])
      if (ean.length < 8 || ean.length > 14) continue
      unique.set(ean, {
        ean,
        produto: productColumn >= 0 ? String(row[productColumn] ?? '').trim() : '',
        tipo_mix: mixColumn >= 0 ? String(row[mixColumn] ?? '').trim() : '',
      })
    }
    if (unique.size) return [...unique.values()]
  }
  throw new Error('Não encontrei EANs válidos na planilha.')
}

function sourceLabel(info: BaseInfo, mode: Mode) {
  if (!info.total) return 'Base ausente'
  if (mode === 'GD' && info.origem === 'REGIONAL') return `${info.total.toLocaleString('pt-BR')} registros · herdada do GR`
  if (info.origem === 'DISTRITAL') return `${info.total.toLocaleString('pt-BR')} registros · base do GD`
  return `${info.total.toLocaleString('pt-BR')} registros`
}

export default function ProductBasesUpload({ mode, regionalId, regionalName, districtId }: Props) {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const [regionals, setRegionals] = useState<Regional[]>([])
  const [selectedRegional, setSelectedRegional] = useState(String(regionalId || ''))
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [generalError, setGeneralError] = useState('')
  const [states, setStates] = useState<Record<BaseType, ImportState>>({
    PRODUTOS_MIX: { ...EMPTY_IMPORT },
    PRODUTOS_MERCADO_FARMA: { ...EMPTY_IMPORT },
  })

  useEffect(() => {
    if (mode !== 'DESENVOLVEDOR') return
    api<{ regionais: Regional[] }>('developer/estrutura')
      .then((result) => setRegionals(result.regionais || []))
      .catch(() => setRegionals([]))
  }, [mode])

  useEffect(() => {
    if (regionalId) setSelectedRegional(String(regionalId))
  }, [regionalId])

  useEffect(() => {
    const updateTarget = () => {
      if (mode === 'DESENVOLVEDOR') {
        setTarget(document.querySelector<HTMLElement>('.developer-content'))
        return
      }
      const active = normalize(document.querySelector<HTMLElement>('.regional-main-nav button.active')?.textContent)
      const visible = mode === 'RG'
        ? active.includes('ACESSOS DOS GDS') || active.includes('ADMINISTRACAO')
        : active.includes('MEUS ACESSOS')
      setTarget(visible ? document.querySelector<HTMLElement>('.content') : null)
    }

    updateTarget()
    const observer = new MutationObserver(updateTarget)
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] })
    window.addEventListener('popstate', updateTarget)
    return () => {
      observer.disconnect()
      window.removeEventListener('popstate', updateTarget)
    }
  }, [mode])

  const loadStatus = useCallback(async () => {
    if (!selectedRegional) {
      setStatus(null)
      return
    }
    setLoading(true)
    setGeneralError('')
    try {
      const query = mode === 'DESENVOLVEDOR' ? `?regional_id=${encodeURIComponent(selectedRegional)}` : ''
      setStatus(await api<StatusResponse>(`produtos/importar${query}`))
    } catch (reason) {
      setStatus(null)
      setGeneralError(reason instanceof Error ? reason.message : 'Não foi possível consultar as bases de produtos.')
    } finally {
      setLoading(false)
    }
  }, [mode, selectedRegional])

  useEffect(() => {
    if (target && selectedRegional) void loadStatus()
  }, [target, selectedRegional, loadStatus])

  function patch(type: BaseType, values: Partial<ImportState>) {
    setStates((current) => ({ ...current, [type]: { ...current[type], ...values } }))
  }

  async function importFile(type: BaseType, event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (!file || !selectedRegional) return

    patch(type, { loading: true, message: '', error: '' })
    try {
      const rows = await readProducts(file, type)
      const result = await api<{ total_importado: number; mensagem: string }>('produtos/importar', {
        method: 'POST',
        body: JSON.stringify({
          regional_id: Number(selectedRegional),
          distrital_id: districtId || null,
          tipo: type,
          nome_arquivo: file.name,
          linhas: rows,
        }),
      })
      patch(type, { loading: false, message: result.mensagem || `${result.total_importado} produtos importados.`, error: '' })
      await loadStatus()
    } catch (reason) {
      patch(type, { loading: false, message: '', error: reason instanceof Error ? reason.message : 'Não foi possível importar a planilha.' })
    }
  }

  const scopeName = useMemo(() => {
    if (mode === 'GD') return status?.distrital?.nome || 'Minha Distrital'
    return status?.regional?.nome || regionalName || 'Regional selecionada'
  }, [mode, regionalName, status])

  if (!target) return null

  return createPortal(
    <section className="product-bases-section">
      <div className="product-bases-heading">
        <div>
          <span className="product-bases-kicker">Bases oficiais</span>
          <h2>Produtos e Mix</h2>
          <p>{mode === 'GD'
            ? `Atualize as bases usadas nas extrações da ${scopeName}. Sem uma base própria, a Distrital usa a base enviada pelo GR.`
            : `Atualize as bases de produtos usadas nas extrações da ${scopeName}.`}</p>
        </div>
        <button type="button" onClick={() => void loadStatus()} disabled={loading || !selectedRegional}>
          {loading ? 'Atualizando…' : 'Atualizar situação'}
        </button>
      </div>

      {mode === 'DESENVOLVEDOR' && (
        <label className="product-regional-field">
          <span>Regional</span>
          <select value={selectedRegional} onChange={(event) => setSelectedRegional(event.target.value)}>
            <option value="">Selecione uma Regional</option>
            {regionals.map((regional) => <option value={regional.id} key={regional.id}>{regional.nome} · Setor {regional.setor || '—'}</option>)}
          </select>
        </label>
      )}

      <div className="product-bases-note">A mesma planilha de Produtos / Mix pode ser usada nos dois uploads. No Mercado Farma, o EAN é o campo obrigatório.</div>
      {generalError && <div className="product-upload-alert error">{generalError}</div>}

      <div className="product-base-cards">
        {CARDS.map((card) => {
          const info = status?.bases[card.statusKey] || { total: 0, origem: 'AUSENTE', proprio: false }
          const state = states[card.type]
          return (
            <article className="product-base-card" key={card.type}>
              <div className="product-base-card-top">
                <div><h3>{card.title}</h3><p>{card.description}</p></div>
                <span className={info.total ? 'product-base-count ready' : 'product-base-count missing'}>{sourceLabel(info, mode)}</span>
              </div>
              <small><strong>Colunas esperadas:</strong> {card.expected}</small>
              {state.error && <div className="product-upload-alert error">{state.error}</div>}
              {state.message && <div className="product-upload-alert success">{state.message}</div>}
              <label className={`product-file-button ${state.loading || !selectedRegional ? 'disabled' : ''}`}>
                <input type="file" accept=".xlsx,.xls,.csv" disabled={state.loading || !selectedRegional} onChange={(event) => void importFile(card.type, event)} />
                {state.loading ? 'Lendo e importando…' : info.proprio ? 'Substituir planilha' : info.total ? 'Criar base própria' : 'Selecionar planilha'}
              </label>
            </article>
          )
        })}
      </div>

      <section className="product-import-history">
        <div><h3>Últimas importações</h3><span>{mode === 'GD' ? 'da Distrital' : 'da Regional'}</span></div>
        {(status?.importacoes || []).map((item) => (
          <article key={item.id}>
            <div><strong>{item.tipo === 'PRODUTOS_MIX' ? 'Produtos / Mix' : 'Produtos do Mercado Farma'}</strong><span>{item.nome_arquivo}</span></div>
            <div><b>{item.total_importado.toLocaleString('pt-BR')} registros</b><span>{dateLabel(item.criado_em)}</span></div>
          </article>
        ))}
        {!status?.importacoes?.length && <p>Nenhuma importação registrada neste escopo.</p>}
      </section>
    </section>,
    target,
  )
}
