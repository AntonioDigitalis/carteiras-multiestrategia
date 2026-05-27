import { Router } from 'express'
import { getDb } from '../db/database.js'
import { fetchCotaFundo, fetchHistoricoBrapi } from '../services/external.js'

const router = Router()

// GET /api/estados/:estadoId/produtos
router.get('/:estadoId/produtos', (req, res) => {
  const db = getDb()
  const rows = db.prepare(
    'SELECT * FROM produtos WHERE estado_id = ? ORDER BY classe, nome'
  ).all(req.params.estadoId)
  res.json(rows)
})

// POST /api/estados/:estadoId/produtos
router.post('/:estadoId/produtos', (req, res) => {
  const db = getDb()
  const {
    tipo, classe, nome, identificador,
    peso, indexador, tipo_cdi, taxa,
    data_emissao, data_vencimento, isento_ir,
  } = req.body

  if (!['fundo', 'acao', 'rf_curva', 'carteira'].includes(tipo)) {
    return res.status(400).json({ error: 'Tipo inválido' })
  }

  const result = db.prepare(`
    INSERT INTO produtos
      (estado_id, tipo, classe, nome, identificador, peso, indexador, tipo_cdi, taxa, data_emissao, data_vencimento, isento_ir)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.params.estadoId, tipo, classe, nome,
    identificador || null, peso || 0,
    indexador || null, tipo_cdi || null, taxa || null,
    data_emissao || null, data_vencimento || null,
    isento_ir ? 1 : 0,
  )

  const created = db.prepare('SELECT * FROM produtos WHERE id = ?').get(result.lastInsertRowid)
  res.json(created)
})

// PUT /api/produtos/:id
router.put('/:id', async (req, res) => {
  const db = getDb()
  const {
    tipo, classe, nome, identificador,
    peso, indexador, tipo_cdi, taxa,
    data_emissao, data_vencimento, isento_ir,
  } = req.body

  const anterior = db.prepare('SELECT * FROM produtos WHERE id = ?').get(req.params.id)
  const identificadorMudou = anterior && identificador && anterior.identificador !== identificador

  db.prepare(`
    UPDATE produtos SET
      tipo = ?, classe = ?, nome = ?, identificador = ?,
      peso = ?, indexador = ?, tipo_cdi = ?, taxa = ?,
      data_emissao = ?, data_vencimento = ?, isento_ir = ?
    WHERE id = ?
  `).run(
    tipo, classe, nome, identificador || null,
    peso || 0, indexador || null, tipo_cdi || null, taxa || null,
    data_emissao || null, data_vencimento || null,
    isento_ir ? 1 : 0,
    req.params.id,
  )

  const updated = db.prepare('SELECT * FROM produtos WHERE id = ?').get(req.params.id)

  // Se o identificador mudou, descarta cotas antigas e re-sincroniza em background
  if (identificadorMudou && (tipo === 'fundo' || tipo === 'acao')) {
    db.prepare('DELETE FROM cotas_cache WHERE produto_id = ?').run(req.params.id)

    // Sync em background — não bloqueia a resposta
    ;(async () => {
      try {
        const hoje = new Date().toISOString().split('T')[0]
        const maisAntiga = db.prepare(
          `SELECT MIN(ep.data_inicio) as d FROM estados_portfolio ep
           JOIN produtos p ON p.estado_id = ep.id WHERE p.id = ?`
        ).get(req.params.id)
        const cincoAnosAtras = new Date(Date.now() - 5 * 365 * 24 * 3600000).toISOString().split('T')[0]
        const dataInicio = maisAntiga?.d
          ? (maisAntiga.d > cincoAnosAtras ? maisAntiga.d : cincoAnosAtras)
          : new Date(Date.now() - 365 * 24 * 3600000).toISOString().split('T')[0]

        if (tipo === 'fundo') {
          const cotas = await fetchCotaFundo(identificador, dataInicio, hoje)
          const stmt = db.prepare(
            'INSERT OR IGNORE INTO cotas_cache (produto_id, data, valor, fonte) VALUES (?, ?, ?, ?)'
          )
          db.transaction(() => {
            for (const c of cotas) {
              if (c.data && c.valor) stmt.run(req.params.id, c.data, c.valor, 'CVM')
            }
          })()
        } else {
          const { rows, insertMany } = await fetchHistoricoBrapi(identificador, dataInicio, hoje)
          insertMany(req.params.id, rows)
        }
      } catch (e) {
        console.error(`[sync-on-update] produto ${req.params.id}:`, e.message)
      }
    })()
  }

  res.json(updated)
})

// DELETE /api/produtos/:id
router.delete('/:id', (req, res) => {
  const db = getDb()
  db.prepare('DELETE FROM produtos WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

export default router
