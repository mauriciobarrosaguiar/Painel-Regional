PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS regionais (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS distritais (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  regional_id INTEGER NOT NULL REFERENCES regionais(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  codigo TEXT NOT NULL,
  gerente_nome TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(regional_id, codigo)
);

CREATE TABLE IF NOT EXISTS consultores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  distrital_id INTEGER NOT NULL REFERENCES distritais(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  codigo TEXT NOT NULL,
  email TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(distrital_id, codigo)
);

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  regional_id INTEGER NOT NULL REFERENCES regionais(id) ON DELETE CASCADE,
  distrital_id INTEGER REFERENCES distritais(id) ON DELETE SET NULL,
  consultor_id INTEGER REFERENCES consultores(id) ON DELETE SET NULL,
  nome TEXT NOT NULL,
  email TEXT NOT NULL,
  senha_hash TEXT NOT NULL,
  perfil TEXT NOT NULL CHECK (perfil IN ('RG', 'GD', 'CONSULTOR')),
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(regional_id, email)
);

CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS resultados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  regional_id INTEGER NOT NULL REFERENCES regionais(id) ON DELETE CASCADE,
  distrital_id INTEGER REFERENCES distritais(id) ON DELETE CASCADE,
  consultor_id INTEGER REFERENCES consultores(id) ON DELETE CASCADE,
  competencia TEXT NOT NULL,
  ol_total_faturado REAL NOT NULL DEFAULT 0,
  ol_sem_combate REAL NOT NULL DEFAULT 0,
  ol_combate REAL NOT NULL DEFAULT 0,
  ol_prioritarios REAL NOT NULL DEFAULT 0,
  ol_lancamentos REAL NOT NULL DEFAULT 0,
  meta_ol_sem_combate REAL NOT NULL DEFAULT 0,
  meta_ol_prioritarios REAL NOT NULL DEFAULT 0,
  meta_ol_lancamentos REAL NOT NULL DEFAULT 0,
  clientes_com_venda INTEGER NOT NULL DEFAULT 0,
  clientes_sem_venda INTEGER NOT NULL DEFAULT 0,
  pedidos_nao_faturados INTEGER NOT NULL DEFAULT 0,
  valor_nao_faturado REAL NOT NULL DEFAULT 0,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(consultor_id, competencia)
);

CREATE TABLE IF NOT EXISTS automacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  regional_id INTEGER NOT NULL REFERENCES regionais(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ATIVO',
  ultima_execucao TEXT,
  proxima_execucao TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_distritais_regional ON distritais(regional_id);
CREATE INDEX IF NOT EXISTS idx_consultores_distrital ON consultores(distrital_id);
CREATE INDEX IF NOT EXISTS idx_resultados_escopo ON resultados(regional_id, distrital_id, consultor_id, competencia);
CREATE INDEX IF NOT EXISTS idx_sessoes_usuario ON sessoes(usuario_id, expira_em);

INSERT OR IGNORE INTO regionais (id, nome, slug, ativo) VALUES (1, 'Regional Norte', 'norte', 1);
INSERT OR IGNORE INTO distritais (id, regional_id, nome, codigo, gerente_nome, ativo)
VALUES (1, 1, 'Distrital Norte', 'DN01', 'Gerente Distrital', 1);
INSERT OR IGNORE INTO automacoes (id, regional_id, nome, status)
VALUES (1, 1, 'Atualização Bússola', 'ATIVO');
INSERT OR IGNORE INTO automacoes (id, regional_id, nome, status)
VALUES (2, 1, 'Atualização Mercado Farma', 'ATIVO');
