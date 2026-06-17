/**
 * Corrige cotas de produto em escala incompatível com a base Economatica.
 *
 * Quando Yahoo/B3/etc. estendeu um produto que tem histórico 'economatica',
 * a nova série pode estar em outra escala (ex.: GICP11 economatica=25,63 em
 * 01/06 e Yahoo=10,81 em 02/06 → "queda" falsa de -58%). Reancora a parte
 * não-economatica posterior à emenda no nível Economatica, preservando só a
 * variação dia-a-dia da nova base. Só atua quando o salto na emenda é > 40%.
 *
 * Uso: node backend/corrigir_escala_cotas.mjs [--dry]
 */
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import Database from './node_modules/better-sqlite3/lib/database.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = resolve(__dirname, 'data/carteiras.db')
const DRY = process.argv.includes('--dry')

const db = new Database(DB_PATH)

// Produtos com histórico economatica
const pids = db.prepare(
  `SELECT DISTINCT produto_id FROM cotas_cache WHERE fonte = 'economatica'`
).all().map((r) => r.produto_id)

const update = db.prepare(
  `UPDATE cotas_cache SET valor = valor * ?, valor_ajustado = CASE WHEN valor_ajustado IS NULL THEN NULL ELSE valor_ajustado * ? END
   WHERE produto_id = ? AND data > ? AND fonte <> 'economatica'`
)

let corrigidos = 0
for (const pid of pids) {
  const econ = db.prepare(
    `SELECT data, valor FROM cotas_cache WHERE produto_id = ? AND fonte = 'economatica' ORDER BY data DESC LIMIT 1`
  ).get(pid)
  if (!econ || !econ.valor) continue

  const ancora = db.prepare(
    `SELECT data, valor, fonte FROM cotas_cache WHERE produto_id = ? AND data > ? AND fonte <> 'economatica' AND valor > 0 ORDER BY data LIMIT 1`
  ).get(pid, econ.data)
  if (!ancora) continue

  const salto = ancora.valor / econ.valor - 1
  if (Math.abs(salto) <= 0.40) continue  // movimento real plausível, não mexe

  const fator = econ.valor / ancora.valor
  const prod = db.prepare(`SELECT identificador FROM produtos WHERE id = ?`).get(pid)
  const n = db.prepare(
    `SELECT COUNT(*) n FROM cotas_cache WHERE produto_id = ? AND data > ? AND fonte <> 'economatica'`
  ).get(pid, econ.data).n

  console.log(`${(prod?.identificador || 'pid' + pid).padEnd(10)} emenda ${econ.data} econ=${econ.valor} → ${ancora.fonte}=${ancora.valor} (${(salto * 100).toFixed(1)}%)  fator=${fator.toFixed(4)}  ${n} cotas`)
  if (!DRY) update.run(fator, fator, pid, econ.data)
  corrigidos++
}

console.log(`\n${DRY ? '[DRY] ' : ''}Produtos corrigidos: ${corrigidos}`)
db.close()
