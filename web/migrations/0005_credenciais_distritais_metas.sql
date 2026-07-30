PRAGMA foreign_keys = ON;

ALTER TABLE comandos_automacao ADD COLUMN distrital_id INTEGER REFERENCES distritais(id) ON DELETE CASCADE;
ALTER TABLE extracoes ADD COLUMN distrital_id INTEGER REFERENCES distritais(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_comandos_distrital_status
  ON comandos_automacao(regional_id, distrital_id, tipo, status, solicitado_em);
CREATE INDEX IF NOT EXISTS idx_extracoes_distrital
  ON extracoes(regional_id, distrital_id, tipo, criado_em);

CREATE TABLE IF NOT EXISTS credenciais_distritais (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  regional_id INTEGER NOT NULL REFERENCES regionais(id) ON DELETE CASCADE,
  distrital_id INTEGER NOT NULL REFERENCES distritais(id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('BUSSOLA', 'MERCADO_FARMA')),
  usuario_mascarado TEXT NOT NULL,
  credencial_cifrada TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'CONFIGURADA',
  mensagem_status TEXT,
  testado_em TEXT,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (distrital_id, tipo)
);

CREATE INDEX IF NOT EXISTS idx_credenciais_distritais_regional
  ON credenciais_distritais(regional_id, distrital_id, tipo, status);

CREATE TABLE IF NOT EXISTS metas_importacoes (
  id TEXT PRIMARY KEY,
  regional_id INTEGER NOT NULL REFERENCES regionais(id) ON DELETE CASCADE,
  competencia TEXT NOT NULL,
  tipo_carteira TEXT NOT NULL CHECK (tipo_carteira IN ('TERRITORIO', 'REDE', 'ASSOCIATIVO')),
  arquivo_origem TEXT NOT NULL,
  origem_modificada_em TEXT,
  status TEXT NOT NULL DEFAULT 'PROCESSANDO',
  total_recebido INTEGER NOT NULL DEFAULT 0,
  total_importado INTEGER NOT NULL DEFAULT 0,
  total_ignorado INTEGER NOT NULL DEFAULT 0,
  mensagem TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finalizado_em TEXT
);

CREATE INDEX IF NOT EXISTS idx_metas_importacoes_competencia
  ON metas_importacoes(regional_id, competencia, tipo_carteira, criado_em);

CREATE TABLE IF NOT EXISTS metas_sellout (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  importacao_id TEXT NOT NULL REFERENCES metas_importacoes(id) ON DELETE CASCADE,
  regional_id INTEGER NOT NULL REFERENCES regionais(id) ON DELETE CASCADE,
  distrital_id INTEGER REFERENCES distritais(id) ON DELETE CASCADE,
  consultor_id INTEGER REFERENCES consultores(id) ON DELETE CASCADE,
  competencia TEXT NOT NULL,
  tipo_carteira TEXT NOT NULL CHECK (tipo_carteira IN ('TERRITORIO', 'REDE', 'ASSOCIATIVO')),
  nivel TEXT NOT NULL CHECK (nivel IN ('GR', 'GD', 'CONSULTOR')),
  regiao TEXT,
  setor TEXT NOT NULL,
  colaborador TEXT NOT NULL,
  cargo_original TEXT,
  meta_ol_sem_combate REAL NOT NULL DEFAULT 0,
  meta_ol_prioritarios REAL NOT NULL DEFAULT 0,
  meta_ol_lancamentos REAL NOT NULL DEFAULT 0,
  meta_demanda_sem_combate REAL NOT NULL DEFAULT 0,
  arquivo_origem TEXT NOT NULL,
  origem_modificada_em TEXT,
  importado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (regional_id, competencia, tipo_carteira, setor)
);

CREATE INDEX IF NOT EXISTS idx_metas_sellout_escopo
  ON metas_sellout(regional_id, competencia, nivel, distrital_id, consultor_id);
CREATE INDEX IF NOT EXISTS idx_metas_sellout_setor
  ON metas_sellout(regional_id, setor, competencia);
