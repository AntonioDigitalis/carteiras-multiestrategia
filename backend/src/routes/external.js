import { Router } from 'express'
import { buscarFundoAnbima, validarTicker, fetchCDIDiario, fetchIPCAMensal, fetchCDIAcumuladoMensal, fetchIndicesMercado } from '../services/external.js'
import { getDb } from '../db/database.js'

const router = Router()

// GET /api/external/fundo/:cnpj
router.get('/fundo/:cnpj', async (req, res) => {
  try {
    const cnpj = req.params.cnpj
    const digits = cnpj.replace(/\D/g, '')

    // 1. Busca no banco local — resolve fundos já cadastrados em qualquer carteira
    const db = getDb()
    const local = db.prepare(`
      SELECT nome FROM produtos
      WHERE tipo = 'fundo'
        AND replace(replace(replace(replace(identificador,'.',''),'/',''),'-',''),' ','') = ?
      LIMIT 1
    `).get(digits)
    if (local?.nome) {
      const fmt = `${digits.slice(0,2)}.${digits.slice(2,5)}.${digits.slice(5,8)}/${digits.slice(8,12)}-${digits.slice(12,14)}`
      return res.json({ cnpj: fmt, nome: local.nome, classe: null, source: 'local' })
    }

    // 2. Fallback: cadastral CVM
    const data = await buscarFundoAnbima(cnpj)
    res.json(data)
  } catch (e) {
    res.status(404).json({ error: e.message })
  }
})

// GET /api/external/ticker/:ticker
router.get('/ticker/:ticker', async (req, res) => {
  try {
    const data = await validarTicker(req.params.ticker)
    res.json(data)
  } catch (e) {
    res.status(404).json({ error: e.message })
  }
})

// GET /api/external/cdi
router.get('/cdi', async (req, res) => {
  try {
    const db = getDb()
    const { inicio, fim } = req.query
    const rows = db.prepare(
      `SELECT data, valor FROM dados_macro WHERE serie = 'CDI_DIARIO' AND data >= ? AND data <= ? ORDER BY data`
    ).all(inicio, fim)

    if (rows.length === 0) {
      const dataInicioBR = inicio?.split('-').reverse().join('/')
      const dataFimBR = fim?.split('-').reverse().join('/')
      await fetchCDIDiario(dataInicioBR, dataFimBR)
      const fresh = db.prepare(
        `SELECT data, valor FROM dados_macro WHERE serie = 'CDI_DIARIO' AND data >= ? AND data <= ? ORDER BY data`
      ).all(inicio, fim)
      return res.json(fresh)
    }
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/external/ipca
router.get('/ipca', async (req, res) => {
  try {
    const db = getDb()
    const { inicio, fim } = req.query
    const rows = db.prepare(
      `SELECT data, valor FROM dados_macro WHERE serie = 'IPCA_MENSAL' AND data >= ? AND data <= ? ORDER BY data`
    ).all(inicio + '-01', fim + '-01')

    if (rows.length === 0) {
      const dataInicioBR = inicio?.split('-').reverse().join('/')
      const dataFimBR = fim?.split('-').reverse().join('/')
      await fetchIPCAMensal(dataInicioBR, dataFimBR)
      const fresh = db.prepare(
        `SELECT data, valor FROM dados_macro WHERE serie = 'IPCA_MENSAL' AND data >= ? AND data <= ? ORDER BY data`
      ).all(inicio + '-01', fim + '-01')
      return res.json(fresh)
    }
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/external/indices  { inicio: 'YYYY-MM-DD', fim: 'YYYY-MM-DD' }
router.post('/indices', async (req, res) => {
  try {
    const { inicio, fim } = req.body
    if (!inicio || !fim) return res.status(400).json({ error: 'inicio e fim obrigatórios' })
    const n = await fetchIndicesMercado(inicio, fim)
    res.json({ ok: true, registros: n })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/external/macro  { inicio: 'YYYY-MM-DD', fim: 'YYYY-MM-DD' }
router.post('/macro', async (req, res) => {
  try {
    const { inicio, fim } = req.body
    if (!inicio || !fim) return res.status(400).json({ error: 'inicio e fim obrigatórios' })
    const toBR = (iso) => iso.split('-').reverse().join('/')
    const [nCDI, nCDIMensal, nIPCA] = await Promise.all([
      fetchCDIDiario(toBR(inicio), toBR(fim)),
      fetchCDIAcumuladoMensal(toBR(inicio), toBR(fim)),
      fetchIPCAMensal(toBR(inicio), toBR(fim)),
    ])
    res.json({ ok: true, cdi_diario: nCDI, cdi_mensal: nCDIMensal, ipca: nIPCA })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
