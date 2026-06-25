import { getDb } from '../db/database.js'
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'fs'
import { createInterface } from 'readline'
import { downloadToFile, registrarLog } from './external.js'

// Feeds disponíveis. As URLs ficam em `configuracoes` (chave abaixo) e são
// tratadas como sensíveis em routes/config.js (são tokens de acesso).
// `fundos` fica para a Fase 2 (precisa de ponte nome↔CNPJ + URL corrigida).
const FEEDS = [
  { feed: 'acoes',     chave: 'economatica_url_acoes',     tipo: 'ativos' },
  { feed: 'fiis',      chave: 'economatica_url_fiis',      tipo: 'ativos' },
  { feed: 'etfs',      chave: 'economatica_url_etfs',      tipo: 'ativos' },
  { feed: 'indices',   chave: 'economatica_url_indices',   tipo: 'indices' },
  { feed: 'papeis_rf', chave: 'economatica_url_papeis_rf', tipo: 'papeis_rf' },
]

// Nome do índice no feed (após strip do sufixo) → série em dados_macro.
// Mesmas séries que import_indices_diario.mjs consome. CDI/IPCA/DOL ficam de
// fora: têm semântica diferente do CDI/IPCA do BCB já usados pelo app.
const INDICE_SERIE = {
  'IBOV':  'IBOV_DIARIO',
  'IMA-B': 'IMAB_DIARIO',
  'IRF-M': 'IRFM_DIARIO',
  'IFIX':  'IFIX_DIARIO',
  'IHFA':  'IHFA_DIARIO',
}

const CACHE_DIR = '/tmp/economatica-cache'
const BATCH = 50000

// Os feeds trazem histórico completo (IBOV desde 1967, papeis_rf desde 1990). O
// app só usa de 2019 em diante — ignoramos datas anteriores para não inchar o banco.
const DATA_MINIMA = '2019-01-01'

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true })
}

// Cada linha: "ATIVO<FONTE>","YYYY-MM-DD",valor   (valor pode ser "-" ou notação científica)
function parseLinha(line) {
  const m = line.match(/^"([^"]*)","([^"]*)",(.*)$/)
  if (!m) return null
  const ativo = m[1]
  const data = m[2]
  let raw = m[3].trim()
  if (raw.startsWith('"')) raw = raw.slice(1, -1)  // valor entre aspas (ex.: "-")
  if (raw === '-' || raw === '') return { ativo, data, valor: null }
  return { ativo, data, valor: parseFloat(raw) }
}

const stripSufixo = (ativo) => ativo.split('<')[0].trim()

// Baixa o feed para arquivo temporário, seguindo o redirect 302 → S3 (presigned
// de vida curta) imediatamente. Retenta porque a URL assinada pode expirar.
async function baixarFeed(url, destPath, feed) {
  let ultimoErro = null
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      await downloadToFile(url, destPath)
      // S3 devolve XML de erro com status 200/403 → detecta pelo início do arquivo
      const head = readFileSync(destPath, { encoding: 'utf8', flag: 'r' }).slice(0, 64)
      if (head.startsWith('<')) throw new Error('resposta inválida (presigned expirou?)')
      if (statSync(destPath).size < 64) throw new Error('arquivo vazio')
      return
    } catch (e) {
      ultimoErro = e
      try { rmSync(destPath, { force: true }) } catch (_) {}
      if (tentativa < 3) await new Promise((r) => setTimeout(r, 500))
    }
  }
  throw new Error(`download falhou após 3 tentativas: ${ultimoErro?.message}`)
}

// Lê o arquivo por streaming e descarrega em lotes (memória limitada mesmo no
// feed de 115 MB). `onRow(parsed)` devolve 0+ linhas a inserir; `flush(rows)` é
// uma transação better-sqlite3.
function processarArquivo(filePath, onRow, flush) {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity })
    let batch = []
    let total = 0
    let header = true
    rl.on('line', (line) => {
      if (header) { header = false; return }  // pula cabeçalho
      const p = parseLinha(line)
      if (!p || p.valor == null || p.data < DATA_MINIMA) return
      const rows = onRow(p)
      if (rows && rows.length) {
        for (const r of rows) batch.push(r)
        if (batch.length >= BATCH) { flush(batch); total += batch.length; batch = [] }
      }
    })
    rl.on('close', () => {
      if (batch.length) { flush(batch); total += batch.length }
      resolve(total)
    })
    rl.on('error', reject)
  })
}

// Ativos (acoes/fiis/etfs) → cotas_cache, fonte economatica e imutável.
async function importarAtivos(db, filePath) {
  // ticker (identificador) → todos os produto_ids
  const tickerProdutos = new Map()
  for (const p of db.prepare(`SELECT identificador, id FROM produtos WHERE identificador IS NOT NULL`).all()) {
    const k = p.identificador
    if (!tickerProdutos.has(k)) tickerProdutos.set(k, [])
    tickerProdutos.get(k).push(p.id)
  }

  // Mesmo upsert imutável de import_economatica.mjs: economatica sobrescreve a si
  // mesma; valor_ajustado=NULL evita double-counting de proventos.
  const stmt = db.prepare(`
    INSERT INTO cotas_cache (produto_id, data, valor, valor_ajustado, fonte)
    VALUES (?, ?, ?, NULL, 'economatica')
    ON CONFLICT(produto_id, data) DO UPDATE SET
      valor          = excluded.valor,
      valor_ajustado = NULL,
      fonte          = 'economatica'
  `)
  const flush = db.transaction((rows) => { for (const r of rows) stmt.run(r.pid, r.data, r.valor) })

  return processarArquivo(filePath, (p) => {
    if (p.valor <= 0) return null
    const ticker = stripSufixo(p.ativo)
    const pids = tickerProdutos.get(ticker)
    if (!pids) return null
    return pids.map((pid) => ({ pid, data: p.data, valor: p.valor }))
  }, flush)
}

// Índices → dados_macro séries *_DIARIO (níveis), fonte economatica imutável.
async function importarIndices(db, filePath) {
  const stmt = db.prepare(`
    INSERT INTO dados_macro (serie, data, valor, fonte)
    VALUES (?, ?, ?, 'economatica')
    ON CONFLICT(serie, data) DO UPDATE SET valor = excluded.valor, fonte = 'economatica'
  `)
  const flush = db.transaction((rows) => { for (const r of rows) stmt.run(r.serie, r.data, r.valor) })

  return processarArquivo(filePath, (p) => {
    if (p.valor <= 0) return null
    const serie = INDICE_SERIE[stripSufixo(p.ativo)]
    if (!serie) return null
    return [{ serie, data: p.data, valor: p.valor }]
  }, flush)
}

// papeis_rf → tabela staging crua (mantém o sufixo no ativo).
async function importarPapeisRF(db, filePath) {
  const stmt = db.prepare(`
    INSERT INTO economatica_papeis_rf (ativo, data, valor)
    VALUES (?, ?, ?)
    ON CONFLICT(ativo, data) DO UPDATE SET valor = excluded.valor
  `)
  const flush = db.transaction((rows) => { for (const r of rows) stmt.run(r.ativo, r.data, r.valor) })

  return processarArquivo(filePath, (p) => {
    if (!isFinite(p.valor)) return null
    return [{ ativo: p.ativo, data: p.data, valor: p.valor }]
  }, flush)
}

export function importarPorTipo(db, tipo, filePath) {
  if (tipo === 'ativos')    return importarAtivos(db, filePath)
  if (tipo === 'indices')   return importarIndices(db, filePath)
  if (tipo === 'papeis_rf') return importarPapeisRF(db, filePath)
  throw new Error(`tipo de feed desconhecido: ${tipo}`)
}

function getUrl(db, chave) {
  const r = db.prepare(`SELECT valor FROM configuracoes WHERE chave = ?`).get(chave)
  return r?.valor?.trim() || null
}

// Já captado com sucesso hoje? Evita rebaixar ~130 MB a cada sync-all.
function captadoHoje(db, feed) {
  return !!db.prepare(
    `SELECT 1 FROM log_captacao
     WHERE fonte = 'economatica' AND ativo = ? AND status = 'ok' AND date(timestamp) = date('now')
     LIMIT 1`
  ).get(feed)
}

export async function sincronizarEconomatica() {
  const db = getDb()
  ensureCacheDir()
  const resultado = {}
  const pulados = []
  const erros = []

  for (const { feed, chave, tipo } of FEEDS) {
    const url = getUrl(db, chave)
    if (!url) continue                    // feed não configurado
    if (captadoHoje(db, feed)) { pulados.push(feed); continue }

    const destPath = `${CACHE_DIR}/${feed}.csv`
    try {
      await baixarFeed(url, destPath, feed)
      const n = await importarPorTipo(db, tipo, destPath)
      resultado[feed] = n
      registrarLog('economatica', feed, n, 'ok', null)
    } catch (e) {
      erros.push(`${feed}: ${e.message}`)
      registrarLog('economatica', feed, null, 'erro', e.message)
      console.warn(`[economatica] falha no feed ${feed}:`, e.message)
    } finally {
      try { rmSync(destPath, { force: true }) } catch (_) {}
    }
  }

  return { resultado, pulados, erros }
}
