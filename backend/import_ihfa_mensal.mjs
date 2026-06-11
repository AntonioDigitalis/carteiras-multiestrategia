/**
 * Importa IHFA mensal da planilha Economatica para dados_macro.
 * Calcula retorno mensal a partir do índice diário de nível (ex: 3400 → 6288).
 * Uso: node backend/import_ihfa_mensal.mjs
 */
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import Database from './node_modules/better-sqlite3/lib/database.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require   = createRequire(import.meta.url)
const XLSX      = require('./node_modules/xlsx/xlsx.js')

const DB_PATH   = resolve(__dirname, 'data/carteiras.db')
const XLSX_PATH = resolve(__dirname, '../economatica_template.xlsx')

function excelDateToISO(serial) {
  return new Date((serial - 25569) * 86400 * 1000).toISOString().split('T')[0]
}

const db  = new Database(DB_PATH)
const buf = readFileSync(XLSX_PATH)
const wb  = XLSX.read(buf, { type: 'buffer' })

const wsPrecos = wb.Sheets['Preços']
const rows     = XLSX.utils.sheet_to_json(wsPrecos, { header: 1, defval: null })
const headers  = rows[0]
const dataRows = rows.slice(1).filter(r => r[0] != null)

const ihfaCol = headers.indexOf('IHFA')
if (ihfaCol === -1) throw new Error('Coluna IHFA não encontrada na aba Preços')

// Agrupa por mês: mantém o último valor de cada mês (fechamento do mês)
const ultimoPorMes = new Map() // 'YYYY-MM' → { data, valor }
for (const row of dataRows) {
  const iso   = excelDateToISO(row[0])
  const valor = row[ihfaCol]
  if (valor == null || valor <= 0) continue
  const mes = iso.slice(0, 7) // 'YYYY-MM'
  ultimoPorMes.set(mes, { data: iso, valor })
}

// Ordena os meses cronologicamente
const meses = Array.from(ultimoPorMes.keys()).sort()
console.log(`IHFA: ${meses.length} meses de ${meses[0]} a ${meses[meses.length - 1]}`)

// Calcula retorno mensal = (nivel_fim_mes / nivel_fim_mes_anterior - 1) * 100
const stmt = db.prepare(`
  INSERT INTO dados_macro (serie, data, valor, fonte)
  VALUES ('IHFA_MENSAL', ?, ?, 'economatica')
  ON CONFLICT(serie, data) DO UPDATE SET
    valor = excluded.valor,
    fonte = excluded.fonte
`)

// Verifica se existe UNIQUE constraint em dados_macro
const hasUnique = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='dados_macro'").get()
console.log('Schema dados_macro:', hasUnique?.sql?.replace(/\s+/g, ' '))

let inseridos = 0
const inserir = db.transaction(() => {
  for (let i = 1; i < meses.length; i++) {
    const mesAtual = meses[i]
    const mesAnterior = meses[i - 1]
    const vAtual    = ultimoPorMes.get(mesAtual).valor
    const vAnterior = ultimoPorMes.get(mesAnterior).valor
    const retorno   = (vAtual / vAnterior - 1) * 100
    stmt.run(`${mesAtual}-01`, retorno)
    inseridos++
  }
})

inserir()

console.log(`\nInseridos: ${inseridos} registros em IHFA_MENSAL`)

// Verificação
const check = db.prepare("SELECT count(*) as n, min(data) as ini, max(data) as fim FROM dados_macro WHERE serie='IHFA_MENSAL'").get()
console.log(`Verificação: ${check.n} registros, ${check.ini} → ${check.fim}`)

// Amostra
const sample = db.prepare("SELECT data, valor FROM dados_macro WHERE serie='IHFA_MENSAL' ORDER BY data LIMIT 6").all()
console.log('\nPrimeiras entradas:')
sample.forEach(r => console.log(` ${r.data}  ${r.valor.toFixed(4)}%`))
