// Sincroniza cotas CVM para todos os fundos distintos no banco.
// Executa uma vez; seguro re-executar (INSERT OR IGNORE).
import Database from 'better-sqlite3'
import { fetchCotaFundo } from './src/services/external.js'

const db = new Database('/home/antonio/carteiras/backend/data/carteiras.db')

// Um produto_id representativo por CNPJ (o mais antigo), e a data de início mínima
const fundos = db.prepare(`
  SELECT p.identificador, p.nome, p.tipo,
    MIN(p.id) as produto_id,
    MIN(ep.data_inicio) as data_inicio
  FROM produtos p
  JOIN estados_portfolio ep ON ep.id = p.estado_id
  WHERE p.tipo = 'fundo' AND p.identificador != ''
  GROUP BY p.identificador
  ORDER BY p.nome
`).all()

const hoje = new Date().toISOString().split('T')[0]

const stmt = db.prepare(`
  INSERT OR IGNORE INTO cotas_cache (produto_id, data, valor, fonte)
  VALUES (?, ?, ?, 'CVM')
`)

console.log(`Sincronizando ${fundos.length} fundos até ${hoje}...\n`)

let totalCotas = 0
const erros = []

for (const f of fundos) {
  // Começa 30 dias antes do primeiro uso, limitado a 2025-01-01
  const dataInicio = f.data_inicio
    ? new Date(Math.max(new Date(f.data_inicio) - 30 * 86400000, new Date('2025-01-01')))
        .toISOString().split('T')[0]
    : '2025-01-01'

  process.stdout.write(`  ${f.nome.substring(0, 50).padEnd(50)} `)
  try {
    const cotas = await fetchCotaFundo(f.identificador, dataInicio, hoje)
    db.transaction(() => {
      for (const c of cotas) {
        if (c.data && c.valor) stmt.run(f.produto_id, c.data, c.valor)
      }
    })()
    totalCotas += cotas.length
    console.log(`${cotas.length} cotas`)
  } catch (e) {
    console.log(`ERRO: ${e.message}`)
    erros.push(`${f.nome}: ${e.message}`)
  }
}

console.log(`\nTotal cotas inseridas: ${totalCotas}`)
if (erros.length > 0) {
  console.log('\nErros:')
  erros.forEach(e => console.log(' -', e))
}

// Verifica resultado
const resultado = db.prepare(`
  SELECT p.nome, COUNT(cc.id) as n_cotas, MIN(cc.data) as primeiro, MAX(cc.data) as ultimo
  FROM cotas_cache cc
  JOIN produtos p ON cc.produto_id = p.id
  WHERE p.tipo = 'fundo'
  GROUP BY p.identificador
  ORDER BY p.nome
`).all()

console.log('\n=== RESULTADO ===')
for (const r of resultado) {
  const ok = r.n_cotas > 10 ? '✓' : '⚠'
  console.log(`${ok} ${r.nome.substring(0,45).padEnd(45)} ${String(r.n_cotas).padStart(4)} cotas  ${r.primeiro} → ${r.ultimo}`)
}
