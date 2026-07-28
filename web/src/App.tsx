import { FormEvent, useCallback, useEffect, useState } from 'react'
import { api, clearToken, getToken, setToken } from './api'
import type { AutomationItem, Dashboard, Distrital, Hierarquia, Regional, SessionUser } from './types'

type View = 'regional' | 'distritais' | 'administracao' | 'automacoes'
type AuthMode = 'login' | 'setup'

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const number = new Intl.NumberFormat('pt-BR')
const percent = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

const emptyDashboard: Dashboard = {
  escopo: 'Regional',
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

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
const result = (value: number, goal: number) => goal > 0 ? (value / goal) * 100 : 0

function App() {
  const [regionais, setRegionais] = useState<Regional[]>([])
  const [regional, setRegional] = useState<Regional | null>(null)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [hierarchy, setHierarchy] = useState<Hierarquia | null>(null)
  const [dashboard, setDashboard] = useState<Dashboard>(emptyDashboard)
  const [automations, setAutomations] = useState<AutomationItem[]>([])
  const [selectedDistrict, setSelectedDistrict] = useState<Distrital | null>(null)
  const [view, setView] = useState<View>('regional')
  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  useEffect(() => {
    api<{ regionais: Regional[] }>('regionais')
      .then(({ regionais: items }) => setRegionais(items))
      .catch((error) => setMessage(error.message))
      .finally(() => setLoading(false))
  }, [])

  const loadWorkspace = useCallback(async (currentUser: SessionUser, districtId?: number) => {
    const districtQuery = districtId ? `?distrital_id=${districtId}` : ''
    const [hierarchyData, dashboardData] = await Promise.all([
      api<Hierarquia>('hierarquia'),
      api<Dashboard>(`dashboard${districtQuery}`),
    ])
    setHierarchy(hierarchyData)
    setDashboard(dashboardData)
    setSelectedDistrict(districtId
      ? hierarchyData.distritais.find((item) => item.id === districtId) || null
      : null)
    if (currentUser.perfil === 'RG') {
      const data = await api<{ automacoes: AutomationItem[] }>('automacoes')
      setAutomations(data.automacoes)
    }
  }, [])

  useEffect(() => {
    const token = getToken()
    if (!token) return
    api<{ usuario: SessionUser; regional: Regional }>('me')
      .then(async ({ usuario, regional: savedRegional }) => {
        setUser(usuario)
        setRegional(savedRegional)
        await loadWorkspace(usuario)
      })
      .catch(() => clearToken())
  }, [loadWorkspace])

  async function chooseRegional(item: Regional) {
    setRegional(item)
    setMessage('')
    try {
      const status = await api<{ precisa_configurar: boolean }>(`setup-status?regional_id=${item.id}`)
      setAuthMode(status.precisa_configurar ? 'setup' : 'login')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao selecionar a regional.')
    }
  }

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!regional) return
    setMessage('')
    const form = new FormData(event.currentTarget)
    const payload = {
      regional_id: regional.id,
      nome: String(form.get('nome') || ''),
      email: String(form.get('email') || '').trim().toLowerCase(),
      senha: String(form.get('senha') || ''),
    }
    try {
      const endpoint = authMode === 'setup' ? 'setup' : 'login'
      const data = await api<{ token: string; usuario: SessionUser }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setToken(data.token)
      setUser(data.usuario)
      await loadWorkspace(data.usuario)
      setView('regional')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha no acesso.')
    }
  }

  async function openDistrict(district: Distrital) {
    if (!user) return
    setView('distritais')
    setMessage('')
    try {
      await loadWorkspace(user, district.id)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível abrir a distrital.')
    }
  }

  async function navigate(nextView: View) {
    setView(nextView)
    setMessage('')
    if (nextView === 'regional' && user) await loadWorkspace(user)
  }

  async function logout() {
    try { await api('logout', { method: 'POST' }) } catch { /* sessão local também será limpa */ }
    clearToken()
    setUser(null)
    setHierarchy(null)
    setSelectedDistrict(null)
    setView('regional')
  }

  async function createEntity(event: FormEvent<HTMLFormElement>, endpoint: string) {
    event.preventDefault()
    setMessage('')
    const form = event.currentTarget
    const payload = Object.fromEntries(new FormData(form).entries())
    try {
      await api(endpoint, { method: 'POST', body: JSON.stringify(payload) })
      form.reset()
      if (user) await loadWorkspace(user)
      setMessage('Cadastro salvo com sucesso.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível salvar.')
    }
  }

  if (loading) return <LoadingScreen />
  if (!regional || !user) {
    return regional
      ? <AuthScreen regional={regional} mode={authMode} message={message} onSubmit={authenticate} onBack={() => { setRegional(null); setMessage('') }} />
      : <RegionalSelector regionais={regionais} message={message} onSelect={chooseRegional} />
  }

  const visibleDistricts = hierarchy?.distritais || []
  const firstName = user.nome.split(' ')[0]
  const title = selectedDistrict ? selectedDistrict.nome : hierarchy?.regional.nome || regional.nome

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => navigate('regional')}>
          <span className="brand-mark">R</span>
          <span><strong>Painel Regional</strong><small>{regional.nome}</small></span>
        </button>
        <div className="profile-area">
          <span className={`role-badge role-${user.perfil.toLowerCase()}`}>{user.perfil}</span>
          <span className="avatar">{initials(user.nome)}</span>
          <span className="profile-name">{user.nome}</span>
          <button className="text-button" onClick={logout}>Sair</button>
        </div>
      </header>

      <nav className="main-nav">
        <button className={view === 'regional' ? 'active' : ''} onClick={() => navigate('regional')}>Visão Regional</button>
        <button className={view === 'distritais' ? 'active' : ''} onClick={() => setView('distritais')}>Distritais</button>
        {user.perfil === 'RG' && <button className={view === 'administracao' ? 'active' : ''} onClick={() => navigate('administracao')}>Administração</button>}
        {user.perfil === 'RG' && <button className={view === 'automacoes' ? 'active' : ''} onClick={() => navigate('automacoes')}>Automações</button>}
      </nav>

      <main className="content">
        {message && <div className="notice">{message}</div>}

        {view === 'regional' && (
          <>
            <section className="hero">
              <div>
                <span className="eyebrow">Gerência Regional</span>
                <h1>Olá, {firstName}</h1>
                <p>Resultado consolidado da {regional.nome}, com acesso às distritais e consultores.</p>
              </div>
              {user.perfil === 'RG' && (
                <div className="hero-actions">
                  <button className="primary-button" onClick={() => navigate('administracao')}>Administrar estrutura</button>
                  <button className="secondary-button" onClick={() => navigate('automacoes')}>Central de automações</button>
                </div>
              )}
            </section>
            <DashboardPanel dashboard={dashboard} title={title} />
            <SectionTitle eyebrow="Estrutura hierárquica" title="Distritais da regional" description={`${visibleDistricts.length} distrital(is) cadastrada(s)`} />
            <DistrictCards districts={visibleDistricts} onOpen={openDistrict} />
          </>
        )}

        {view === 'distritais' && (
          <>
            <section className="hero compact-hero">
              <div>
                <span className="eyebrow">Distritais</span>
                <h1>{selectedDistrict?.nome || 'Escolha uma distrital'}</h1>
                <p>{selectedDistrict ? `Gerente Distrital: ${selectedDistrict.gerente_nome || 'não informado'}` : 'Abra uma distrital para visualizar o resultado e seus consultores.'}</p>
              </div>
            </section>
            {!selectedDistrict ? (
              <DistrictCards districts={visibleDistricts} onOpen={openDistrict} />
            ) : (
              <>
                <DashboardPanel dashboard={dashboard} title={selectedDistrict.nome} />
                <SectionTitle eyebrow="Equipe" title="Consultores" description={`${selectedDistrict.consultores.length} consultor(es)`} />
                <div className="consultant-grid">
                  {selectedDistrict.consultores.map((consultant) => (
                    <article className="consultant-card" key={consultant.id}>
                      <span className="avatar large">{initials(consultant.nome)}</span>
                      <div><h3>{consultant.nome}</h3><p>Código {consultant.codigo || 'não informado'}</p></div>
                      <span className="status-dot">Ativo</span>
                    </article>
                  ))}
                  {!selectedDistrict.consultores.length && <EmptyState text="Nenhum consultor cadastrado nesta distrital." />}
                </div>
              </>
            )}
          </>
        )}

        {view === 'administracao' && user.perfil === 'RG' && (
          <Administration hierarchy={hierarchy} onCreate={createEntity} />
        )}

        {view === 'automacoes' && user.perfil === 'RG' && (
          <Automations items={automations} onCreate={createEntity} />
        )}
      </main>

      <footer><span>Painel Regional</span><span>Regional → Distritais → Consultores</span></footer>
    </div>
  )
}

function LoadingScreen() {
  return <div className="center-screen"><div className="loader" /><h2>Carregando Painel Regional</h2></div>
}

function RegionalSelector({ regionais, message, onSelect }: { regionais: Regional[]; message: string; onSelect: (regional: Regional) => void }) {
  return (
    <div className="access-screen">
      <div className="access-panel regional-access">
        <span className="access-logo">R</span>
        <span className="eyebrow">Painel Regional de Vendas</span>
        <h1>Selecione sua Regional</h1>
        <p>O acesso começa pela Regional. Depois, cada perfil visualiza somente sua estrutura autorizada.</p>
        {message && <div className="notice error">{message}</div>}
        <div className="regional-grid">
          {regionais.map((item) => (
            <button className="regional-card" key={item.id} onClick={() => onSelect(item)}>
              <span className="regional-icon">⌂</span>
              <strong>{item.nome}</strong>
              <small>Acessar regional <b>→</b></small>
            </button>
          ))}
          {!regionais.length && <EmptyState text="Nenhuma Regional cadastrada. Execute a migração inicial do D1." />}
        </div>
      </div>
    </div>
  )
}

function AuthScreen({ regional, mode, message, onSubmit, onBack }: {
  regional: Regional
  mode: AuthMode
  message: string
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onBack: () => void
}) {
  return (
    <div className="access-screen">
      <div className="access-panel auth-panel">
        <button className="back-button" onClick={onBack}>← Trocar Regional</button>
        <span className="access-logo">R</span>
        <span className="eyebrow">{regional.nome}</span>
        <h1>{mode === 'setup' ? 'Criar primeiro Gerente Regional' : 'Entrar no painel'}</h1>
        <p>{mode === 'setup' ? 'Este cadastro inicial terá acesso ao administrativo e às automações.' : 'Use seu e-mail e senha cadastrados.'}</p>
        {message && <div className="notice error">{message}</div>}
        <form className="auth-form" onSubmit={onSubmit}>
          {mode === 'setup' && <label><span>Nome completo</span><input name="nome" required minLength={3} autoComplete="name" /></label>}
          <label><span>E-mail</span><input name="email" type="email" required autoComplete="email" /></label>
          <label><span>Senha</span><input name="senha" type="password" required minLength={8} autoComplete={mode === 'setup' ? 'new-password' : 'current-password'} /></label>
          <button className="primary-button full" type="submit">{mode === 'setup' ? 'Criar acesso e entrar' : 'Entrar'}</button>
        </form>
      </div>
    </div>
  )
}

function DashboardPanel({ dashboard, title }: { dashboard: Dashboard; title: string }) {
  const cards = [
    ['OL sem combate', dashboard.ol_sem_combate, dashboard.meta_ol_sem_combate],
    ['OL prioritários', dashboard.ol_prioritarios, dashboard.meta_ol_prioritarios],
    ['OL lançamentos', dashboard.ol_lancamentos, dashboard.meta_ol_lancamentos],
  ] as const
  return (
    <>
      <section className="total-card">
        <div><span>{dashboard.escopo || title}</span><small>Resultado consolidado</small></div>
        <strong>{money.format(dashboard.ol_total_faturado)}</strong>
        <div><span>OL combate</span><b>{money.format(dashboard.ol_combate)}</b></div>
      </section>
      <section className="metrics-grid">
        {cards.map(([label, value, goal]) => {
          const achieved = result(value, goal)
          return (
            <article className="metric-card" key={label}>
              <div className="metric-heading"><span>{label}</span><b className={achieved >= 100 ? 'good' : achieved >= 80 ? 'warning' : 'low'}>{percent.format(achieved)}%</b></div>
              <strong>{money.format(value)}</strong>
              <div className="metric-detail"><span>Meta</span><b>{money.format(goal)}</b></div>
            </article>
          )
        })}
        <article className="metric-card">
          <div className="metric-heading"><span>Clientes com venda</span><b>{number.format(dashboard.clientes_com_venda)}</b></div>
          <strong>{number.format(dashboard.clientes_com_venda)}</strong>
          <div className="metric-detail"><span>Sem venda</span><b>{number.format(dashboard.clientes_sem_venda)}</b></div>
        </article>
        <article className="metric-card">
          <div className="metric-heading"><span>Não faturados</span><b>{number.format(dashboard.pedidos_nao_faturados)}</b></div>
          <strong>{money.format(dashboard.valor_nao_faturado)}</strong>
          <div className="metric-detail"><span>Pedidos</span><b>{number.format(dashboard.pedidos_nao_faturados)}</b></div>
        </article>
      </section>
    </>
  )
}

function SectionTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <section className="section-title"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div><p>{description}</p></section>
}

function DistrictCards({ districts, onOpen }: { districts: Distrital[]; onOpen: (district: Distrital) => void }) {
  return (
    <div className="district-grid">
      {districts.map((district) => (
        <button className="district-card" key={district.id} onClick={() => onOpen(district)}>
          <div className="district-card-top"><span className="district-icon">D</span><span className="status-dot">Ativa</span></div>
          <div><h3>{district.nome}</h3><p>GD: {district.gerente_nome || 'não informado'}</p></div>
          <div className="district-card-footer"><span>{district.consultores.length} consultor(es)</span><b>Abrir →</b></div>
        </button>
      ))}
      {!districts.length && <EmptyState text="Nenhuma distrital disponível para este perfil." />}
    </div>
  )
}

function Administration({ hierarchy, onCreate }: {
  hierarchy: Hierarquia | null
  onCreate: (event: FormEvent<HTMLFormElement>, endpoint: string) => void
}) {
  return (
    <>
      <section className="hero compact-hero"><div><span className="eyebrow">Gerente Regional</span><h1>Administração</h1><p>Cadastre Distritais, Consultores e acessos respeitando a hierarquia.</p></div></section>
      <div className="admin-grid">
        <form className="admin-card" onSubmit={(event) => onCreate(event, 'admin/distritais')}>
          <h2>Nova Distrital</h2>
          <label><span>Nome da Distrital</span><input name="nome" required /></label>
          <label><span>Código</span><input name="codigo" required /></label>
          <label><span>Nome do Gerente Distrital</span><input name="gerente_nome" /></label>
          <button className="primary-button full">Cadastrar Distrital</button>
        </form>
        <form className="admin-card" onSubmit={(event) => onCreate(event, 'admin/consultores')}>
          <h2>Novo Consultor</h2>
          <label><span>Distrital</span><select name="distrital_id" required><option value="">Selecione</option>{hierarchy?.distritais.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>
          <label><span>Nome</span><input name="nome" required /></label>
          <label><span>Código</span><input name="codigo" required /></label>
          <label><span>E-mail</span><input name="email" type="email" /></label>
          <button className="primary-button full">Cadastrar Consultor</button>
        </form>
        <form className="admin-card" onSubmit={(event) => onCreate(event, 'admin/usuarios')}>
          <h2>Novo Acesso</h2>
          <label><span>Perfil</span><select name="perfil" required><option value="GD">Gerente Distrital (GD)</option><option value="CONSULTOR">Consultor</option><option value="RG">Gerente Regional (RG)</option></select></label>
          <label><span>Distrital</span><select name="distrital_id"><option value="">Acesso Regional</option>{hierarchy?.distritais.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>
          <label><span>Nome</span><input name="nome" required /></label>
          <label><span>E-mail</span><input name="email" type="email" required /></label>
          <label><span>Senha inicial</span><input name="senha" type="password" required minLength={8} /></label>
          <button className="primary-button full">Criar acesso</button>
        </form>
      </div>
    </>
  )
}

function Automations({ items, onCreate }: {
  items: AutomationItem[]
  onCreate: (event: FormEvent<HTMLFormElement>, endpoint: string) => void
}) {
  return (
    <>
      <section className="hero compact-hero"><div><span className="eyebrow">Gerente Regional</span><h1>Automações</h1><p>Central única da Regional para acompanhar extrações, cargas e atualizações.</p></div></section>
      <div className="automation-layout">
        <section className="automation-list">
          {items.map((item) => (
            <article className="automation-card" key={item.id}>
              <span className={`automation-status status-${item.status.toLowerCase()}`}>{item.status}</span>
              <div><h3>{item.nome}</h3><p>Última execução: {item.ultima_execucao || 'ainda não executada'}</p></div>
            </article>
          ))}
          {!items.length && <EmptyState text="Nenhuma automação cadastrada." />}
        </section>
        <form className="admin-card" onSubmit={(event) => onCreate(event, 'admin/automacoes')}>
          <h2>Nova automação</h2>
          <label><span>Nome</span><input name="nome" required placeholder="Ex.: Atualizar Bússola" /></label>
          <label><span>Próxima execução</span><input name="proxima_execucao" type="datetime-local" /></label>
          <button className="primary-button full">Cadastrar automação</button>
        </form>
      </div>
    </>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state"><span>＋</span><p>{text}</p></div>
}

export default App
