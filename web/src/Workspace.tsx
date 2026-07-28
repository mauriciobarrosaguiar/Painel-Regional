import { FormEvent, useCallback, useEffect, useState } from 'react'
import { api } from './api'
import type { AutomationData, Dashboard, Distrital, Hierarquia, Regional, SessionUser } from './types'

type View = 'regional' | 'distritais' | 'administracao' | 'automacoes'

type Props = {
  user: SessionUser
  regional: Regional
  onLogout: () => void
}

type IntegrationStatus = {
  configurada: boolean
  usuario_mascarado: string
  status: string
  mensagem: string
  testado_em?: string | null
  atualizado_em?: string | null
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const number = new Intl.NumberFormat('pt-BR')
const percent = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
const achievement = (value: number, goal: number) => goal > 0 ? (value / goal) * 100 : 0
const dateTime = (value?: string | null) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR')
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

const emptyAutomations: AutomationData = {
  comandos: [],
  extracoes: [],
  em_execucao: 0,
  credencial_configurada: false,
  atualizado_em: '',
}

export default function Workspace({ user, regional, onLogout }: Props) {
  const [view, setView] = useState<View>('regional')
  const [hierarchy, setHierarchy] = useState<Hierarquia | null>(null)
  const [dashboard, setDashboard] = useState<Dashboard>(emptyDashboard)
  const [selectedDistrict, setSelectedDistrict] = useState<Distrital | null>(null)
  const [automations, setAutomations] = useState<AutomationData>(emptyAutomations)
  const [integration, setIntegration] = useState<IntegrationStatus | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const loadWorkspace = useCallback(async (districtId?: number) => {
    setLoading(true)
    try {
      const query = districtId ? `?distrital_id=${districtId}` : ''
      const [hierarchyData, dashboardData] = await Promise.all([
        api<Hierarquia>('hierarquia'),
        api<Dashboard>(`dashboard${query}`),
      ])
      setHierarchy(hierarchyData)
      setDashboard(dashboardData)
      setSelectedDistrict(districtId
        ? hierarchyData.distritais.find((item) => item.id === districtId) || null
        : null)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o painel.')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadRGData = useCallback(async () => {
    if (user.perfil !== 'RG') return
    try {
      const [automationData, integrationData] = await Promise.all([
        api<AutomationData>('automacoes'),
        api<IntegrationStatus>('integracoes/status'),
      ])
      setAutomations(automationData)
      setIntegration(integrationData)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível consultar as integrações.')
    }
  }, [user.perfil])

  useEffect(() => {
    void loadWorkspace()
    void loadRGData()
  }, [loadWorkspace, loadRGData])

  useEffect(() => {
    if (view !== 'automacoes' || user.perfil !== 'RG') return undefined
    const timer = window.setInterval(() => void loadRGData(), 5000)
    return () => window.clearInterval(timer)
  }, [view, user.perfil, loadRGData])

  async function openDistrict(district: Distrital) {
    setView('distritais')
    setMessage('')
    setError('')
    await loadWorkspace(district.id)
  }

  async function navigate(next: View) {
    setView(next)
    setMessage('')
    setError('')
    if (next === 'regional') await loadWorkspace()
    if (next === 'automacoes') await loadRGData()
  }

  async function createEntity(event: FormEvent<HTMLFormElement>, endpoint: string) {
    event.preventDefault()
    setMessage('')
    setError('')
    const form = event.currentTarget
    const payload = Object.fromEntries(new FormData(form).entries())
    try {
      await api(endpoint, { method: 'POST', body: JSON.stringify(payload) })
      form.reset()
      setMessage('Cadastro salvo com sucesso.')
      await loadWorkspace()
      await loadRGData()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o cadastro.')
    }
  }

  async function requestAutomation(type: 'BUSSOLA' | 'MERCADO_FARMA') {
    setMessage('')
    setError('')
    try {
      const result = await api<{ mensagem: string }>('automacoes/solicitar', {
        method: 'POST',
        body: JSON.stringify({ tipo: type }),
      })
      setMessage(result.mensagem)
      await loadRGData()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível solicitar a extração.')
    }
  }

  const districts = hierarchy?.distritais || []
  const firstName = user.nome.split(' ')[0]

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => void navigate('regional')}>
          <span className="brand-mark">R</span>
          <span><strong>Painel Regional</strong><small>{regional.nome}</small></span>
        </button>
        <div className="profile-area">
          <span className={`role-badge role-${user.perfil.toLowerCase()}`}>{user.perfil}</span>
          <span className="avatar">{initials(user.nome)}</span>
          <span className="profile-name">{user.nome}</span>
          <button className="text-button" onClick={onLogout}>Sair</button>
        </div>
      </header>

      <nav className="main-nav">
        <button className={view === 'regional' ? 'active' : ''} onClick={() => void navigate('regional')}>Visão Regional</button>
        <button className={view === 'distritais' ? 'active' : ''} onClick={() => setView('distritais')}>Distritais</button>
        {user.perfil === 'RG' && <button className={view === 'administracao' ? 'active' : ''} onClick={() => void navigate('administracao')}>Administração</button>}
        {user.perfil === 'RG' && <button className={view === 'automacoes' ? 'active' : ''} onClick={() => void navigate('automacoes')}>Automações</button>}
      </nav>

      <main className="content">
        {error && <div className="notice error">{error}</div>}
        {message && <div className="notice">{message}</div>}

        {view === 'regional' && (
          <>
            <section className="hero">
              <div><span className="eyebrow">Gestão comercial</span><h1>Olá, {firstName}</h1><p>Acompanhe a operação da {regional.nome} e acesse cada Distrital.</p></div>
              {user.perfil === 'RG' && <div className="hero-actions"><button className="primary-button" onClick={() => void navigate('administracao')}>Administrar estrutura</button><button className="secondary-button" onClick={() => void navigate('automacoes')}>Central de automações</button></div>}
            </section>
            <DashboardPanel dashboard={dashboard} loading={loading} />
            <SectionTitle eyebrow="Estrutura hierárquica" title="Distritais da Regional" description={`${districts.length} distrital(is) disponível(is)`} />
            <DistrictCards districts={districts} onOpen={openDistrict} />
          </>
        )}

        {view === 'distritais' && (
          <>
            <section className="hero compact-hero"><div><span className="eyebrow">Distritais</span><h1>{selectedDistrict?.nome || 'Escolha uma Distrital'}</h1><p>{selectedDistrict ? `Gerente Distrital: ${selectedDistrict.gerente_nome || 'não informado'}` : 'Abra uma Distrital para visualizar o resultado e os Consultores.'}</p></div></section>
            {!selectedDistrict ? <DistrictCards districts={districts} onOpen={openDistrict} /> : <><DashboardPanel dashboard={dashboard} loading={loading} /><SectionTitle eyebrow="Equipe" title="Consultores" description={`${selectedDistrict.consultores.length} consultor(es)`} /><div className="consultant-grid">{selectedDistrict.consultores.map((consultant) => <article className="consultant-card" key={consultant.id}><span className="avatar large">{initials(consultant.nome)}</span><div><h3>{consultant.nome}</h3><p>Código {consultant.codigo || 'não informado'}</p></div><span className="status-dot">Ativo</span></article>)}{!selectedDistrict.consultores.length && <EmptyState text="Nenhum Consultor cadastrado nesta Distrital." />}</div></>}
          </>
        )}

        {view === 'administracao' && user.perfil === 'RG' && (
          <Administration hierarchy={hierarchy} integration={integration} onCreate={createEntity} />
        )}

        {view === 'automacoes' && user.perfil === 'RG' && (
          <AutomationCenter data={automations} onRun={requestAutomation} />
        )}
      </main>

      <footer><span>Painel Regional</span><span>Regional → Distritais → Consultores</span></footer>
    </div>
  )
}

function DashboardPanel({ dashboard, loading }: { dashboard: Dashboard; loading: boolean }) {
  const cards = [
    ['OL sem combate', dashboard.ol_sem_combate, dashboard.meta_ol_sem_combate],
    ['OL prioritários', dashboard.ol_prioritarios, dashboard.meta_ol_prioritarios],
    ['OL lançamentos', dashboard.ol_lancamentos, dashboard.meta_ol_lancamentos],
  ] as const
  return <><section className="total-card"><div><span>{dashboard.escopo}</span><small>Resultado consolidado</small></div><strong>{loading ? '—' : money.format(dashboard.ol_total_faturado)}</strong><div><span>OL combate</span><b>{loading ? '—' : money.format(dashboard.ol_combate)}</b></div></section><section className="metrics-grid">{cards.map(([label, value, goal]) => { const result = achievement(value, goal); return <article className="metric-card" key={label}><div className="metric-heading"><span>{label}</span><b className={result >= 100 ? 'good' : result >= 80 ? 'warning' : 'low'}>{percent.format(result)}%</b></div><strong>{loading ? '—' : money.format(value)}</strong><div className="metric-detail"><span>Meta</span><b>{money.format(goal)}</b></div></article> })}<article className="metric-card"><div className="metric-heading"><span>Clientes com venda</span><b>{number.format(dashboard.clientes_com_venda)}</b></div><strong>{number.format(dashboard.clientes_com_venda)}</strong><div className="metric-detail"><span>Sem venda</span><b>{number.format(dashboard.clientes_sem_venda)}</b></div></article><article className="metric-card"><div className="metric-heading"><span>Não faturados</span><b>{number.format(dashboard.pedidos_nao_faturados)}</b></div><strong>{money.format(dashboard.valor_nao_faturado)}</strong><div className="metric-detail"><span>Pedidos</span><b>{number.format(dashboard.pedidos_nao_faturados)}</b></div></article></section></>
}

function SectionTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <section className="section-title"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div><p>{description}</p></section>
}

function DistrictCards({ districts, onOpen }: { districts: Distrital[]; onOpen: (district: Distrital) => void }) {
  return <div className="district-grid">{districts.map((district) => <button className="district-card" key={district.id} onClick={() => void onOpen(district)}><div className="district-card-top"><span className="district-icon">D</span><span className="status-dot">Ativa</span></div><div><h3>{district.nome}</h3><p>GD: {district.gerente_nome || 'não informado'}</p></div><div className="district-card-footer"><span>{district.consultores.length} consultor(es)</span><b>Abrir →</b></div></button>)}{!districts.length && <EmptyState text="Nenhuma Distrital disponível para este perfil." />}</div>
}

function Administration({ hierarchy, integration, onCreate }: { hierarchy: Hierarquia | null; integration: IntegrationStatus | null; onCreate: (event: FormEvent<HTMLFormElement>, endpoint: string) => void }) {
  return <><section className="hero compact-hero"><div><span className="eyebrow">Gerente Regional</span><h1>Administração</h1><p>Cadastre Distritais, Consultores e os acessos da sua equipe.</p></div></section><section className="integration-summary"><div className="integration-icon">B</div><div><span>Credencial Bússola e Mercado Farma</span><strong>{integration?.configurada ? 'Configurada' : 'Pendente'}</strong><small>{integration?.mensagem || 'Consultando credencial vinculada ao acesso do RG.'}</small></div><div><span>Usuário protegido</span><b>{integration?.usuario_mascarado || '—'}</b></div></section><div className="admin-grid"><form className="admin-card" onSubmit={(event) => onCreate(event, 'admin/distritais')}><h2>Nova Distrital</h2><label><span>Nome da Distrital</span><input name="nome" required /></label><label><span>Código</span><input name="codigo" required /></label><label><span>Nome do Gerente Distrital</span><input name="gerente_nome" /></label><button className="primary-button full">Cadastrar Distrital</button></form><form className="admin-card" onSubmit={(event) => onCreate(event, 'admin/consultores')}><h2>Novo Consultor</h2><label><span>Distrital</span><select name="distrital_id" required><option value="">Selecione</option>{hierarchy?.distritais.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label><label><span>Nome</span><input name="nome" required /></label><label><span>Código</span><input name="codigo" required /></label><label><span>E-mail</span><input name="email" type="email" /></label><button className="primary-button full">Cadastrar Consultor</button></form><form className="admin-card" onSubmit={(event) => onCreate(event, 'admin/usuarios')}><h2>Novo acesso da equipe</h2><label><span>Perfil</span><select name="perfil" required><option value="GD">Gerente Distrital (GD)</option><option value="CONSULTOR">Consultor</option></select></label><label><span>Distrital</span><select name="distrital_id" required><option value="">Selecione</option>{hierarchy?.distritais.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label><label><span>Nome</span><input name="nome" required /></label><label><span>E-mail</span><input name="email" type="email" required /></label><label><span>Senha inicial</span><input name="senha" type="password" required minLength={8} /></label><button className="primary-button full">Criar acesso</button></form></div></>
}

function AutomationCenter({ data, onRun }: { data: AutomationData; onRun: (type: 'BUSSOLA' | 'MERCADO_FARMA') => void }) {
  const activeTypes = new Set(data.comandos.filter((item) => ['aguardando', 'executando'].includes(item.status)).map((item) => item.tipo))
  const actions = [
    ['BUSSOLA', 'Extrair Bússola', 'Carregará as bases da Regional usando o mesmo acesso do Gerente Regional.'],
    ['MERCADO_FARMA', 'Extrair Mercado Farma', 'Atualizará preços e estoques relacionados à Regional.'],
  ] as const
  return <><section className="operations-hero"><div><span className="eyebrow">Processos</span><h1>Central de Automações</h1><p>As solicitações usam a credencial protegida vinculada ao acesso do Gerente Regional.</p></div><span>{data.em_execucao} em execução</span></section><div className={`automation-session-note ${data.credencial_configurada ? '' : 'warning-note'}`}>{data.credencial_configurada ? 'Credencial do Gerente Regional configurada para Bússola e Mercado Farma.' : 'A credencial do Gerente Regional ainda não está configurada.'}</div><section className="automation-actions">{actions.map(([type, title, description]) => <article key={type}><div><h2>{title}</h2><p>{description}</p></div><button className="primary-button" disabled={!data.credencial_configurada || activeTypes.has(type)} onClick={() => void onRun(type)}>{activeTypes.has(type) ? 'Na fila' : 'Executar agora'}</button></article>)}</section><section className="operations-list"><div className="operations-heading"><div><h2>Solicitações recentes</h2><small>Atualizado em {dateTime(data.atualizado_em)}</small></div></div>{!data.comandos.length && <div className="operations-empty">Nenhuma solicitação registrada.</div>}{data.comandos.map((item) => <div className="operation-row" key={item.id}><div><strong>{item.tipo.replaceAll('_', ' ')}</strong><span>{item.erro || item.mensagem || 'Sem detalhes'}</span></div><div><b className={`operation-status status-${item.status}`}>{item.status}</b><small>{dateTime(item.finalizado_em || item.iniciado_em || item.solicitado_em)}</small></div></div>)}</section></>
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state"><span>＋</span><p>{text}</p></div>
}
