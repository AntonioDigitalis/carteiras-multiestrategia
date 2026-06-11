/**
 * Importa preços Economatica para cotas_cache.
 *
 * Os preços são cotações ajustadas por proventos (total return), prontos para
 * cálculo de retorno. Armazenamos como `valor`, com `valor_ajustado = null`
 * para que o calculator use o caminho direto first.valor/last.valor (evita
 * double-counting de dividendos para FIIs).
 *
 * Uso: node backend/import_economatica.mjs
 * (executar a partir da raiz do projeto)
 */
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import Database from './node_modules/better-sqlite3/lib/database.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const XLSX = require('./node_modules/xlsx/xlsx.js')

const DB_PATH    = resolve(__dirname, 'data/carteiras.db')
const XLSX_PATH  = resolve(__dirname, '../economatica_template.xlsx')

function excelDateToISO(serial) {
  return new Date((serial - 25569) * 86400 * 1000).toISOString().split('T')[0]
}

const db  = new Database(DB_PATH)
const buf = readFileSync(XLSX_PATH)
const wb  = XLSX.read(buf, { type: 'buffer' })

const wsPrecos = wb.Sheets['Preços']
if (!wsPrecos) throw new Error('Aba "Preços" não encontrada no arquivo')

const rows    = XLSX.utils.sheet_to_json(wsPrecos, { header: 1, defval: null })
const headers = rows[0]
const dataRows = rows.slice(1).filter(r => r[0] != null)

// ticker → coluna na planilha
const tickerColMap = {}
for (let i = 1; i < headers.length; i++) {
  if (headers[i]) tickerColMap[headers[i]] = i
}

// ticker → lista de todos os produto_ids no banco
// (o mesmo ticker aparece em múltiplas carteiras/estados, todos devem receber o mesmo preço)
const allTickers = Object.keys(tickerColMap)
const placeholders = allTickers.map(() => '?').join(',')
const produtos = db
  .prepare(`SELECT identificador, id FROM produtos WHERE identificador IN (${placeholders})`)
  .all(...allTickers)

const tickerProdutoMap = {}   // ticker → [id, id, ...]
for (const p of produtos) {
  if (!tickerProdutoMap[p.identificador]) tickerProdutoMap[p.identificador] = []
  tickerProdutoMap[p.identificador].push(p.id)
}

const tickersImportados = Object.keys(tickerProdutoMap)
const tickersIgnorados   = allTickers.filter(t => !tickerProdutoMap[t])

console.log(`Arquivo: ${XLSX_PATH}`)
console.log(`Datas: ${excelDateToISO(dataRows[0][0])} → ${excelDateToISO(dataRows[dataRows.length-1][0])} (${dataRows.length} dias)`)
console.log(`Tickers no arquivo: ${allTickers.length}`)
console.log(`Tickers com produto no banco: ${tickersImportados.length}`)
if (tickersIgnorados.length) console.log(`Ignorados (sem produto): ${tickersIgnorados.join(', ')}`)

const stmt = db.prepare(`
  INSERT INTO cotas_cache (produto_id, data, valor, valor_ajustado, fonte)
  VALUES (?, ?, ?, NULL, 'economatica')
  ON CONFLICT(produto_id, data) DO UPDATE SET
    valor         = excluded.valor,
    valor_ajustado = NULL,
    fonte         = 'economatica'
`)

let totalInseridos = 0
let totalNulos     = 0

const importar = db.transaction(() => {
  for (const row of dataRows) {
    const data = excelDateToISO(row[0])
    for (const ticker of tickersImportados) {
      const colIdx = tickerColMap[ticker]
      const preco  = row[colIdx]
      if (preco == null || preco <= 0) { totalNulos++; continue }
      for (const pid of tickerProdutoMap[ticker]) {
        stmt.run(pid, data, preco)
      }
      totalInseridos += tickerProdutoMap[ticker].length
    }
  }
})

importar()

console.log(`\nImportados: ${totalInseridos} registros`)
console.log(`Pulados (sem preço): ${totalNulos} células nulas`)

// Verificação rápida: amostra de 3 tickers
const amostras = tickersImportados.slice(0, 3)
for (const t of amostras) {
  const pids = tickerProdutoMap[t]
  const cnt = db.prepare(`SELECT count(*) as n FROM cotas_cache WHERE produto_id IN (${pids.map(()=>'?').join(',')}) AND fonte = 'economatica'`).get(...pids)
  console.log(`  ${t} (${pids.length} produtos): ${cnt.n} entradas economatica`)
}
