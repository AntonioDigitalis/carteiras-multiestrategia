/**
 * Import Carteira Alfa B – 4 períodos de 2026
 * Formato correto: macro já em 0-100, micro já em % do portfólio
 */
import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const db = new Database(path.join(path.dirname(fileURLToPath(import.meta.url)), 'data/carteiras.db'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// ── Mapeamentos ────────────────────────────────────────────────────────────

const PROFILE_MAP = {
  conservadora: { perfil_id: 1, carteira_id: 2 },
  moderada:     { perfil_id: 2, carteira_id: 4 },
  agressiva:    { perfil_id: 3, carteira_id: 6 },
}

const CLASS_MAP = {
  pos_fixada:            'pos_fixado',
  inflacao:              'inflacao',
  pre_fixada:            'prefixado',
  renda_fixa_global:     'rf_global',
  multimercados:         'multimercado',
  renda_variavel_brasil: 'rv_brasil',
  renda_variavel_global: 'rv_global',
  fundos_listados:       'fundos_listados',
  alternativos:          'alternativos',
}

const MACRO_COL_MAP = {
  pos_fixada:            'pos_fixado',
  inflacao:              'inflacao',
  pre_fixada:            'prefixado',
  renda_fixa_global:     'rf_global',
  multimercados:         'multimercado',
  renda_variavel_brasil: 'rv_brasil',
  renda_variavel_global: 'rv_global',
  fundos_listados:       'fundos_listados',
  alternativos:          'alternativos',
}

const CNPJ = {
  'Selection RF Light FIC FIRF CP LP':        '24.572.219/0001-23',
  'Legacy Capital Credit Advisory FIC FIM CP': '39.487.617/0001-19',
  'Root Capital High Yield Advisory FIC FIM CP': '34.431.610/0001-61',
  'SulAmérica Crédito Ativo FIRF CP LP':      '13.823.084/0001-05',
  'ARX Elbrus Advisory FIC INFRA RF':         '32.319.627/0001-04',
  'Kinea Atlas II FIM':                       '29.762.315/0001-58',
  'Absolute Vertex Advisory FIC FIM':         '28.947.266/0001-65',
  'Genoa Capital Radar Advisory FIC FIM':     '36.017.731/0001-97',
  'Real Investor FIC FIA BDR Nível 1':        '10.500.884/0001-05',
  'WHG Global Long Biased BRL FIC FIM CP IE': '41.409.761/0001-89',
  'Trend Bolsas Globais':                     '37.553.464/0001-35',
  'Trend Commodities FIF RL':                 '40.212.817/0001-48',
  'XP Crédito Estruturado 360 FIDC RL':       '22.003.930/0001-31',
  'Novus Renda Fixa Ativo Isento':            '54.484.843/0001-30',
  'AZ Quest Altro Advisory FIC FIF Multimercado CP': '34.370.777/0001-60',
  'AZ Quest Debêntures Incentivadas CP FIC de FIF Incentivado de Investimento em Infra RF': '25.213.405/0001-39',
  'Kapitalo K10 Advisory FIF em Cotas de FIM':'33.520.968/0001-06',
  'TREND PRÉ-FIXADO RESP LIMITADA FI RENDA FIXA LP': '31.145.851/0001-56',
  'Trend Dividendos Brasil FIA Resp Limitada':'55.630.600/0001-25',
  'Trend IA':                                 '44.431.925/0001-62',
  'Trend Momentum Brasil FIA RL':             '47.033.461/0001-24',
  'Wellington Ventura FIA IE':                '35.556.444/0001-92',
  'XP Dividendos FIA':                        '16.575.255/0001-12',
}

const SUB_CARTEIRA = {
  'Top FIIs':              '7',
  'Carteira Top Ações':    '8',
  'Carteira Top Dividendos': '9',
}

const ETF_TICKERS = new Set(['HYBR11','T10R11','GOLX11','PIBB11'])

// Parâmetros completos dos produtos rf_curva
// data_emissao = data do período em que o produto aparece pela primeira vez
const RF_PARAMS = {
  'LFT – Selic + 0,01% - 01/03/2028':
    { indexador:'CDI', tipo_cdi:'spread', taxa:0.01, data_vencimento:'2028-03-01', isento_ir:0 },
  'LFT – Selic + 0,01% - 01/03/2029':
    { indexador:'CDI', tipo_cdi:'spread', taxa:0.01, data_vencimento:'2029-03-01', isento_ir:0 },
  'CRI Lavvi - 100% do CDI - 15/10/2032':
    { indexador:'CDI', tipo_cdi:'pct',    taxa:100,  data_vencimento:'2032-10-15', isento_ir:1 },
  'LCA Banco Original - 91% CDI - 24/03/2028':
    { indexador:'CDI', tipo_cdi:'pct',    taxa:91,   data_vencimento:'2028-03-24', isento_ir:1 },
  'LCA Banco Original - 91% CDI - 05/04/2029':
    { indexador:'CDI', tipo_cdi:'pct',    taxa:91,   data_vencimento:'2029-04-05', isento_ir:1 },
  'CRA Minerva - IPCA + 8,3% - 16/07/2029':
    { indexador:'IPCA', taxa:8.3,  data_vencimento:'2029-07-16', isento_ir:1 },
  'NTN-B – IPCA + 7,2% – 15/05/2033':
    { indexador:'IPCA', taxa:7.2,  data_vencimento:'2033-05-15', isento_ir:0 },
  'NTN-B 15/08/2032 IPCA + 7,30%':
    { indexador:'IPCA', taxa:7.3,  data_vencimento:'2032-08-15', isento_ir:0 },
  'Debênture Engie - IPCA + 6,1% - 15/06/2035':
    { indexador:'IPCA', taxa:6.1,  data_vencimento:'2035-06-15', isento_ir:1 },
  'Debênture Eletrobras (Axia) - IPCA + 6,60% - 15/09/2034':
    { indexador:'IPCA', taxa:6.6,  data_vencimento:'2034-09-15', isento_ir:1 },
  'Debênture Isa Energia (CTEEP) - IPCA + 6,65% - 15/10/2036':
    { indexador:'IPCA', taxa:6.65, data_vencimento:'2036-10-15', isento_ir:1 },
  'CDB PicPay - 14,2% - 31/01/2029':
    { indexador:'PRE',  taxa:14.2, data_vencimento:'2029-01-31', isento_ir:0 },
  'CDB Banco C6 - 14,6% - 24/03/2030':
    { indexador:'PRE',  taxa:14.6, data_vencimento:'2030-03-24', isento_ir:0 },
  'CDB Banco C6 - 14,6% - 24/04/2030':
    { indexador:'PRE',  taxa:14.6, data_vencimento:'2030-04-24', isento_ir:0 },
}

// Normaliza nomes que o usuário usou com variações
function normalizeName(nome) {
  if (nome.includes('Wellington Ventura')) return 'Wellington Ventura FIA IE'
  if (nome.includes('IPC-A + 6,60%'))     return 'Debênture Eletrobras (Axia) - IPCA + 6,60% - 15/09/2034'
  if (nome.includes('IPC-A + 6,65%'))     return 'Debênture Isa Energia (CTEEP) - IPCA + 6,65% - 15/10/2036'
  return nome
}

function inferTipo(nome) {
  if (SUB_CARTEIRA[nome])                 return 'carteira'
  if (ETF_TICKERS.has(nome))             return 'acao'
  if (RF_PARAMS[nome])                   return 'rf_curva'
  return 'fundo'
}

function getIdentificador(nome, tipo) {
  if (tipo === 'carteira') return SUB_CARTEIRA[nome]
  if (tipo === 'acao')     return nome
  if (tipo === 'fundo')    return CNPJ[nome] ?? null
  return null
}

// ── Dados dos 4 períodos ──────────────────────────────────────────────────
// data_fim: dia antes do próximo rebalanceamento
// Feb fica aberto (null) para o calculador usar em março via fallback

const PERIODS = [
  { data: '2026-01-09', mes: '2026-01', data_fim: '2026-02-08' },
  { data: '2026-02-09', mes: '2026-02', data_fim: null },          // aberto → março usa via fallback
  { data: '2026-04-09', mes: '2026-04', data_fim: '2026-05-11' },
  { data: '2026-05-12', mes: '2026-05', data_fim: null },
]

// Alocações macro e produtos — copiados literalmente do JSON do usuário
// (macro em 0-100, micro em % do portfólio — nenhuma transformação necessária)

const DATA = [
  // ── Período 1: 2026-01-09 ─────────────────────────────────────────────
  {
    conservadora: {
      macro: { pos_fixada:70, inflacao:12.5, pre_fixada:5, renda_fixa_global:2.5, multimercados:5, renda_variavel_brasil:0, renda_variavel_global:2.5, fundos_listados:2.5, alternativos:0 },
      produtos: {
        pos_fixada: [
          { nome:'LFT – Selic + 0,01% - 01/03/2028', peso:25 },
          { nome:'CRI Lavvi - 100% do CDI - 15/10/2032', peso:5 },
          { nome:'Selection RF Light FIC FIRF CP LP', peso:6 },
          { nome:'Legacy Capital Credit Advisory FIC FIM CP', peso:7 },
          { nome:'Root Capital High Yield Advisory FIC FIM CP', peso:7 },
          { nome:'SulAmérica Crédito Ativo FIRF CP LP', peso:8 },
          { nome:'XP Crédito Estruturado 360 FIDC RL', peso:6 },
          { nome:'Novus Renda Fixa Ativo Isento', peso:6 },
        ],
        inflacao: [
          { nome:'NTN-B – IPCA + 7,2% – 15/05/2033', peso:4 },
          { nome:'CRA Minerva - IPCA + 8,3% - 16/07/2029', peso:2 },
          { nome:'ARX Elbrus Advisory FIC INFRA RF', peso:3.5 },
          { nome:'AZ Quest Debêntures Incentivadas CP FIC de FIF Incentivado de Investimento em Infra RF', peso:3 },
        ],
        pre_fixada: [
          { nome:'CDB PicPay - 14,2% - 31/01/2029', peso:5 },
        ],
        renda_fixa_global: [
          { nome:'T10R11', peso:1.5 },
          { nome:'HYBR11', peso:1 },
        ],
        multimercados: [
          { nome:'Absolute Vertex Advisory FIC FIM', peso:2.5 },
          { nome:'Genoa Capital Radar Advisory FIC FIM', peso:2.5 },
        ],
        renda_variavel_global: [
          { nome:'Trend Bolsas Globais', peso:2.5 },
        ],
        fundos_listados: [
          { nome:'Top FIIs', peso:2.5 },
        ],
      },
    },
    moderada: {
      macro: { pos_fixada:32.5, inflacao:22.5, pre_fixada:10, renda_fixa_global:2.5, multimercados:16.5, renda_variavel_brasil:7.5, renda_variavel_global:3.5, fundos_listados:2, alternativos:3 },
      produtos: {
        pos_fixada: [
          { nome:'LFT – Selic + 0,01% - 01/03/2028', peso:12 },
          { nome:'CRI Lavvi - 100% do CDI - 15/10/2032', peso:3 },
          { nome:'Selection RF Light FIC FIRF CP LP', peso:3 },
          { nome:'Legacy Capital Credit Advisory FIC FIM CP', peso:2.5 },
          { nome:'Root Capital High Yield Advisory FIC FIM CP', peso:6 },
          { nome:'XP Crédito Estruturado 360 FIDC RL', peso:3.5 },
          { nome:'Novus Renda Fixa Ativo Isento', peso:2.5 },
        ],
        inflacao: [
          { nome:'NTN-B – IPCA + 7,2% – 15/05/2033', peso:8.5 },
          { nome:'CRA Minerva - IPCA + 8,3% - 16/07/2029', peso:5 },
          { nome:'ARX Elbrus Advisory FIC INFRA RF', peso:4 },
          { nome:'AZ Quest Debêntures Incentivadas CP FIC de FIF Incentivado de Investimento em Infra RF', peso:5 },
        ],
        pre_fixada: [
          { nome:'CDB PicPay - 14,2% - 31/01/2029', peso:10 },
        ],
        renda_fixa_global: [
          { nome:'T10R11', peso:1.5 },
          { nome:'HYBR11', peso:1 },
        ],
        multimercados: [
          { nome:'Kinea Atlas II FIM', peso:4.5 },
          { nome:'Kapitalo K10 Advisory FIF em Cotas de FIM', peso:4 },
          { nome:'Absolute Vertex Advisory FIC FIM', peso:4 },
          { nome:'Genoa Capital Radar Advisory FIC FIM', peso:4 },
        ],
        renda_variavel_brasil: [
          { nome:'Real Investor FIC FIA BDR Nível 1', peso:3 },
          { nome:'Carteira Top Dividendos', peso:2 },
          { nome:'Carteira Top Ações', peso:2.5 },
        ],
        renda_variavel_global: [
          { nome:'Trend Bolsas Globais', peso:3.5 },
        ],
        fundos_listados: [
          { nome:'Top FIIs', peso:2 },
        ],
        alternativos: [
          { nome:'GOLX11', peso:2 },
          { nome:'Trend IA', peso:1 },
        ],
      },
    },
    agressiva: {
      macro: { pos_fixada:12.5, inflacao:27.5, pre_fixada:7.5, renda_fixa_global:2.5, multimercados:12.5, renda_variavel_brasil:17.5, renda_variavel_global:5, fundos_listados:8, alternativos:7 },
      produtos: {
        pos_fixada: [
          { nome:'LFT – Selic + 0,01% - 01/03/2028', peso:5 },
          { nome:'Selection RF Light FIC FIRF CP LP', peso:2 },
          { nome:'Root Capital High Yield Advisory FIC FIM CP', peso:3.5 },
          { nome:'XP Crédito Estruturado 360 FIDC RL', peso:2 },
        ],
        inflacao: [
          { nome:'NTN-B – IPCA + 7,2% – 15/05/2033', peso:9 },
          { nome:'CRA Minerva - IPCA + 8,3% - 16/07/2029', peso:5 },
          { nome:'ARX Elbrus Advisory FIC INFRA RF', peso:7.5 },
          { nome:'AZ Quest Debêntures Incentivadas CP FIC de FIF Incentivado de Investimento em Infra RF', peso:6 },
        ],
        pre_fixada: [
          { nome:'CDB PicPay - 14,2% - 31/01/2029', peso:7.5 },
        ],
        renda_fixa_global: [
          { nome:'T10R11', peso:1 },
          { nome:'HYBR11', peso:1.5 },
        ],
        multimercados: [
          { nome:'Kinea Atlas II FIM', peso:3.5 },
          { nome:'Kapitalo K10 Advisory FIF em Cotas de FIM', peso:3 },
          { nome:'Absolute Vertex Advisory FIC FIM', peso:3 },
          { nome:'Genoa Capital Radar Advisory FIC FIM', peso:3 },
        ],
        renda_variavel_brasil: [
          { nome:'Real Investor FIC FIA BDR Nível 1', peso:4.5 },
          { nome:'Trend Momentum Brasil FIA RL', peso:4.5 },
          { nome:'Carteira Top Dividendos', peso:4.5 },
          { nome:'Carteira Top Ações', peso:4 },
        ],
        renda_variavel_global: [
          { nome:'WHG Global Long Biased BRL FIC FIM CP IE', peso:2 },
          { nome:'Trend Bolsas Globais', peso:3 },
        ],
        fundos_listados: [
          { nome:'Top FIIs', peso:8 },
        ],
        alternativos: [
          { nome:'GOLX11', peso:5 },
          { nome:'Trend IA', peso:2 },
        ],
      },
    },
  },

  // ── Período 2: 2026-02-09 ─────────────────────────────────────────────
  {
    conservadora: {
      macro: { pos_fixada:70, inflacao:12.5, pre_fixada:5, renda_fixa_global:2.5, multimercados:5, renda_variavel_brasil:0, renda_variavel_global:2.5, fundos_listados:2.5, alternativos:0 },
      produtos: {
        pos_fixada: [
          { nome:'LFT – Selic + 0,01% - 01/03/2028', peso:25 },
          { nome:'CRI Lavvi - 100% do CDI - 15/10/2032', peso:5 },
          { nome:'Selection RF Light FIC FIRF CP LP', peso:6 },
          { nome:'Legacy Capital Credit Advisory FIC FIM CP', peso:7 },
          { nome:'Root Capital High Yield Advisory FIC FIM CP', peso:7 },
          { nome:'SulAmérica Crédito Ativo FIRF CP LP', peso:8 },
          { nome:'XP Crédito Estruturado 360 FIDC RL', peso:6 },
          { nome:'Novus Renda Fixa Ativo Isento', peso:6 },
        ],
        inflacao: [
          { nome:'NTN-B – IPCA + 7,2% – 15/05/2033', peso:4 },
          { nome:'Debênture Engie - IPCA + 6,1% - 15/06/2035', peso:2 },
          { nome:'ARX Elbrus Advisory FIC INFRA RF', peso:3.5 },
          { nome:'AZ Quest Debêntures Incentivadas CP FIC de FIF Incentivado de Investimento em Infra RF', peso:3 },
        ],
        pre_fixada: [
          { nome:'TREND PRÉ-FIXADO RESP LIMITADA FI RENDA FIXA LP', peso:5 },
        ],
        renda_fixa_global: [
          { nome:'HYBR11', peso:2.5 },
        ],
        multimercados: [
          { nome:'Absolute Vertex Advisory FIC FIM', peso:2.5 },
          { nome:'Genoa Capital Radar Advisory FIC FIM', peso:2.5 },
        ],
        renda_variavel_global: [
          { nome:'Trend Bolsas Globais', peso:2.5 },
        ],
        fundos_listados: [
          { nome:'Top FIIs', peso:2.5 },
        ],
      },
    },
    moderada: {
      macro: { pos_fixada:32.5, inflacao:22.5, pre_fixada:10, renda_fixa_global:2.5, multimercados:16.5, renda_variavel_brasil:7.5, renda_variavel_global:3.5, fundos_listados:2, alternativos:3 },
      produtos: {
        pos_fixada: [
          { nome:'LFT – Selic + 0,01% - 01/03/2028', peso:12 },
          { nome:'CRI Lavvi - 100% do CDI - 15/10/2032', peso:3 },
          { nome:'Selection RF Light FIC FIRF CP LP', peso:3 },
          { nome:'Legacy Capital Credit Advisory FIC FIM CP', peso:3 },
          { nome:'Root Capital High Yield Advisory FIC FIM CP', peso:5 },
          { nome:'XP Crédito Estruturado 360 FIDC RL', peso:3.5 },
          { nome:'Novus Renda Fixa Ativo Isento', peso:3 },
        ],
        inflacao: [
          { nome:'NTN-B – IPCA + 7,2% – 15/05/2033', peso:8.5 },
          { nome:'Debênture Engie - IPCA + 6,1% - 15/06/2035', peso:5 },
          { nome:'ARX Elbrus Advisory FIC INFRA RF', peso:4 },
          { nome:'AZ Quest Debêntures Incentivadas CP FIC de FIF Incentivado de Investimento em Infra RF', peso:5 },
        ],
        pre_fixada: [
          { nome:'TREND PRÉ-FIXADO RESP LIMITADA FI RENDA FIXA LP', peso:10 },
        ],
        renda_fixa_global: [
          { nome:'HYBR11', peso:2.5 },
        ],
        multimercados: [
          { nome:'Kinea Atlas II FIM', peso:4.5 },
          { nome:'Kapitalo K10 Advisory FIF em Cotas de FIM', peso:4 },
          { nome:'Absolute Vertex Advisory FIC FIM', peso:4 },
          { nome:'Genoa Capital Radar Advisory FIC FIM', peso:4 },
        ],
        renda_variavel_brasil: [
          { nome:'Real Investor FIC FIA BDR Nível 1', peso:2 },
          { nome:'Trend Momentum Brasil FIA RL', peso:1 },
          { nome:'Carteira Top Dividendos', peso:2 },
          { nome:'Carteira Top Ações', peso:2.5 },
        ],
        renda_variavel_global: [
          { nome:'Trend Bolsas Globais', peso:3.5 },
        ],
        fundos_listados: [
          { nome:'Top FIIs', peso:2 },
        ],
        alternativos: [
          { nome:'GOLX11', peso:2 },
          { nome:'Trend IA', peso:1 },
        ],
      },
    },
    agressiva: {
      macro: { pos_fixada:12.5, inflacao:27.5, pre_fixada:7.5, renda_fixa_global:2.5, multimercados:12.5, renda_variavel_brasil:17.5, renda_variavel_global:5, fundos_listados:8, alternativos:7 },
      produtos: {
        pos_fixada: [
          { nome:'LFT – Selic + 0,01% - 01/03/2028', peso:5 },
          { nome:'Root Capital High Yield Advisory FIC FIM CP', peso:3.5 },
          { nome:'XP Crédito Estruturado 360 FIDC RL', peso:2 },
          { nome:'Novus Renda Fixa Ativo Isento', peso:2 },
        ],
        inflacao: [
          { nome:'NTN-B – IPCA + 7,2% – 15/05/2033', peso:9 },
          { nome:'Debênture Engie - IPCA + 6,1% - 15/06/2035', peso:5 },
          { nome:'ARX Elbrus Advisory FIC INFRA RF', peso:7.5 },
          { nome:'AZ Quest Debêntures Incentivadas CP FIC de FIF Incentivado de Investimento em Infra RF', peso:6 },
        ],
        pre_fixada: [
          { nome:'TREND PRÉ-FIXADO RESP LIMITADA FI RENDA FIXA LP', peso:7.5 },
        ],
        renda_fixa_global: [
          { nome:'HYBR11', peso:2.5 },
        ],
        multimercados: [
          { nome:'Kinea Atlas II FIM', peso:3.5 },
          { nome:'Kapitalo K10 Advisory FIF em Cotas de FIM', peso:3 },
          { nome:'Absolute Vertex Advisory FIC FIM', peso:3 },
          { nome:'Genoa Capital Radar Advisory FIC FIM', peso:3 },
        ],
        renda_variavel_brasil: [
          { nome:'Real Investor FIC FIA BDR Nível 1', peso:4 },
          { nome:'Trend Momentum Brasil FIA RL', peso:4.5 },
          { nome:'Carteira Top Dividendos', peso:4.5 },
          { nome:'Carteira Top Ações', peso:4.5 },
        ],
        renda_variavel_global: [
          { nome:'Wellington Ventura FIA IE', peso:2 },
          { nome:'Trend Bolsas Globais', peso:3 },
        ],
        fundos_listados: [
          { nome:'Top FIIs', peso:8 },
        ],
        alternativos: [
          { nome:'GOLX11', peso:5 },
          { nome:'Trend IA', peso:2 },
        ],
      },
    },
  },

  // ── Período 3: 2026-04-09 ─────────────────────────────────────────────
  {
    conservadora: {
      macro: { pos_fixada:72.5, inflacao:12.5, pre_fixada:5, renda_fixa_global:2.5, multimercados:2.5, renda_variavel_brasil:0, renda_variavel_global:2.5, fundos_listados:2.5, alternativos:0 },
      produtos: {
        pos_fixada: [
          { nome:'LFT – Selic + 0,01% - 01/03/2029', peso:25 },
          { nome:'LCA Banco Original - 91% CDI - 24/03/2028', peso:12 },
          { nome:'Selection RF Light FIC FIRF CP LP', peso:6 },
          { nome:'Legacy Capital Credit Advisory FIC FIM CP', peso:7 },
          { nome:'SulAmérica Crédito Ativo FIRF CP LP', peso:8.5 },
          { nome:'XP Crédito Estruturado 360 FIDC RL', peso:7 },
          { nome:'Novus Renda Fixa Ativo Isento', peso:7 },
        ],
        inflacao: [
          { nome:'NTN-B 15/08/2032 IPCA + 7,30%', peso:4 },
          { nome:'Debênture Eletrobras (Axia) - IPCA + 6,60% - 15/09/2034', peso:3 },
          { nome:'ARX Elbrus Advisory FIC INFRA RF', peso:3.5 },
          { nome:'AZ Quest Debêntures Incentivadas CP FIC de FIF Incentivado de Investimento em Infra RF', peso:2 },
        ],
        pre_fixada: [
          { nome:'TREND PRÉ-FIXADO RESP LIMITADA FI RENDA FIXA LP', peso:2.5 },
          { nome:'CDB Banco C6 - 14,6% - 24/03/2030', peso:2.5 },
        ],
        renda_fixa_global: [
          { nome:'HYBR11', peso:2.5 },
        ],
        multimercados: [
          { nome:'Genoa Capital Radar Advisory FIC FIM', peso:2.5 },
        ],
        renda_variavel_global: [
          { nome:'Trend Bolsas Globais', peso:2.5 },
        ],
        fundos_listados: [
          { nome:'Top FIIs', peso:2.5 },
        ],
      },
    },
    moderada: {
      macro: { pos_fixada:32.5, inflacao:22.5, pre_fixada:10, renda_fixa_global:2.5, multimercados:14, renda_variavel_brasil:7.5, renda_variavel_global:4, fundos_listados:4, alternativos:3 },
      produtos: {
        pos_fixada: [
          { nome:'LFT – Selic + 0,01% - 01/03/2029', peso:12 },
          { nome:'LCA Banco Original - 91% CDI - 24/03/2028', peso:5 },
          { nome:'Selection RF Light FIC FIRF CP LP', peso:3.5 },
          { nome:'Legacy Capital Credit Advisory FIC FIM CP', peso:3 },
          { nome:'SulAmérica Crédito Ativo FIRF CP LP', peso:3 },
          { nome:'XP Crédito Estruturado 360 FIDC RL', peso:3 },
          { nome:'Novus Renda Fixa Ativo Isento', peso:3 },
        ],
        inflacao: [
          { nome:'NTN-B 15/08/2032 IPCA + 7,30%', peso:9.5 },
          { nome:'Debênture Eletrobras (Axia) - IPCA + 6,60% - 15/09/2034', peso:5 },
          { nome:'ARX Elbrus Advisory FIC INFRA RF', peso:4 },
          { nome:'AZ Quest Debêntures Incentivadas CP FIC de FIF Incentivado de Investimento em Infra RF', peso:4 },
        ],
        pre_fixada: [
          { nome:'TREND PRÉ-FIXADO RESP LIMITADA FI RENDA FIXA LP', peso:4.5 },
          { nome:'CDB Banco C6 - 14,6% - 24/03/2030', peso:5.5 },
        ],
        renda_fixa_global: [
          { nome:'HYBR11', peso:2.5 },
        ],
        multimercados: [
          { nome:'Kinea Atlas II FIM', peso:4 },
          { nome:'Kapitalo K10 Advisory FIF em Cotas de FIM', peso:4 },
          { nome:'Absolute Vertex Advisory FIC FIM', peso:3 },
          { nome:'Genoa Capital Radar Advisory FIC FIM', peso:3 },
        ],
        renda_variavel_brasil: [
          { nome:'Real Investor FIC FIA BDR Nível 1', peso:2.5 },
          { nome:'Trend Dividendos Brasil FIA Resp Limitada', peso:3 },
          { nome:'PIBB11', peso:2 },
        ],
        renda_variavel_global: [
          { nome:'Trend Bolsas Globais', peso:4 },
        ],
        fundos_listados: [
          { nome:'Top FIIs', peso:4 },
        ],
        alternativos: [
          { nome:'GOLX11', peso:2 },
          { nome:'Trend Commodities FIF RL', peso:1 },
        ],
      },
    },
    agressiva: {
      macro: { pos_fixada:12.5, inflacao:27.5, pre_fixada:7.5, renda_fixa_global:2.5, multimercados:9.5, renda_variavel_brasil:17.5, renda_variavel_global:6, fundos_listados:9.5, alternativos:7 },
      produtos: {
        pos_fixada: [
          { nome:'LFT – Selic + 0,01% - 01/03/2029', peso:5 },
          { nome:'Legacy Capital Credit Advisory FIC FIM CP', peso:3.5 },
          { nome:'XP Crédito Estruturado 360 FIDC RL', peso:2 },
          { nome:'Novus Renda Fixa Ativo Isento', peso:2 },
        ],
        inflacao: [
          { nome:'NTN-B 15/08/2032 IPCA + 7,30%', peso:10 },
          { nome:'Debênture Eletrobras (Axia) - IPCA + 6,60% - 15/09/2034', peso:5 },
          { nome:'ARX Elbrus Advisory FIC INFRA RF', peso:7.5 },
          { nome:'AZ Quest Debêntures Incentivadas CP FIC de FIF Incentivado de Investimento em Infra RF', peso:5 },
        ],
        pre_fixada: [
          { nome:'TREND PRÉ-FIXADO RESP LIMITADA FI RENDA FIXA LP', peso:3.5 },
          { nome:'CDB Banco C6 - 14,6% - 24/03/2030', peso:4 },
        ],
        renda_fixa_global: [
          { nome:'HYBR11', peso:2.5 },
        ],
        multimercados: [
          { nome:'Kinea Atlas II FIM', peso:3 },
          { nome:'Kapitalo K10 Advisory FIF em Cotas de FIM', peso:3 },
          { nome:'Absolute Vertex Advisory FIC FIM', peso:1.5 },
          { nome:'Genoa Capital Radar Advisory FIC FIM', peso:2 },
        ],
        renda_variavel_brasil: [
          { nome:'Real Investor FIC FIA BDR Nível 1', peso:5.5 },
          { nome:'Trend Dividendos Brasil FIA Resp Limitada', peso:6 },
          { nome:'PIBB11', peso:6 },
        ],
        renda_variavel_global: [
          { nome:'Wellington Ventura FIA IE', peso:3 },
          { nome:'Trend Bolsas Globais', peso:3 },
        ],
        fundos_listados: [
          { nome:'Top FIIs', peso:9.5 },
        ],
        alternativos: [
          { nome:'GOLX11', peso:5 },
          { nome:'Trend Commodities FIF RL', peso:2 },
        ],
      },
    },
  },

  // ── Período 4: 2026-05-12 ─────────────────────────────────────────────
  {
    conservadora: {
      macro: { pos_fixada:72.5, inflacao:12.5, pre_fixada:5, renda_fixa_global:2.5, multimercados:2.5, renda_variavel_brasil:0, renda_variavel_global:2.5, fundos_listados:2.5, alternativos:0 },
      produtos: {
        pos_fixada: [
          { nome:'LFT – Selic + 0,01% - 01/03/2029', peso:25 },
          { nome:'LCA Banco Original - 91% CDI - 05/04/2029', peso:13 },
          { nome:'AZ Quest Altro Advisory FIC FIF Multimercado CP', peso:8 },
          { nome:'Legacy Capital Credit Advisory FIC FIM CP', peso:8 },
          { nome:'SulAmérica Crédito Ativo FIRF CP LP', peso:10.5 },
          { nome:'XP Crédito Estruturado 360 FIDC RL', peso:8 },
        ],
        inflacao: [
          { nome:'NTN-B 15/08/2032 IPCA + 7,30%', peso:4 },
          { nome:'Debênture Isa Energia (CTEEP) - IPCA + 6,65% - 15/10/2036', peso:3 },
          { nome:'ARX Elbrus Advisory FIC INFRA RF', peso:3.5 },
          { nome:'AZ Quest Debêntures Incentivadas CP FIC de FIF Incentivado de Investimento em Infra RF', peso:2 },
        ],
        pre_fixada: [
          { nome:'TREND PRÉ-FIXADO RESP LIMITADA FI RENDA FIXA LP', peso:2.5 },
          { nome:'CDB Banco C6 - 14,6% - 24/04/2030', peso:2.5 },
        ],
        renda_fixa_global: [
          { nome:'HYBR11', peso:2.5 },
        ],
        multimercados: [
          { nome:'Genoa Capital Radar Advisory FIC FIM', peso:2.5 },
        ],
        renda_variavel_global: [
          { nome:'Trend Bolsas Globais', peso:2.5 },
        ],
        fundos_listados: [
          { nome:'Top FIIs', peso:2.5 },
        ],
      },
    },
    moderada: {
      macro: { pos_fixada:35.5, inflacao:22.5, pre_fixada:10, renda_fixa_global:2.5, multimercados:14, renda_variavel_brasil:5, renda_variavel_global:3.5, fundos_listados:4, alternativos:3 },
      produtos: {
        pos_fixada: [
          { nome:'LFT – Selic + 0,01% - 01/03/2029', peso:15 },
          { nome:'LCA Banco Original - 91% CDI - 05/04/2029', peso:5.5 },
          { nome:'AZ Quest Altro Advisory FIC FIF Multimercado CP', peso:3.5 },
          { nome:'Legacy Capital Credit Advisory FIC FIM CP', peso:3.5 },
          { nome:'SulAmérica Crédito Ativo FIRF CP LP', peso:4.5 },
          { nome:'XP Crédito Estruturado 360 FIDC RL', peso:3.5 },
        ],
        inflacao: [
          { nome:'NTN-B 15/08/2032 IPCA + 7,30%', peso:9.5 },
          { nome:'Debênture Isa Energia (CTEEP) - IPCA + 6,65% - 15/10/2036', peso:5 },
          { nome:'ARX Elbrus Advisory FIC INFRA RF', peso:4 },
          { nome:'AZ Quest Debêntures Incentivadas CP FIC de FIF Incentivado de Investimento em Infra RF', peso:4 },
        ],
        pre_fixada: [
          { nome:'TREND PRÉ-FIXADO RESP LIMITADA FI RENDA FIXA LP', peso:4.5 },
          { nome:'CDB Banco C6 - 14,6% - 24/04/2030', peso:5.5 },
        ],
        renda_fixa_global: [
          { nome:'HYBR11', peso:2.5 },
        ],
        multimercados: [
          { nome:'Kinea Atlas II FIM', peso:4 },
          { nome:'Kapitalo K10 Advisory FIF em Cotas de FIM', peso:4 },
          { nome:'Absolute Vertex Advisory FIC FIM', peso:3 },
          { nome:'Genoa Capital Radar Advisory FIC FIM', peso:3 },
        ],
        renda_variavel_brasil: [
          { nome:'XP Dividendos FIA', peso:3 },
          { nome:'PIBB11', peso:2 },
        ],
        renda_variavel_global: [
          { nome:'Trend Bolsas Globais', peso:3.5 },
        ],
        fundos_listados: [
          { nome:'Top FIIs', peso:4 },
        ],
        alternativos: [
          { nome:'GOLX11', peso:2 },
          { nome:'Trend Commodities FIF RL', peso:1 },
        ],
      },
    },
    agressiva: {
      macro: { pos_fixada:16, inflacao:27.5, pre_fixada:7.5, renda_fixa_global:2.5, multimercados:10, renda_variavel_brasil:15, renda_variavel_global:5, fundos_listados:9.5, alternativos:7 },
      produtos: {
        pos_fixada: [
          { nome:'LFT – Selic + 0,01% - 01/03/2029', peso:8.5 },
          { nome:'Legacy Capital Credit Advisory FIC FIM CP', peso:4.5 },
          { nome:'XP Crédito Estruturado 360 FIDC RL', peso:3 },
        ],
        inflacao: [
          { nome:'NTN-B 15/08/2032 IPCA + 7,30%', peso:10 },
          { nome:'Debênture Isa Energia (CTEEP) - IPCA + 6,65% - 15/10/2036', peso:5 },
          { nome:'ARX Elbrus Advisory FIC INFRA RF', peso:7.5 },
          { nome:'AZ Quest Debêntures Incentivadas CP FIC de FIF Incentivado de Investimento em Infra RF', peso:5 },
        ],
        pre_fixada: [
          { nome:'TREND PRÉ-FIXADO RESP LIMITADA FI RENDA FIXA LP', peso:3.5 },
          { nome:'CDB Banco C6 - 14,6% - 24/04/2030', peso:4 },
        ],
        renda_fixa_global: [
          { nome:'HYBR11', peso:2.5 },
        ],
        multimercados: [
          { nome:'Kinea Atlas II FIM', peso:3 },
          { nome:'Kapitalo K10 Advisory FIF em Cotas de FIM', peso:3 },
          { nome:'Absolute Vertex Advisory FIC FIM', peso:2 },
          { nome:'Genoa Capital Radar Advisory FIC FIM', peso:2 },
        ],
        renda_variavel_brasil: [
          { nome:'Real Investor FIC FIA BDR Nível 1', peso:3 },
          { nome:'XP Dividendos FIA', peso:6 },
          { nome:'PIBB11', peso:6 },
        ],
        renda_variavel_global: [
          { nome:'Wellington Ventura FIA IE', peso:2.5 },
          { nome:'Trend Bolsas Globais', peso:2.5 },
        ],
        fundos_listados: [
          { nome:'Top FIIs', peso:9.5 },
        ],
        alternativos: [
          { nome:'GOLX11', peso:5 },
          { nome:'Trend Commodities FIF RL', peso:2 },
        ],
      },
    },
  },
]

// ── Statements ────────────────────────────────────────────────────────────

const insEstado = db.prepare(
  `INSERT INTO estados_portfolio (carteira_id, mes, data_inicio, data_fim) VALUES (?, ?, ?, ?)`
)
const insAloc = db.prepare(`
  INSERT OR REPLACE INTO alocacoes_macro
    (perfil_id, mes, pos_fixado, inflacao, prefixado, rf_global, multimercado,
     rv_brasil, rv_global, fundos_listados, alternativos)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
const insProd = db.prepare(`
  INSERT INTO produtos
    (estado_id, tipo, classe, nome, identificador, peso,
     indexador, tipo_cdi, taxa, data_emissao, data_vencimento, isento_ir)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

// ── Execução ──────────────────────────────────────────────────────────────

let stats = { estados: 0, alocacoes: 0, produtos: 0 }

db.transaction(() => {
  // Limpar dados anteriores
  const d1 = db.prepare(`DELETE FROM estados_portfolio WHERE carteira_id IN (2,4,6) AND mes >= '2026-01'`).run()
  const d2 = db.prepare(`DELETE FROM alocacoes_macro WHERE perfil_id IN (1,2,3) AND mes >= '2026-01'`).run()
  console.log(`Deleted: ${d1.changes} estados, ${d2.changes} alocacoes`)

  for (let pi = 0; pi < PERIODS.length; pi++) {
    const { data, mes, data_fim } = PERIODS[pi]
    const periodoData = DATA[pi]

    for (const [profile, { perfil_id, carteira_id }] of Object.entries(PROFILE_MAP)) {
      const pd = periodoData[profile]
      const m  = pd.macro

      // Alocação macro (uma vez por perfil × período)
      insAloc.run(
        perfil_id, mes,
        m.pos_fixada, m.inflacao, m.pre_fixada, m.renda_fixa_global, m.multimercados,
        m.renda_variavel_brasil, m.renda_variavel_global, m.fundos_listados, m.alternativos
      )
      stats.alocacoes++

      // Estado
      const r = insEstado.run(carteira_id, mes, data, data_fim)
      const estadoId = r.lastInsertRowid
      stats.estados++

      // Produtos
      for (const [inputClass, prods] of Object.entries(pd.produtos)) {
        const classeDb = CLASS_MAP[inputClass]
        if (!classeDb) { console.warn('Classe desconhecida:', inputClass); continue }

        for (const p of prods) {
          if (!p.peso || p.peso <= 0) continue  // pula zeros
          const nome = normalizeName(p.nome)
          const tipo = inferTipo(nome)
          const id   = getIdentificador(nome, tipo)
          const rf   = RF_PARAMS[nome] ?? {}

          insProd.run(
            estadoId, tipo, classeDb, nome, id, p.peso,
            rf.indexador ?? null,
            rf.tipo_cdi  ?? null,
            rf.taxa      ?? null,
            data,                    // data_emissao = data do rebalanceamento
            rf.data_vencimento ?? null,
            rf.isento_ir ?? 0
          )
          stats.produtos++
        }
      }
    }
  }
})()

// ── Verificações ──────────────────────────────────────────────────────────

console.log(`\n=== Resumo ===`)
console.log(`  Estados:   ${stats.estados}`)
console.log(`  Alocações: ${stats.alocacoes}`)
console.log(`  Produtos:  ${stats.produtos}`)

console.log('\n=== Estados por carteira ===')
const breakdown = db.prepare(`
  SELECT c.nome, ep.mes, ep.data_inicio, ep.data_fim, COUNT(p.id) as n
  FROM estados_portfolio ep
  JOIN carteiras c ON c.id = ep.carteira_id
  LEFT JOIN produtos p ON p.estado_id = ep.id
  WHERE ep.carteira_id IN (2,4,6) AND ep.mes >= '2026-01'
  GROUP BY ep.id ORDER BY ep.carteira_id, ep.mes
`).all()
breakdown.forEach(r =>
  console.log(`  ${r.nome.padEnd(16)} ${r.mes}  ${r.data_inicio} → ${(r.data_fim??'aberto').padEnd(10)}  ${r.n} produtos`)
)

console.log('\n=== Validação de pesos (soma por classe deve = alocação macro) ===')
const erros = db.prepare(`
  SELECT c.nome, ep.mes, ep.data_inicio, p.classe, ROUND(SUM(p.peso),4) as soma
  FROM produtos p
  JOIN estados_portfolio ep ON ep.id = p.estado_id
  JOIN carteiras c ON c.id = ep.carteira_id
  WHERE ep.carteira_id IN (2,4,6) AND ep.mes >= '2026-01'
  GROUP BY ep.id, p.classe
`).all()

// Para cada linha, verificar contra a alocação macro correspondente
const alocRows = db.prepare(`SELECT * FROM alocacoes_macro WHERE perfil_id IN (1,2,3) AND mes >= '2026-01'`).all()
const alocMap = {}
for (const a of alocRows) alocMap[`${a.perfil_id}|${a.mes}`] = a

const perfMap = { 2: 1, 4: 2, 6: 3 }
const carteiraPerfilMap = db.prepare('SELECT id, perfil_id FROM carteiras WHERE id IN (2,4,6)').all()
  .reduce((m, r) => { m[r.id] = r.perfil_id; return m }, {})

// Load carteira_id from estados
const estadosInfo = db.prepare(`SELECT ep.id, ep.carteira_id, ep.mes FROM estados_portfolio ep WHERE ep.carteira_id IN (2,4,6) AND ep.mes >= '2026-01'`).all()
const estadoCartMap = {}
for (const e of estadosInfo) estadoCartMap[e.id] = { carteira_id: e.carteira_id, mes: e.mes }

// Check with joined query
const checks = db.prepare(`
  SELECT ep.carteira_id, ep.mes, p.classe, ROUND(SUM(p.peso),2) as soma
  FROM produtos p
  JOIN estados_portfolio ep ON ep.id = p.estado_id
  WHERE ep.carteira_id IN (2,4,6) AND ep.mes >= '2026-01'
  GROUP BY ep.id, p.classe
`).all()

let ok = true
for (const row of checks) {
  const perfil_id = carteiraPerfilMap[row.carteira_id]
  const aloc = alocMap[`${perfil_id}|${row.mes}`]
  if (!aloc) continue
  const expected = aloc[row.classe]
  if (Math.abs(row.soma - expected) > 0.05) {
    console.log(`  ⚠ carteira=${row.carteira_id} mes=${row.mes} ${row.classe}: soma=${row.soma} esperado=${expected}`)
    ok = false
  }
}
if (ok) console.log('  Tudo ✓ — somas coincidem com alocação macro')
