import Database from 'better-sqlite3'
import { SCHEMA, SEED } from './schema.js'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '../../data')
const DB_PATH = path.join(DATA_DIR, 'carteiras.db')

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

let db

function runMigrations(db) {
  const cols = db.pragma('table_info(alocacoes_macro)').map((c) => c.name)

  // Migração: esquema antigo (rf_pos, rf_ipca...) → novo (pos_fixado, inflacao...)
  if (cols.includes('rf_pos')) {
    console.log('[DB] Migrando classes de ativos para nova nomenclatura...')
    db.pragma('foreign_keys = OFF')
    db.exec(`
      CREATE TABLE alocacoes_macro_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        perfil_id INTEGER NOT NULL REFERENCES perfis(id),
        mes TEXT NOT NULL,
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

      INSERT INTO alocacoes_macro_new
        (id, perfil_id, mes, pos_fixado, inflacao, prefixado, rf_global,
         multimercado, rv_brasil, rv_global, fundos_listados, alternativos,
         created_at, updated_at)
      SELECT
        id, perfil_id, mes,
        rf_pos, rf_ipca, rf_pre, 0,
        multimercado, renda_variavel, 0, 0, outros,
        created_at, updated_at
      FROM alocacoes_macro;

      DROP TABLE alocacoes_macro;
      ALTER TABLE alocacoes_macro_new RENAME TO alocacoes_macro;

      CREATE TABLE produtos_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        estado_id INTEGER NOT NULL REFERENCES estados_portfolio(id) ON DELETE CASCADE,
        tipo TEXT NOT NULL CHECK(tipo IN ('fundo', 'acao', 'rf_curva')),
        classe TEXT NOT NULL CHECK(classe IN (
          'pos_fixado','inflacao','prefixado','rf_global','multimercado',
          'rv_brasil','rv_global','fundos_listados','alternativos'
        )),
        nome TEXT NOT NULL,
        identificador TEXT,
        peso REAL NOT NULL DEFAULT 0,
        indexador TEXT CHECK(indexador IN ('CDI', 'IPCA', 'PRE', NULL)),
        tipo_cdi TEXT CHECK(tipo_cdi IN ('pct', 'spread', NULL)),
        taxa REAL,
        data_emissao TEXT,
        data_vencimento TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      INSERT INTO produtos_new
        (id, estado_id, tipo, classe, nome, identificador, peso,
         indexador, tipo_cdi, taxa, data_emissao, data_vencimento, created_at)
      SELECT
        id, estado_id, tipo,
        CASE classe
          WHEN 'rf_pos'        THEN 'pos_fixado'
          WHEN 'rf_ipca'       THEN 'inflacao'
          WHEN 'rf_pre'        THEN 'prefixado'
          WHEN 'renda_variavel' THEN 'rv_brasil'
          WHEN 'outros'        THEN 'alternativos'
          ELSE classe
        END,
        nome, identificador, peso,
        indexador, tipo_cdi, taxa, data_emissao, data_vencimento, created_at
      FROM produtos;

      DROP TABLE produtos;
      ALTER TABLE produtos_new RENAME TO produtos;
    `)
    db.pragma('foreign_keys = ON')
    console.log('[DB] Migração concluída.')
  }
}

export function getDb() {
  if (!db) {
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.exec(SCHEMA)
    db.exec(SEED)
    runMigrations(db)
    console.log(`[DB] SQLite conectado: ${DB_PATH}`)
  }
  return db
}

export function closeDb() {
  if (db) {
    db.close()
    db = null
  }
}
