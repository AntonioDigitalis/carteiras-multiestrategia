import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const input = JSON.parse(readFileSync(path.join(__dirname, 'importar-historico-v2.json'), 'utf-8'))

// ── Mapeamentos ────────────────────────────────────────────

const CLASS_MAP = {
  pos_fixada:            'pos_fixado',
  inflacao:              'inflacao',
  pre_fixada:            'prefixado',
  renda_fixa_global:     'rf_global',
  multimercado:          'multimercado',
  renda_variavel_brasil: 'rv_brasil',
  renda_variavel_global: 'rv_global',
  fundos_listados:       'fundos_listados',
  alternativos:          'alternativos',
}

const PERFIL_MAP = {
  conservadora: { perfil_id: 1, carteira_id: 2 },
  moderada:     { perfil_id: 2, carteira_id: 4 },
  agressiva:    { perfil_id: 3, carteira_id: 6 },
}

// ── Helpers ────────────────────────────────────────────────

function getTipo(p) {
  if (['tesouro', 'lca', 'cdb', 'cri', 'cra', 'debenture'].includes(p.tipo)) return 'rf_curva'
  if (p.tipo === 'etf') return 'acao'
  if (p.tipo === 'fundo') return 'fundo'
  return null // carteira_interna → ignorado
}

function getIndexador(p) {
  const idx = (p.indexador || '').toUpperCase()
  if (idx === 'SELIC' || idx === 'CDI') return 'CDI'
  if (idx === 'IPCA') return 'IPCA'
  if (idx === 'PREFIXADO' || idx === 'PRE') return 'PRE'
  return null
}

function getTipoCDI(p) {
  const idx = (p.indexador || '').toUpperCase()
  if (idx === 'SELIC') return 'pct'
  if (idx === 'CDI') return p.percentual_cdi != null ? 'pct' : 'spread'
  return null
}

// Novo formato: valores já em percentual (91.0, 7.6, 13.34)
// Não precisa multiplicar por 100 como no formato antigo
function getTaxa(p) {
  const idx = (p.indexador || '').toUpperCase()
  if (idx === 'SELIC') return 100                              // LFT ≈ 100% CDI
  if (idx === 'CDI' && p.percentual_cdi != null) return +parseFloat(p.percentual_cdi).toFixed(4)
  if (idx === 'IPCA' && p.spread != null)        return +parseFloat(p.spread).toFixed(4)
  if ((idx === 'PREFIXADO' || idx === 'PRE') && p.taxa != null) return +parseFloat(p.taxa).toFixed(4)
  return null
}

// ── Construção do output ───────────────────────────────────

const periodos = [...input.historico].sort((a, b) => a.periodo.localeCompare(b.periodo))

const perfis = [
  { id: 1, nome: 'Conservador', ordem: 1, created_at: '2025-01-01 00:00:00' },
  { id: 2, nome: 'Moderado',    ordem: 2, created_at: '2025-01-01 00:00:00' },
  { id: 3, nome: 'Arrojado',    ordem: 3, created_at: '2025-01-01 00:00:00' },
]

const carteiras = [
  { id: 1, perfil_id: 1, tipo: 'A', nome: 'Conservador A',    descricao: null, created_at: '2025-01-01 00:00:00' },
  { id: 2, perfil_id: 1, tipo: 'B', nome: 'Conservador Alfa', descricao: null, created_at: '2025-01-01 00:00:00' },
  { id: 3, perfil_id: 2, tipo: 'A', nome: 'Moderado A',       descricao: null, created_at: '2025-01-01 00:00:00' },
  { id: 4, perfil_id: 2, tipo: 'B', nome: 'Moderado Alfa',    descricao: null, created_at: '2025-01-01 00:00:00' },
  { id: 5, perfil_id: 3, tipo: 'A', nome: 'Arrojado A',       descricao: null, created_at: '2025-01-01 00:00:00' },
  { id: 6, perfil_id: 3, tipo: 'B', nome: 'Arrojado Alfa',    descricao: null, created_at: '2025-01-01 00:00:00' },
]

// Alocações macro — novo formato: valores já em % (70.0 não 0.70)
let alocacaoId = 1
const alocacoes_macro = []
const mesesVistos = new Set()

for (const p of periodos) {
  const mes = p.periodo.slice(0, 7)
  if (mesesVistos.has(mes)) {
    console.warn(`⚠️  Mês duplicado ignorado: ${mes} (período ${p.periodo})`)
    continue
  }
  mesesVistos.add(mes)

  for (const [perfilNome, mapping] of Object.entries(PERFIL_MAP)) {
    const a = p.alocacao_macro[perfilNome]
    const ts = `${mes}-01 00:00:00`
    alocacoes_macro.push({
      id: alocacaoId++,
      perfil_id: mapping.perfil_id,
      mes,
      pos_fixado:      +parseFloat(a.pos_fixada      ?? 0).toFixed(4),
      inflacao:        +parseFloat(a.inflacao         ?? 0).toFixed(4),
      prefixado:       +parseFloat(a.pre_fixada       ?? 0).toFixed(4),
      rf_global:       +parseFloat(a.renda_fixa_global ?? 0).toFixed(4),
      multimercado:    +parseFloat(a.multimercado     ?? 0).toFixed(4),
      rv_brasil:       +parseFloat(a.renda_variavel_brasil ?? 0).toFixed(4),
      rv_global:       +parseFloat(a.renda_variavel_global ?? 0).toFixed(4),
      fundos_listados: +parseFloat(a.fundos_listados  ?? 0).toFixed(4),
      alternativos:    +parseFloat(a.alternativos     ?? 0).toFixed(4),
      created_at: ts,
      updated_at: ts,
    })
  }
}

// Estados do portfólio (1 por carteira B × mês único)
let estadoId = 1
const estados_portfolio = []
const estadoMap = {}
for (const mes of [...mesesVistos].sort()) {
  for (const [, mapping] of Object.entries(PERFIL_MAP)) {
    const key = `${mapping.carteira_id}-${mes}`
    estadoMap[key] = estadoId
    estados_portfolio.push({
      id: estadoId++,
      carteira_id: mapping.carteira_id,
      mes,
      data_inicio: `${mes}-01`,
      data_fim: null,
      created_at: `${mes}-01 00:00:00`,
    })
  }
}

// Produtos
let produtoId = 1
const produtos = []
const semCNPJ = []

for (const periodo of periodos) {
  const mes = periodo.periodo.slice(0, 7)
  if (!mesesVistos.has(mes)) continue // mês duplicado já ignorado

  for (const [classeOrig, prods] of Object.entries(periodo.produtos)) {
    const classe = CLASS_MAP[classeOrig]
    if (!classe) { console.warn('Classe desconhecida:', classeOrig); continue }

    for (const prod of prods) {
      const tipo = getTipo(prod)
      if (!tipo) continue // carteira_interna → ignorado

      for (const [perfilNome, mapping] of Object.entries(PERFIL_MAP)) {
        const peso = prod.pesos[perfilNome]
        if (!peso || peso === 0) continue

        const estadoKey = `${mapping.carteira_id}-${mes}`
        const eid = estadoMap[estadoKey]
        if (!eid) continue

        let identificador = null
        if (tipo === 'fundo') {
          // Novo formato: cnpj direto no produto
          identificador = prod.cnpj ?? null
          if (!identificador && !semCNPJ.includes(prod.nome)) semCNPJ.push(prod.nome)
        } else if (tipo === 'acao') {
          identificador = prod.ticker ?? null
        }

        produtos.push({
          id: produtoId++,
          estado_id: eid,
          tipo,
          classe,
          nome: prod.nome,
          identificador,
          // Novo formato: peso já em % (35.0 não 0.35)
          peso: +parseFloat(peso).toFixed(4),
          indexador:       tipo === 'rf_curva' ? getIndexador(prod) : null,
          tipo_cdi:        tipo === 'rf_curva' ? getTipoCDI(prod) : null,
          taxa:            tipo === 'rf_curva' ? getTaxa(prod) : null,
          data_emissao:    prod.data_emissao ?? null,
          data_vencimento: prod.data_vencimento ?? null,
          created_at: `${mes}-01 00:00:00`,
        })
      }
    }
  }
}

const output = {
  versao: '1.0.0',
  exportado_em: new Date().toISOString(),
  perfis,
  carteiras,
  alocacoes_macro,
  estados_portfolio,
  produtos,
  cotas_cache: [],
  dados_macro: [],
  retornos_mensais: [],
  alertas_auditoria: [],
  log_captacao: [],
  configuracoes: [
    { chave: 'versao', valor: '1.0.0', updated_at: new Date().toISOString() },
    { chave: 'taxa_livre_risco', valor: 'CDI', updated_at: new Date().toISOString() },
  ],
}

const outPath = path.join(__dirname, 'importar-historico-v2-convertido.json')
writeFileSync(outPath, JSON.stringify(output, null, 2))

console.log('✅ Arquivo gerado:', outPath)
console.log(`   ${alocacoes_macro.length} alocações macro (${mesesVistos.size} meses × 3 perfis)`)
console.log(`   ${estados_portfolio.length} estados de portfólio`)
console.log(`   ${produtos.length} produtos`)
if (semCNPJ.length) {
  console.log('\n⚠️  Fundos sem CNPJ:')
  semCNPJ.forEach(n => console.log('  -', n))
}

console.log('\n📊 Verificação de alocações (devem ser 100%):')
for (const a of alocacoes_macro.slice(0, 3)) {
  const soma = a.pos_fixado + a.inflacao + a.prefixado + a.rf_global +
    a.multimercado + a.rv_brasil + a.rv_global + a.fundos_listados + a.alternativos
  const ok = Math.abs(soma - 100) < 0.1 ? '✅' : '❌'
  console.log(`  ${ok} Perfil ${a.perfil_id} / ${a.mes}: ${soma.toFixed(2)}%`)
}
