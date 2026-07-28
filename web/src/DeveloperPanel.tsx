import { FormEvent, useEffect, useState } from 'react'
import { api } from './api'
import type { Regional, RegionalManager, SessionUser } from './types'
import './developer.css'

type Props = {
  user: SessionUser
  onLogout: () => void
}

type Structure = {
  regionais: Regional[]
  gerentes_regionais: RegionalManager[]
}

const emptyStructure: Structure = { regionais: [], gerentes_regionais: [] }

export default function DeveloperPanel({ user, onLogout }: Props) {
  const [structure, setStructure] = useState<Structure>(emptyStructure)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

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

  async function submit(event: FormEvent<HTMLFormElement>, endpoint: string) {
    event.preventDefault()
    setMessage('')
    setError('')
    const form = event.currentTarget
    const payload = Object.fromEntries(new FormData(form).entries())
    try {
      await api(endpoint, { method: 'POST', body: JSON.stringify(payload) })
      form.reset()
      setMessage('Cadastro salvo com sucesso.')
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o cadastro.')
    }
  }

  return (
    <div className="developer-shell">
      <header className="developer-topbar">
        <div className="developer-brand"><span>D</span><div><strong>Painel Regional</strong><small>Administração do desenvolvedor</small></div></div>
        <div className="developer-profile"><b>{user.nome}</b><button onClick={onLogout}>Sair</button></div>
      </header>

      <main className="developer-content">
        <section className="developer-hero">
          <div><span>Configuração inicial</span><h1>Regionais e Gerentes Regionais</h1><p>Cadastre a estrutura principal antes de carregar as bases e ativar as automações.</p></div>
          <div className="developer-summary"><strong>{structure.regionais.length}</strong><span>Regionais</span><strong>{structure.gerentes_regionais.length}</strong><span>Gerentes Regionais</span></div>
        </section>

        {error && <div className="developer-alert error">{error}</div>}
        {message && <div className="developer-alert success">{message}</div>}

        <section className="developer-form-grid">
          <form className="developer-card" onSubmit={(event) => void submit(event, 'developer/regionais')}>
            <span className="developer-card-icon">R</span>
            <h2>Nova Regional</h2>
            <p>Crie a Regional que receberá Distritais, Consultores e resultados.</p>
            <label><span>Nome da Regional</span><input name="nome" required placeholder="Ex.: Regional Norte" /></label>
            <label><span>Identificador</span><input name="slug" required placeholder="Ex.: norte" /></label>
            <button>Cadastrar Regional</button>
          </form>

          <form className="developer-card" onSubmit={(event) => void submit(event, 'developer/gerentes-regionais')}>
            <span className="developer-card-icon">G</span>
            <h2>Novo Gerente Regional</h2>
            <p>O mesmo e-mail e senha serão protegidos para uso na Bússola e Mercado Farma.</p>
            <label><span>Regional</span><select name="regional_id" required><option value="">Selecione</option>{structure.regionais.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>
            <label><span>Nome completo</span><input name="nome" required minLength={3} /></label>
            <label><span>E-mail de acesso</span><input name="email" type="email" required /></label>
            <label><span>Senha</span><input name="senha" type="password" required minLength={8} /></label>
            <button disabled={!structure.regionais.length}>Criar acesso do RG</button>
          </form>
        </section>

        <section className="developer-list-card">
          <div className="developer-list-heading"><div><span>Estrutura cadastrada</span><h2>Gerentes Regionais</h2></div><button onClick={() => void load()} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar'}</button></div>
          <div className="developer-table-wrap">
            <table>
              <thead><tr><th>Regional</th><th>Gerente Regional</th><th>E-mail</th><th>Credencial de extração</th></tr></thead>
              <tbody>
                {structure.gerentes_regionais.map((item) => (
                  <tr key={item.id}>
                    <td>{item.regional_nome}</td>
                    <td><strong>{item.nome}</strong></td>
                    <td>{item.email}</td>
                    <td><span className={item.credencial_configurada ? 'credential-ready' : 'credential-pending'}>{item.credencial_configurada ? `Configurada · ${item.usuario_mascarado || ''}` : 'Pendente'}</span></td>
                  </tr>
                ))}
                {!structure.gerentes_regionais.length && <tr><td colSpan={4} className="developer-empty">Nenhum Gerente Regional cadastrado.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}
