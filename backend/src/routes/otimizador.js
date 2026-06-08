import { Router } from 'express'
import { getDb } from '../db/database.js'
import { otimizarMacroLivre, otimizarAtivosLivre } from '../services/calculator.js'
import { fetchHistoricoBrapi } from '../services/external.js'

const router = Router()

const _syncInProgress = new Set()

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
function isValidDate(s) {
  return typeof s === 'string' && DATE_RE.test(s) && !isNaN(Date.parse(s))
}

// POST /api/otimizador/macro
router.post('/macro', (req, res) => {
  try {
    const { start, end, n_simulacoes, min_peso, max_peso, classes } = req.body
    if (start && !isValidDate(start)) return res.status(400).json({ error: 'start deve ser YYYY-MM-DD' })
    if (end && !isValidDate(end)) return res.status(400).json({ error: 'end deve ser YYYY-MM-DD' })
    const minP = min_peso ?? 0
    const maxP = max_peso ?? 100
    if (minP < 0 || minP > 100) return res.status(400).json({ error: 'min_peso deve estar entre 0 e 100' })
    if (maxP < 0 || maxP > 100) return res.status(400).json({ error: 'max_peso deve estar entre 0 e 100' })
    if (minP > maxP) return res.status(400).json({ error: `min_peso (${minP}%) não pode ser maior que max_peso (${maxP}%)` })
    const classesParam = Array.isArray(classes) && classes.length > 0 ? classes : null
    const data = otimizarMacroLivre(start || null, end || null, n_simulacoes ?? 5000, minP / 100, maxP / 100, classesParam)
    if (!data) return res.json(null)
    res.json(data)
  } catch (e) {
    console.error('[otimizador/macro]', e)
    res.status(500).json({ error: e.message })
  }
})

// POST /api/otimizador/ativos
router.post('/ativos', async (req, res) => {
  try {
    const { classe, ativos, n_simulacoes, start, end, min_peso, max_peso } = req.body
    if (!classe) return res.status(400).json({ error: 'classe obrigatória' })
    if (!ativos || ativos.length < 2) return res.status(400).json({ error: 'Informe ao menos 2 ativos' })
    if (start && !isValidDate(start)) return res.status(400).json({ error: 'start deve ser YYYY-MM-DD' })
    if (end && !isValidDate(end)) return res.status(400).json({ error: 'end deve ser YYYY-MM-DD' })
    const minP = min_peso ?? 0
    const maxP = max_peso ?? 100
    if (minP < 0 || minP > 100) return res.status(400).json({ error: 'min_peso deve estar entre 0 e 100' })
    if (maxP < 0 || maxP > 100) return res.status(400).json({ error: 'max_peso deve estar entre 0 e 100' })
    if (minP > maxP) return res.status(400).json({ error: `min_peso (${minP}%) não pode ser maior que max_peso (${maxP}%)` })

    const db = getDb()
    const hoje = new Date().toISOString().split('T')[0]
    const doisAnosAtras = new Date(Date.now() - 2 * 365 * 24 * 3600000).toISOString().split('T')[0]
    const dataInicio = start || doisAnosAtras

    // Usa o estado mais recente de qualquer carteira como âncora para inserção de produtos temporários
    const estadoRef = db.prepare(
      `SELECT id FROM estados_portfolio ORDER BY mes DESC, data_inicio DESC LIMIT 1`
    ).get()

    const ativosSemDados = ativos
      .filter((a) => a.tipo === 'acao' && a.identificador && !_syncInProgress.has(a.identificador))
      .filter((a) => {
        const { n } = db.prepare(
          `SELECT COUNT(*) as n FROM cotas_cache cc JOIN produtos p ON cc.produto_id = p.id WHERE p.identificador = ?`
        ).get(a.identificador)
        return n === 0
      })

    const syncErros = {}

    if (ativosSemDados.length > 0 && estadoRef) {
      await Promise.allSettled(ativosSemDados.map(async (ativo) => {
        _syncInProgress.add(ativo.identificador)
        let produtoId = null
        try {
          produtoId = db.prepare(
            `INSERT INTO produtos (estado_id, nome, identificador, tipo, classe, peso) VALUES (?, ?, ?, ?, ?, 0)`
          ).run(estadoRef.id, ativo.nome || ativo.identificador, ativo.identificador, ativo.tipo, classe).lastInsertRowid
          const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 25s')), 25000))
          const { rows, insertMany } = await Promise.race([fetchHistoricoBrapi(ativo.identificador, dataInicio, hoje), timeout])
          insertMany(produtoId, rows)
          if (rows.length === 0) syncErros[ativo.identificador] = 'nenhuma cota retornada pelas fontes de dados'
        } catch (e) {
          if (produtoId) db.prepare('DELETE FROM produtos WHERE id = ?').run(produtoId)
          syncErros[ativo.identificador] = e.message
          console.warn(`[otimizador/ativos] sync ${ativo.identificador}: ${e.message}`)
        } finally {
          _syncInProgress.delete(ativo.identificador)
        }
      }))
    }

    const restricoes = {}
    if (req.body.target_duration != null) restricoes.target_duration = Number(req.body.target_duration)
    if (req.body.duration_tolerancia != null) restricoes.duration_tolerancia = Number(req.body.duration_tolerancia)
    if (req.body.max_portfolio_min != null) restricoes.max_portfolio_min = Number(req.body.max_portfolio_min)

    const data = otimizarAtivosLivre(
      classe, ativos,
      start || null, end || null, n_simulacoes ?? 5000, minP / 100, maxP / 100, restricoes
    )
    if (data?.ativos && Object.keys(syncErros).length > 0) {
      data.ativos = data.ativos.map((a) =>
        syncErros[a.identificador] ? { ...a, sync_erro: syncErros[a.identificador] } : a
      )
    }
    res.json(data)
  } catch (e) {
    console.error('[otimizador/ativos]', e)
    res.status(500).json({ error: e.message })
  }
})

export default router
