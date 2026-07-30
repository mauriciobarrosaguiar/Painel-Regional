CREATE TABLE IF NOT EXISTS produtos_catalogo (
  id TEXT PRIMARY KEY,
  regional_id INTEGER NOT NULL,
  distrital_id INTEGER NOT NULL DEFAULT 0,
  ean TEXT NOT NULL,
  produto TEXT NOT NULL DEFAULT '',
  tipo_mix TEXT NOT NULL DEFAULT 'SEM CLASSIFICACAO',
  mix_importacao_id TEXT,
  mercado_farma_importacao_id TEXT,
  atualizado_em TEXT NOT NULL,
  UNIQUE (regional_id, distrital_id, ean),
  FOREIGN KEY (regional_id) REFERENCES regionais(id)
);

CREATE INDEX IF NOT EXISTS idx_produtos_catalogo_escopo
  ON produtos_catalogo (regional_id, distrital_id);

CREATE INDEX IF NOT EXISTS idx_produtos_catalogo_mix
  ON produtos_catalogo (regional_id, distrital_id, mix_importacao_id);

CREATE INDEX IF NOT EXISTS idx_produtos_catalogo_mercado_farma
  ON produtos_catalogo (regional_id, distrital_id, mercado_farma_importacao_id);

CREATE TABLE IF NOT EXISTS produtos_importacoes (
  id TEXT PRIMARY KEY,
  regional_id INTEGER NOT NULL,
  distrital_id INTEGER NOT NULL DEFAULT 0,
  tipo TEXT NOT NULL CHECK (tipo IN ('PRODUTOS_MIX', 'PRODUTOS_MERCADO_FARMA')),
  nome_arquivo TEXT NOT NULL,
  total_recebido INTEGER NOT NULL DEFAULT 0,
  total_importado INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'CONCLUIDO',
  mensagem TEXT,
  enviado_por TEXT,
  criado_em TEXT NOT NULL,
  finalizado_em TEXT,
  FOREIGN KEY (regional_id) REFERENCES regionais(id)
);

CREATE INDEX IF NOT EXISTS idx_produtos_importacoes_escopo
  ON produtos_importacoes (regional_id, distrital_id, criado_em DESC);
