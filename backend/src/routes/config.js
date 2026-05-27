import { Router } from 'express'
import { getDb } from '../db/database.js'

const router = Router()

// GET /api/config
router.get('/', (req, res) => {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM configuracoes').all()
  const config = Object.fromEntries(rows.map((r) => [r.chave, r.valor]))
  res.json(config)
})

// PUT /api/config
router.put('/', (req, res) => {
  const db = getDb()
  const stmt = db.prepare(
    `INSERT INTO configuracoes (chave, valor) VALUES (?, ?)
     ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, updated_at = datetime('now')`
  )
  db.transaction(() => {
    for (const [k, v] of Object.entries(req.body)) {
      stmt.run(k, v)
    }
  })()
  res.json({ ok: true })
})

// GET /api/config/exportar
router.get('/exportar', (req, res) => {
  const db = getDb()
  const exportData = {
    versao: '1.0.0',
    exportado_em: new Date().toISOString(),
    perfis: db.prepare('SELECT * FROM perfis').all(),
    carteiras: db.prepare('SELECT * FROM carteiras').all(),
    alocacoes_macro: db.prepare('SELECT * FROM alocacoes_macro').all(),
    estados_portfolio: db.prepare('SELECT * FROM estados_portfolio').all(),
    produtos: db.prepare('SELECT * FROM produtos').all(),
    cotas_cache: db.prepare('SELECT * FROM cotas_cache').all(),
    dados_macro: db.prepare('SELECT * FROM dados_macro').all(),
    retornos_mensais: db.prepare('SELECT * FROM retornos_mensais').all(),
    alertas_auditoria: db.prepare('SELECT * FROM alertas_auditoria').all(),
    log_captacao: db.prepare('SELECT * FROM log_captacao ORDER BY timestamp DESC LIMIT 1000').all(),
    configuracoes: db.prepare('SELECT * FROM configuracoes').all(),
  }
  res.json(exportData)
})

// POST /api/config/importar
router.post('/importar', (req, res) => {
  const db = getDb()
  const { data, modo } = req.body

  if (!data || !modo) {
    return res.status(400).json({ error: 'Dados e modo são obrigatórios' })
  }

  if (!['substituir', 'merge'].includes(modo)) {
    return res.status(400).json({ error: 'Modo deve ser "substituir" ou "merge"' })
  }

  try {
    db.transaction(() => {
      if (modo === 'substituir') {
        // Limpar tabelas (exceto perfis e carteiras base)
        db.prepare('DELETE FROM alertas_auditoria').run()
        db.prepare('DELETE FROM log_captacao').run()
        db.prepare('DELETE FROM retornos_mensais').run()
        db.prepare('DELETE FROM cotas_cache').run()
        db.prepare('DELETE FROM dados_macro').run()
        db.prepare('DELETE FROM produtos').run()
        db.prepare('DELETE FROM estados_portfolio').run()
        db.prepare('DELETE FROM alocacoes_macro').run()
        db.prepare('DELETE FROM carteiras').run()
        db.prepare('DELETE FROM perfis').run()
        db.prepare('DELETE FROM configuracoes').run()
      }

      // Inserir perfis
      for (const p of data.perfis ?? []) {
        db.prepare(`
          INSERT OR REPLACE INTO perfis (id, nome, ordem, created_at)
          VALUES (?, ?, ?, ?)
        `).run(p.id, p.nome, p.ordem, p.created_at)
      }

      // Inserir carteiras
      for (const c of data.carteiras ?? []) {
        db.prepare(`
          INSERT OR REPLACE INTO carteiras (id, perfil_id, tipo, nome, descricao, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(c.id, c.perfil_id, c.tipo, c.nome, c.descricao, c.created_at)
      }

      // Inserir alocações (compatível com schema antigo e novo)
      for (const a of data.alocacoes_macro ?? []) {
        db.prepare(`
          INSERT OR REPLACE INTO alocacoes_macro
            (id, perfil_id, mes, pos_fixado, inflacao, prefixado, rf_global,
             multimercado, rv_brasil, rv_global, fundos_listados, alternativos,
             created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          a.id, a.perfil_id, a.mes,
          a.pos_fixado ?? a.rf_pos ?? 0,
          a.inflacao ?? a.rf_ipca ?? 0,
          a.prefixado ?? a.rf_pre ?? 0,
          a.rf_global ?? 0,
          a.multimercado ?? 0,
          a.rv_brasil ?? a.renda_variavel ?? 0,
          a.rv_global ?? 0,
          a.fundos_listados ?? 0,
          a.alternativos ?? a.outros ?? 0,
          a.created_at, a.updated_at,
        )
      }

      // Inserir estados
      for (const e of data.estados_portfolio ?? []) {
        db.prepare(`
          INSERT OR REPLACE INTO estados_portfolio (id, carteira_id, mes, data_inicio, data_fim, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(e.id, e.carteira_id, e.mes, e.data_inicio, e.data_fim, e.created_at)
      }

      // Inserir produtos
      for (const p of data.produtos ?? []) {
        db.prepare(`
          INSERT OR REPLACE INTO produtos
            (id, estado_id, tipo, classe, nome, identificador, peso, indexador, tipo_cdi, taxa, data_emissao, data_vencimento, isento_ir, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(p.id, p.estado_id, p.tipo, p.classe, p.nome, p.identificador, p.peso, p.indexador, p.tipo_cdi, p.taxa, p.data_emissao, p.data_vencimento, p.isento_ir ?? 0, p.created_at)
      }

      // Inserir cotas (merge ignora duplicatas)
      for (const c of data.cotas_cache ?? []) {
        db.prepare(`
          INSERT OR IGNORE INTO cotas_cache (produto_id, data, valor, valor_ajustado, fonte, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(c.produto_id, c.data, c.valor, c.valor_ajustado, c.fonte, c.created_at)
      }

      // Inserir dados macro
      for (const d of data.dados_macro ?? []) {
        db.prepare(`
          INSERT OR IGNORE INTO dados_macro (serie, data, valor, fonte, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(d.serie, d.data, d.valor, d.fonte, d.created_at)
      }

      // Configurações
      for (const c of data.configuracoes ?? []) {
        db.prepare(`
          INSERT OR REPLACE INTO configuracoes (chave, valor, updated_at)
          VALUES (?, ?, ?)
        `).run(c.chave, c.valor, c.updated_at)
      }
    })()

    res.json({ ok: true, modo })
  } catch (e) {
    console.error('[importar]', e)
    res.status(500).json({ error: e.message })
  }
})

export default router
