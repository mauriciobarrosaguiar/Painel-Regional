import { useEffect, useMemo, useState } from 'react'
import { api } from './api'
import type { Consultor, Dashboard, Distrital } from './types'
import './consultants-results.css'

type Props = {
  district: Distrital
}

type ConsultantDashboard = Dashboard & {
  valor_nao_faturado_sem_combate?: number
  valor_nao_faturado_lancamentos?: number
  valor_nao_faturado_prioritarios?: number
  valor_nao_faturado_combate?: number
}

type ConsultantResult = {
  consultant: Consultor
  dashboard: ConsultantDashboard
  error?: string
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const number = new Intl.NumberFormat('pt-BR')
const percent = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

const numeric = (value: unknown) => Number(value || 0)
const ratio = (value: number, goal: number) => goal > 0 ? (value / goal) * 100 : 0
const resultClass = (value: number) => value >= 100 ? 'good' : value >= 80 ? 'warning' : 'low'
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
const competenceLabel = (value?: string | null) => {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return ''
  const [year, month] = value.split('-')
  return `${month}/${year}`
}

const emptyDashboard = (consultant: Consultor): ConsultantDashboard => ({
  escopo: consultant.nome,
  ol_total_faturado: 0,
  ol_sem_combate: 0,
  ol_combate: 0,
  ol_prioritarios: 0,
  ol_lancamentos: 0,
  meta_ol_sem_combate: 0,
  meta_ol_prioritarios: 0,
  meta_ol_lancamentos: 0,
  clientes_com_venda: 0,
  clientes_sem_venda: 0,
  pedidos_nao_faturados: 0,
  valor_nao_faturado: 0,
  atualizado_em: '',
})

function PendingBreakdown({ dashboard }: { dashboard: ConsultantDashboard }) {
  const items = [
    ['OL sem combate', numeric(dashboard.valor_nao_faturado_sem_combate)],
    ['Lançamentos', numeric(dashboard.valor_nao_faturado_lancamentos)],
    ['Prioritários', numeric(dashboard.valor_nao_faturado_prioritarios)],
    ['Combate', numeric(dashboard.valor_nao_faturado_combate)],
  ] as const

  return (
    <div className="consultant-result-pending-grid">
      {items.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{money.format(value)}</strong>
        </div>
      ))}
    </div>
  )
}

export default function ConsultantsResultsModule({ district }: Props) {
  const [rows, setRows] = useState<ConsultantResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)

  useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      setError('')
      setExpandedId(null)

      const loaded = await Promise.all(district.consultores.map(async (consultant): Promise<ConsultantResult> => {
        try {
          const dashboard = await api<ConsultantDashboard>(
            `dashboard?distrital_id=${district.id}&consultor_id=${consultant.id}`,
          )
          return { consultant, dashboard }
        } catch (reason) {
          return {
            consultant,
            dashboard: emptyDashboard(consultant),
            error: reason instanceof Error ? reason.message : 'Não foi possível carregar o resultado.',
          }
        }
      }))

      if (!active) return
      setRows(loaded)
      const failures = loaded.filter((item) => item.error)
      if (failures.length === loaded.length && loaded.length) {
        setError('Não foi possível carregar os resultados dos Consultores desta Distrital.')
      } else if (failures.length) {
        setError(`${failures.length} Consultor(es) não tiveram o resultado carregado.`)
      }
      setLoading(false)
    }

    void load()
    return () => { active = false }
  }, [district.id, district.consultores])

  const rankedRows = useMemo(() => [...rows].sort((left, right) => {
    const leftResult = ratio(numeric(left.dashboard.ol_sem_combate), numeric(left.dashboard.meta_ol_sem_combate))
    const rightResult = ratio(numeric(right.dashboard.ol_sem_combate), numeric(right.dashboard.meta_ol_sem_combate))
    if (rightResult !== leftResult) return rightResult - leftResult
    return numeric(right.dashboard.ol_sem_combate) - numeric(left.dashboard.ol_sem_combate)
  }), [rows])

  const totals = useMemo(() => rows.reduce((result, item) => {
    result.semCombate += numeric(item.dashboard.ol_sem_combate)
    result.metaSemCombate += numeric(item.dashboard.meta_ol_sem_combate)
    result.prioritarios += numeric(item.dashboard.ol_prioritarios)
    result.metaPrioritarios += numeric(item.dashboard.meta_ol_prioritarios)
    result.lancamentos += numeric(item.dashboard.ol_lancamentos)
    result.metaLancamentos += numeric(item.dashboard.meta_ol_lancamentos)
    result.clientesComVenda += numeric(item.dashboard.clientes_com_venda)
    result.clientesSemVenda += numeric(item.dashboard.clientes_sem_venda)
    return result
  }, {
    semCombate: 0,
    metaSemCombate: 0,
    prioritarios: 0,
    metaPrioritarios: 0,
    lancamentos: 0,
    metaLancamentos: 0,
    clientesComVenda: 0,
    clientesSemVenda: 0,
  }), [rows])

  const competence = competenceLabel(rows.find((item) => item.dashboard.competencia_meta)?.dashboard.competencia_meta)

  return (
    <>
      <section className="hero compact-hero module-hero">
        <div>
          <span className="eyebrow">Consultores</span>
          <h1>Equipe — {district.nome}</h1>
          <p>Ranking, resultado individual, metas e acompanhamento da equipe no padrão do Painel Norte.</p>
        </div>
      </section>

      {error && <div className="notice error">{error}</div>}

      <section className="consultant-results-summary">
        <article>
          <span>OL sem combate</span>
          <strong>{loading ? '—' : money.format(totals.semCombate)}</strong>
          <small>Meta {money.format(totals.metaSemCombate)} · <b className={resultClass(ratio(totals.semCombate, totals.metaSemCombate))}>{percent.format(ratio(totals.semCombate, totals.metaSemCombate))}%</b></small>
        </article>
        <article>
          <span>Prioritários</span>
          <strong>{loading ? '—' : money.format(totals.prioritarios)}</strong>
          <small>Meta {money.format(totals.metaPrioritarios)} · <b className={resultClass(ratio(totals.prioritarios, totals.metaPrioritarios))}>{percent.format(ratio(totals.prioritarios, totals.metaPrioritarios))}%</b></small>
        </article>
        <article>
          <span>Lançamentos</span>
          <strong>{loading ? '—' : money.format(totals.lancamentos)}</strong>
          <small>Meta {money.format(totals.metaLancamentos)} · <b className={resultClass(ratio(totals.lancamentos, totals.metaLancamentos))}>{percent.format(ratio(totals.lancamentos, totals.metaLancamentos))}%</b></small>
        </article>
        <article>
          <span>CNPJs com vendas</span>
          <strong>{loading ? '—' : number.format(totals.clientesComVenda)}</strong>
          <small>{number.format(totals.clientesSemVenda)} sem venda{competence ? ` · Metas ${competence}` : ''}</small>
        </article>
      </section>

      <section className="consultant-results-ranking">
        <div className="consultant-results-heading">
          <div>
            <h2>Ranking de resultados</h2>
            <p>Toque no Consultor para abrir mais informações.</p>
          </div>
          <span>{district.consultores.length} consultor(es)</span>
        </div>

        <div className="consultant-results-list">
          {loading && <div className="consultant-results-empty">Carregando resultados dos Consultores…</div>}

          {!loading && rankedRows.map(({ consultant, dashboard, error: rowError }, index) => {
            const totalClients = numeric(dashboard.clientes_com_venda) + numeric(dashboard.clientes_sem_venda)
            const semCombateResult = ratio(numeric(dashboard.ol_sem_combate), numeric(dashboard.meta_ol_sem_combate))
            const prioritariosResult = ratio(numeric(dashboard.ol_prioritarios), numeric(dashboard.meta_ol_prioritarios))
            const lancamentosResult = ratio(numeric(dashboard.ol_lancamentos), numeric(dashboard.meta_ol_lancamentos))
            const expanded = expandedId === consultant.id

            return (
              <article className={`consultant-result-card${expanded ? ' is-expanded' : ''}`} key={consultant.id}>
                <button
                  type="button"
                  className="consultant-result-toggle"
                  onClick={() => setExpandedId(expanded ? null : consultant.id)}
                  aria-expanded={expanded}
                >
                  <div className="consultant-result-identity">
                    <span className="consultant-result-position">{index + 1}</span>
                    <span className="consultant-result-avatar">{initials(consultant.nome)}</span>
                    <div>
                      <h3>{consultant.nome}</h3>
                      <small>Setor {consultant.codigo} · {number.format(numeric(dashboard.clientes_com_venda))}/{number.format(totalClients)} CNPJs com vendas</small>
                    </div>
                  </div>

                  <div className="consultant-result-metric">
                    <span>Sem combate</span>
                    <strong>{money.format(numeric(dashboard.ol_sem_combate))}</strong>
                    <small>Meta {money.format(numeric(dashboard.meta_ol_sem_combate))} · <b className={resultClass(semCombateResult)}>{percent.format(semCombateResult)}%</b></small>
                  </div>

                  <div className="consultant-result-metric">
                    <span>Prioritários</span>
                    <strong>{money.format(numeric(dashboard.ol_prioritarios))}</strong>
                    <small>Meta {money.format(numeric(dashboard.meta_ol_prioritarios))} · <b className={resultClass(prioritariosResult)}>{percent.format(prioritariosResult)}%</b></small>
                  </div>

                  <div className="consultant-result-metric">
                    <span>Lançamentos</span>
                    <strong>{money.format(numeric(dashboard.ol_lancamentos))}</strong>
                    <small>Meta {money.format(numeric(dashboard.meta_ol_lancamentos))} · <b className={resultClass(lancamentosResult)}>{percent.format(lancamentosResult)}%</b></small>
                  </div>

                  <div className="consultant-result-pending">
                    <span>Atendidos e ainda não faturados</span>
                    <strong>{number.format(numeric(dashboard.pedidos_nao_faturados))} · {money.format(numeric(dashboard.valor_nao_faturado))}</strong>
                    <small>pedidos/notas · toque para detalhar</small>
                    <PendingBreakdown dashboard={dashboard} />
                    <em>Prioritários e lançamentos já compõem o OL sem combate.</em>
                  </div>

                  <span className="consultant-result-expand" aria-hidden="true">{expanded ? '−' : '+'}</span>
                </button>

                {expanded && (
                  <div className="consultant-result-details">
                    {rowError && <div className="notice error">{rowError}</div>}
                    <article><span>OL total faturado</span><strong>{money.format(numeric(dashboard.ol_total_faturado))}</strong></article>
                    <article><span>OL combate</span><strong>{money.format(numeric(dashboard.ol_combate))}</strong></article>
                    <article><span>Clientes com venda</span><strong>{number.format(numeric(dashboard.clientes_com_venda))}</strong></article>
                    <article><span>Clientes sem venda</span><strong>{number.format(numeric(dashboard.clientes_sem_venda))}</strong></article>
                    <article><span>Pedidos não faturados</span><strong>{number.format(numeric(dashboard.pedidos_nao_faturados))}</strong></article>
                    <article><span>Valor não faturado</span><strong>{money.format(numeric(dashboard.valor_nao_faturado))}</strong></article>
                  </div>
                )}
              </article>
            )
          })}

          {!loading && !rankedRows.length && <div className="consultant-results-empty">Nenhum Consultor vinculado a esta Distrital.</div>}
        </div>
      </section>
    </>
  )
}
