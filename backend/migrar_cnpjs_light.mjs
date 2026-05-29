// Migra produtos das carteiras Alfa Light (1,3,5) de volta para os CNPJs originais
// e copia cotas dos proxies para os novos produto_ids.
import Database from 'better-sqlite3'
import { readFileSync } from 'fs'

const db = new Database('./data/carteiras.db')
const raw = JSON.parse(readFileSync('./alfa_light_hist.json', 'utf8'))

// Mapeamento cnpj_original → cnpj_proxy (como estava antes)
const PROXY = {
  '26.705.938/0001-65': '45.823.918/0001-79',
  '26.708.431/0001-10': '45.823.918/0001-79',
  '32.604.675/0001-16': '34.475.424/0001-24',
  '36.255.217/0001-50': '47.033.348/0001-49',
  '31.638.229/0001-02': '55.630.600/0001-25',
  '41.287.689/0001-00': '24.572.219/0001-23',
  '28.212.946/0001-44': '36.017.731/0001-97',
  '47.083.245/0001-01': '47.033.461/0001-24',
  '54.170.559/0001-90': '40.212.817/0001-48',
  '13.290.882/0001-43': '16.575.255/0001-12',
  '36.639.004/0001-55': '26.803.233/0001-16',
  '44.974.587/0001-22': 'XFIX11',
  '47.332.898/0001-40': 'HYBR11',
}

const TICKERS = new Set(['XFIX11','HYBR11','GICP11','LTBX11','PIBB11'])

// Passo 1: restaurar identificadores originais por produto_id
// Para cada estado das carteiras A, restaurar o identificador do JSON
let restored = 0
db.transaction(() => {
  for (const periodo of raw.periodos) {
    const mes = periodo.data.slice(0, 7)
    for (const [perfilKey, perfil] of Object.entries(periodo.perfis)) {
      const carteiraMap = { conservadora: 1, moderada: 3, sofisticada: 5 }
      const carteiraId = carteiraMap[perfilKey]
      if (!carteiraId) continue

      const estado = db.prepare(
        'SELECT id FROM estados_portfolio WHERE carteira_id=? AND mes=? ORDER BY data_inicio DESC LIMIT 1'
      ).get(carteiraId, mes)
      if (!estado) continue

      for (const [classeKey, prods] of Object.entries(perfil.produtos)) {
        for (const prod of prods) {
          if (!prod.cnpj) continue
          // Tipo correto: ticker → acao, resto → fundo
          const tipo = TICKERS.has(prod.nome) ? 'acao' : 'fundo'
          const ident = TICKERS.has(prod.nome) ? prod.nome : prod.cnpj

          // Encontrar o produto neste estado com o nome correspondente
          const dbProd = db.prepare(
            'SELECT id FROM produtos WHERE estado_id=? AND nome=? LIMIT 1'
          ).get(estado.id, prod.nome)
          if (!dbProd) continue

          db.prepare('UPDATE produtos SET identificador=?, tipo=? WHERE id=?')
            .run(ident, tipo, dbProd.id)
          restored++
        }
      }
    }
  }
})()
console.log('Identificadores restaurados:', restored, 'produtos')

// Passo 2: para cada CNPJ que tem proxy, copiar cotas do proxy para o novo produto_id
const stmtInsCotas = db.prepare(`
  INSERT OR IGNORE INTO cotas_cache (produto_id, data, valor, valor_ajustado, fonte)
  VALUES (?, ?, ?, ?, ?)
`)

let totalCotas = 0
const jaCopiadoParaCnpj = new Set()

db.transaction(() => {
  for (const [cnpjNovo, cnpjProxy] of Object.entries(PROXY)) {
    if (jaCopiadoParaCnpj.has(cnpjNovo)) continue
    jaCopiadoParaCnpj.add(cnpjNovo)

    // Produto_id representativo para o novo CNPJ (MIN id nas carteiras A)
    const prodNovo = db.prepare(`
      SELECT MIN(p.id) as id FROM produtos p
      JOIN estados_portfolio ep ON ep.id=p.estado_id
      WHERE ep.carteira_id IN (1,3,5) AND p.identificador=?
    `).get(cnpjNovo)
    if (!prodNovo?.id) continue

    // Cotas do proxy
    const isProxy = cnpjProxy === 'XFIX11' || cnpjProxy === 'HYBR11'
    const cotasProxy = isProxy
      ? db.prepare(`
          SELECT cc.data, cc.valor, cc.valor_ajustado, cc.fonte
          FROM cotas_cache cc JOIN produtos p ON cc.produto_id=p.id
          WHERE p.identificador=? AND p.tipo='acao'
          GROUP BY cc.data HAVING MAX(cc.valor)
        `).all(cnpjProxy)
      : db.prepare(`
          SELECT cc.data, MAX(cc.valor) as valor, cc.valor_ajustado, cc.fonte
          FROM cotas_cache cc JOIN produtos p ON cc.produto_id=p.id
          WHERE p.identificador=? AND p.tipo='fundo'
          GROUP BY cc.data
        `).all(cnpjProxy)

    for (const c of cotasProxy) {
      stmtInsCotas.run(prodNovo.id, c.data, c.valor, c.valor_ajustado ?? null, 'proxy_' + cnpjProxy.slice(0, 14))
    }
    totalCotas += cotasProxy.length
    console.log(cnpjNovo.padEnd(22), '← proxy', cnpjProxy.substring(0, 22).padEnd(22), cotasProxy.length, 'cotas copiadas → produto_id', prodNovo.id)
  }
})()
console.log('\nTotal cotas copiadas:', totalCotas)

// Passo 3: verificar resultado
console.log('\n=== VERIFICAÇÃO ===')
const prods = db.prepare(`
  SELECT DISTINCT p.identificador, p.tipo, COUNT(*) as n_prods
  FROM produtos p JOIN estados_portfolio ep ON ep.id=p.estado_id
  WHERE ep.carteira_id IN (1,3,5) AND p.tipo IN ('fundo','acao')
  GROUP BY p.identificador, p.tipo
  ORDER BY p.identificador
`).all()

for (const p of prods) {
  const cotas = db.prepare(`
    SELECT COUNT(*) as n, MIN(cc.data) as mn, MAX(cc.data) as mx
    FROM cotas_cache cc JOIN produtos p2 ON cc.produto_id=p2.id
    WHERE p2.identificador=? AND p2.tipo=?
  `).get(p.identificador, p.tipo)
  const status = cotas.n > 0 ? '✓ ' + cotas.n + ' (' + cotas.mn?.slice(0,7) + '→' + cotas.mx?.slice(0,7) + ')' : '✗ SEM COTAS'
  console.log(p.tipo.padEnd(7), p.identificador.padEnd(24), status)
}
