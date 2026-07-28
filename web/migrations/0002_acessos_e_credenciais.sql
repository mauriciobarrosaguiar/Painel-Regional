PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS desenvolvedores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultimo_acesso_em TEXT
);

CREATE TABLE IF NOT EXISTS sessoes_acesso (
  token TEXT PRIMARY KEY,
  tipo_usuario TEXT NOT NULL CHECK (tipo_usuario IN ('DESENVOLVEDOR', 'USUARIO')),
  usuario_id INTEGER NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS credenciais_extracao (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  regional_id INTEGER NOT NULL UNIQUE REFERENCES regionais(id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  usuario_mascarado TEXT NOT NULL,
  credencial_cifrada TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'CONFIGURADA',
  mensagem_status TEXT,
  testado_em TEXT,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS comandos_automacao (
  id TEXT PRIMARY KEY,
  regional_id INTEGER NOT NULL REFERENCES regionais(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  parametros_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'aguardando',
  solicitado_por TEXT,
  mensagem TEXT,
  erro TEXT,
  solicitado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  iniciado_em TEXT,
  finalizado_em TEXT,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS extracoes (
  id TEXT PRIMARY KEY,
  regional_id INTEGER NOT NULL REFERENCES regionais(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'aguardando',
  total_registros INTEGER NOT NULL DEFAULT 0,
  mensagem TEXT,
  erro TEXT,
  iniciado_em TEXT,
  finalizado_em TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessoes_acesso_validade
  ON sessoes_acesso(tipo_usuario, usuario_id, expira_em);
CREATE INDEX IF NOT EXISTS idx_credenciais_regional
  ON credenciais_extracao(regional_id, usuario_id);
CREATE INDEX IF NOT EXISTS idx_comandos_regional_status
  ON comandos_automacao(regional_id, status, solicitado_em);
CREATE INDEX IF NOT EXISTS idx_extracoes_regional
  ON extracoes(regional_id, criado_em);
