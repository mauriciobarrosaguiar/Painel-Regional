import { forbidden, getSession, unauthorized } from './security.js'

export async function requireManager(request, env) {
  const user = await getSession(request, env)
  if (!user) return { denial: unauthorized('Sessão expirada. Entre novamente.'), user: null }
  if (!['RG', 'GD'].includes(String(user.perfil))) {
    return { denial: forbidden('Apenas Gerentes Regionais e Distritais podem realizar esta operação.'), user }
  }
  if (user.perfil === 'GD' && !user.distrital_id) {
    return { denial: forbidden('Este Gerente Distrital ainda não está vinculado a uma Distrital.'), user }
  }
  return { denial: null, user }
}

export async function requireGD(request, env) {
  const result = await requireManager(request, env)
  if (result.denial) return result
  if (result.user.perfil !== 'GD') {
    return { denial: forbidden('O acesso do Bússola e Mercado Farma deve ser cadastrado por cada Gerente Distrital.'), user: result.user }
  }
  return result
}
