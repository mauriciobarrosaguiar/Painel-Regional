import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api'
import ConsultantsResultsModule from './ConsultantsResultsModule'
import type { AutomationData, CredentialSummary, Dashboard, DistrictCredential, Distrital, Hierarquia, Regional, SessionUser } from './types'
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
  modo?: 'RG' | 'GD'
  integracao?: CredentialItem | null
  bussola: CredentialItem | null
  mercado_farma: CredentialItem | null
  distritais: DistrictCredential[]
  resumo: CredentialSummary
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
const competenceLabel = (value?: string | null) => {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return ''
  const [year, month] = value.split('-')
  return `${month}/${year}`
}

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

const emptySummary: CredentialSummary = { total: 0, configuradas: 0, pendentes: 0, completa: false }
const emptyCredentials: CredentialStatus = {
  bussola: null,
  mercado_farma: null,
  integracao: null,
  distritais: [],
  resumo: emptySummary,
}
const emptyAutomations: AutomationData = {
  comandos: [],
  extracoes: [],
  em_execucao: 0,
  credencial_configurada: false,
  distritais: [],
  resumo_credenciais: emptySummary,
  atualizado_em: '',
}
const emptyClients: ClientsData = {
  clientes: [], total: 0, pagina: 1, paginas: 1,
  resumo: { clientes: 0, consultores: 0, cidades: 0, ufs: 0 },
}

const districtPages: { id: RegionalPage; label: string; managers?: ('RG' | 'GD')[] }[] = [
  { id: 'visao-geral', label: 'Visão Geral' },
  { id: 'consultores', label: 'Consultores' },
  { id: 'clientes', label: 'Clientes' },
  { id: 'foco-semanal', label: 'Foco Semanal' },
  { id: 'oportunidades', label: 'Oportunidades' },
  { id: 'mercado-farma', label: 'Mercado Farma' },
  { id: 'sips', label: 'SIP / Redes' },
  { id: 'historico', label: 'Histórico' },
  { id: 'integracoes', label: 'Meus acessos', managers: ['GD'] },
  { id: 'automacoes', label: 'Automações', managers: ['GD'] },
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
  const [credentials, setCredentials] = useState<CredentialStatus>(emptyCredentials)
  const [clients, setClients] = useState<ClientsData>(emptyClients)
  const [clientSearch, setClientSearch] = useState('')
  const [clientPage, setClientPage] = useState(1)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const districts = hierarchy?.distritais || []
  const selectedDistrict = districts.find((item) => Number(item.id) === Number(selectedDistrictId)) || null
  const isManager = user.perfil === 'RG' || user.perfil === 'GD'

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
    if (!isManager) return
    try { setCredentials(await api<CredentialStatus>('integracoes/credenciais')) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os acessos das integrações.') }
  }, [isManager])

  const loadAutomations = useCallback(async () => {
    if (!isManager) return
    try { setAutomations(await api<AutomationData>('automacoes')) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível carregar as automações.') }
  }, [isManager])

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
  useEffect(() => {
    if (['administracao', 'integracoes', 'mercado-farma'].includes(page)) void loadCredentials()
  }, [page, loadCredentials])
  useEffect(() => { if (page === 'automacoes') void loadAutomations() }, [page, loadAutomations])
  useEffect(() => { if (page === 'clientes') void loadClients() }, [page, loadClients])

  useEffect(() => {
    if (page !== 'automacoes' || !isManager) return undefined
    const timer = window.setInterval(() => void loadAutomations(), 5000)
    return () => window.clearInterval(timer)
  }, [page, isManager, loadAutomations])

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

  async function saveCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')
    setError('')
    const form = event.currentTarget
    const data = new FormData(form)
    try {
      const result = await api<{ mensagem: string }>('integracoes/credenciais', {
        method: 'POST',
        body: JSON.stringify({ usuario: data.get('usuario'), senha: data.get('senha') }),
      })
      form.reset()
      setMessage(result.mensagem)
      await Promise.all([loadCredentials(), loadAutomations()])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o acesso.')
    }
  }

  async function requestAutomation(type: 'BUSSOLA' | 'MERCADO_FARMA' | 'SHAREPOINT') {
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

  const isRegionalRoot = user.perfil === 'RG' && ['regional', 'administracao', 'automacoes'].includes(page)
  const inDistrict = Boolean(selectedDistrictId) && !isRegionalRoot
  const visibleDistrictPages = districtPages.filter((item) => !item.managers || item.managers.includes(user.perfil as 'RG' | 'GD'))

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
            {visibleDistrictPages.map((item) => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => navigate(item.id)}>{item.label}</button>)}
          </>
        ) : (
          <>
            <button className={page === 'regional' ? 'active' : ''} onClick={() => navigate('regional', null)}>Visão Regional</button>
            {user.perfil === 'RG' && <button className={page === 'administracao' ? 'active' : ''} onClick={() => navigate('administracao', null)}>Acessos dos GDs</button>}
            {user.perfil === 'RG' && <button className={page === 'automacoes' ? 'active' : ''} onClick={() => navigate('automacoes', null)}>Automações</button>}
          </>
        )}
      </nav>

      <main className="content">
        {error && <div className="notice error">{error}</div>}
        {message && <div className="notice">{message}</div>}

        {page === 'regional' && <RegionalOverview user={user} regional={regional} dashboard={dashboard} loading={loading} districts={districts} onOpen={openDistrict} />}
        {page === 'visao-geral' && selectedDistrict && <DistrictOverview profile={user.perfil} district={selectedDistrict} dashboard={dashboard} loading={loading} onNavigate={navigate} />}
        {page === 'sips' && selectedDistrict && <SipModule district={selectedDistrict} dashboard={dashboard} />}
        {page === 'consultores' && selectedDistrict && <ConsultantsResultsModule district={selectedDistrict} />}
        {page === 'clientes' && selectedDistrict && <ClientsModule data={clients} search={clientSearch} page={clientPage} onSearch={(value) => { setClientSearch(value); setClientPage(1) }} onPage={setClientPage} onReload={() => void loadClients()} />}
        {page === 'foco-semanal' && selectedDistrict && <FocoModule district={selectedDistrict} />}
        {page === 'oportunidades' && selectedDistrict && <OpportunitiesModule district={selectedDistrict} dashboard={dashboard} />}
        {page === 'mercado-farma' && selectedDistrict && <MarketModule profile={user.perfil} credentials={credentials} onRun={() => void requestAutomation('MERCADO_FARMA')} />}
        {page === 'historico' && selectedDistrict && <HistoryModule district={selectedDistrict} />}
        {page === 'integracoes' && user.perfil === 'GD' && selectedDistrict && <DistrictIntegration district={selectedDistrict} credentials={credentials} onSave={saveCredential} />}
        {page === 'administracao' && user.perfil === 'RG' && <Administration credentials={credentials} />}
        {page === 'automacoes' && isManager && <AutomationCenter profile={user.perfil as 'RG' | 'GD'} data={automations} onRun={requestAutomation} />}
      </main>

      <footer><span>Painel Regional</span><span>Regional → Distritais → Consultores → Clientes</span></footer>
    </div>
  )
}

function RegionalOverview({ user, regional, dashboard, loading, districts, onOpen }: { user: SessionUser; regional: Regional; dashboard: Dashboard; loading: boolean; districts: Distrital[]; onOpen: (district: Distrital) => void }) {
  return <><section className="hero"><div><span className="eyebrow">Gestão comercial</span><h1>Olá, {user.nome.split(' ')[0]}</h1><p>Resultado consolidado da {regional.nome}, formado pelas extrações de todos os GDs.</p></div></section><DashboardPanel dashboard={dashboard} loading={loading} /><SectionTitle title="Distritais da Regional" description={`${districts.length} distrital(is) disponível(is)`} /><DistrictCards districts={districts} onOpen={onOpen} /></>
}

function DistrictOverview({ profile, district, dashboard, loading, onNavigate }: { profile: SessionUser['perfil']; district: Distrital; dashboard: Dashboard; loading: boolean; onNavigate: (page: RegionalPage) => void }) {
  const clientsTotal = dashboard.clientes_com_venda + dashboard.clientes_sem_venda
  const modules: { id: RegionalPage; icon: string; label: string; summary: string; gdOnly?: boolean }[] = [
    { id: 'consultores', icon: 'C', label: 'CONSULTOR', summary: `${number.format(district.consultores.length)} consultor(es)` },
    { id: 'clientes', icon: 'CL', label: 'CLIENTES', summary: `${number.format(clientsTotal)} cliente(s)` },
    { id: 'foco-semanal', icon: 'FS', label: 'FOCO SEMANAL', summary: 'Missões e resultados' },
    { id: 'oportunidades', icon: 'OP', label: 'OPORTUNIDADES', summary: `${number.format(dashboard.clientes_sem_venda)} cliente(s) sem venda` },
    { id: 'mercado-farma', icon: 'MF', label: 'MERCADO FARMA', summary: 'Preços e estoques' },
    { id: 'sips', icon: 'SIP', label: 'SIP', summary: 'Redes, metas e cobertura' },
    { id: 'historico', icon: 'H', label: 'HISTÓRICO', summary: 'Evolução mês a mês' },
    { id: 'integracoes', icon: 'AC', label: 'MEUS ACESSOS', summary: 'Bússola e Mercado Farma', gdOnly: true },
    { id: 'automacoes', icon: 'AU', label: 'AUTOMAÇÕES', summary: 'Atualizar a sua Distrital', gdOnly: true },
  ]

  return (
    <>
      <ModuleHero eyebrow="Distrital" title={district.nome} description={`GD: ${district.gerente_nome || 'não informado'} · ${district.consultores.length} Consultores`} />
      <DashboardPanel dashboard={dashboard} loading={loading} />
      <section className="gd-modules-section">
        <div className="gd-modules-heading"><div><span className="eyebrow">Acesso rápido</span><h2>Módulos do GD</h2></div><p>Selecione um card para abrir as informações desta Distrital.</p></div>
        <div className="gd-module-grid">
          {modules.filter((module) => !module.gdOnly || profile === 'GD').map((module) => (
            <button className="gd-module-card" key={module.id} onClick={() => onNavigate(module.id)}>
              <span className="gd-module-icon">{module.icon}</span><span className="gd-module-content"><strong>{module.label}</strong><small>{module.summary}</small></span><b className="gd-module-arrow">→</b>
            </button>
          ))}
        </div>
      </section>
    </>
  )
}

function SipModule({ district, dashboard }: { district: Distrital; dashboard: Dashboard }) {
  return <><ModuleHero eyebrow="SIP / Redes" title={`SIP — ${district.nome}`} description="Objetivo, cobertura, Prioritários, Lançamentos e GAP por rede, no padrão do Painel Norte." /><section className="north-module-grid">{[['Objetivo', dashboard.meta_ol_sem_combate], ['Realizado', dashboard.ol_sem_combate], ['Prioritários', dashboard.ol_prioritarios], ['Lançamentos', dashboard.ol_lancamentos]].map(([label, value]) => <article key={String(label)}><span>{label}</span><strong>{money.format(Number(value))}</strong></article>)}</section><EmptyState text="Os detalhes de SIP serão preenchidos pela sincronização do Bússola desta Distrital." /></>
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

function OpportunitiesModule({ district, dashboard }: { district: Distrital; dashboard: Dashboard }) {
  const priorityGap = Math.max(dashboard.meta_ol_prioritarios - dashboard.ol_prioritarios, 0)
  return <><ModuleHero eyebrow="Oportunidades" title={`Oportunidades — ${district.nome}`} description="Clientes sem venda, pedidos não faturados e gaps para direcionar a atuação da equipe." /><section className="north-module-grid"><article><span>Clientes sem venda</span><strong>{number.format(dashboard.clientes_sem_venda)}</strong></article><article><span>Pedidos não faturados</span><strong>{number.format(dashboard.pedidos_nao_faturados)}</strong></article><article><span>Valor não faturado</span><strong>{money.format(dashboard.valor_nao_faturado)}</strong></article><article><span>GAP de Prioritários</span><strong>{money.format(priorityGap)}</strong></article></section><EmptyState text="A lista detalhada de oportunidades será alimentada pela sincronização do Bússola." /></>
}

function MarketModule({ profile, credentials, onRun }: { profile: SessionUser['perfil']; credentials: CredentialStatus; onRun: () => void }) {
  const configured = Boolean(credentials.integracao)
  return <><ModuleHero eyebrow="Mercado Farma" title="Preços e estoques por UF" description="Produtos, distribuidores, estoque, descontos e melhor preço, como no Painel Norte." /><section className="module-empty-card"><h2>{profile === 'GD' ? (configured ? 'Seu acesso está configurado' : 'Seu acesso está pendente') : 'Consolidação Regional'}</h2><p>{profile === 'GD' ? (credentials.integracao?.mensagem_status || 'Cadastre seu login e senha na página Meus acessos.') : `${credentials.resumo.configuradas} de ${credentials.resumo.total} GDs configuraram o acesso.`}</p>{profile === 'GD' && <button className="primary-button" disabled={!configured} onClick={onRun}>Atualizar minha Distrital</button>}</section></>
}

function HistoryModule({ district }: { district: Distrital }) {
  return <><ModuleHero eyebrow="Histórico" title={`Histórico — ${district.nome}`} description="Acompanhamento mensal dos principais indicadores da Distrital." /><section className="module-empty-card"><h2>Evolução mês a mês</h2><p>A página está disponível para receber o histórico consolidado das extrações do Bússola.</p></section></>
}

function DistrictIntegration({ district, credentials, onSave }: { district: Distrital; credentials: CredentialStatus; onSave: (event: FormEvent<HTMLFormElement>) => void }) {
  return <><ModuleHero eyebrow="Gerente Distrital" title="Meus acessos" description={`O acesso salvo será usado somente nas extrações da ${district.nome}.`} /><div className="integration-forms"><CredentialForm status={credentials.integracao || null} onSubmit={onSave} /></div></>
}

function CredentialForm({ status, onSubmit }: { status: CredentialItem | null; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <form className="admin-card integration-form" onSubmit={onSubmit}><div><span className={status ? 'credential-ok' : 'credential-wait'}>{status ? 'Configurado' : 'Pendente'}</span><h2>Bússola e Mercado Farma</h2><p>{status?.usuario_mascarado ? `Usuário salvo: ${status.usuario_mascarado}` : 'Informe o mesmo acesso usado no Bússola e no Mercado Farma.'}</p></div><label><span>Login do Bússola e Mercado Farma</span><input name="usuario" required autoComplete="off" /></label><label><span>Senha do Bússola e Mercado Farma</span><input name="senha" type="password" required autoComplete="new-password" /></label><button className="primary-button full">Salvar meu acesso</button></form>
}

function Administration({ credentials }: { credentials: CredentialStatus }) {
  return <><ModuleHero eyebrow="Gerente Regional" title="Acessos dos Gerentes Distritais" description="Cada GD cadastra o próprio acesso. O GR acompanha apenas o status, sem visualizar senhas." /><section className="credential-summary"><article><span>Distritais</span><strong>{credentials.resumo.total}</strong></article><article><span>Configuradas</span><strong>{credentials.resumo.configuradas}</strong></article><article><span>Pendentes</span><strong>{credentials.resumo.pendentes}</strong></article><article><span>Status</span><strong>{credentials.resumo.completa ? 'Completo' : 'Incompleto'}</strong></article></section><div className="credential-district-list">{credentials.distritais.map((district) => <article key={district.id}><div><strong>{district.nome}</strong><span>{district.gerente_nome || 'GD não informado'} · Setor {district.codigo}</span></div><div><b className={district.configurada ? 'credential-ok' : 'credential-wait'}>{district.configurada ? 'Configurado' : 'Pendente'}</b><small>{district.usuario_mascarado || 'Aguardando cadastro do GD'}</small></div></article>)}{!credentials.distritais.length && <EmptyState text="Nenhuma Distrital ativa encontrada." />}</div></>
}

function AutomationCenter({ profile, data, onRun }: { profile: 'RG' | 'GD'; data: AutomationData; onRun: (type: 'BUSSOLA' | 'MERCADO_FARMA' | 'SHAREPOINT') => void }) {
  const summary = data.resumo_credenciais || emptySummary
  const canRun = profile === 'GD' ? data.credencial_configurada : summary.configuradas > 0
  return <><ModuleHero eyebrow="Processos" title="Central de Automações" description={profile === 'RG' ? 'Dispare as extrações dos GDs configurados e consolide o resultado Regional.' : 'Atualize somente os dados da sua Distrital.'} /><section className="credential-progress"><div><strong>{summary.configuradas}/{summary.total}</strong><span>GDs com acesso configurado</span></div><div className="progress-track"><span style={{ width: `${summary.total ? (summary.configuradas / summary.total) * 100 : 0}%` }} /></div>{profile === 'RG' && summary.pendentes > 0 && <small>{summary.pendentes} GD(s) ainda precisam cadastrar o acesso.</small>}</section><div className={`automation-actions ${profile === 'RG' ? 'three-columns' : ''}`}><article><div><h2>{profile === 'RG' ? 'Extrair Bússola dos GDs' : 'Extrair meu Bússola'}</h2><p>Atualiza indicadores, SIP, Consultores, Clientes e Foco Semanal.</p></div><button className="primary-button" disabled={!canRun} onClick={() => onRun('BUSSOLA')}>Executar agora</button></article><article><div><h2>{profile === 'RG' ? 'Extrair Mercado Farma dos GDs' : 'Extrair meu Mercado Farma'}</h2><p>Atualiza preços e estoques usando o acesso de cada Distrital.</p></div><button className="primary-button" disabled={!canRun} onClick={() => onRun('MERCADO_FARMA')}>Executar agora</button></article>{profile === 'RG' && <article><div><h2>Importar metas do SharePoint</h2><p>Baixa Território, Rede e Associativo do mês e vincula GR, GD e Consultores.</p></div><button className="primary-button" onClick={() => onRun('SHAREPOINT')}>Importar metas</button></article>}</div><section className="operations-list"><div className="operations-heading"><div><h2>Últimas solicitações</h2><small>{data.em_execucao} em execução</small></div></div>{data.comandos.map((item) => <article className="operation-row" key={item.id}><div><strong>{item.tipo.replace('_', ' ')}{item.distrital_nome ? ` · ${item.distrital_nome}` : ''}</strong><span>{item.mensagem || item.erro || 'Aguardando processamento'}</span></div><div><b className={`operation-status status-${String(item.status).toLowerCase()}`}>{item.status}</b><span>{item.solicitado_em}</span></div></article>)}{!data.comandos.length && <EmptyState text="Nenhuma extração solicitada." />}</section></>
}

function DashboardPanel({ dashboard, loading }: { dashboard: Dashboard; loading: boolean }) {
  const cards = [['OL sem combate', dashboard.ol_sem_combate, dashboard.meta_ol_sem_combate], ['OL prioritários', dashboard.ol_prioritarios, dashboard.meta_ol_prioritarios], ['OL lançamentos', dashboard.ol_lancamentos, dashboard.meta_ol_lancamentos]] as const
  const metaCompetence = competenceLabel(dashboard.competencia_meta)
  return <><section className="total-card"><div><span>{dashboard.escopo}</span><small>{metaCompetence ? `Metas ${metaCompetence}` : 'Resultado consolidado'}</small></div><strong>{loading ? '—' : money.format(dashboard.ol_total_faturado)}</strong><div><span>OL combate</span><b>{loading ? '—' : money.format(dashboard.ol_combate)}</b></div></section><section className="metrics-grid">{cards.map(([label, value, goal]) => { const result = achievement(value, goal); return <article className="metric-card" key={label}><div className="metric-heading"><span>{label}</span><b className={result >= 100 ? 'good' : result >= 80 ? 'warning' : 'low'}>{percent.format(result)}%</b></div><strong>{loading ? '—' : money.format(value)}</strong><div className="metric-detail"><span>Meta</span><b>{money.format(goal)}</b></div></article> })}<article className="metric-card"><div className="metric-heading"><span>Clientes com venda</span><b>{number.format(dashboard.clientes_com_venda)}</b></div><strong>{number.format(dashboard.clientes_com_venda)}</strong><div className="metric-detail"><span>Sem venda</span><b>{number.format(dashboard.clientes_sem_venda)}</b></div></article><article className="metric-card"><div className="metric-heading"><span>Não faturados</span><b>{number.format(dashboard.pedidos_nao_faturados)}</b></div><strong>{money.format(dashboard.valor_nao_faturado)}</strong><div className="metric-detail"><span>Pedidos</span><b>{number.format(dashboard.pedidos_nao_faturados)}</b></div></article></section></>
}

function ModuleHero({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) { return <section className="hero compact-hero module-hero"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div></section> }
function SectionTitle({ title, description }: { title: string; description: string }) { return <section className="section-title"><div><span className="eyebrow">Estrutura hierárquica</span><h2>{title}</h2></div><p>{description}</p></section> }
function DistrictCards({ districts, onOpen }: { districts: Distrital[]; onOpen: (district: Distrital) => void }) { return <div className="district-grid">{districts.map((district) => <button className="district-card" key={district.id} onClick={() => onOpen(district)}><div className="district-card-top"><span className="district-icon">D</span><span className="status-dot">Ativa</span></div><div><h3>{district.nome}</h3><p>GD: {district.gerente_nome || 'não informado'}</p></div><div className="district-card-footer"><span>{district.consultores.length} consultor(es)</span><b>Abrir →</b></div></button>)}{!districts.length && <EmptyState text="Nenhuma Distrital disponível para este perfil." />}</div> }
function EmptyState({ text }: { text: string }) { return <div className="empty-state">{text}</div> }
