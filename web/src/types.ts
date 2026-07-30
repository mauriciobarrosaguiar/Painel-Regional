export type Perfil = 'DESENVOLVEDOR' | 'RG' | 'GD' | 'CONSULTOR'

export type Regional = {
  id: number
  nome: string
  slug: string
  ativo?: number
  setor?: string
  origem?: string
  na_base_atual?: number
  total_distritais?: number
  total_consultores?: number
  criado_em?: string
  atualizado_em?: string | null
}

export type SessionUser = {
  id: number
  nome: string
  email: string
  perfil: Perfil
  regional_id?: number | null
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
  meta_demanda_sem_combate?: number
  clientes_com_venda: number
  clientes_sem_venda: number
  pedidos_nao_faturados: number
  valor_nao_faturado: number
  competencia_resultado?: string | null
  competencia_meta?: string | null
  metas_atualizadas_em?: string
  atualizado_em: string
}

export type AutomationCommand = {
  id: string
  tipo: string
  status: string
  mensagem?: string
  erro?: string
  distrital_id?: number | null
  distrital_nome?: string | null
  distrital_codigo?: string | null
  solicitado_em: string
  iniciado_em?: string | null
  finalizado_em?: string | null
}

export type ExtractionItem = {
  id: string
  tipo: string
  status: string
  total_registros: number
  mensagem?: string
  erro?: string
  distrital_id?: number | null
  distrital_nome?: string | null
  distrital_codigo?: string | null
  iniciado_em?: string | null
  finalizado_em?: string | null
  criado_em: string
}

export type CredentialSummary = {
  total: number
  configuradas: number
  pendentes: number
  completa: boolean
}

export type DistrictCredential = {
  id: number
  nome: string
  codigo: string
  gerente_nome?: string
  configurada: boolean
  usuario_mascarado?: string
  atualizado_em?: string | null
}

export type AutomationData = {
  modo?: 'RG' | 'GD'
  comandos: AutomationCommand[]
  extracoes: ExtractionItem[]
  em_execucao: number
  credencial_configurada: boolean
  credenciais?: {
    integracao?: unknown | null
    bussola?: unknown | null
    mercado_farma?: unknown | null
  }
  distritais?: DistrictCredential[]
  resumo_credenciais?: CredentialSummary
  atualizado_em: string
}

export type RegionalManager = {
  id: number
  nome: string
  email: string
  login_rede?: string
  setor?: string
  regional_id: number
  regional_nome: string
  ativo: number
  na_base_atual?: number
  regional_ativa?: number
  credencial_configurada: number
  usuario_mascarado?: string
  credencial_status?: string
  credencial_atualizada_em?: string | null
}

export type PeopleImport = {
  id: number
  nome_arquivo: string
  nome_planilha?: string
  total_linhas: number
  total_regionais: number
  total_distritais: number
  total_consultores: number
  total_ignorados: number
  criado_em: string
}
