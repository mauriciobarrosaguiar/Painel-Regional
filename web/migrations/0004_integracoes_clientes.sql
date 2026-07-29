PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS credenciais_integracoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  regional_id INTEGER NOT NULL,
  usuario_id INTEGER,
  tipo TEXT NOT NULL CHECK (tipo IN ('BUSSOLA', 'MERCADO_FARMA')),
  usuario_mascarado TEXT NOT NULL,
  credencial_cifrada TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'CONFIGURADA',
  mensagem_status TEXT,
  testado_em TEXT,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (regional_id) REFERENCES regionais(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  UNIQUE (regional_id, tipo)
);

CREATE INDEX IF NOT EXISTS idx_credenciais_integracoes_regional
  ON credenciais_integracoes(regional_id, tipo);

CREATE TABLE IF NOT EXISTS painel_clientes_importacoes (
  id TEXT PRIMARY KEY,
  nome_arquivo TEXT NOT NULL,
  nome_planilha TEXT NOT NULL DEFAULT 'PAINEL',
  status TEXT NOT NULL DEFAULT 'ABERTA',
  total_recebido INTEGER NOT NULL DEFAULT 0,
  total_importado INTEGER NOT NULL DEFAULT 0,
  mensagem TEXT,
  criado_por INTEGER,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finalizado_em TEXT
);

CREATE TABLE IF NOT EXISTS painel_clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  importacao_id TEXT NOT NULL,
  cnpj TEXT NOT NULL,
  codigo_cliente TEXT,
  nome_pdv TEXT NOT NULL,
  grupo_economico TEXT,
  rede_associacao TEXT,
  endereco TEXT,
  bairro TEXT,
  cidade TEXT,
  uf TEXT,
  cep TEXT,
  situacao TEXT,
  classificacao_cliente TEXT,
  setor_gr TEXT NOT NULL,
  nome_gr TEXT,
  setor_gd TEXT NOT NULL,
  nome_gd TEXT,
  setor_consultor TEXT NOT NULL,
  nome_consultor TEXT,
  foco_pex TEXT,
  positivacao TEXT,
  ativo INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (importacao_id) REFERENCES painel_clientes_importacoes(id),
  UNIQUE (importacao_id, cnpj, setor_consultor)
);

CREATE INDEX IF NOT EXISTS idx_painel_clientes_hierarquia
  ON painel_clientes(ativo, setor_gr, setor_gd, setor_consultor);
CREATE INDEX IF NOT EXISTS idx_painel_clientes_busca
  ON painel_clientes(ativo, cnpj, nome_pdv, cidade, uf);
