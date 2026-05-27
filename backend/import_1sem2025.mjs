/**
 * Import Carteiras Alfa B – 1º semestre 2025
 * 5 períodos: Fev-10, Mar-10, Abr-09, Mai-09, Jun-10
 * Substitui os estados de fev-jun/25 nas carteiras 2, 4, 6
 */
import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const db = new Database(path.join(path.dirname(fileURLToPath(import.meta.url)), 'data/carteiras.db'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

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

const SUB_CARTEIRA = {
  'Top FIIs':              '7',
  'Carteira Top Dividendos': '9',
}

const RF_PARAMS = {
  'Tesouro Selic CDI+0,08% 2027':           { indexador:'CDI', tipo_cdi:'spread', taxa:0.08, data_vencimento:'2027-01-01', isento_ir:0 },
  'LCA BNDES 84% 15/01/2026':               { indexador:'CDI', tipo_cdi:'pct',    taxa:84,   data_vencimento:'2026-01-15', isento_ir:1 },
  'NTN-B IPCA+7,48 2030':                   { indexador:'IPCA', taxa:7.48, data_vencimento:'2030-01-01', isento_ir:0 },
  'CDB C6 IPCA+8,15 15/08/2028':            { indexador:'IPCA', taxa:8.15, data_vencimento:'2028-08-15', isento_ir:0 },
  'DEB Eletrobras IPCA+6,9% 15/09/2031':    { indexador:'IPCA', taxa:6.9,  data_vencimento:'2031-09-15', isento_ir:1 },
  'NTN-F 15,05% 2027':                      { indexador:'PRE',  taxa:15.05, data_vencimento:'2027-01-01', isento_ir:0 },
  'CDB Agibank 15,75% 14/01/2027':          { indexador:'PRE',  taxa:15.75, data_vencimento:'2027-01-14', isento_ir:0 },
  'CDB BMG 2028 103%':                      { indexador:'CDI', tipo_cdi:'pct',    taxa:103,  data_vencimento:'2028-01-01', isento_ir:0 },
  'CRA SÃO MARTINHO 2029':                  { indexador:'IPCA', taxa:null, data_vencimento:'2029-01-01', isento_ir:1 },
  'NTN-B 2030 7,38%':                       { indexador:'IPCA', taxa:7.38, data_vencimento:'2030-01-01', isento_ir:0 },
  'CRA RAIZEN 7,55% 2029':                  { indexador:'IPCA', taxa:7.55, data_vencimento:'2029-01-01', isento_ir:1 },
  'CDB BANCO C6 15%':                       { indexador:'PRE',  taxa:15,   data_vencimento:null, isento_ir:0 },
  'Tesouro Selic 2028':                     { indexador:'CDI', tipo_cdi:'spread', taxa:0,    data_vencimento:'2028-01-01', isento_ir:0 },
  'LCD BNDES 93% 2026':                     { indexador:'CDI', tipo_cdi:'pct',    taxa:93,   data_vencimento:'2026-01-01', isento_ir:1 },
  'CDB Agibank - Abr/2028 107% do CDI':     { indexador:'CDI', tipo_cdi:'pct',    taxa:107,  data_vencimento:'2028-04-01', isento_ir:0 },
  'NTN-B 2030 7,29%':                       { indexador:'IPCA', taxa:7.29, data_vencimento:'2030-01-01', isento_ir:0 },
  'CBD BMG 2029 7,5%':                      { indexador:'IPCA', taxa:7.5,  data_vencimento:'2029-01-01', isento_ir:0 },
  'LCA SICOOB':                             { indexador:'CDI', tipo_cdi:'pct',    taxa:null, data_vencimento:null, isento_ir:1 },
  'LCD BRDE - Mai/2029 94% do CDI':         { indexador:'CDI', tipo_cdi:'pct',    taxa:94,   data_vencimento:'2029-05-01', isento_ir:1 },
  'CRI CYRELA Abr/2030 95% do CDI':         { indexador:'CDI', tipo_cdi:'pct',    taxa:95,   data_vencimento:'2030-04-01', isento_ir:1 },
  'NTN-B - Ago/2028 IPCA+7,30':            { indexador:'IPCA', taxa:7.30, data_vencimento:'2028-08-01', isento_ir:0 },
  'DEB Rumo - Abr/2030 IPCA+6,9':          { indexador:'IPCA', taxa:6.9,  data_vencimento:'2030-04-01', isento_ir:1 },
  'LTN Jul/2027 13,34%':                    { indexador:'PRE',  taxa:13.34, data_vencimento:'2027-07-01', isento_ir:0 },
  'DEB Eletrobras - Set/2034 IPCA+ 6,85%':  { indexador:'IPCA', taxa:6.85, data_vencimento:'2034-09-01', isento_ir:1 },
  'CRA CMAA - Out/2034 IPCA+8,5':           { indexador:'IPCA', taxa:8.5,  data_vencimento:'2034-10-01', isento_ir:1 },
  'LCD BNDES Dez/2029 91% CDI':             { indexador:'CDI', tipo_cdi:'pct',    taxa:91,   data_vencimento:'2029-12-01', isento_ir:1 },
  'LCA SICOOB - Mai/2028 90% do CDI':       { indexador:'CDI', tipo_cdi:'pct',    taxa:90,   data_vencimento:'2028-05-01', isento_ir:1 },
  'LCA SICOOB - Abr/2028 91% do CDI':       { indexador:'CDI', tipo_cdi:'pct',    taxa:91,   data_vencimento:'2028-04-01', isento_ir:1 },
  'NTN-B - Ago/2028 IPCA+7,60':            { indexador:'IPCA', taxa:7.60, data_vencimento:'2028-08-01', isento_ir:0 },
}

function inferTipo(nome) {
  if (SUB_CARTEIRA[nome])       return 'carteira'
  if (nome.includes('BSHV39')) return 'acao'
  if (RF_PARAMS[nome])          return 'rf_curva'
  return 'fundo'
}

function getIdentificador(nome, tipo) {
  if (tipo === 'carteira') return SUB_CARTEIRA[nome]
  if (tipo === 'acao')     return 'BSHV39'
  return null
}

// ── Períodos ───────────────────────────────────────────────────────────────
const PERIODS = [
  { data:'2025-02-10', mes:'2025-02', data_fim:'2025-03-09' },
  { data:'2025-03-10', mes:'2025-03', data_fim:'2025-04-08' },
  { data:'2025-04-09', mes:'2025-04', data_fim:'2025-05-08' },
  { data:'2025-05-09', mes:'2025-05', data_fim:'2025-06-09' },
  { data:'2025-06-10', mes:'2025-06', data_fim:'2025-06-30' },
]

// ── Dados dos 5 períodos ──────────────────────────────────────────────────
const DATA = [
  // ── 2025-02-10 ─────────────────────────────────────────────────────────
  {
    conservadora: {
      macro: { pos_fixada:70, inflacao:17.5, pre_fixada:0, renda_fixa_global:2.5, multimercados:5, renda_variavel_brasil:0, renda_variavel_global:2.5, fundos_listados:2.5, alternativos:0 },
      produtos: {
        pos_fixada:            [{ nome:'Tesouro Selic CDI+0,08% 2027', peso:25 }, { nome:'LCA BNDES 84% 15/01/2026', peso:16 }, { nome:'XP 24 Horas FIRF RL', peso:12 }, { nome:'Selection RF Light FIC FIRF CP LP', peso:10 }, { nome:'Legacy Capital Credit Advisory FIC FIM CP', peso:4 }, { nome:'SulAmérica Crédito Ativo FIRF CP LP', peso:3 }],
        inflacao:              [{ nome:'NTN-B IPCA+7,48 2030', peso:12.5 }, { nome:'ARX Elbrus Advisory FIC INFRA RF', peso:2.5 }, { nome:'CDB C6 IPCA+8,15 15/08/2028', peso:2.5 }],
        pre_fixada:            [],
        renda_fixa_global:     [{ nome:'Trend Crédito Global', peso:2.5 }],
        multimercados:         [{ nome:'Novus Renda Fixa Exclusive FIC FI LP', peso:2 }, { nome:'AZ Quest Advisory Total Return FIC FIM', peso:1 }, { nome:'Selection Multimercado Plus FIC FIM', peso:2 }],
        renda_variavel_brasil: [],
        renda_variavel_global: [{ nome:'Trend Bolsas Globais', peso:2.5 }],
        fundos_listados:       [{ nome:'Top FIIs', peso:2.5 }],
        alternativos:          [],
      },
    },
    moderada: {
      macro: { pos_fixada:35, inflacao:27.5, pre_fixada:5, renda_fixa_global:2.5, multimercados:16.5, renda_variavel_brasil:5, renda_variavel_global:3.5, fundos_listados:2, alternativos:3 },
      produtos: {
        pos_fixada:            [{ nome:'Tesouro Selic CDI+0,08% 2027', peso:12 }, { nome:'LCA BNDES 84% 15/01/2026', peso:10 }, { nome:'Selection RF Light FIC FIRF CP LP', peso:5 }, { nome:'Legacy Capital Credit Advisory FIC FIM CP', peso:4 }, { nome:'Root Capital High Yield Advisory FIC FIM CP', peso:4 }],
        inflacao:              [{ nome:'NTN-B IPCA+7,48 2030', peso:10 }, { nome:'DEB Eletrobras IPCA+6,9% 15/09/2031', peso:10 }, { nome:'ARX Elbrus Advisory FIC INFRA RF', peso:7.5 }],
        pre_fixada:            [{ nome:'NTN-F 15,05% 2027', peso:3 }, { nome:'CDB Agibank 15,75% 14/01/2027', peso:2 }],
        renda_fixa_global:     [{ nome:'Trend Crédito Global', peso:2.5 }],
        multimercados:         [{ nome:'Kinea Atlas II FIM', peso:4 }, { nome:'Novus Renda Fixa Exclusive FIC FI LP', peso:6.5 }, { nome:'AZ Quest Advisory Total Return FIC FIM', peso:3 }, { nome:'Selection Multimercado Plus FIC FIM', peso:3 }],
        renda_variavel_brasil: [{ nome:'IP Participações IPG FIC FIF Ações - Resp Limitada', peso:2 }, { nome:'Carteira Top Dividendos', peso:3 }],
        renda_variavel_global: [{ nome:'Trend Bolsas Globais', peso:2.5 }, { nome:'Trend China', peso:1 }],
        fundos_listados:       [{ nome:'Top FIIs', peso:2 }],
        alternativos:          [{ nome:'Trend Ouro', peso:1 }, { nome:'Ilíquidos', peso:1 }, { nome:'Capitânia Yield 120 CP FIC FIM CP', peso:1 }],
      },
    },
    agressiva: {
      macro: { pos_fixada:15, inflacao:32.5, pre_fixada:2.5, renda_fixa_global:2.5, multimercados:12.5, renda_variavel_brasil:15, renda_variavel_global:5, fundos_listados:8, alternativos:7 },
      produtos: {
        pos_fixada:            [{ nome:'Tesouro Selic CDI+0,08% 2027', peso:5 }, { nome:'LCA BNDES 84% 15/01/2026', peso:5 }, { nome:'Legacy Capital Credit Advisory FIC FIM CP', peso:2 }, { nome:'Root Capital High Yield Advisory FIC FIM CP', peso:3 }],
        inflacao:              [{ nome:'NTN-B IPCA+7,48 2030', peso:10 }, { nome:'DEB Eletrobras IPCA+6,9% 15/09/2031', peso:10 }, { nome:'ARX Elbrus Advisory FIC INFRA RF', peso:7.5 }, { nome:'CDB C6 IPCA+8,15 15/08/2028', peso:5 }],
        pre_fixada:            [{ nome:'CDB Agibank 15,75% 14/01/2027', peso:2.5 }],
        renda_fixa_global:     [{ nome:'Trend Crédito Global', peso:2.5 }],
        multimercados:         [{ nome:'Kinea Atlas II FIM', peso:5.5 }, { nome:'Novus Renda Fixa Exclusive FIC FI LP', peso:3 }, { nome:'AZ Quest Advisory Total Return FIC FIM', peso:2 }, { nome:'Selection Multimercado Plus FIC FIM', peso:2 }],
        renda_variavel_brasil: [{ nome:'IP Participações IPG FIC FIF Ações - Resp Limitada', peso:5 }, { nome:'Oceana Long Biased Advisory FIC FIA', peso:5 }, { nome:'Carteira Top Dividendos', peso:5 }],
        renda_variavel_global: [{ nome:'Morgan Stanley Global Brands Advisory FIC FIA IE', peso:1 }, { nome:'Trend Bolsas Globais', peso:3 }, { nome:'Trend China', peso:1 }],
        fundos_listados:       [{ nome:'Top FIIs', peso:8 }],
        alternativos:          [{ nome:'Trend Commodities', peso:3 }, { nome:'Ilíquidos', peso:4 }],
      },
    },
  },

  // ── 2025-03-10 ─────────────────────────────────────────────────────────
  {
    conservadora: {
      macro: { pos_fixada:70, inflacao:15, pre_fixada:0, renda_fixa_global:2.5, multimercados:5, renda_variavel_brasil:0, renda_variavel_global:2.5, fundos_listados:2.5, alternativos:0 },
      produtos: {
        pos_fixada:            [{ nome:'Tesouro Selic 2028', peso:25 }, { nome:'CDB BMG 2028 103%', peso:6 }, { nome:'CRA SÃO MARTINHO 2029', peso:4 }, { nome:'Selection RF Light FIC FIRF CP LP', peso:10 }, { nome:'Legacy Capital Credit Advisory FIC FIM CP', peso:5 }, { nome:'Trend DI Simples', peso:10 }, { nome:'XP 24 Horas FIRF RL', peso:10 }],
        inflacao:              [{ nome:'NTN-B 2030 7,38%', peso:12.5 }, { nome:'CRA RAIZEN 7,55% 2029', peso:2.5 }],
        pre_fixada:            [],
        renda_fixa_global:     [{ nome:'Ishares Short Treasury (BSHV39)', peso:1.5 }, { nome:'PIMCO Income FIC FIM IE', peso:1 }],
        multimercados:         [{ nome:'Novus Renda Fixa Exclusive FIC FI LP', peso:2 }, { nome:'AZ Quest Advisory Total Return FIC FIM', peso:1 }, { nome:'Quantitas FC FI Mult Mallorca', peso:2 }],
        renda_variavel_brasil: [],
        renda_variavel_global: [{ nome:'Trend Bolsas Globais', peso:2.5 }],
        fundos_listados:       [{ nome:'Top FIIs', peso:2.5 }],
        alternativos:          [],
      },
    },
    moderada: {
      macro: { pos_fixada:35, inflacao:27.5, pre_fixada:5, renda_fixa_global:2.5, multimercados:16.5, renda_variavel_brasil:5, renda_variavel_global:3.5, fundos_listados:2, alternativos:3 },
      produtos: {
        pos_fixada:            [{ nome:'Tesouro Selic 2028', peso:15 }, { nome:'CDB BMG 2028 103%', peso:4 }, { nome:'CRA SÃO MARTINHO 2029', peso:3 }, { nome:'Selection RF Light FIC FIRF CP LP', peso:5 }, { nome:'Legacy Capital Credit Advisory FIC FIM CP', peso:4 }, { nome:'Root Capital High Yield Advisory FIC FIM CP', peso:4 }],
        inflacao:              [{ nome:'NTN-B 2030 7,38%', peso:10 }, { nome:'CRA RAIZEN 7,55% 2029', peso:5 }, { nome:'ARX Elbrus Advisory FIC INFRA RF', peso:8 }, { nome:'XP Debêntures Incentivadas CP FIC FIM', peso:4.5 }],
        pre_fixada:            [{ nome:'CDB BANCO C6 15%', peso:5 }],
        renda_fixa_global:     [{ nome:'Ishares Short Treasury (BSHV39)', peso:1.5 }, { nome:'PIMCO Income FIC FIM IE', peso:1 }],
        multimercados:         [{ nome:'Kinea Atlas II FIM', peso:3 }, { nome:'Novus Renda Fixa Exclusive FIC FI LP', peso:6.5 }, { nome:'AZ Quest Advisory Total Return FIC FIM', peso:3.5 }, { nome:'Selection Multimercado Plus FIC FIM', peso:3.5 }],
        renda_variavel_brasil: [{ nome:'IP Participações IPG FIC FIF Ações - Resp Limitada', peso:2 }, { nome:'Carteira Top Dividendos', peso:3 }],
        renda_variavel_global: [{ nome:'Trend Bolsas Globais', peso:2.5 }, { nome:'Trend China', peso:1 }],
        fundos_listados:       [{ nome:'Top FIIs', peso:2 }],
        alternativos:          [{ nome:'Trend Ouro', peso:1 }, { nome:'XP Crédito Estruturado 120 FIC FIM CP', peso:1 }, { nome:'Capitânia Yield 120 CP FIC FIM CP', peso:1 }],
      },
    },
    agressiva: {
      macro: { pos_fixada:15, inflacao:32.5, pre_fixada:2.5, renda_fixa_global:2.5, multimercados:12.5, renda_variavel_brasil:15, renda_variavel_global:5, fundos_listados:8, alternativos:7 },
      produtos: {
        pos_fixada:            [{ nome:'Tesouro Selic 2028', peso:4 }, { nome:'CDB BMG 2028 103%', peso:3 }, { nome:'CRA SÃO MARTINHO 2029', peso:3 }, { nome:'Legacy Capital Credit Advisory FIC FIM CP', peso:2 }, { nome:'Root Capital High Yield Advisory FIC FIM CP', peso:3 }],
        inflacao:              [{ nome:'NTN-B 2030 7,38%', peso:15 }, { nome:'CRA RAIZEN 7,55% 2029', peso:5 }, { nome:'ARX Elbrus Advisory FIC INFRA RF', peso:7.5 }, { nome:'XP Debêntures Incentivadas CP FIC FIM', peso:5 }],
        pre_fixada:            [{ nome:'CDB BANCO C6 15%', peso:2.5 }],
        renda_fixa_global:     [{ nome:'Ishares Short Treasury (BSHV39)', peso:1.5 }, { nome:'PIMCO Income FIC FIM IE', peso:1 }],
        multimercados:         [{ nome:'Kinea Atlas II FIM', peso:3 }, { nome:'Novus Renda Fixa Exclusive FIC FI LP', peso:3 }, { nome:'AZ Quest Advisory Total Return FIC FIM', peso:2 }, { nome:'Selection Multimercado Plus FIC FIM', peso:2 }, { nome:'Absolute Vertex Advisory FIC FIM', peso:2.5 }],
        renda_variavel_brasil: [{ nome:'IP Participações IPG FIC FIF Ações - Resp Limitada', peso:5 }, { nome:'Oceana Long Biased Advisory FIC FIA', peso:5 }, { nome:'Carteira Top Dividendos', peso:5 }],
        renda_variavel_global: [{ nome:'Morgan Stanley Global Brands Advisory FIC FIA IE', peso:1.5 }, { nome:'Trend Bolsas Globais', peso:2.5 }, { nome:'Trend China', peso:1 }],
        fundos_listados:       [{ nome:'Top FIIs', peso:8 }],
        alternativos:          [{ nome:'Trend Ouro', peso:3 }, { nome:'XP Crédito Estruturado 120 FIC FIM CP', peso:2 }, { nome:'Capitânia Yield 120 CP FIC FIM CP', peso:2 }],
      },
    },
  },

  // ── 2025-04-09 ─────────────────────────────────────────────────────────
  {
    conservadora: {
      macro: { pos_fixada:70, inflacao:17.5, pre_fixada:0, renda_fixa_global:2.5, multimercados:5, renda_variavel_brasil:0, renda_variavel_global:2.5, fundos_listados:2.5, alternativos:0 },
      produtos: {
        pos_fixada:            [{ nome:'Tesouro Selic 2028', peso:25 }, { nome:'LCD BNDES 93% 2026', peso:8 }, { nome:'CDB Agibank - Abr/2028 107% do CDI', peso:8 }, { nome:'Selection RF Light FIC FIRF CP LP', peso:12 }, { nome:'Legacy Capital Credit Advisory FIC FIM CP', peso:5 }, { nome:'Trend DI Simples', peso:10 }],
        inflacao:              [{ nome:'NTN-B 2030 7,29%', peso:12.5 }, { nome:'CBD BMG 2029 7,5%', peso:2.5 }, { nome:'ARX Elbrus Advisory FIC INFRA RF', peso:2.5 }],
        pre_fixada:            [],
        renda_fixa_global:     [{ nome:'Trend Crédito Global', peso:2.5 }],
        multimercados:         [{ nome:'Novus Renda Fixa Exclusive FIC FI LP', peso:2 }, { nome:'AZ Quest Advisory Total Return FIC FIM', peso:1 }, { nome:'Selection Multimercado Plus FIC FIM', peso:2 }],
        renda_variavel_brasil: [],
        renda_variavel_global: [{ nome:'Trend Bolsas Globais', peso:2.5 }],
        fundos_listados:       [{ nome:'Top FIIs', peso:2.5 }],
        alternativos:          [],
      },
    },
    moderada: {
      macro: { pos_fixada:35, inflacao:27.5, pre_fixada:5, renda_fixa_global:2.5, multimercados:16.5, renda_variavel_brasil:5, renda_variavel_global:3.5, fundos_listados:2, alternativos:3 },
      produtos: {
        pos_fixada:            [{ nome:'Tesouro Selic 2028', peso:15 }, { nome:'LCD BNDES 93% 2026', peso:5 }, { nome:'CDB Agibank - Abr/2028 107% do CDI', peso:5 }, { nome:'Selection RF Light FIC FIRF CP LP', peso:5 }, { nome:'Legacy Capital Credit Advisory FIC FIM CP', peso:4 }, { nome:'Root Capital High Yield Advisory FIC FIM CP', peso:4 }],
        inflacao:              [{ nome:'NTN-B 2030 7,29%', peso:10 }, { nome:'CBD BMG 2029 7,5%', peso:5 }, { nome:'ARX Elbrus Advisory FIC INFRA RF', peso:8 }, { nome:'XP Debêntures Incentivadas CP FIC FIM', peso:4.5 }],
        pre_fixada:            [{ nome:'CDB BANCO C6 15%', peso:5 }],
        renda_fixa_global:     [{ nome:'Trend Crédito Global', peso:2.5 }],
        multimercados:         [{ nome:'Kinea Atlas II FIM', peso:3 }, { nome:'Novus Renda Fixa Exclusive FIC FI LP', peso:6.5 }, { nome:'AZ Quest Advisory Total Return FIC FIM', peso:3.5 }, { nome:'Selection Multimercado Plus FIC FIM', peso:3.5 }],
        renda_variavel_brasil: [{ nome:'IP Participações IPG FIC FIF Ações - Resp Limitada', peso:2 }, { nome:'Carteira Top Dividendos', peso:3 }],
        renda_variavel_global: [{ nome:'Trend Bolsas Globais', peso:2.5 }, { nome:'Trend China', peso:1 }],
        fundos_listados:       [{ nome:'Top FIIs', peso:2 }],
        alternativos:          [{ nome:'Trend Ouro', peso:1 }, { nome:'XP Crédito Estruturado 120 FIC FIM CP', peso:1 }, { nome:'Capitânia Yield 120 CP FIC FIM CP', peso:1 }],
      },
    },
    agressiva: {
      macro: { pos_fixada:15, inflacao:32.5, pre_fixada:2.5, renda_fixa_global:2.5, multimercados:12.5, renda_variavel_brasil:15, renda_variavel_global:5, fundos_listados:8, alternativos:7 },
      produtos: {
        pos_fixada:            [{ nome:'Tesouro Selic 2028', peso:4 }, { nome:'LCA SICOOB', peso:3 }, { nome:'CRA SÃO MARTINHO 2029', peso:3 }, { nome:'Legacy Capital Credit Advisory FIC FIM CP', peso:2 }, { nome:'Root Capital High Yield Advisory FIC FIM CP', peso:3 }],
        inflacao:              [{ nome:'NTN-B 2030 7,29%', peso:15 }, { nome:'CBD BMG 2029 7,5%', peso:5 }, { nome:'ARX Elbrus Advisory FIC INFRA RF', peso:7.5 }, { nome:'XP Debêntures Incentivadas CP FIC FIM', peso:5 }],
        pre_fixada:            [{ nome:'CDB BANCO C6 15%', peso:2.5 }],
        renda_fixa_global:     [{ nome:'Trend Crédito Global', peso:2.5 }],
        multimercados:         [{ nome:'Kinea Atlas II FIM', peso:3 }, { nome:'Novus Renda Fixa Exclusive FIC FI LP', peso:5.5 }, { nome:'AZ Quest Advisory Total Return FIC FIM', peso:2 }, { nome:'Selection Multimercado Plus FIC FIM', peso:2 }],
        renda_variavel_brasil: [{ nome:'IP Participações IPG FIC FIF Ações - Resp Limitada', peso:5 }, { nome:'Oceana Long Biased Advisory FIC FIA', peso:5 }, { nome:'Carteira Top Dividendos', peso:5 }],
        renda_variavel_global: [{ nome:'Morgan Stanley Global Brands Advisory FIC FIA IE', peso:1.5 }, { nome:'Trend Bolsas Globais', peso:2.5 }, { nome:'Trend China', peso:1 }],
        fundos_listados:       [{ nome:'Top FIIs', peso:8 }],
        alternativos:          [{ nome:'Trend Ouro', peso:3 }, { nome:'XP Crédito Estruturado 120 FIC FIM CP', peso:2 }, { nome:'Capitânia Yield 120 CP FIC FIM CP', peso:2 }],
      },
    },
  },

  // ── 2025-05-09 ─────────────────────────────────────────────────────────
  {
    conservadora: {
      macro: { pos_fixada:70, inflacao:17.5, pre_fixada:0, renda_fixa_global:2.5, multimercados:5, renda_variavel_brasil:0, renda_variavel_global:2.5, fundos_listados:2.5, alternativos:0 },
      produtos: {
        pos_fixada:            [{ nome:'Tesouro Selic - Mar/2028 Selic +0,07%', peso:25 }, { nome:'LCA SICOOB - Mai/2028 90% do CDI', peso:10 }, { nome:'LCD BRDE - Mai/2029 94% do CDI', peso:8 }, { nome:'Selection RF Light FIC FIRF CP LP', peso:12 }, { nome:'Legacy Capital Credit Advisory FIC FIM CP', peso:5 }, { nome:'Trend DI Simples', peso:10 }],
        inflacao:              [{ nome:'NTN-B - Ago/2028 IPCA+7,30', peso:12.5 }, { nome:'DEB Rumo - Abr/2030 IPCA+6,9', peso:2.5 }, { nome:'ARX Elbrus Advisory FIC INFRA RF', peso:2.5 }],
        pre_fixada:            [],
        renda_fixa_global:     [{ nome:'Trend Crédito Global', peso:1.5 }, { nome:'PIMCO Income FIC FIM IE', peso:1 }],
        multimercados:         [{ nome:'Novus Renda Fixa Exclusive FIC FI LP', peso:2 }, { nome:'Absolute Vertex Advisory FIC FIM', peso:1.5 }, { nome:'Genoa Capital Radar Advisory FIC FIM', peso:1.5 }],
        renda_variavel_brasil: [],
        renda_variavel_global: [{ nome:'Trend Bolsas Globais', peso:2.5 }],
        fundos_listados:       [{ nome:'Top FIIs', peso:2.5 }],
        alternativos:          [],
      },
    },
    moderada: {
      macro: { pos_fixada:35, inflacao:27.5, pre_fixada:7.5, renda_fixa_global:2.5, multimercados:16.5, renda_variavel_brasil:5, renda_variavel_global:3.5, fundos_listados:2, alternativos:3 },
      produtos: {
        pos_fixada:            [{ nome:'Tesouro Selic - Mar/2028 Selic +0,07%', peso:10 }, { nome:'LCA SICOOB - Mai/2028 90% do CDI', peso:7 }, { nome:'LCD BRDE - Mai/2029 94% do CDI', peso:7 }, { nome:'CRI CYRELA Abr/2030 95% do CDI', peso:5 }, { nome:'Selection RF Light FIC FIRF CP LP', peso:5 }, { nome:'Legacy Capital Credit Advisory FIC FIM CP', peso:4 }, { nome:'Root Capital High Yield Advisory FIC FIM CP', peso:4 }],
        inflacao:              [{ nome:'NTN-B - Ago/2028 IPCA+7,30', peso:10 }, { nome:'DEB Rumo - Abr/2030 IPCA+6,9', peso:5 }, { nome:'ARX Elbrus Advisory FIC INFRA RF', peso:5.5 }, { nome:'XP Debêntures Incentivadas CP FIC FIM', peso:4.5 }, { nome:'DEB Eletrobras - Set/2034 IPCA+ 6,85%', peso:5 }],
        pre_fixada:            [{ nome:'LTN Jul/2027 13,34%', peso:7.5 }],
        renda_fixa_global:     [{ nome:'Trend Crédito Global', peso:1.5 }, { nome:'PIMCO Income FIC FIM IE', peso:1 }],
        multimercados:         [{ nome:'Kinea Atlas II FIM', peso:3 }, { nome:'Novus Renda Fixa Exclusive FIC FI LP', peso:6.5 }, { nome:'Absolute Vertex Advisory FIC FIM', peso:3.5 }, { nome:'Genoa Capital Radar Advisory FIC FIM', peso:3.5 }],
        renda_variavel_brasil: [{ nome:'Real Investor FIC FIA BDR Nível 1', peso:2 }, { nome:'Carteira Top Dividendos', peso:3 }],
        renda_variavel_global: [{ nome:'Trend Bolsas Globais', peso:3.5 }],
        fundos_listados:       [{ nome:'Top FIIs', peso:2 }],
        alternativos:          [{ nome:'Trend Ouro', peso:3 }],
      },
    },
    agressiva: {
      macro: { pos_fixada:15, inflacao:32.5, pre_fixada:2.5, renda_fixa_global:2.5, multimercados:12.5, renda_variavel_brasil:15, renda_variavel_global:5, fundos_listados:8, alternativos:7 },
      produtos: {
        pos_fixada:            [{ nome:'Tesouro Selic - Mar/2028 Selic +0,07%', peso:4 }, { nome:'LCA SICOOB - Mai/2028 90% do CDI', peso:3 }, { nome:'CRI CYRELA Abr/2030 95% do CDI', peso:3 }, { nome:'Legacy Capital Credit Advisory FIC FIM CP', peso:2 }, { nome:'Root Capital High Yield Advisory FIC FIM CP', peso:3 }],
        inflacao:              [{ nome:'NTN-B - Ago/2028 IPCA+7,30', peso:12.5 }, { nome:'DEB Rumo - Abr/2030 IPCA+6,9', peso:5 }, { nome:'ARX Elbrus Advisory FIC INFRA RF', peso:7.5 }, { nome:'XP Debêntures Incentivadas CP FIC FIM', peso:5 }, { nome:'CRA CMAA - Out/2034 IPCA+8,5', peso:5 }],
        pre_fixada:            [{ nome:'LTN Jul/2027 13,34%', peso:2.5 }],
        renda_fixa_global:     [{ nome:'Trend Crédito Global', peso:1.5 }, { nome:'PIMCO Income FIC FIM IE', peso:1 }],
        multimercados:         [{ nome:'Kinea Atlas II FIM', peso:3 }, { nome:'Novus Renda Fixa Exclusive FIC FI LP', peso:5.5 }, { nome:'Absolute Vertex Advisory FIC FIM', peso:2 }, { nome:'Genoa Capital Radar Advisory FIC FIM', peso:2 }],
        renda_variavel_brasil: [{ nome:'Real Investor FIC FIA BDR Nível 1', peso:5 }, { nome:'Oceana Long Biased Advisory FIC FIA', peso:5 }, { nome:'Carteira Top Dividendos', peso:5 }],
        renda_variavel_global: [{ nome:'Trend Bolsas Globais', peso:3 }, { nome:'Morgan Stanley Global Brands Advisory FIC FIA IE', peso:2 }],
        fundos_listados:       [{ nome:'Top FIIs', peso:8 }],
        alternativos:          [{ nome:'Trend Ouro', peso:7 }],
      },
    },
  },

  // ── 2025-06-10 ─────────────────────────────────────────────────────────
  {
    conservadora: {
      macro: { pos_fixada:70, inflacao:17.5, pre_fixada:0, renda_fixa_global:2.5, multimercados:5, renda_variavel_brasil:0, renda_variavel_global:2.5, fundos_listados:2.5, alternativos:0 },
      produtos: {
        pos_fixada:            [{ nome:'Tesouro Selic - Mar/2028 Selic +0,07%', peso:35 }, { nome:'LCD BNDES Dez/2029 91% CDI', peso:10 }, { nome:'LCA SICOOB - Abr/2028 91% do CDI', peso:10 }, { nome:'Selection RF Light FIC FIRF CP LP', peso:12 }, { nome:'Legacy Capital Credit Advisory FIC FIM CP', peso:5 }, { nome:'SulAmérica Crédito Ativo FIRF CP LP', peso:3 }],
        inflacao:              [{ nome:'NTN-B - Ago/2028 IPCA+7,60', peso:10 }, { nome:'DEB Rumo - Abr/2030 IPCA+6,9', peso:2.5 }, { nome:'ARX Elbrus Advisory FIC INFRA RF', peso:2.5 }, { nome:'XP Debêntures Incentivadas CP FIC FIM', peso:2.5 }],
        pre_fixada:            [],
        renda_fixa_global:     [{ nome:'Trend Crédito Global', peso:1.5 }, { nome:'PIMCO Income FIC FIM IE', peso:1 }],
        multimercados:         [{ nome:'Novus Renda Fixa Exclusive FIC FI LP', peso:2 }, { nome:'Absolute Vertex Advisory FIC FIM', peso:1.5 }, { nome:'Genoa Capital Radar Advisory FIC FIM', peso:1.5 }],
        renda_variavel_brasil: [],
        renda_variavel_global: [{ nome:'Trend Bolsas Globais', peso:2.5 }],
        fundos_listados:       [{ nome:'Top FIIs', peso:2.5 }],
        alternativos:          [],
      },
    },
    moderada: {
      macro: { pos_fixada:35, inflacao:25, pre_fixada:7.5, renda_fixa_global:2.5, multimercados:16.5, renda_variavel_brasil:5, renda_variavel_global:3.5, fundos_listados:2, alternativos:3 },
      produtos: {
        pos_fixada:            [{ nome:'Tesouro Selic - Mar/2028 Selic +0,07%', peso:10 }, { nome:'LCD BNDES Dez/2029 91% CDI', peso:7 }, { nome:'LCA SICOOB - Abr/2028 91% do CDI', peso:7 }, { nome:'Selection RF Light FIC FIRF CP LP', peso:5 }, { nome:'Legacy Capital Credit Advisory FIC FIM CP', peso:4 }, { nome:'Root Capital High Yield Advisory FIC FIM CP', peso:4 }],
        inflacao:              [{ nome:'NTN-B - Ago/2028 IPCA+7,60', peso:10 }, { nome:'DEB Rumo - Abr/2030 IPCA+6,9', peso:5 }, { nome:'ARX Elbrus Advisory FIC INFRA RF', peso:5.5 }, { nome:'XP Debêntures Incentivadas CP FIC FIM', peso:4.5 }],
        pre_fixada:            [{ nome:'LTN Jul/2027 13,34%', peso:7.5 }],
        renda_fixa_global:     [{ nome:'Trend Crédito Global', peso:1.5 }, { nome:'PIMCO Income FIC FIM IE', peso:1 }],
        multimercados:         [{ nome:'Kinea Atlas II FIM', peso:3 }, { nome:'Novus Renda Fixa Exclusive FIC FI LP', peso:6.5 }, { nome:'Absolute Vertex Advisory FIC FIM', peso:3.5 }, { nome:'Genoa Capital Radar Advisory FIC FIM', peso:3.5 }],
        renda_variavel_brasil: [{ nome:'Real Investor FIC FIA BDR Nível 1', peso:2 }, { nome:'Carteira Top Dividendos', peso:3 }],
        renda_variavel_global: [{ nome:'Trend Bolsas Globais', peso:3.5 }],
        fundos_listados:       [{ nome:'Top FIIs', peso:2 }],
        alternativos:          [{ nome:'Trend Ouro', peso:3 }],
      },
    },
    agressiva: {
      macro: { pos_fixada:15, inflacao:30, pre_fixada:5, renda_fixa_global:2.5, multimercados:12.5, renda_variavel_brasil:15, renda_variavel_global:5, fundos_listados:8, alternativos:7 },
      produtos: {
        pos_fixada:            [{ nome:'Tesouro Selic - Mar/2028 Selic +0,07%', peso:4 }, { nome:'LCD BNDES Dez/2029 91% CDI', peso:3 }, { nome:'LCA SICOOB - Abr/2028 91% do CDI', peso:3 }, { nome:'Legacy Capital Credit Advisory FIC FIM CP', peso:2 }, { nome:'Root Capital High Yield Advisory FIC FIM CP', peso:3 }],
        inflacao:              [{ nome:'NTN-B - Ago/2028 IPCA+7,60', peso:12.5 }, { nome:'DEB Rumo - Abr/2030 IPCA+6,9', peso:5 }, { nome:'ARX Elbrus Advisory FIC INFRA RF', peso:7.5 }, { nome:'XP Debêntures Incentivadas CP FIC FIM', peso:5 }],
        pre_fixada:            [{ nome:'LTN Jul/2027 13,34%', peso:5 }],
        renda_fixa_global:     [{ nome:'Trend Crédito Global', peso:1.5 }, { nome:'PIMCO Income FIC FIM IE', peso:1 }],
        multimercados:         [{ nome:'Kinea Atlas II FIM', peso:3 }, { nome:'Novus Renda Fixa Exclusive FIC FI LP', peso:5.5 }, { nome:'Absolute Vertex Advisory FIC FIM', peso:2 }, { nome:'Genoa Capital Radar Advisory FIC FIM', peso:2 }],
        renda_variavel_brasil: [{ nome:'Real Investor FIC FIA BDR Nível 1', peso:5 }, { nome:'Oceana Long Biased Advisory FIC FIA', peso:5 }, { nome:'Carteira Top Dividendos', peso:5 }],
        renda_variavel_global: [{ nome:'Trend Bolsas Globais', peso:3 }, { nome:'Morgan Stanley Global Brands Advisory FIC FIA IE', peso:2 }],
        fundos_listados:       [{ nome:'Top FIIs', peso:8 }],
        alternativos:          [{ nome:'Trend Ouro', peso:7 }],
      },
    },
  },
]

// ── Statements ─────────────────────────────────────────────────────────────
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

// ── Execução ────────────────────────────────────────────────────────────────
const MES_ALVO = ['2025-02','2025-03','2025-04','2025-05','2025-06']

let stats = { estados:0, alocacoes:0, produtos:0 }

db.transaction(() => {
  // Remover apenas fev-jun/25 das carteiras Alfa (produtos primeiro por FK)
  // alertas_auditoria não tem CASCADE, nullificar referências antes
  db.prepare(
    `UPDATE alertas_auditoria SET produto_id = NULL WHERE produto_id IN (
       SELECT id FROM produtos WHERE estado_id IN (
         SELECT id FROM estados_portfolio WHERE carteira_id IN (2,4,6)
         AND mes IN ('2025-02','2025-03','2025-04','2025-05','2025-06')
       )
     )`
  ).run()
  const d0 = db.prepare(
    `DELETE FROM produtos WHERE estado_id IN (
       SELECT id FROM estados_portfolio WHERE carteira_id IN (2,4,6)
       AND mes IN ('2025-02','2025-03','2025-04','2025-05','2025-06')
     )`
  ).run()
  const d1 = db.prepare(
    `DELETE FROM estados_portfolio WHERE carteira_id IN (2,4,6) AND mes IN ('2025-02','2025-03','2025-04','2025-05','2025-06')`
  ).run()
  const d2 = db.prepare(
    `DELETE FROM alocacoes_macro WHERE perfil_id IN (1,2,3) AND mes IN ('2025-02','2025-03','2025-04','2025-05','2025-06')`
  ).run()
  console.log(`Deletados: ${d0.changes} produtos, ${d1.changes} estados, ${d2.changes} alocacoes`)

  for (let pi = 0; pi < PERIODS.length; pi++) {
    const { data, mes, data_fim } = PERIODS[pi]
    const periodoData = DATA[pi]

    for (const [profile, { perfil_id, carteira_id }] of Object.entries(PROFILE_MAP)) {
      const pd = periodoData[profile]
      const m  = pd.macro

      // Macro
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
          if (!p.peso || p.peso <= 0) continue
          const tipo = inferTipo(p.nome)
          const id   = getIdentificador(p.nome, tipo)
          const rf   = RF_PARAMS[p.nome] ?? {}

          insProd.run(
            estadoId, tipo, classeDb, p.nome, id, p.peso,
            rf.indexador ?? null, rf.tipo_cdi ?? null, rf.taxa ?? null,
            data, rf.data_vencimento ?? null,
            rf.isento_ir ?? 0
          )
          stats.produtos++
        }
      }
    }
  }
})()

// ── Resumo ─────────────────────────────────────────────────────────────────
console.log(`\n=== Resumo ===`)
console.log(`  Estados:   ${stats.estados}`)
console.log(`  Alocações: ${stats.alocacoes}`)
console.log(`  Produtos:  ${stats.produtos}`)

console.log('\n=== Estados inseridos ===')
db.prepare(`
  SELECT c.nome, ep.mes, ep.data_inicio, ep.data_fim, COUNT(p.id) as n
  FROM estados_portfolio ep
  JOIN carteiras c ON c.id = ep.carteira_id
  LEFT JOIN produtos p ON p.estado_id = ep.id
  WHERE ep.carteira_id IN (2,4,6) AND ep.mes IN ('2025-02','2025-03','2025-04','2025-05','2025-06')
  GROUP BY ep.id ORDER BY ep.carteira_id, ep.mes
`).all().forEach(r =>
  console.log(`  ${r.nome.padEnd(16)} ${r.mes}  ${r.data_inicio} → ${(r.data_fim??'aberto').padEnd(10)}  ${r.n} produtos`)
)
