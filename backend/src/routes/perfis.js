import { Router } from 'express'
import { getDb } from '../db/database.js'

const router = Router()

router.get('/', (req, res) => {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM perfis ORDER BY ordem').all()
  res.json(rows)
})

router.put('/:id', (req, res) => {
  const db = getDb()
  const { nome } = req.body
  db.prepare('UPDATE perfis SET nome = ? WHERE id = ?').run(nome, req.params.id)
  res.json({ ok: true })
})

router.post('/', (req, res) => {
  const db = getDb()
  const { nome } = req.body
  if (!nome?.trim()) return res.status(400).json({ error: 'Nome obrigatório' })
  const maxOrdem = db.prepare('SELECT MAX(ordem) as m FROM perfis').get().m || 0
  const result = db.prepare(
    `INSERT INTO perfis (nome, ordem, created_at) VALUES (?, ?, datetime('now'))`
  ).run(nome.trim(), maxOrdem + 1)
  res.json({ id: result.lastInsertRowid, nome: nome.trim(), ordem: maxOrdem + 1 })
})

router.delete('/:id', (req, res) => {
  const db = getDb()
  const id = Number(req.params.id)
  const carteiras = db.prepare('SELECT COUNT(*) as n FROM carteiras WHERE perfil_id = ?').get(id)
  if (carteiras.n > 0) return res.status(400).json({ error: 'Remova as carteiras deste perfil antes de excluí-lo' })
  db.prepare('DELETE FROM alocacoes_macro WHERE perfil_id = ?').run(id)
  db.prepare('DELETE FROM perfis WHERE id = ?').run(id)
  res.json({ ok: true })
})

export default router
