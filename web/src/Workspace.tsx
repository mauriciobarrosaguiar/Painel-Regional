import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api'
import type { AutomationData, Dashboard, Distrital, Hierarquia, Regional, SessionUser } from './types'
import { readRegionalNavigation, saveRegionalNavigation } from './regionalNavigation'
import type { RegionalPage } from './regionalNavigation'
import './district-modules.css'

type Props = {
  user: SessionUser
  regional: Regional
  onLogout: () => void
}

type CredentialItem = {
  tipo?: string
  usuario_mascarado?: string
  status?: string
  mensagem_status?: string
  atualizado_em?: string | null
}

type CredentialStatus = {
  bussola: CredentialItem | null
  mercado_farma: CredentialItem | null
}

type ClientRow = {
  id: number
  cnpj: string
  nome_pdv: string
  grupo_economico?: string
  cidade?: string
  uf?: string
  situacao?: string
  nome_consultor?: string
  setor_consultor?: string
  foco_pex?: string
  positivacao?: string
}

type ClientsData = {
  clientes: ClientRow[]
  total: number
  pagina: number
  paginas: number
  resumo: { clientes: number; consultores: number; cidades: number; ufs: number }
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const number = new Intl.NumberFormat('pt-BR')
const percent = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
const achievement = (value: number, goal: number) => goal > 0 ? (value / goal) * 100 : 0
const roleLabel = (profile: string) => profile === 'RG' ? 'GR' : profile

const emptyDashboard: Dashboard = {
  escopo: 'Resultado Regional',
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
}

const emptyAutomations: AutomationData = {
  comandos: [],
  extracoes: [],
  em_execucao: 0,
  credencial_configurada: false,
  atualizado_em: '',
}

const emptyClients: ClientsData = {
  clientes: [], total: 0, pagina: 1, paginas: 1,
  resumo: { clientes: 0, consultores: 0, cidades: 0, ufs: 0 },
}

const districtPages: { id: RegionalPage; label: string }[] = [
  { id: 'visao-geral', label: 'Visão Geral' },
  { id: 'sips', label: 'SIP / Redes' },
  { id: 'consultores', label: 'Consultores' },
  { id: 'clientes', label: 'Clientes' },
  { id: 'foco-semanal', label: 'Foco Semanal' },
  { id: 'mercado-farma', label: 'Mercado Farma' },
]

export default function Workspace({ user, regional, onLogout }: Props) {
  const initialNavigation = useMemo(() => readRegionalNavigation(), [])
  const forcedDistrictId = user.perfil === 'GD' || user.perfil === 'CONSULTOR'
    ? Number(user.distrital_id || 0) || null
    : null
  const [page, setPage] = useState<RegionalPage>(() => {
    if (forcedDistrictId && initialNavigation.pagina === 'regional') return 'visao-geral'
    return initialNavigation.pagina
  })
  const [selectedDistrictId, setSelectedDistrictId] = useState<number | null>(forcedDistrictId || initialNavigation.distritalId)
  const [hierarchy, setHierarchy] = useState<Hierarquia | null>(null)
  const [dashboard, setDashboard] = useState<Dashboard>(emptyDashboard)
  const [automations, setAutomations] = useState<AutomationData>(emptyAutomations)
  const [credentials, setCredentials] = useState<CredentialStatus>({ bussola: null, mercado_farma: null })
  const [clients, setClients] = useState<ClientsData>(emptyClients)
  const [clientSearch, setClientSearch] = useState('')
  const [clientPage, setClientPage] = useState(1)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const districts = hierarchy?.distritais || []
  const selectedDistrict = districts.find((item) => Number(item.id) === Number(selectedDistrictId)) || null

  const loadWorkspace = useCallback(async () => {
    setLoading(true)
    try {
      const hierarchyData = await api<Hierarquia>('hierarquia')
      setHierarchy(hierarchyData)
      const allowedDistrict = forcedDistrictId || selectedDistrictId
      const query = allowedDistrict ? `?distrital_id=${allowedDistrict}` : ''
      setDashboard(await api<Dashboard>(`dashboard${query}`))
      if (allowedDistrict && !hierarchyData.distritais.some((item) => Number(item.id) === Number(allowedDistrict))) {
        setSelectedDistrictId(forcedDistrictId || null)
      }
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o painel.')
    } finally {
      setLoading(false)
    }
  }, [forcedDistrictId, selectedDistrictId])

  const loadCredentials = useCallback(async () => {
    if (user.perfil !== 'RG') return
    try { setCredentials(await api<CredentialStatus>('integracoes/credenciais')) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível carregar as integrações.') }
  }, [user.perfil])

  const loadAutomations = useCallback(async () => {
    if (user.perfil !== 'RG') return
    try { setAutomations(await api<AutomationData>('automacoes')) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível carregar as automações.') }
  }, [user.perfil])

  const loadClients = useCallback(async () => {
    if (!selectedDistrictId) return
    const params = new URLSearchParams({ distrital_id: String(selectedDistrictId), pagina: String(clientPage), limite: '30' })
    if (clientSearch.trim()) params.set('busca', clientSearch.trim())
    try {
      setClients(await api<ClientsData>(`clientes?${params.toString()}`))
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os clientes.')
    }
  }, [selectedDistrictId, clientPage, clientSearch])

  useEffect(() => { void loadWorkspace() }, [loadWorkspace])
  useEffect(() => { if (page === 'administracao') void loadCredentials() }, [page, loadCredentials])
  useEffect(() => { if (page === 'automacoes') void loadAutomations() }, [page, loadAutomations])
  useEffect(() => { if (page === 'clientes') void loadClients() }, [page, loadClients])

  useEffect(() => {
    const handlePop = () => {
      const navigation = readRegionalNavigation()
      setPage(navigation.pagina)
      setSelectedDistrictId(forcedDistrictId || navigation.distritalId)
    }
    window.addEventListener('popstate', handlePop)
    return () => window.removeEventListener('popstate', handlePop)
  }, [forcedDistrictId])

  function navigate(nextPage: RegionalPage, districtId = selectedDistrictId, replace = false) {
    const safeDistrict = forcedDistrictId || districtId
    setPage(nextPage)
    setSelectedDistrictId(safeDistrict)
    setMessage('')
    setError('')
    saveRegionalNavigation(nextPage, safeDistrict, replace)
  }

  function openDistrict(district: Distrital) {
    setClientPage(1)
    navigate('visao-geral', district.id)
  }

  async function saveCredential(event: FormEvent<HTMLFormElement>, type: 'BUSSOLA' | 'MERCADO_FARMA') {
    event.preventDefault()
    setMessage('')
    setError('')
    const form = event.currentTarget
    const data = new FormData(form)
    try {
      const result = await api<{ mensagem: string }>('integracoes/credenciais', {
        method: 'POST',
        body: JSON.stringify({ tipo: type, usuario: data.get('usuario'), senha: data.get('senha') }),
      })
      form.reset()
      setMessage(result.mensagem)
      await loadCredentials()
      await loadAutomations()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar a credencial.')
    }
  }

  async function requestAutomation(type: 'BUSSOLA' | 'MERCADO_FARMA') {
    setMessage('')
    setError('')
    try {
      const result = await api<{ mensagem: string }>('automacoes/solicitar', {
        method: 'POST', body: JSON.stringify({ tipo: type }),
      })
      setMessage(result.mensagem)
      await loadAutomations()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível solicitar a extração.')
    }
  }

  const inDistrict = Boolean(selectedDistrictId) && page !== 'regional' && page !== 'administracao' && page !== 'automacoes'

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => navigate(forcedDistrictId ? 'visao-geral' : 'regional', forcedDistrictId)}>
          <span className="brand-mark">R</span>
          <span><strong>Painel Regional</strong><small>{selectedDistrict?.nome || regional.nome}</small></span>
        </button>
        <div className="profile-area">
          <span className={`role-badge role-${user.perfil.toLowerCase()}`}>{roleLabel(user.perfil)}</span>
          <span className="avatar">{initials(user.nome)}</span>
          <span className="profile-name">{user.nome}</span>
          <button className="text-button" onClick={onLogout}>Sair</button>
        </div>
      </header>

      <nav className="main-nav regional-main-nav">
        {inDistrict ? (
          <>
            {user.perfil === 'RG' && <button onClick={() => navigate('regional', null)}>← Regional</button>}
            {districtPages.map((item) => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => navigate(item.id)}>{item.label}</button>)}
          </>
        ) : (
          <>
            <button className={page === 'regional' ? 'active' : ''} onClick={() => navigate('regional', null)}>Visão Regional</button>
            {user.perfil === 'RG' && <button className={page === 'administracao' ? 'active' : ''} onClick={() => navigate('administracao', null)}>Administração</button>}
            {user.perfil === 'RG' && <button className={page === 'automacoes' ? 'active' : ''} onClick={() => navigate('automacoes', null)}>Automações</button>}
          </>
        )}
      </nav>

      <main className="content">
        {error && <div className="notice error">{error}</div>}
        {message && <div className="notice">{message}</div>}

        {page === 'regional' && <RegionalOverview user={user} regional={regional} dashboard={dashboard} loading={loading} districts={districts} onOpen={openDistrict} />}
        {page === 'visao-geral' && selectedDistrict && <DistrictOverview district={selectedDistrict} dashboard={dashboard} loading={loading} />}
        {page === 'sips' && selectedDistrict && <SipModule district={selectedDistrict} dashboard={dashboard} />}
        {page === 'consultores' && selectedDistrict && <ConsultantsModule district={selectedDistrict} />}
        {page === 'clientes' && selectedDistrict && <ClientsModule data={clients} search={clientSearch} page={clientPage} onSearch={(value) => { setClientSearch(value); setClientPage(1) }} onPage={setClientPage} onReload={() => void loadClients()} />}
        {page === 'foco-semanal' && selectedDistrict && <FocoModule district={selectedDistrict} />}
        {page === 'mercado-farma' && selectedDistrict && <MarketModule credentials={credentials} onRun={() => void requestAutomation('MERCADO_FARMA')} />}
        {page === 'administracao' && user.perfil === 'RG' && <Administration credentials={credentials} onSave={saveCredential} />}
        {page === 'automacoes' && user.perfil === 'RG' && <AutomationCenter data={automations} onRun={requestAutomation} />}
      </main>

      <footer><span>Painel Regional</span><span>Regional → Distritais → Consultores → Clientes</span></footer>
    </div>
  )
}

function RegionalOverview({ user, regional, dashboard, loading, districts, onOpen }: { user: SessionUser; regional: Regional; dashboard: Dashboard; loading: boolean; districts: Distrital[]; onOpen: (district: Distrital) => void }) {
  return <><section className="hero"><div><span className="eyebrow">Gestão comercial</span><h1>Olá, {user.nome.split(' ')[0]}</h1><p>Acompanhe a operação da {regional.nome} e abra uma Distrital.</p></div></section><DashboardPanel dashboard={dashboard} loading={loading} /><SectionTitle title="Distritais da Regional" description={`${districts.length} distrital(is) disponível(is)`} /><DistrictCards districts={districts} onOpen={onOpen} /></>
}

function DistrictOverview({ district, dashboard, loading }: { district: Distrital; dashboard: Dashboard; loading: boolean }) {
  return <><ModuleHero eyebrow="Distrital" title={district.nome} description={`GD: ${district.gerente_nome || 'não informado'} · ${district.consultores.length} Consultores`} /><DashboardPanel dashboard={dashboard} loading={loading} /><section className="north-module-grid">{[['Consultores', district.consultores.length], ['Clientes com venda', dashboard.clientes_com_venda], ['Clientes sem venda', dashboard.clientes_sem_venda], ['Pedidos não faturados', dashboard.pedidos_nao_faturados]].map(([label, value]) => <article key={String(label)}><span>{label}</span><strong>{number.format(Number(value))}</strong></article>)}</section></>
}

function SipModule({ district, dashboard }: { district: Distrital; dashboard: Dashboard }) {
  return <><ModuleHero eyebrow="SIP / Redes" title={`SIP — ${district.nome}`} description="Objetivo, cobertura, Prioritários, Lançamentos e GAP por rede, no padrão do Painel Norte." /><section className="north-module-grid">{[['Objetivo', dashboard.meta_ol_sem_combate], ['Realizado', dashboard.ol_sem_combate], ['Prioritários', dashboard.ol_prioritarios], ['Lançamentos', dashboard.ol_lancamentos]].map(([label, value]) => <article key={String(label)}><span>{label}</span><strong>{money.format(Number(value))}</strong></article>)}</section><EmptyState text="Os detalhes de SIP serão preenchidos pela sincronização regional do Bússola." /></>
}

function ConsultantsModule({ district }: { district: Distrital }) {
  return <><ModuleHero eyebrow="Consultores" title={`Equipe — ${district.nome}`} description="Ranking, resultado individual, metas e acompanhamento da equipe." /><div className="consultant-grid">{district.consultores.map((consultant) => <article className="consultant-card" key={consultant.id}><span className="avatar large">{initials(consultant.nome)}</span><div><h3>{consultant.nome}</h3><p>Setor {consultant.codigo}</p></div><span className="status-dot">Ativo</span></article>)}{!district.consultores.length && <EmptyState text="Nenhum Consultor vinculado a esta Distrital." />}</div></>
}

function ClientsModule({ data, search, page, onSearch, onPage, onReload }: { data: ClientsData; search: string; page: number; onSearch: (value: string) => void; onPage: (page: number) => void; onReload: () => void }) {
  return <><ModuleHero eyebrow="Clientes" title="Painel de Clientes" description="Carteira separada automaticamente por GR, GD e Consultor." /><section className="north-module-grid">{[['Clientes', data.resumo.clientes], ['Consultores', data.resumo.consultores], ['Cidades', data.resumo.cidades], ['UFs', data.resumo.ufs]].map(([label, value]) => <article key={String(label)}><span>{label}</span><strong>{number.format(Number(value))}</strong></article>)}</section><div className="client-toolbar"><input type="search" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Buscar por cliente, CNPJ, cidade ou grupo econômico" /><button className="secondary-button" onClick={onReload}>Atualizar</button></div><div className="client-list">{data.clientes.map((client) => <article key={client.id}><div><strong>{client.nome_pdv}</strong><span>{client.cnpj} · {client.cidade}/{client.uf}</span></div><div><b>{client.nome_consultor}</b><span>Setor {client.setor_consultor}</span></div><div><span>{client.grupo_economico || 'Independente'}</span><small>{client.situacao || '—'}</small></div></article>)}{!data.clientes.length && <EmptyState text="Nenhum cliente encontrado. A base deve ser anexada pelo desenvolvedor." />}</div><div className="pagination"><button disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</button><span>Página {data.pagina} de {data.paginas} · {number.format(data.total)} clientes</span><button disabled={page >= data.paginas} onClick={() => onPage(page + 1)}>Próxima</button></div></>
}

function FocoModule({ district }: { district: Distrital }) {
  return <><ModuleHero eyebrow="Foco Semanal" title={`Missões — ${district.nome}`} description="Produtos foco, meta, faturamento, cobertura e percentual por Consultor." /><section className="module-empty-card"><h2>Focos em andamento</h2><p>A estrutura está pronta para receber as missões e o histórico extraídos do Bússola.</p></section></>
}

function MarketModule({ credentials, onRun }: { credentials: CredentialStatus; onRun: () => void }) {
  return <><ModuleHero eyebrow="Mercado Farma" title="Preços e estoques por UF" description="Produtos, distribuidores, estoque, descontos e melhor preço, como no Painel Norte." /><section className="module-empty-card"><h2>{credentials.mercado_farma ? 'Acesso configurado' : 'Acesso pendente'}</h2><p>{credentials.mercado_farma?.mensagem_status || 'O GR deve cadastrar o login e a senha do Mercado Farma na Administração.'}</p><button className="primary-button" disabled={!credentials.mercado_farma} onClick={onRun}>Atualizar Mercado Farma</button></section></>
}

function Administration({ credentials, onSave }: { credentials: CredentialStatus; onSave: (event: FormEvent<HTMLFormElement>, type: 'BUSSOLA' | 'MERCADO_FARMA') => void }) {
  return <><ModuleHero eyebrow="Gerente Regional" title="Administração" description="As credenciais abaixo são exclusivas das extrações e não alteram a senha do Painel Regional." /><div className="integration-forms"><CredentialForm title="Bússola" status={credentials.bussola} onSubmit={(event) => onSave(event, 'BUSSOLA')} /><CredentialForm title="Mercado Farma" status={credentials.mercado_farma} onSubmit={(event) => onSave(event, 'MERCADO_FARMA')} /></div></>
}

function CredentialForm({ title, status, onSubmit }: { title: string; status: CredentialItem | null; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <form className="admin-card integration-form" onSubmit={onSubmit}><div><span className={status ? 'credential-ok' : 'credential-wait'}>{status ? 'Configurada' : 'Pendente'}</span><h2>{title}</h2><p>{status?.usuario_mascarado ? `Usuário salvo: ${status.usuario_mascarado}` : 'Cadastre um acesso próprio para esta integração.'}</p></div><label><span>Login do {title}</span><input name="usuario" required autoComplete="off" /></label><label><span>Senha do {title}</span><input name="senha" type="password" required autoComplete="new-password" /></label><button className="primary-button full">Salvar acesso do {title}</button></form>
}

function AutomationCenter({ data, onRun }: { data: AutomationData; onRun: (type: 'BUSSOLA' | 'MERCADO_FARMA') => void }) {
  const extended = data as AutomationData & { credenciais?: { bussola?: CredentialItem | null; mercado_farma?: CredentialItem | null } }
  return <><ModuleHero eyebrow="Processos" title="Central de Automações" description="Cada extração usa sua própria credencial da Regional." /><div className="automation-actions"><article><div><h2>Extrair Bússola</h2><p>Atualiza indicadores, SIP, Consultores, Clientes e Foco Semanal.</p></div><button className="primary-button" disabled={!extended.credenciais?.bussola} onClick={() => onRun('BUSSOLA')}>Executar agora</button></article><article><div><h2>Extrair Mercado Farma</h2><p>Atualiza preços e estoques das UFs da Regional.</p></div><button className="primary-button" disabled={!extended.credenciais?.mercado_farma} onClick={() => onRun('MERCADO_FARMA')}>Executar agora</button></article></div><section className="operations-list"><div className="operations-heading"><div><h2>Últimas solicitações</h2><small>{data.em_execucao} em execução</small></div></div>{data.comandos.map((item) => <article className="operation-row" key={item.id}><div><strong>{item.tipo.replace('_', ' ')}</strong><span>{item.mensagem || item.erro || 'Aguardando processamento'}</span></div><div><b className={`operation-status status-${String(item.status).toLowerCase()}`}>{item.status}</b><span>{item.solicitado_em}</span></div></article>)}{!data.comandos.length && <EmptyState text="Nenhuma extração solicitada." />}</section></>
}

function DashboardPanel({ dashboard, loading }: { dashboard: Dashboard; loading: boolean }) {
  const cards = [['OL sem combate', dashboard.ol_sem_combate, dashboard.meta_ol_sem_combate], ['OL prioritários', dashboard.ol_prioritarios, dashboard.meta_ol_prioritarios], ['OL lançamentos', dashboard.ol_lancamentos, dashboard.meta_ol_lancamentos]] as const
  return <><section className="total-card"><div><span>{dashboard.escopo}</span><small>Resultado consolidado</small></div><strong>{loading ? '—' : money.format(dashboard.ol_total_faturado)}</strong><div><span>OL combate</span><b>{loading ? '—' : money.format(dashboard.ol_combate)}</b></div></section><section className="metrics-grid">{cards.map(([label, value, goal]) => { const result = achievement(value, goal); return <article className="metric-card" key={label}><div className="metric-heading"><span>{label}</span><b className={result >= 100 ? 'good' : result >= 80 ? 'warning' : 'low'}>{percent.format(result)}%</b></div><strong>{loading ? '—' : money.format(value)}</strong><div className="metric-detail"><span>Meta</span><b>{money.format(goal)}</b></div></article> })}<article className="metric-card"><div className="metric-heading"><span>Clientes com venda</span><b>{number.format(dashboard.clientes_com_venda)}</b></div><strong>{number.format(dashboard.clientes_com_venda)}</strong><div className="metric-detail"><span>Sem venda</span><b>{number.format(dashboard.clientes_sem_venda)}</b></div></article><article className="metric-card"><div className="metric-heading"><span>Não faturados</span><b>{number.format(dashboard.pedidos_nao_faturados)}</b></div><strong>{money.format(dashboard.valor_nao_faturado)}</strong><div className="metric-detail"><span>Pedidos</span><b>{number.format(dashboard.pedidos_nao_faturados)}</b></div></article></section></>
}

function ModuleHero({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) { return <section className="hero compact-hero module-hero"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div></section> }
function SectionTitle({ title, description }: { title: string; description: string }) { return <section className="section-title"><div><span className="eyebrow">Estrutura hierárquica</span><h2>{title}</h2></div><p>{description}</p></section> }
function DistrictCards({ districts, onOpen }: { districts: Distrital[]; onOpen: (district: Distrital) => void }) { return <div className="district-grid">{districts.map((district) => <button className="district-card" key={district.id} onClick={() => onOpen(district)}><div className="district-card-top"><span className="district-icon">D</span><span className="status-dot">Ativa</span></div><div><h3>{district.nome}</h3><p>GD: {district.gerente_nome || 'não informado'}</p></div><div className="district-card-footer"><span>{district.consultores.length} consultor(es)</span><b>Abrir →</b></div></button>)}{!districts.length && <EmptyState text="Nenhuma Distrital disponível para este perfil." />}</div> }
function EmptyState({ text }: { text: string }) { return <div className="empty-state">{text}</div> }
