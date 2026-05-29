import Database from 'better-sqlite3'

// Importar as funções internas do external.js via dynamic import
const { fetchHistoricoB3Cotahist, fetchHistoricoBrapi } = await import('./src/services/external.js')

const db = new Database('./data/carteiras.db')

const stmtIns = db.prepare(`
  INSERT OR IGNORE INTO cotas_cache (produto_id, data, valor, valor_ajustado, fonte)
  VALUES (?, ?, ?, ?, ?)
`)

async function inserirCotas(ticker, rows) {
  const prod = db.prepare(`
    SELECT MIN(p.id) as id FROM produtos p
    JOIN estados_portfolio ep ON ep.id=p.estado_id
    WHERE p.identificador=? AND p.tipo='acao'
  `).get(ticker)
  if (!prod?.id) { console.log(ticker + ': sem produto_id'); return 0 }

  let inseridos = 0
  db.transaction(() => {
    for (const r of rows) {
      const data = r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date).split('T')[0]
      const valor = r.close ?? r.adjustedClose
      const adj   = r.adjustedClose ?? r.close
      if (!data || !valor) continue
      const res = stmtIns.run(prod.id, data, valor, adj, r.fonte || 'B3_COTAHIST')
      inseridos += res.changes
    }
  })()
  return inseridos
}

// ── Grupo 1: Top Dividendos — gaps pré-2021 (anos 2019-2020)
const topDivAntes2021 = [
  { ticker: 'BBAS3', de: '2020-02-01', ate: '2021-04-30' },
  { ticker: 'EGIE3', de: '2019-09-01', ate: '2021-04-30' },
  { ticker: 'ISAE4', de: '2019-10-01', ate: '2021-04-30' },
  { ticker: 'ITUB4', de: '2019-07-01', ate: '2021-04-30' },
  { ticker: 'TAEE11',de: '2019-07-01', ate: '2021-04-30' },
  { ticker: 'VBBR3', de: '2019-07-01', ate: '2021-04-30' },
]

// ── Grupo 2: Top Ações — gaps início 2025
const topAcoesGaps = [
  { ticker: 'BRFS3', de: '2025-03-01', ate: '2025-04-30' },
  { ticker: 'JBSS3', de: '2025-02-01', ate: '2025-02-28' },
  { ticker: 'NATU3', de: '2025-02-01', ate: '2025-05-31' },
]

// ── Grupo 3: Alfa B — BSHV39 (BDR de ETF americano)
const alfaBGaps = [
  { ticker: 'BSHV39', de: '2025-03-01', ate: '2026-03-31' },
]

const todos = [...topDivAntes2021, ...topAcoesGaps, ...alfaBGaps]

console.log(`\nBuscando dados B3/COTAHIST para ${todos.length} gaps...\n`)

for (const { ticker, de, ate } of todos) {
  process.stdout.write(`${ticker.padEnd(8)} ${de.slice(0,7)}→${ate.slice(0,7)}  `)
  try {
    const rows = await fetchHistoricoB3Cotahist(ticker, de, ate)
    if (rows.length === 0) {
      // Tentar também B3 daily bulletin
      const { fetchHistoricoB3 } = await import('./src/services/external.js').catch(() => ({}))
      process.stdout.write('COTAHIST vazio, tentando B3 diário...')
    }
    const n = await inserirCotas(ticker, rows)
    const cot = db.prepare(`SELECT MIN(cc.data) as mn, MAX(cc.data) as mx, COUNT(*) as total FROM cotas_cache cc JOIN produtos p ON cc.produto_id=p.id WHERE p.identificador=? AND p.tipo='acao'`).get(ticker)
    console.log(`${rows.length} registros → ${n} inseridos | DB total: ${cot.total} (${cot.mn?.slice(0,7)}→${cot.mx?.slice(0,7)})`)
  } catch(e) {
    console.log(`ERRO: ${e.message.slice(0,80)}`)
  }
}

console.log('\nConcluído.')
