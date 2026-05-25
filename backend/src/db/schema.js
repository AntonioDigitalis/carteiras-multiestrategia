export const SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- Perfis de investidor (Conservador, Moderado, Arrojado)
CREATE TABLE IF NOT EXISTS perfis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  ordem INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Carteiras (2 por perfil: A e B)
CREATE TABLE IF NOT EXISTS carteiras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  perfil_id INTEGER NOT NULL REFERENCES perfis(id),
  tipo TEXT NOT NULL CHECK(tipo IN ('A', 'B')),
  nome TEXT NOT NULL,
  descricao TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Alocação macro compartilhada por perfil (ambas carteiras do perfil)
-- Vigência mensal
CREATE TABLE IF NOT EXISTS alocacoes_macro (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  perfil_id INTEGER NOT NULL REFERENCES perfis(id),
  mes TEXT NOT NULL,             -- formato YYYY-MM
  pos_fixado REAL NOT NULL DEFAULT 0,
  inflacao REAL NOT NULL DEFAULT 0,
  prefixado REAL NOT NULL DEFAULT 0,
  rf_global REAL NOT NULL DEFAULT 0,
  multimercado REAL NOT NULL DEFAULT 0,
  rv_brasil REAL NOT NULL DEFAULT 0,
  rv_global REAL NOT NULL DEFAULT 0,
  fundos_listados REAL NOT NULL DEFAULT 0,
  alternativos REAL NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(perfil_id, mes)
);

-- Estados do portfólio (para capturar trocas de produto dentro do mês)
CREATE TABLE IF NOT EXISTS estados_portfolio (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  carteira_id INTEGER NOT NULL REFERENCES carteiras(id),
  mes TEXT NOT NULL,             -- formato YYYY-MM
  data_inicio TEXT NOT NULL,     -- formato YYYY-MM-DD
  data_fim TEXT,                 -- NULL = vigente até o final do mês
  created_at TEXT DEFAULT (datetime('now'))
);

-- Produtos dentro de cada estado
CREATE TABLE IF NOT EXISTS produtos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estado_id INTEGER NOT NULL REFERENCES estados_portfolio(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK(tipo IN ('fundo', 'acao', 'rf_curva')),
  classe TEXT NOT NULL CHECK(classe IN ('pos_fixado', 'inflacao', 'prefixado', 'rf_global', 'multimercado', 'rv_brasil', 'rv_global', 'fundos_listados', 'alternativos')),
  nome TEXT NOT NULL,
  identificador TEXT,            -- CNPJ para fundos, ticker para ações
  peso REAL NOT NULL DEFAULT 0,  -- % dentro da classe (deve somar 100% por classe)
  -- Campos RF marcada na curva
  indexador TEXT CHECK(indexador IN ('CDI', 'IPCA', 'PRE', NULL)),
  tipo_cdi TEXT CHECK(tipo_cdi IN ('pct', 'spread', NULL)),
  taxa REAL,                     -- % CDI, spread a.a. ou taxa prefixada a.a.
  data_emissao TEXT,
  data_vencimento TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Cache de cotas / preços históricos
CREATE TABLE IF NOT EXISTS cotas_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  data TEXT NOT NULL,            -- formato YYYY-MM-DD
  valor REAL NOT NULL,
  valor_ajustado REAL,           -- para ações: preço ajustado por proventos/splits
  fonte TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(produto_id, data)
);

-- Cache de dados macro (CDI, IPCA, benchmarks)
CREATE TABLE IF NOT EXISTS dados_macro (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serie TEXT NOT NULL,           -- 'CDI_DIARIO', 'IPCA_MENSAL', 'IMA_B', etc.
  data TEXT NOT NULL,
  valor REAL NOT NULL,
  fonte TEXT NOT NULL DEFAULT 'BCB',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(serie, data)
);

-- Retornos calculados (cache)
CREATE TABLE IF NOT EXISTS retornos_mensais (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  carteira_id INTEGER NOT NULL REFERENCES carteiras(id),
  mes TEXT NOT NULL,             -- YYYY-MM
  retorno REAL NOT NULL,
  retorno_cdi REAL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(carteira_id, mes)
);

-- Log de captação de dados externos
CREATE TABLE IF NOT EXISTS log_captacao (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  fonte TEXT NOT NULL,
  ativo TEXT NOT NULL,
  valor TEXT,
  status TEXT NOT NULL DEFAULT 'ok' CHECK(status IN ('ok', 'erro', 'aviso')),
  detalhes TEXT
);

-- Alertas de auditoria
CREATE TABLE IF NOT EXISTS alertas_auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL CHECK(tipo IN ('error', 'warning', 'info')),
  categoria TEXT NOT NULL,       -- 'cota_travada', 'split', 'retorno_anomalo', 'outro'
  titulo TEXT NOT NULL,
  descricao TEXT,
  ativo TEXT,                    -- nome/identificador do ativo
  produto_id INTEGER REFERENCES produtos(id),
  data TEXT,
  valor_bruto TEXT,
  valor_usado TEXT,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK(status IN ('ativo', 'revisado', 'ignorar')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Eventos corporativos (splits, inplits, dividendos, mudanças de ticker)
CREATE TABLE IF NOT EXISTS eventos_corporativos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  data TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK(tipo IN ('split', 'inplit', 'dividendo', 'ticker_change', 'sem_dados')),
  valor REAL,            -- razão do split, valor do dividendo, etc.
  descricao TEXT,
  fonte TEXT DEFAULT 'yahoo',
  revisado INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(ticker, data, tipo)
);

-- Configurações gerais
CREATE TABLE IF NOT EXISTS configuracoes (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);
`

export const SEED = `
-- Inserir perfis padrão se não existirem
INSERT OR IGNORE INTO perfis (id, nome, ordem) VALUES (1, 'Conservador', 1);
INSERT OR IGNORE INTO perfis (id, nome, ordem) VALUES (2, 'Moderado', 2);
INSERT OR IGNORE INTO perfis (id, nome, ordem) VALUES (3, 'Arrojado', 3);

-- Inserir carteiras padrão se não existirem
INSERT OR IGNORE INTO carteiras (id, perfil_id, tipo, nome) VALUES (1, 1, 'A', 'Conservador A');
INSERT OR IGNORE INTO carteiras (id, perfil_id, tipo, nome) VALUES (2, 1, 'B', 'Conservador B');
INSERT OR IGNORE INTO carteiras (id, perfil_id, tipo, nome) VALUES (3, 2, 'A', 'Moderado A');
INSERT OR IGNORE INTO carteiras (id, perfil_id, tipo, nome) VALUES (4, 2, 'B', 'Moderado B');
INSERT OR IGNORE INTO carteiras (id, perfil_id, tipo, nome) VALUES (5, 3, 'A', 'Arrojado A');
INSERT OR IGNORE INTO carteiras (id, perfil_id, tipo, nome) VALUES (6, 3, 'B', 'Arrojado B');

-- Configurações padrão
INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES ('versao', '1.0.0');
INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES ('taxa_livre_risco', 'CDI');
`
