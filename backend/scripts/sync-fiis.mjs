/**
 * Syncs all unique FII tickers in carteira 10 and copies cotas to all product instances.
 * Run: node scripts/sync-fiis.mjs
 */
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import Database from 'better-sqlite3'
import { fetchHistoricoBrapi } from '../src/services/external.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = join(__dirname, '../data/carteiras.db')
const db = new Database(DB_PATH)

const hoje = new Date().toISOString().split('T')[0]
const cincoAnosAtras = new Date(Date.now() - 5 * 365 * 24 * 3600000).toISOString().split('T')[0]

// Get all product IDs for carteira 10, grouped by ticker
const rows = db.prepare(`
  SELECT p.id, p.identificador, MIN(ep.data_inicio) as data_mais_antiga
  FROM produtos p
  JOIN estados_portfolio ep ON p.estado_id = ep.id
  WHERE ep.carteira_id = 10
  GROUP BY p.identificador
  ORDER BY p.identificador
`).all()

const byTicker = {}
for (const r of rows) {
  // Use oldest estado data_inicio (like the API sync endpoint does), capped at 5 years
  const dataInicio = r.data_mais_antiga && r.data_mais_antiga > cincoAnosAtras
    ? r.data_mais_antiga : cincoAnosAtras
  // Get all product IDs for this ticker
  const ids = db.prepare(`
    SELECT p.id FROM produtos p
    JOIN estados_portfolio ep ON p.estado_id = ep.id
    WHERE ep.carteira_id = 10 AND p.identificador = ?
    ORDER BY p.id
  `).all(r.identificador).map(x => x.id)
  byTicker[r.identificador] = { ids, dataInicio }
}

const copyStmt = db.prepare(`
  INSERT OR IGNORE INTO cotas_cache (produto_id, data, valor, valor_ajustado, fonte)
  SELECT ?, data, valor, valor_ajustado, fonte FROM cotas_cache WHERE produto_id = ?
`)

for (const [ticker, { ids, dataInicio }] of Object.entries(byTicker)) {
  const minId = ids[0]
  const existing = db.prepare('SELECT MIN(data) as d FROM cotas_cache WHERE produto_id = ?').get(minId)?.d

  // Re-sync if no data OR if earliest data is after the portfolio start date
  if (!existing || existing > dataInicio) {
    process.stdout.write(`Syncing ${ticker} from ${dataInicio} (id=${minId})... `)
    try {
      const { rows: cotaRows, insertMany } = await fetchHistoricoBrapi(ticker, dataInicio, hoje)
      insertMany(minId, cotaRows)
      const count = db.prepare('SELECT COUNT(*) as n FROM cotas_cache WHERE produto_id = ?').get(minId).n
      console.log(`${count} cotas`)
    } catch (e) {
      console.log(`ERRO: ${e.message}`)
      continue
    }
  } else {
    const count = db.prepare('SELECT COUNT(*) as n FROM cotas_cache WHERE produto_id = ?').get(minId).n
    console.log(`${ticker}: ${count} cotas desde ${existing} (ok)`)
  }

  // Copy cotas from minId to all other product IDs with same ticker
  let copied = 0
  db.transaction(() => {
    for (const id of ids.slice(1)) {
      const before = db.prepare('SELECT COUNT(*) as n FROM cotas_cache WHERE produto_id = ?').get(id).n
      copyStmt.run(id, minId)
      const after = db.prepare('SELECT COUNT(*) as n FROM cotas_cache WHERE produto_id = ?').get(id).n
      copied += (after - before)
    }
  })()

  if (ids.length > 1) {
    console.log(`  -> Copiadas ${copied} entradas para ${ids.length - 1} outros produtos de ${ticker}`)
  }
}

console.log('\nSync concluído!')
db.close()
