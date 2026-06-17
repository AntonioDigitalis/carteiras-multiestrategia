/**
 * Importa as colunas de ÍNDICE da planilha Economatica para dados_macro como
 * séries diárias (*_DIARIO). São níveis (index points / preço), prontos para
 * retorno por janela: ret = nível_fim / nível_início - 1.
 *
 * Diferente de import_economatica.mjs, estas colunas NÃO têm produto
 * correspondente — por isso são ignoradas lá e vão direto para dados_macro.
 *
 * Fonte 'economatica' = primária e imutável (extensão diária via Yahoo nunca
 * sobrescreve, ver garantirIndicesDiarios em external.js).
 *
 * Uso: node backend/import_indices_diario.mjs  (a partir da raiz do projeto)
 */
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createRequire } from 'module'
import Database from './node_modules/better-sqlite3/lib/database.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const XLSX = require('./node_modules/xlsx/xlsx.js')

const DB_PATH   = resolve(__dirname, 'data/carteiras.db')
const XLSX_PATH = resolve(__dirname, '../economatica_template.xlsx')

// Coluna na planilha → série em dados_macro
const COL_SERIE = {
  'IBOV':   'IBOV_DIARIO',
  'IMA-B':  'IMAB_DIARIO',
  'IRF-M':  'IRFM_DIARIO',
  'IFIX':   'IFIX_DIARIO',
  'IHFA':   'IHFA_DIARIO',
  'DEBB11': 'DEBB11_DIARIO',
}

function excelDateToISO(serial) {
  return new Date((serial - 25569) * 86400 * 1000).toISOString().split('T')[0]
}

const db  = new Database(DB_PATH)
const wb  = XLSX.read(readFileSync(XLSX_PATH), { type: 'buffer' })
const ws  = wb.Sheets['Preços']
if (!ws) throw new Error('Aba "Preços" não encontrada')

const rows    = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })
const headers = rows[0]
const dataRows = rows.slice(1).filter((r) => r[0] != null)

const colIdx = {}
for (const [col, serie] of Object.entries(COL_SERIE)) {
  const i = headers.indexOf(col)
  if (i < 0) { console.warn(`Coluna "${col}" não encontrada — ignorada`); continue }
  colIdx[serie] = i
}

const stmt = db.prepare(`
  INSERT INTO dados_macro (serie, data, valor, fonte)
  VALUES (?, ?, ?, 'economatica')
  ON CONFLICT(serie, data) DO UPDATE SET valor = excluded.valor, fonte = 'economatica'
`)

const contagem = {}
const importar = db.transaction(() => {
  for (const row of dataRows) {
    const data = excelDateToISO(row[0])
    for (const [serie, i] of Object.entries(colIdx)) {
      const v = row[i]
      if (v == null || v <= 0) continue
      stmt.run(serie, data, v)
      contagem[serie] = (contagem[serie] || 0) + 1
    }
  }
})

importar()

console.log(`Arquivo: ${XLSX_PATH}`)
for (const [serie, n] of Object.entries(contagem)) {
  const r = db.prepare(`SELECT MIN(data) min, MAX(data) max FROM dados_macro WHERE serie=?`).get(serie)
  console.log(`  ${serie.padEnd(15)} ${String(n).padStart(5)} dias  ${r.min} → ${r.max}`)
}
db.close()
