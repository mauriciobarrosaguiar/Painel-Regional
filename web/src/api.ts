const TOKEN_KEY = 'painel_regional_token'
const PUBLIC_MODE = true

export const getToken = () => PUBLIC_MODE
  ? 'public-mode'
  : localStorage.getItem(TOKEN_KEY) || ''

export const setToken = (token: string) => {
  if (!PUBLIC_MODE) localStorage.setItem(TOKEN_KEY, token)
}

export const clearToken = () => {
  if (PUBLIC_MODE) {
    window.location.reload()
    return
  }
  localStorage.removeItem(TOKEN_KEY)
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set('Content-Type', 'application/json')
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(`/api/${path.replace(/^\//, '')}`, {
    ...options,
    headers,
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.erro || payload.detalhe || 'Não foi possível concluir a operação.')
  return payload as T
}
