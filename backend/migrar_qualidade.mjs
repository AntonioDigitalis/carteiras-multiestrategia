/**
 * Migração: adiciona coluna `qualidade` em cotas_cache e marca spikes internos.
 *
 * Spike isolado: um valor onde TANTO o retorno do dia anterior QUANTO o retorno
 * para o dia seguinte excedem 40%. Isso indica que o valor "vai e vem" — padrão
 * clássico de dado corrompido (ex: escala errada em alguns dias da Economatica).
 *
 * Só analisa registros com fonte = 'economatica'.
 * Uso: node backend/migrar_qualidade.mjs
 */
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import Database from './node_modules/better-sqlite3/lib/database.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const db = new Database(resolve(__dirname, 'data/carteiras.db'))

// 1. Adicionar coluna se ainda não existir
const colunas = db.prepare('PRAGMA table_info(cotas_cache)').all().map(c => c.name)
if (!colunas.includes('qualidade')) {
  db.exec("ALTER TABLE cotas_cache ADD COLUMN qualidade TEXT DEFAULT 'ok'")
  console.log("Coluna 'qualidade' adicionada a cotas_cache.")
} else {
  console.log("Coluna 'qualidade' já existe — pulando ALTER TABLE.")
}

// 2. Buscar todos os produto_ids que têm dados economatica
const pids = db.prepare(
  "SELECT DISTINCT produto_id FROM cotas_cache WHERE fonte = 'economatica' ORDER BY produto_id"
).all().map(r => r.produto_id)

console.log(`\nAnalisando ${pids.length} produto_ids com dados Economatica...`)

const updateStmt = db.prepare("UPDATE cotas_cache SET qualidade = 'spike' WHERE id = ?")

let totalSpikes = 0
let totalAnalisados = 0

// Processa em lotes por produto_id para não carregar tudo na memória
const detectar = db.transaction(() => {
  for (const pid of pids) {
    const records = db.prepare(
      'SELECT id, valor FROM cotas_cache WHERE produto_id = ? AND fonte = \'economatica\' ORDER BY data'
    ).all(pid)

    totalAnalisados += records.length

    // Precisa de pelo menos 3 registros para detectar spike isolado
    for (let i = 1; i < records.length - 1; i++) {
      const prev = records[i - 1].valor
      const curr = records[i].valor
      const next = records[i + 1].valor

      if (prev <= 0 || curr <= 0 || next <= 0) continue

      const retDePrev = Math.abs(curr / prev - 1)
      const retParaNext = Math.abs(next / curr - 1)

      // Spike isolado: sobe/cai >40% E depois volta >40%
      if (retDePrev > 0.40 && retParaNext > 0.40) {
        updateStmt.run(records[i].id)
        totalSpikes++
      }
    }
  }
})

detectar()

console.log(`Registros analisados: ${totalAnalisados.toLocaleString('pt-BR')}`)
console.log(`Spikes isolados marcados: ${totalSpikes.toLocaleString('pt-BR')}`)

// 3. Resumo por ticker (via identificador do produto)
if (totalSpikes > 0) {
  const porTicker = db.prepare(`
    SELECT p.identificador, COUNT(*) as n
    FROM cotas_cache cc
    JOIN produtos p ON p.id = cc.produto_id
    WHERE cc.qualidade = 'spike'
    GROUP BY p.identificador
    ORDER BY n DESC
    LIMIT 15
  `).all()

  console.log('\nTop tickers com spikes:')
  porTicker.forEach(r => console.log(`  ${r.identificador.padEnd(10)} ${r.n}`))
}

// 4. Verificação final
const resumo = db.prepare(`
  SELECT qualidade, COUNT(*) as n
  FROM cotas_cache
  WHERE fonte = 'economatica'
  GROUP BY qualidade
`).all()
console.log('\nDistribuição qualidade (economatica):')
resumo.forEach(r => console.log(`  ${(r.qualidade || 'ok').padEnd(10)} ${r.n.toLocaleString('pt-BR')}`))
