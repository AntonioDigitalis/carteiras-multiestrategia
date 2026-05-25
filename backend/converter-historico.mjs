import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const input = JSON.parse(readFileSync(path.join(__dirname, 'importar-historico.json'), 'utf-8'))

// ── Mapeamentos ────────────────────────────────────────────

const CLASS_MAP = {
  pos_fixada:           'pos_fixado',
  inflacao:             'inflacao',
  pre_fixada:           'prefixado',
  renda_fixa_global:    'rf_global',
  multimercado:         'multimercado',
  renda_variavel_brasil:'rv_brasil',
  renda_variavel_global:'rv_global',
  fundos_listados:      'fundos_listados',
  alternativos:         'alternativos',
}

const PERFIL_MAP = {
  conservadora: { perfil_id: 1, carteira_id: 2 },
  moderada:     { perfil_id: 2, carteira_id: 4 },
  agressiva:    { perfil_id: 3, carteira_id: 6 },
}

const CNPJ_MAP = {
  'AZ Quest Altro Advisory FIC FIF Multimercado CP':                                         '34.370.777/0001-60',
  'Legacy Capital Credit Advisory FIC FIM CP':                                                '39.487.197/0001-70',
  'SulAmérica Crédito Ativo FIRF CP LP':                                                      '13.823.084/0001-05',
  'XP Crédito Estruturado 360 FIDC RL':                                                       '27.227.796/0001-76',
  'ARX Elbrus Advisory FIC INFRA RF':                                                         '32.319.627/0001-04',
  'AZ Quest Debêntures Incentivadas CP FIC de FIF Incentivado de Investimento em Infra RF':   '25.213.405/0001-39',
  'TREND PRÉ-FIXADO RESP LIMITADA FI RENDA FIXA LP':                                         '31.145.851/0001-56',
  'Kinea Atlas II FIM':                                                                        '29.762.315/0001-58',
  'Kapitalo K10 Advisory FIF em Cotas de FIM':                                                '33.520.968/0001-06',
  'Absolute Vertex Advisory FIC FIM':                                                         '28.947.266/0001-65',
  'Genoa Capital Radar Advisory FIC FIM':                                                     '36.017.731/0001-97',
  'XP Dividendos FIA':                                                                        '16.575.255/0001-12',
  'Wellington Ventura FIA IE':                                                                 '35.556.444/0001-92',
  'Wellington Ventura Advisory CI Ações IE RL':                                               '35.556.444/0001-92',
  'Trend Bolsas Globais':                                                                      '37.553.464/0001-35',
  'Selection RF Light FIC FIRF CP LP':                                                        '24.572.219/0001-23',
  'Real Investor FIC FIA BDR Nível 1':                                                        '10.500.884/0001-05',
  'Trend Dividendos Brasil FIA Resp Limitada':                                                '55.630.600/0001-25',
  'Root Capital High Yield Advisory FIC FIM CP':                                              '34.431.610/0001-61',
  'Novus Renda Fixa Ativo Isento':                                                            '54.484.843/0001-30',
  'Trend Momentum Brasil FIA RL':                                                             '47.033.461/0001-24',
  'WHG Global Long Biased BRL FIC FIM CP IE':                                                 '41.409.761/0001-89',
  'Trend IA':                                                                                  '44.431.925/0001-62',
  'Trend Commodities FIF RL':                                                                  '40.212.817/0001-48',
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

function getTaxa(p) {
  const idx = (p.indexador || '').toUpperCase()
  if (idx === 'SELIC') return 100                                   // LFT ≈ 100% CDI
  if (idx === 'CDI' && p.percentual_cdi != null) return +(p.percentual_cdi * 100).toFixed(4)
  if (idx === 'IPCA' && p.spread != null)        return +(p.spread * 100).toFixed(4)
  if ((idx === 'PREFIXADO' || idx === 'PRE') && p.taxa != null) return +(p.taxa * 100).toFixed(4)
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

// Alocações macro (1 por perfil × mes)
let alocacaoId = 1
const alocacoes_macro = []
for (const p of periodos) {
  const mes = p.periodo.slice(0, 7)
  for (const [perfilNome, mapping] of Object.entries(PERFIL_MAP)) {
    const a = p.alocacao_macro[perfilNome]
    const ts = `${mes}-01 00:00:00`
    alocacoes_macro.push({
      id: alocacaoId++,
      perfil_id: mapping.perfil_id,
      mes,
      pos_fixado:      +((a.pos_fixada ?? 0) * 100).toFixed(4),
      inflacao:        +((a.inflacao ?? 0) * 100).toFixed(4),
      prefixado:       +((a.pre_fixada ?? 0) * 100).toFixed(4),
      rf_global:       +((a.renda_fixa_global ?? 0) * 100).toFixed(4),
      multimercado:    +((a.multimercado ?? 0) * 100).toFixed(4),
      rv_brasil:       +((a.renda_variavel_brasil ?? 0) * 100).toFixed(4),
      rv_global:       +((a.renda_variavel_global ?? 0) * 100).toFixed(4),
      fundos_listados: +((a.fundos_listados ?? 0) * 100).toFixed(4),
      alternativos:    +((a.alternativos ?? 0) * 100).toFixed(4),
      created_at: ts,
      updated_at: ts,
    })
  }
}

// Estados do portfólio (1 por carteira B × mes)
let estadoId = 1
const estados_portfolio = []
const estadoMap = {}
for (const p of periodos) {
  const mes = p.periodo.slice(0, 7)
  for (const [perfilNome, mapping] of Object.entries(PERFIL_MAP)) {
    const key = `${mapping.carteira_id}-${mes}`
    estadoMap[key] = estadoId
    estados_portfolio.push({
      id: estadoId++,
      carteira_id: mapping.carteira_id,
      mes,
      data_inicio: `${mes}-01`,   // primeiro dia do mês para cálculo integral
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
  for (const [classeOrig, prods] of Object.entries(periodo.produtos)) {
    const classe = CLASS_MAP[classeOrig]
    if (!classe) { console.warn('Classe desconhecida:', classeOrig); continue }

    for (const prod of prods) {
      const tipo = getTipo(prod)
      if (!tipo) continue // carteira_interna → ignorada

      for (const [perfilNome, mapping] of Object.entries(PERFIL_MAP)) {
        const peso = prod.pesos[perfilNome]
        if (!peso || peso === 0) continue

        const estadoKey = `${mapping.carteira_id}-${mes}`
        const eid = estadoMap[estadoKey]
        if (!eid) continue

        let identificador = null
        if (tipo === 'fundo') {
          identificador = CNPJ_MAP[prod.nome] ?? null
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
          peso: +(peso * 100).toFixed(4),
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

const outPath = path.join(__dirname, 'importar-historico-convertido.json')
writeFileSync(outPath, JSON.stringify(output, null, 2))

console.log('✅ Arquivo gerado:', outPath)
console.log(`   ${alocacoes_macro.length} alocações macro`)
console.log(`   ${estados_portfolio.length} estados de portfólio`)
console.log(`   ${produtos.length} produtos`)
if (semCNPJ.length) {
  console.log('\n⚠️  Fundos sem CNPJ encontrado:')
  semCNPJ.forEach(n => console.log('  -', n))
}

// Verificar se somas batem em 100%
console.log('\n📊 Verificação de alocações (devem ser 100%):')
for (const a of alocacoes_macro.slice(0, 3)) {
  const soma = a.pos_fixado + a.inflacao + a.prefixado + a.rf_global +
    a.multimercado + a.rv_brasil + a.rv_global + a.fundos_listados + a.alternativos
  console.log(`  Perfil ${a.perfil_id} / ${a.mes}: ${soma.toFixed(2)}%`)
}
