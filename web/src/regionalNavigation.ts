export type RegionalPage =
  | 'regional'
  | 'visao-geral'
  | 'sips'
  | 'consultores'
  | 'clientes'
  | 'foco-semanal'
  | 'oportunidades'
  | 'mercado-farma'
  | 'historico'
  | 'administracao'
  | 'automacoes'

const valid = new Set<RegionalPage>([
  'regional',
  'visao-geral',
  'sips',
  'consultores',
  'clientes',
  'foco-semanal',
  'oportunidades',
  'mercado-farma',
  'historico',
  'administracao',
  'automacoes',
])

export function readRegionalNavigation(search = window.location.search) {
  const params = new URLSearchParams(search)
  const raw = (params.get('pagina') || 'regional') as RegionalPage
  const pagina = valid.has(raw) ? raw : 'regional'
  const distritalId = Number(params.get('distrital') || 0) || null
  return { pagina, distritalId }
}

export function saveRegionalNavigation(page: RegionalPage, districtId: number | null, replace = false) {
  const url = new URL(window.location.href)
  if (page === 'regional') url.searchParams.delete('pagina')
  else url.searchParams.set('pagina', page)
  if (districtId) url.searchParams.set('distrital', String(districtId))
  else url.searchParams.delete('distrital')
  window.history[replace ? 'replaceState' : 'pushState']({ pagina: page, distrital: districtId }, '', `${url.pathname}${url.search}${url.hash}`)
}
