import { useEffect, useState } from 'react'
import { api, clearToken, getToken } from './api'
import ClientBaseImport from './ClientBaseImport'
import DeveloperPanel from './DeveloperPanel'
import LoginPage from './LoginPage'
import MetaUploadLauncher from './MetaUploadLauncher'
import ProductBasesUpload from './ProductBasesUpload'
import SiteEnhancements from './SiteEnhancements'
import Workspace from './Workspace'
import type { Regional, SessionUser } from './types'

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [regional, setRegional] = useState<Regional | null>(null)
  const [developerConfigured, setDeveloperConfigured] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function initialize() {
      try {
        const status = await api<{ desenvolvedor_configurado: boolean }>('auth/status')
        setDeveloperConfigured(status.desenvolvedor_configurado)
        if (!getToken()) return
        const session = await api<{ usuario: SessionUser; regional: Regional | null }>('me')
        setUser(session.usuario)
        setRegional(session.regional)
      } catch (reason) {
        clearToken()
        setError(reason instanceof Error ? reason.message : 'Não foi possível restaurar a sessão.')
      } finally {
        setLoading(false)
      }
    }
    void initialize()
  }, [])

  function authenticated(nextUser: SessionUser, nextRegional: Regional | null) {
    setUser(nextUser)
    setRegional(nextRegional)
    setDeveloperConfigured(true)
    setError('')
  }

  async function logout() {
    try { await api('logout', { method: 'POST' }) } catch { /* a sessão local será encerrada */ }
    clearToken()
    setUser(null)
    setRegional(null)
  }

  if (loading) return <div className="center-screen"><div className="loader" /><h2>Carregando Painel Regional</h2></div>
  if (!user) return <LoginPage developerConfigured={developerConfigured} onAuthenticated={authenticated} />

  if (user.perfil === 'DESENVOLVEDOR') {
    return <><DeveloperPanel user={user} onLogout={logout} /><MetaUploadLauncher mode="DESENVOLVEDOR" /><ProductBasesUpload mode="DESENVOLVEDOR" /><ClientBaseImport /><SiteEnhancements user={user} /></>
  }

  if (!regional) {
    return <div className="center-screen"><h2>Regional não encontrada</h2><p>{error || 'Este acesso ainda não está vinculado a uma Regional.'}</p><button className="primary-button" onClick={() => void logout()}>Voltar ao login</button></div>
  }

  return <>
    <Workspace user={user} regional={regional} onLogout={logout} />
    {user.perfil === 'RG' && <MetaUploadLauncher mode="RG" regionalId={regional.id} regionalName={regional.nome} />}
    {user.perfil === 'RG' && <ProductBasesUpload mode="RG" regionalId={regional.id} regionalName={regional.nome} />}
    {user.perfil === 'GD' && <ProductBasesUpload mode="GD" regionalId={regional.id} regionalName={regional.nome} districtId={user.distrital_id} />}
    <SiteEnhancements user={user} />
  </>
}
