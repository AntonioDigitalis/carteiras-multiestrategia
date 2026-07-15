import { Router } from 'express'
import { getDb } from '../db/database.js'

const router = Router()

// Chaves sensíveis que nunca devem ser expostas em texto plano via API
// (as URLs Economatica carregam um token de acesso na própria URL)
const SENSITIVE_CONFIG_KEYS = new Set([
  'anbima_client_id', 'anbima_client_secret',
  'economatica_url_acoes', 'economatica_url_fiis', 'economatica_url_etfs',
  'economatica_url_indices', 'economatica_url_papeis_rf', 'economatica_url_fundos',
  'economatica_api_key', 'economatica_api_secret', 'economatica_customer_id',
])

// GET /api/config
router.get('/', (req, res) => {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM configuracoes').all()
  const config = Object.fromEntries(
    rows.map((r) => [r.chave, SENSITIVE_CONFIG_KEYS.has(r.chave) ? (r.valor ? '***' : null) : r.valor])
  )
  res.json(config)
})

// PUT /api/config
router.put('/', (req, res) => {
  const db = getDb()
  for (const [k, v] of Object.entries(req.body)) {
    if (v !== null && typeof v !== 'string') {
      return res.status(400).json({ error: `Valor de '${k}' deve ser texto` })
    }
  }
  const stmt = db.prepare(
    `INSERT INTO configuracoes (chave, valor) VALUES (?, ?)
     ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, updated_at = datetime('now')`
  )
  db.transaction(() => {
    for (const [k, v] of Object.entries(req.body)) {
      // '***' é o placeholder mascarado devolvido pelo GET — nunca deve
      // sobrescrever a credencial real (ex: cliente reenvia o form sem editar)
      if (v === '***') continue
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
    // Credenciais de API não são exportadas — devem ser reconfiguradas no destino.
    // Usa o mesmo SENSITIVE_CONFIG_KEYS do GET/PUT (não uma lista solta em SQL,
    // que ficou desatualizada antes: só filtrava ANBIMA, deixando as URLs
    // Economatica — que carregam um token de acesso embutido — vazarem em
    // qualquer dump exportado).
    configuracoes: db.prepare('SELECT * FROM configuracoes').all()
      .filter((r) => !SENSITIVE_CONFIG_KEYS.has(r.chave)),
  }
  res.json(exportData)
})

// POST /api/config/importar
router.post('/importar', (req, res) => {
  const db = getDb()
  const { data, modo, confirmar } = req.body

  if (!data || !modo) {
    return res.status(400).json({ error: 'Dados e modo são obrigatórios' })
  }

  if (!['substituir', 'merge'].includes(modo)) {
    return res.status(400).json({ error: 'Modo deve ser "substituir" ou "merge"' })
  }

  if (modo === 'substituir' && confirmar !== true) {
    return res.status(400).json({ error: 'Modo substituir requer confirmar: true para evitar perda acidental de dados' })
  }

  try {
    // Desliga FK enforcement durante o import: INSERT OR REPLACE faz DELETE+INSERT
    // por baixo dos panos, e com FK ligado isso dispara ON DELETE CASCADE nos
    // filhos (produtos de um estado, cotas de um produto) — no modo merge isso
    // apaga dados locais que não estavam no dump importado. Volta a ON no finally
    // (é o padrão da conexão, setado em getDb()).
    db.pragma('foreign_keys = OFF')
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
          INSERT OR REPLACE INTO estados_portfolio (id, carteira_id, mes, data_inicio, data_fim, created_at, notas)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(e.id, e.carteira_id, e.mes, e.data_inicio, e.data_fim, e.created_at, e.notas ?? null)
      }

      // Inserir produtos
      for (const p of data.produtos ?? []) {
        db.prepare(`
          INSERT OR REPLACE INTO produtos
            (id, estado_id, tipo, classe, nome, identificador, peso, indexador, tipo_cdi, taxa, data_emissao, data_vencimento, isento_ir, created_at, duration_manual)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(p.id, p.estado_id, p.tipo, p.classe, p.nome, p.identificador, p.peso, p.indexador, p.tipo_cdi, p.taxa, p.data_emissao, p.data_vencimento, p.isento_ir ?? 0, p.created_at, p.duration_manual ?? null)
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

      // Inserir alertas de auditoria (preserva status revisado/ignorar do usuário)
      for (const a of data.alertas_auditoria ?? []) {
        db.prepare(`
          INSERT OR REPLACE INTO alertas_auditoria
            (id, tipo, categoria, titulo, descricao, ativo, produto_id, data, valor_bruto, valor_usado, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(a.id, a.tipo, a.categoria, a.titulo, a.descricao, a.ativo, a.produto_id, a.data, a.valor_bruto, a.valor_usado, a.status, a.created_at, a.updated_at)
      }

      // Inserir retornos mensais (cache)
      for (const r of data.retornos_mensais ?? []) {
        db.prepare(`
          INSERT OR REPLACE INTO retornos_mensais (id, carteira_id, mes, retorno, retorno_cdi, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(r.id, r.carteira_id, r.mes, r.retorno, r.retorno_cdi, r.created_at, r.updated_at)
      }

      // Inserir log de captação (histórico, ignora duplicatas)
      for (const l of data.log_captacao ?? []) {
        db.prepare(`
          INSERT OR IGNORE INTO log_captacao (id, timestamp, fonte, ativo, valor, status, detalhes)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(l.id, l.timestamp, l.fonte, l.ativo, l.valor, l.status, l.detalhes)
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
  } finally {
    db.pragma('foreign_keys = ON')
  }
})

export default router
