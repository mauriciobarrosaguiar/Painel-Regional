PRAGMA foreign_keys = ON;

ALTER TABLE regionais ADD COLUMN setor TEXT;
ALTER TABLE regionais ADD COLUMN origem TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE regionais ADD COLUMN na_base_atual INTEGER NOT NULL DEFAULT 1;
ALTER TABLE regionais ADD COLUMN atualizado_em TEXT;

ALTER TABLE distritais ADD COLUMN login_rede TEXT;
ALTER TABLE distritais ADD COLUMN origem TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE distritais ADD COLUMN na_base_atual INTEGER NOT NULL DEFAULT 1;
ALTER TABLE distritais ADD COLUMN atualizado_em TEXT;

ALTER TABLE consultores ADD COLUMN login_rede TEXT;
ALTER TABLE consultores ADD COLUMN cargo TEXT;
ALTER TABLE consultores ADD COLUMN situacao TEXT;
ALTER TABLE consultores ADD COLUMN origem TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE consultores ADD COLUMN na_base_atual INTEGER NOT NULL DEFAULT 1;
ALTER TABLE consultores ADD COLUMN atualizado_em TEXT;

ALTER TABLE usuarios ADD COLUMN login_rede TEXT;
ALTER TABLE usuarios ADD COLUMN setor TEXT;
ALTER TABLE usuarios ADD COLUMN origem TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE usuarios ADD COLUMN na_base_atual INTEGER NOT NULL DEFAULT 1;
ALTER TABLE usuarios ADD COLUMN atualizado_em TEXT;

CREATE TABLE IF NOT EXISTS importacoes_estrutura_pessoas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome_arquivo TEXT NOT NULL,
  nome_planilha TEXT,
  total_linhas INTEGER NOT NULL DEFAULT 0,
  total_regionais INTEGER NOT NULL DEFAULT 0,
  total_distritais INTEGER NOT NULL DEFAULT 0,
  total_consultores INTEGER NOT NULL DEFAULT 0,
  total_ignorados INTEGER NOT NULL DEFAULT 0,
  detalhes_json TEXT NOT NULL DEFAULT '{}',
  criado_por INTEGER,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_regionais_setor
  ON regionais(setor)
  WHERE setor IS NOT NULL AND setor <> '';
CREATE INDEX IF NOT EXISTS idx_regionais_origem_base
  ON regionais(origem, na_base_atual, ativo);
CREATE INDEX IF NOT EXISTS idx_distritais_origem_base
  ON distritais(origem, na_base_atual, ativo);
CREATE INDEX IF NOT EXISTS idx_consultores_origem_base
  ON consultores(origem, na_base_atual, ativo);
CREATE INDEX IF NOT EXISTS idx_usuarios_login_rede
  ON usuarios(login_rede, perfil, ativo);
CREATE INDEX IF NOT EXISTS idx_usuarios_origem_base
  ON usuarios(origem, na_base_atual, ativo);
