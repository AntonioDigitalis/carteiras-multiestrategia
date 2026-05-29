import Database from 'better-sqlite3'
import { readFileSync } from 'fs'

const db = new Database('./data/carteiras.db')
const raw = JSON.parse(readFileSync('./alfa_light_hist.json', 'utf8'))

// ── Mapeamento ────────────────────────────────────────────
const PERFIL_MAP = {
  conservadora: { carteira_id: 1, perfil_id: 1 },
  moderada:     { carteira_id: 3, perfil_id: 2 },
  sofisticada:  { carteira_id: 5, perfil_id: 3 },
}

const CLASSE_MAP = {
  pos_fixada:           'pos_fixado',
  inflacao:             'inflacao',
  pre_fixada:           'prefixado',
  renda_fixa_global:    'rf_global',
  multimercados:        'multimercado',
  renda_variavel_brasil:'rv_brasil',
  renda_variavel_global:'rv_global',
  fundos_listados:      'fundos_listados',
  alternativos:         'alternativos',
}

const TICKERS = new Set(['XFIX11','HYBR11','GICP11','LTBX11','PIBB11'])
const SUB_NOMES = { 'Carteira de FIIs':'10', 'Carteira Top Dividendos':'9', 'Carteira Top Ações':'8' }

// ── Funções auxiliares ────────────────────────────────────
function subOneDay(d) {
  const dt = new Date(d + 'T12:00:00Z')
  dt.setUTCDate(dt.getUTCDate() - 1)
  return dt.toISOString().split('T')[0]
}
function lastDayOfMonth(d) {
  const [y, m] = d.split('-').map(Number)
  return new Date(y, m, 0).toISOString().split('T')[0]
}
function inferProduto(p, classeDb) {
  const nome = p.nome
  let tipo = 'fundo', ident = p.cnpj || nome
  if (SUB_NOMES[nome])  { tipo = 'carteira'; ident = SUB_NOMES[nome] }
  else if (TICKERS.has(nome)) { tipo = 'acao'; ident = nome }
  const isento = /LCI|LCA|CRI|CRA|LCD|incentivad/i.test(nome) ? 1 : 0
  return { tipo, ident, isento }
}

// ── Aplicar correções ─────────────────────────────────────
// #1: 2026-04 sofisticada multimercados 9.5 → 10.0
const p2026_04 = raw.periodos.find(p => p.data === '2026-04-13')
if (p2026_04) {
  p2026_04.perfis.sofisticada.alocacao_macro.multimercados = 10.0
  p2026_04.perfis.sofisticada.produtos.multimercados[0].peso = 10.0
  console.log('Correção aplicada: 2026-04 sofisticada multimercados 9.5→10.0')
}
// #2: 2025-12 moderada rv_brasil 3.75→5.0 por produto
const p2025_12 = raw.periodos.find(p => p.data === '2025-12-11')
if (p2025_12) {
  for (const prod of p2025_12.perfis.moderada.produtos.renda_variavel_brasil) {
    prod.peso = 5.0
  }
  console.log('Correção aplicada: 2025-12 moderada rv_brasil 3.75→5.0 (cada produto)')
}

// ── Calcular datas ────────────────────────────────────────
const periodos = raw.periodos
const periodosDatas = periodos.map((p, i) => ({
  data:     p.data,
  data_fim: i < periodos.length - 1 ? subOneDay(periodos[i + 1].data) : lastDayOfMonth(p.data),
  mes:      p.data.slice(0, 7),
}))

const mesesImportar = [...new Set(periodosDatas.map(p => p.mes))]
const carteiraIds = [1, 3, 5]

// ── SQL statements ─────────────────────────────────────────
const stmtClearAlertas = db.prepare(`
  UPDATE alertas_auditoria SET produto_id = NULL
  WHERE produto_id IN (SELECT id FROM produtos WHERE estado_id IN (
    SELECT id FROM estados_portfolio WHERE carteira_id = ? AND mes = ?
  ))
`)
const stmtDelProdutos = db.prepare(`
  DELETE FROM produtos WHERE estado_id IN (
    SELECT id FROM estados_portfolio WHERE carteira_id = ? AND mes = ?
  )
`)
const stmtDelEstado = db.prepare(`
  DELETE FROM estados_portfolio WHERE carteira_id = ? AND mes = ?
`)
const stmtInsEstado = db.prepare(`
  INSERT INTO estados_portfolio (carteira_id, mes, data_inicio, data_fim)
  VALUES (@carteira_id, @mes, @data_inicio, @data_fim)
`)
const stmtInsProduto = db.prepare(`
  INSERT INTO produtos
    (estado_id, tipo, classe, nome, identificador, peso,
     indexador, tipo_cdi, taxa, data_emissao, data_vencimento, isento_ir)
  VALUES
    (@estado_id, @tipo, @classe, @nome, @identificador, @peso,
     @indexador, @tipo_cdi, @taxa, @data_emissao, @data_vencimento, @isento_ir)
`)
const stmtInsAloc = db.prepare(`
  INSERT INTO alocacoes_macro
    (perfil_id, mes, pos_fixado, inflacao, prefixado, rf_global, multimercado,
     rv_brasil, rv_global, fundos_listados, alternativos)
  VALUES
    (@perfil_id, @mes, @pos_fixado, @inflacao, @prefixado, @rf_global, @multimercado,
     @rv_brasil, @rv_global, @fundos_listados, @alternativos)
  ON CONFLICT(perfil_id, mes) DO UPDATE SET
    pos_fixado=excluded.pos_fixado, inflacao=excluded.inflacao,
    prefixado=excluded.prefixado, rf_global=excluded.rf_global,
    multimercado=excluded.multimercado, rv_brasil=excluded.rv_brasil,
    rv_global=excluded.rv_global, fundos_listados=excluded.fundos_listados,
    alternativos=excluded.alternativos, updated_at=datetime('now')
`)

// ── Executar import ────────────────────────────────────────
db.transaction(() => {
  for (const [idx, pd] of periodosDatas.entries()) {
    const periodo = periodos[idx]
    for (const [pkey, pmap] of Object.entries(PERFIL_MAP)) {
      const perfil = periodo.perfis[pkey]
      if (!perfil) continue
      const { carteira_id, perfil_id } = pmap

      // Limpar existente
      stmtClearAlertas.run(carteira_id, pd.mes)
      stmtDelProdutos.run(carteira_id, pd.mes)
      stmtDelEstado.run(carteira_id, pd.mes)

      // Inserir estado
      const { lastInsertRowid: estadoId } = stmtInsEstado.run({
        carteira_id, mes: pd.mes, data_inicio: pd.data, data_fim: pd.data_fim
      })

      // Inserir produtos
      for (const [classeJson, classeDb] of Object.entries(CLASSE_MAP)) {
        const prods = perfil.produtos[classeJson] || []
        for (const p of prods) {
          const { tipo, ident, isento } = inferProduto(p, classeDb)
          stmtInsProduto.run({
            estado_id: estadoId, tipo, classe: classeDb,
            nome: p.nome, identificador: ident, peso: p.peso,
            indexador: null, tipo_cdi: null, taxa: null,
            data_emissao: null, data_vencimento: null, isento_ir: isento,
          })
        }
      }

      // Inserir/atualizar alocacao_macro
      const m = perfil.alocacao_macro
      stmtInsAloc.run({
        perfil_id, mes: pd.mes,
        pos_fixado:     m.pos_fixada,
        inflacao:       m.inflacao,
        prefixado:      m.pre_fixada,
        rf_global:      m.renda_fixa_global,
        multimercado:   m.multimercados,
        rv_brasil:      m.renda_variavel_brasil,
        rv_global:      m.renda_variavel_global,
        fundos_listados:m.fundos_listados,
        alternativos:   m.alternativos,
      })
    }
  }
})()

console.log('Import concluído.')
