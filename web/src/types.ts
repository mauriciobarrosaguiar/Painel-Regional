export type Perfil = 'RG' | 'GD' | 'CONSULTOR'

export type Regional = {
  id: number
  nome: string
  slug: string
}

export type SessionUser = {
  id: number
  nome: string
  email: string
  perfil: Perfil
  regional_id: number
  distrital_id?: number | null
  consultor_id?: number | null
}

export type Consultor = {
  id: number
  nome: string
  codigo: string
  email?: string
  ativo: number
}

export type Distrital = {
  id: number
  nome: string
  codigo: string
  gerente_nome?: string
  ativo: number
  consultores: Consultor[]
}

export type Hierarquia = {
  regional: Regional
  distritais: Distrital[]
}

export type Dashboard = {
  escopo: string
  ol_total_faturado: number
  ol_sem_combate: number
  ol_combate: number
  ol_prioritarios: number
  ol_lancamentos: number
  meta_ol_sem_combate: number
  meta_ol_prioritarios: number
  meta_ol_lancamentos: number
  clientes_com_venda: number
  clientes_sem_venda: number
  pedidos_nao_faturados: number
  valor_nao_faturado: number
  atualizado_em: string
}

export type AutomationItem = {
  id: number
  nome: string
  status: string
  ultima_execucao?: string | null
  proxima_execucao?: string | null
}
