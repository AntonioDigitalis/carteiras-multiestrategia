import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const db = new Database(path.join(path.dirname(fileURLToPath(import.meta.url)), 'data/carteiras.db'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

const MESES = ['2025-07','2025-08','2025-09','2025-10','2025-11','2025-12']

const PERIODS = [
  { data:'2025-07-09', mes:'2025-07', data_fim:'2025-08-07' },
  { data:'2025-08-08', mes:'2025-08', data_fim:'2025-09-08' },
  { data:'2025-09-09', mes:'2025-09', data_fim:'2025-10-08' },
  { data:'2025-10-09', mes:'2025-10', data_fim:'2025-11-09' },
  { data:'2025-11-10', mes:'2025-11', data_fim:'2025-12-08' },
  { data:'2025-12-09', mes:'2025-12', data_fim:'2026-01-08' },
]

const PROFILE_MAP = {
  conservadora: { perfil_id:1, carteira_id:2 },
  moderada:     { perfil_id:2, carteira_id:4 },
  agressiva:    { perfil_id:3, carteira_id:6 },
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

const RF_PARAMS = {
  'Tesouro Selic - Set/2028 Selic +0,01%':             { indexador:'CDI',  tipo_cdi:'spread', taxa:0.01,  data_vencimento:'2028-09-01', isento_ir:0 },
  'LFT – Selic + 0,05% - 01/03/2028':                  { indexador:'CDI',  tipo_cdi:'spread', taxa:0.05,  data_vencimento:'2028-03-01', isento_ir:0 },
  'LFT – Selic + 0,01% - 01/03/2028':                  { indexador:'CDI',  tipo_cdi:'spread', taxa:0.01,  data_vencimento:'2028-03-01', isento_ir:0 },
  'LFT – Selic + 0,01% - 01/09/2028':                  { indexador:'CDI',  tipo_cdi:'spread', taxa:0.01,  data_vencimento:'2028-09-01', isento_ir:0 },
  'LCD BRDE - Mai/2027 94% CDI':                        { indexador:'CDI',  tipo_cdi:'pct',    taxa:94,    data_vencimento:'2027-05-01', isento_ir:1 },
  'LCD BNDES – 92% do CDI – 05/2029':                   { indexador:'CDI',  tipo_cdi:'pct',    taxa:92,    data_vencimento:'2029-05-01', isento_ir:1 },
  'LCA BCOOM BBM – 92% do CDI – 22/09/2030':            { indexador:'CDI',  tipo_cdi:'pct',    taxa:92,    data_vencimento:'2030-09-22', isento_ir:1 },
  'LCA SICOOB - 92% do CDI - 31/10/2030':               { indexador:'CDI',  tipo_cdi:'pct',    taxa:92,    data_vencimento:'2030-10-31', isento_ir:1 },
  'NTN-B - Ago/2030 - IPCA +7,4%':                     { indexador:'IPCA', tipo_cdi:null,     taxa:7.4,   data_vencimento:'2030-08-01', isento_ir:0 },
  'NTN-B – IPCA + 7,2 – 15/05/2033':                   { indexador:'IPCA', tipo_cdi:null,     taxa:7.2,   data_vencimento:'2033-05-15', isento_ir:0 },
  'NTN-B – IPCA + 7,4 – 08/2030':                      { indexador:'IPCA', tipo_cdi:null,     taxa:7.4,   data_vencimento:'2030-08-01', isento_ir:0 },
  'NTN-B – IPCA + 7,5% – 15/05/2029':                  { indexador:'IPCA', tipo_cdi:null,     taxa:7.5,   data_vencimento:'2029-05-15', isento_ir:0 },
  'DEB CTEEP (Isa Energia) - Out/2039 - IPCA + 6,5%':  { indexador:'IPCA', tipo_cdi:null,     taxa:6.5,   data_vencimento:'2039-10-01', isento_ir:1 },
  'DEB Eletronorte - 12,7% - Jul/2032':                 { indexador:'PRE',  tipo_cdi:null,     taxa:12.7,  data_vencimento:'2032-07-01', isento_ir:1 },
  'CRI Guardian Atacadão – IPCA + 7,9 – 15/12/2037':   { indexador:'IPCA', tipo_cdi:null,     taxa:7.9,   data_vencimento:'2037-12-15', isento_ir:1 },
  'CRA BRF – IPCA + 7,3% - 16/04/2035':                { indexador:'IPCA', tipo_cdi:null,     taxa:7.3,   data_vencimento:'2035-04-16', isento_ir:1 },
  'CRA Minerva - 13,7% - 11/2032':                      { indexador:'PRE',  tipo_cdi:null,     taxa:13.7,  data_vencimento:'2032-11-01', isento_ir:1 },
  'Cra Minerva - 97% do CDI - 16/11/2029':              { indexador:'CDI',  tipo_cdi:'pct',    taxa:97,    data_vencimento:'2029-11-16', isento_ir:1 },
  'CRA Minerva - IPCA + 8,5% - 16/11/2034':             { indexador:'IPCA', tipo_cdi:null,     taxa:8.5,   data_vencimento:'2034-11-16', isento_ir:1 },
  'CRPF Suzano - IPCA + 6,7 - 09/2035':                { indexador:'IPCA', tipo_cdi:null,     taxa:6.7,   data_vencimento:'2035-09-01', isento_ir:1 },
  'CDB Banco C6 - Jul/2027 - 14,05%':                   { indexador:'PRE',  tipo_cdi:null,     taxa:14.05, data_vencimento:'2027-07-01', isento_ir:0 },
  'CDB Banco C6 - 13,7% - Out/2027':                    { indexador:'PRE',  tipo_cdi:null,     taxa:13.7,  data_vencimento:'2027-10-01', isento_ir:0 },
  'CDB Banco C6 - 13,9% - 07/2029':                     { indexador:'PRE',  tipo_cdi:null,     taxa:13.9,  data_vencimento:'2029-07-01', isento_ir:0 },
  'CDB Banco Paraná - 14,05% - 26/11/2027':              { indexador:'PRE',  tipo_cdi:null,     taxa:14.05, data_vencimento:'2027-11-26', isento_ir:0 },
  'CDB Agibank - IPCA+8,8% - 27/10/2027':               { indexador:'IPCA', tipo_cdi:null,     taxa:8.8,   data_vencimento:'2027-10-27', isento_ir:0 },
}

const SUB_CARTEIRAS = { 'Top FIIs':'7', 'Carteira Top Dividendos':'9', 'Carteira Top Ações':'8' }

function inferTipo(nome) {
  if (SUB_CARTEIRAS[nome]) return 'carteira'
  if (/^[A-Z0-9]{4,7}$/.test(nome.trim())) return 'acao'
  if (RF_PARAMS[nome]) return 'rf_curva'
  return 'fundo'
}

const DATA = [
  // ── 2025-07 ──────────────────────────────────────────────────────────────
  { conservadora: {
      macro: { pos_fixada:70, inflacao:15, pre_fixada:2.5, renda_fixa_global:2.5, multimercados:5, renda_variavel_brasil:0, renda_variavel_global:2.5, fundos_listados:2.5, alternativos:0 },
      produtos: {
        pos_fixada:            [{ nome:'Tesouro Selic - Set/2028 Selic +0,01%',peso:35},{nome:'LCD BRDE - Mai/2027 94% CDI',peso:10},{nome:'Selection RF Light FIC FIRF CP LP',peso:12},{nome:'Legacy Capital Credit Advisory FIC FIM CP',peso:7},{nome:'SulAmérica Crédito Ativo FIRF CP LP',peso:6}],
        inflacao:              [{ nome:'NTN-B - Ago/2030 - IPCA +7,4%',peso:10},{nome:'DEB CTEEP (Isa Energia) - Out/2039 - IPCA + 6,5%',peso:2.5},{nome:'ARX Elbrus Advisory FIC INFRA RF',peso:2.5}],
        pre_fixada:            [{ nome:'CDB Banco C6 - Jul/2027 - 14,05%',peso:2.5}],
        renda_fixa_global:     [{ nome:'Trend Crédito Global',peso:1.5},{nome:'PIMCO Income FIC FIM IE',peso:1}],
        multimercados:         [{ nome:'Novus Renda Fixa Exclusive FIC FI LP',peso:2},{nome:'Absolute Vertex Advisory FIC FIM',peso:1.5},{nome:'Genoa Capital Radar Advisory FIC FIM',peso:1.5}],
        renda_variavel_brasil: [],
        renda_variavel_global: [{ nome:'Trend Bolsas Globais',peso:2.5}],
        fundos_listados:       [{ nome:'Top FIIs',peso:2.5}],
        alternativos:          [],
      }
    },
    moderada: {
      macro: { pos_fixada:35, inflacao:25, pre_fixada:7.5, renda_fixa_global:2.5, multimercados:16.5, renda_variavel_brasil:5, renda_variavel_global:3.5, fundos_listados:2, alternativos:3 },
      produtos: {
        pos_fixada:            [{ nome:'Tesouro Selic - Set/2028 Selic +0,01%',peso:10},{nome:'LCD BRDE - Mai/2027 94% CDI',peso:7},{nome:'Selection RF Light FIC FIRF CP LP',peso:5},{nome:'Legacy Capital Credit Advisory FIC FIM CP',peso:5},{nome:'Root Capital High Yield Advisory FIC FIM CP',peso:4},{nome:'SulAmérica Crédito Ativo FIRF CP LP',peso:4}],
        inflacao:              [{ nome:'NTN-B - Ago/2030 - IPCA +7,4%',peso:10},{nome:'DEB CTEEP (Isa Energia) - Out/2039 - IPCA + 6,5%',peso:5},{nome:'ARX Elbrus Advisory FIC INFRA RF',peso:5.5},{nome:'XP Debêntures Incentivadas CP FIC FIM',peso:4.5}],
        pre_fixada:            [{ nome:'CDB Banco C6 - Jul/2027 - 14,05%',peso:7.5}],
        renda_fixa_global:     [{ nome:'Trend Crédito Global',peso:1.5},{nome:'PIMCO Income FIC FIM IE',peso:1}],
        multimercados:         [{ nome:'Kinea Atlas II FIM',peso:3},{nome:'Novus Renda Fixa Exclusive FIC FI LP',peso:5},{nome:'Absolute Vertex Advisory FIC FIM',peso:4},{nome:'Genoa Capital Radar Advisory FIC FIM',peso:4}],
        renda_variavel_brasil: [{ nome:'Real Investor FIC FIA BDR Nível 1',peso:2},{nome:'Carteira Top Dividendos',peso:3}],
        renda_variavel_global: [{ nome:'Trend Bolsas Globais',peso:3.5}],
        fundos_listados:       [{ nome:'Top FIIs',peso:2}],
        alternativos:          [{ nome:'Trend Ouro',peso:2},{nome:'Trend IA',peso:1}],
      }
    },
    agressiva: {
      macro: { pos_fixada:15, inflacao:30, pre_fixada:5, renda_fixa_global:2.5, multimercados:12.5, renda_variavel_brasil:15, renda_variavel_global:5, fundos_listados:8, alternativos:7 },
      produtos: {
        pos_fixada:            [{ nome:'Tesouro Selic - Set/2028 Selic +0,01%',peso:4},{nome:'LCD BRDE - Mai/2027 94% CDI',peso:6},{nome:'XP Crédito Estruturado 120 FIC FIM CP',peso:3},{nome:'Legacy Capital Credit Advisory FIC FIM CP',peso:2}],
        inflacao:              [{ nome:'NTN-B - Ago/2030 - IPCA +7,4%',peso:12.5},{nome:'DEB CTEEP (Isa Energia) - Out/2039 - IPCA + 6,5%',peso:5},{nome:'ARX Elbrus Advisory FIC INFRA RF',peso:7.5},{nome:'XP Debêntures Incentivadas CP FIC FIM',peso:5}],
        pre_fixada:            [{ nome:'CDB Banco C6 - Jul/2027 - 14,05%',peso:5}],
        renda_fixa_global:     [{ nome:'Trend Crédito Global',peso:1.5},{nome:'PIMCO Income FIC FIM IE',peso:1}],
        multimercados:         [{ nome:'Kinea Atlas II FIM',peso:3},{nome:'Novus Renda Fixa Exclusive FIC FI LP',peso:4},{nome:'Absolute Vertex Advisory FIC FIM',peso:3},{nome:'Genoa Capital Radar Advisory FIC FIM',peso:3}],
        renda_variavel_brasil: [{ nome:'Real Investor FIC FIA BDR Nível 1',peso:5},{nome:'Oceana Long Biased Advisory FIC FIA',peso:6},{nome:'Carteira Top Dividendos',peso:3},{nome:'Carteira Top Ações',peso:2.5}],
        renda_variavel_global: [{ nome:'Trend Bolsas Globais',peso:3},{nome:'Morgan Stanley Global Brands Advisory FIC FIA IE',peso:2}],
        fundos_listados:       [{ nome:'Top FIIs',peso:8}],
        alternativos:          [{ nome:'Trend Ouro',peso:4},{nome:'Trend IA',peso:3}],
      }
    },
  },
  // ── 2025-08 ──────────────────────────────────────────────────────────────
  { conservadora: {
      macro: { pos_fixada:70, inflacao:15, pre_fixada:2.5, renda_fixa_global:2.5, multimercados:5, renda_variavel_brasil:0, renda_variavel_global:2.5, fundos_listados:2.5, alternativos:0 },
      produtos: {
        pos_fixada:            [{ nome:'Tesouro Selic - Set/2028 Selic +0,01%',peso:35},{nome:'LCD BRDE - Mai/2027 94% CDI',peso:10},{nome:'Selection RF Light FIC FIRF CP LP',peso:12},{nome:'Legacy Capital Credit Advisory FIC FIM CP',peso:5},{nome:'Root Capital High Yield Advisory FIC FIM CP',peso:5},{nome:'SulAmérica Crédito Ativo FIRF CP LP',peso:6},{nome:'Novus Renda Fixa Ativo Isento',peso:6},{nome:'XP Crédito Estruturado 120 FIC FIM CP',peso:5}],
        inflacao:              [{ nome:'NTN-B - Ago/2030 - IPCA +7,4%',peso:10},{nome:'DEB CTEEP (Isa Energia) - Out/2039 - IPCA + 6,5%',peso:2.5},{nome:'ARX Elbrus Advisory FIC INFRA RF',peso:2.5}],
        pre_fixada:            [{ nome:'CDB Banco C6 - 13,7% - Out/2027',peso:2.5}],
        renda_fixa_global:     [{ nome:'Trend Crédito Global',peso:1.5},{nome:'PIMCO Income FIC FIM IE',peso:1}],
        multimercados:         [{ nome:'Absolute Vertex Advisory FIC FIM',peso:2.5},{nome:'Genoa Capital Radar Advisory FIC FIM',peso:2.5}],
        renda_variavel_brasil: [],
        renda_variavel_global: [{ nome:'Trend Bolsas Globais',peso:2.5}],
        fundos_listados:       [{ nome:'Top FIIs',peso:2.5}],
        alternativos:          [],
      }
    },
    moderada: {
      macro: { pos_fixada:35, inflacao:25, pre_fixada:7.5, renda_fixa_global:2.5, multimercados:16.5, renda_variavel_brasil:5, renda_variavel_global:3.5, fundos_listados:2, alternativos:3 },
      produtos: {
        pos_fixada:            [{ nome:'Tesouro Selic - Set/2028 Selic +0,01%',peso:12},{nome:'LCD BRDE - Mai/2027 94% CDI',peso:7},{nome:'Selection RF Light FIC FIRF CP LP',peso:3.5},{nome:'Legacy Capital Credit Advisory FIC FIM CP',peso:3},{nome:'Root Capital High Yield Advisory FIC FIM CP',peso:3},{nome:'SulAmérica Crédito Ativo FIRF CP LP',peso:4},{nome:'Novus Renda Fixa Exclusive FIC FI LP',peso:5}],
        inflacao:              [{ nome:'NTN-B - Ago/2030 - IPCA +7,4%',peso:6},{nome:'DEB CTEEP (Isa Energia) - Out/2039 - IPCA + 6,5%',peso:3.5},{nome:'ARX Elbrus Advisory FIC INFRA RF',peso:7},{nome:'XP Debêntures Incentivadas CP FIC FIM',peso:6},{nome:'CRA BRF – IPCA + 7,3% - 16/04/2035',peso:2.5}],
        pre_fixada:            [{ nome:'CDB Banco C6 - 13,7% - Out/2027',peso:5.5},{nome:'DEB Eletronorte - 12,7% - Jul/2032',peso:2}],
        renda_fixa_global:     [{ nome:'Trend Crédito Global',peso:1.5},{nome:'PIMCO Income FIC FIM IE',peso:1}],
        multimercados:         [{ nome:'Kinea Atlas II FIM',peso:3.5},{nome:'Novus Renda Fixa Exclusive FIC FI LP',peso:5},{nome:'Absolute Vertex Advisory FIC FIM',peso:4},{nome:'Genoa Capital Radar Advisory FIC FIM',peso:4}],
        renda_variavel_brasil: [{ nome:'Real Investor FIC FIA BDR Nível 1',peso:2},{nome:'Carteira Top Dividendos',peso:3}],
        renda_variavel_global: [{ nome:'Trend Bolsas Globais',peso:3.5}],
        fundos_listados:       [{ nome:'Top FIIs',peso:2}],
        alternativos:          [{ nome:'Trend Ouro',peso:2},{nome:'Trend IA',peso:1}],
      }
    },
    agressiva: {
      macro: { pos_fixada:15, inflacao:30, pre_fixada:5, renda_fixa_global:2.5, multimercados:12.5, renda_variavel_brasil:15, renda_variavel_global:5, fundos_listados:8, alternativos:7 },
      produtos: {
        pos_fixada:            [{ nome:'Tesouro Selic - Set/2028 Selic +0,01%',peso:4},{nome:'LCD BRDE - Mai/2027 94% CDI',peso:6},{nome:'XP Crédito Estruturado 120 FIC FIM CP',peso:3},{nome:'Legacy Capital Credit Advisory FIC FIM CP',peso:2}],
        inflacao:              [{ nome:'NTN-B - Ago/2030 - IPCA +7,4%',peso:6.5},{nome:'DEB CTEEP (Isa Energia) - Out/2039 - IPCA + 6,5%',peso:4.5},{nome:'ARX Elbrus Advisory FIC INFRA RF',peso:8},{nome:'XP Debêntures Incentivadas CP FIC FIM',peso:7.5},{nome:'CRA BRF – IPCA + 7,3% - 16/04/2035',peso:3}],
        pre_fixada:            [{ nome:'CDB Banco C6 - 13,7% - Out/2027',peso:3.5},{nome:'DEB Eletronorte - 12,7% - Jul/2032',peso:1.5}],
        renda_fixa_global:     [{ nome:'Trend Crédito Global',peso:1.5},{nome:'PIMCO Income FIC FIM IE',peso:1}],
        multimercados:         [{ nome:'Kinea Atlas II FIM',peso:2.5},{nome:'Novus Renda Fixa Exclusive FIC FI LP',peso:4},{nome:'Absolute Vertex Advisory FIC FIM',peso:3},{nome:'Genoa Capital Radar Advisory FIC FIM',peso:3}],
        renda_variavel_brasil: [{ nome:'Real Investor FIC FIA BDR Nível 1',peso:3.5},{nome:'Oceana Long Biased Advisory FIC FIA',peso:6},{nome:'Carteira Top Dividendos',peso:3},{nome:'Carteira Top Ações',peso:2.5}],
        renda_variavel_global: [{ nome:'Trend Bolsas Globais',peso:3},{nome:'Morgan Stanley Global Brands Advisory FIC FIA IE',peso:2}],
        fundos_listados:       [{ nome:'Top FIIs',peso:8}],
        alternativos:          [{ nome:'Trend Ouro',peso:4},{nome:'Trend IA',peso:3}],
      }
    },
  },
  // ── 2025-09 ──────────────────────────────────────────────────────────────
  { conservadora: {
      macro: { pos_fixada:70, inflacao:15, pre_fixada:2.5, renda_fixa_global:2.5, multimercados:5, renda_variavel_brasil:0, renda_variavel_global:2.5, fundos_listados:2.5, alternativos:0 },
      produtos: {
        pos_fixada:            [{ nome:'LFT – Selic + 0,05% - 01/03/2028',peso:25},{nome:'LCD BNDES – 92% do CDI – 05/2029',peso:12},{nome:'Selection RF Light FIC FIRF CP LP',peso:5.5},{nome:'Legacy Capital Credit Advisory FIC FIM CP',peso:5},{nome:'Root Capital High Yield Advisory FIC FIM CP',peso:5},{nome:'SulAmérica Crédito Ativo FIRF CP LP',peso:6.5},{nome:'Novus Renda Fixa Ativo Isento',peso:6},{nome:'XP Crédito Estruturado 120 FIC FIM CP',peso:5}],
        inflacao:              [{ nome:'NTN-B – IPCA + 7,2 – 15/05/2033',peso:4},{nome:'CRI Guardian Atacadão – IPCA + 7,9 – 15/12/2037',peso:2.5},{nome:'ARX Elbrus Advisory FIC INFRA RF',peso:5},{nome:'XP Debêntures Incentivadas CP FIC FIM',peso:3.5}],
        pre_fixada:            [{ nome:'CDB Banco C6 - 13,7% - Out/2027',peso:2.5}],
        renda_fixa_global:     [{ nome:'Trend Crédito Global',peso:1.5},{nome:'PIMCO Income FIC FIM IE',peso:1}],
        multimercados:         [{ nome:'Absolute Vertex Advisory FIC FIM',peso:2.5},{nome:'Genoa Capital Radar Advisory FIC FIM',peso:2.5}],
        renda_variavel_brasil: [],
        renda_variavel_global: [{ nome:'Trend Bolsas Globais',peso:2.5}],
        fundos_listados:       [{ nome:'Top FIIs',peso:2.5}],
        alternativos:          [],
      }
    },
    moderada: {
      macro: { pos_fixada:35, inflacao:25, pre_fixada:7.5, renda_fixa_global:2.5, multimercados:16.5, renda_variavel_brasil:5, renda_variavel_global:3.5, fundos_listados:2, alternativos:3 },
      produtos: {
        pos_fixada:            [{ nome:'LFT – Selic + 0,05% - 01/03/2028',peso:12},{nome:'LCD BNDES – 92% do CDI – 05/2029',peso:7.5},{nome:'Selection RF Light FIC FIRF CP LP',peso:3.5},{nome:'Legacy Capital Credit Advisory FIC FIM CP',peso:3},{nome:'Root Capital High Yield Advisory FIC FIM CP',peso:3},{nome:'Novus Renda Fixa Exclusive FIC FI LP',peso:5},{nome:'XP Crédito Estruturado 120 FIC FIM CP',peso:3}],
        inflacao:              [{ nome:'NTN-B – IPCA + 7,2 – 15/05/2033',peso:6},{nome:'CRI Guardian Atacadão – IPCA + 7,9 – 15/12/2037',peso:3.5},{nome:'ARX Elbrus Advisory FIC INFRA RF',peso:7},{nome:'XP Debêntures Incentivadas CP FIC FIM',peso:6},{nome:'CRA BRF – IPCA + 7,3% - 16/04/2035',peso:2.5}],
        pre_fixada:            [{ nome:'CDB Banco C6 - 13,7% - Out/2027',peso:5.5},{nome:'DEB Eletronorte - 12,7% - Jul/2032',peso:2}],
        renda_fixa_global:     [{ nome:'Trend Crédito Global',peso:1.5},{nome:'PIMCO Income FIC FIM IE',peso:1}],
        multimercados:         [{ nome:'Kinea Atlas II FIM',peso:3.5},{nome:'Novus Renda Fixa Exclusive FIC FI LP',peso:5},{nome:'Absolute Vertex Advisory FIC FIM',peso:4},{nome:'Genoa Capital Radar Advisory FIC FIM',peso:4}],
        renda_variavel_brasil: [{ nome:'Real Investor FIC FIA BDR Nível 1',peso:2},{nome:'Carteira Top Dividendos',peso:3}],
        renda_variavel_global: [{ nome:'Trend Bolsas Globais',peso:3.5}],
        fundos_listados:       [{ nome:'Top FIIs',peso:2}],
        alternativos:          [{ nome:'Trend Ouro',peso:2},{nome:'Trend IA',peso:1}],
      }
    },
    agressiva: {
      macro: { pos_fixada:15, inflacao:30, pre_fixada:5, renda_fixa_global:2.5, multimercados:12.5, renda_variavel_brasil:15, renda_variavel_global:5, fundos_listados:8, alternativos:7 },
      produtos: {
        pos_fixada:            [{ nome:'LFT – Selic + 0,05% - 01/03/2028',peso:5},{nome:'LCD BNDES – 92% do CDI – 05/2029',peso:5},{nome:'Root Capital High Yield Advisory FIC FIM CP',peso:2.5},{nome:'XP Crédito Estruturado 120 FIC FIM CP',peso:2.5}],
        inflacao:              [{ nome:'NTN-B – IPCA + 7,2 – 15/05/2033',peso:6.5},{nome:'CRI Guardian Atacadão – IPCA + 7,9 – 15/12/2037',peso:4.5},{nome:'ARX Elbrus Advisory FIC INFRA RF',peso:8.5},{nome:'XP Debêntures Incentivadas CP FIC FIM',peso:7.5},{nome:'CRA BRF – IPCA + 7,3% - 16/04/2035',peso:3}],
        pre_fixada:            [{ nome:'CDB Banco C6 - 13,7% - Out/2027',peso:3.5},{nome:'DEB Eletronorte - 12,7% - Jul/2032',peso:1.5}],
        renda_fixa_global:     [{ nome:'Trend Crédito Global',peso:1.5},{nome:'PIMCO Income FIC FIM IE',peso:1}],
        multimercados:         [{ nome:'Kinea Atlas II FIM',peso:2.5},{nome:'Novus Renda Fixa Exclusive FIC FI LP',peso:4},{nome:'Absolute Vertex Advisory FIC FIM',peso:3},{nome:'Genoa Capital Radar Advisory FIC FIM',peso:3}],
        renda_variavel_brasil: [{ nome:'Real Investor FIC FIA BDR Nível 1',peso:3.5},{nome:'Oceana Long Biased Advisory FIC FIA',peso:6},{nome:'Carteira Top Dividendos',peso:3},{nome:'Carteira Top Ações',peso:2.5}],
        renda_variavel_global: [{ nome:'Trend Bolsas Globais',peso:3},{nome:'Morgan Stanley Global Brands Advisory FIC FIA IE',peso:2}],
        fundos_listados:       [{ nome:'Top FIIs',peso:8}],
        alternativos:          [{ nome:'Trend Ouro',peso:5},{nome:'Trend IA',peso:2}],
      }
    },
  },
  // ── 2025-10 ──────────────────────────────────────────────────────────────
  { conservadora: {
      macro: { pos_fixada:70, inflacao:12.5, pre_fixada:5, renda_fixa_global:2.5, multimercados:5, renda_variavel_brasil:0, renda_variavel_global:2.5, fundos_listados:2.5, alternativos:0 },
      produtos: {
        pos_fixada:            [{ nome:'LFT – Selic + 0,01% - 01/03/2028',peso:25},{nome:'LCA BCOOM BBM – 92% do CDI – 22/09/2030',peso:12},{nome:'Selection RF Light FIC FIRF CP LP',peso:5.5},{nome:'Legacy Capital Credit Advisory FIC FIM CP',peso:5},{nome:'Root Capital High Yield Advisory FIC FIM CP',peso:5},{nome:'SulAmérica Crédito Ativo FIRF CP LP',peso:6.5},{nome:'Novus Renda Fixa Ativo Isento',peso:6},{nome:'XP Crédito Estruturado 120 FIC FIM CP',peso:5}],
        inflacao:              [{ nome:'NTN-B – IPCA + 7,4 – 08/2030',peso:4},{nome:'CRPF Suzano - IPCA + 6,7 - 09/2035',peso:1.5},{nome:'ARX Elbrus Advisory FIC INFRA RF',peso:4},{nome:'XP Debêntures Incentivadas CP FIC FIM',peso:3}],
        pre_fixada:            [{ nome:'CDB Banco C6 - 13,9% - 07/2029',peso:3.5},{nome:'IRFM11',peso:1.5}],
        renda_fixa_global:     [{ nome:'T10R11',peso:1.5},{nome:'PIMCO Income FIC FIM IE',peso:1}],
        multimercados:         [{ nome:'Absolute Vertex Advisory FIC FIM',peso:2.5},{nome:'Genoa Capital Radar Advisory FIC FIM',peso:2.5}],
        renda_variavel_brasil: [],
        renda_variavel_global: [{ nome:'Trend Bolsas Globais',peso:2.5}],
        fundos_listados:       [{ nome:'Top FIIs',peso:2.5}],
        alternativos:          [],
      }
    },
    moderada: {
      macro: { pos_fixada:32.5, inflacao:22.5, pre_fixada:10, renda_fixa_global:2.5, multimercados:16.5, renda_variavel_brasil:7.5, renda_variavel_global:3.5, fundos_listados:2, alternativos:3 },
      produtos: {
        pos_fixada:            [{ nome:'LFT – Selic + 0,01% - 01/03/2028',peso:12},{nome:'LCA BCOOM BBM – 92% do CDI – 22/09/2030',peso:7.5},{nome:'Selection RF Light FIC FIRF CP LP',peso:3.5},{nome:'Legacy Capital Credit Advisory FIC FIM CP',peso:3},{nome:'Root Capital High Yield Advisory FIC FIM CP',peso:3},{nome:'Novus Renda Fixa Ativo Isento',peso:3},{nome:'XP Crédito Estruturado 120 FIC FIM CP',peso:3}],
        inflacao:              [{ nome:'NTN-B – IPCA + 7,4 – 08/2030',peso:7},{nome:'CRPF Suzano - IPCA + 6,7 - 09/2035',peso:3},{nome:'ARX Elbrus Advisory FIC INFRA RF',peso:7},{nome:'XP Debêntures Incentivadas CP FIC FIM',peso:5.5}],
        pre_fixada:            [{ nome:'CDB Banco C6 - 13,9% - 07/2029',peso:5},{nome:'CRA Minerva - 13,7% - 11/2032',peso:2},{nome:'IRFM11',peso:3}],
        renda_fixa_global:     [{ nome:'T10R11',peso:1.5},{nome:'PIMCO Income FIC FIM IE',peso:1}],
        multimercados:         [{ nome:'Kinea Atlas II FIM',peso:4.5},{nome:'Kapitalo K10 Advisory FIF em Cotas de FIM',peso:4},{nome:'Absolute Vertex Advisory FIC FIM',peso:4},{nome:'Genoa Capital Radar Advisory FIC FIM',peso:4}],
        renda_variavel_brasil: [{ nome:'Real Investor FIC FIA BDR Nível 1',peso:2},{nome:'Carteira Top Dividendos',peso:3},{nome:'Carteira Top Ações',peso:2.5}],
        renda_variavel_global: [{ nome:'Trend Bolsas Globais',peso:3.5}],
        fundos_listados:       [{ nome:'Top FIIs',peso:2}],
        alternativos:          [{ nome:'Trend Ouro',peso:2},{nome:'Trend IA',peso:1}],
      }
    },
    agressiva: {
      macro: { pos_fixada:12.5, inflacao:27.5, pre_fixada:7.5, renda_fixa_global:2.5, multimercados:12.5, renda_variavel_brasil:17.5, renda_variavel_global:5, fundos_listados:8, alternativos:7 },
      produtos: {
        pos_fixada:            [{ nome:'LFT – Selic + 0,01% - 01/03/2028',peso:5},{nome:'LCA BCOOM BBM – 92% do CDI – 22/09/2030',peso:5},{nome:'Root Capital High Yield Advisory FIC FIM CP',peso:2.5}],
        inflacao:              [{ nome:'NTN-B – IPCA + 7,4 – 08/2030',peso:8.5},{nome:'CRPF Suzano - IPCA + 6,7 - 09/2035',peso:4},{nome:'ARX Elbrus Advisory FIC INFRA RF',peso:8},{nome:'XP Debêntures Incentivadas CP FIC FIM',peso:7}],
        pre_fixada:            [{ nome:'CDB Banco C6 - 13,9% - 07/2029',peso:4},{nome:'CRA Minerva - 13,7% - 11/2032',peso:1.5},{nome:'IRFM11',peso:2}],
        renda_fixa_global:     [{ nome:'T10R11',peso:1.5},{nome:'PIMCO Income FIC FIM IE',peso:1}],
        multimercados:         [{ nome:'Kinea Atlas II FIM',peso:3.5},{nome:'Kapitalo K10 Advisory FIF em Cotas de FIM',peso:3},{nome:'Absolute Vertex Advisory FIC FIM',peso:3},{nome:'Genoa Capital Radar Advisory FIC FIM',peso:3}],
        renda_variavel_brasil: [{ nome:'Real Investor FIC FIA BDR Nível 1',peso:3.5},{nome:'Oceana Long Biased Advisory FIC FIA',peso:6},{nome:'Carteira Top Dividendos',peso:3},{nome:'Carteira Top Ações',peso:2.5},{nome:'Oceana Long Biased Advisory FIC FIA',peso:2.5}],
        renda_variavel_global: [{ nome:'WHG Global Long Biased BRL FIC FIM CP IE',peso:2},{nome:'Trend Bolsas Globais',peso:3}],
        fundos_listados:       [{ nome:'Top FIIs',peso:8}],
        alternativos:          [{ nome:'Trend Ouro',peso:5},{nome:'Trend IA',peso:2}],
      }
    },
  },
  // ── 2025-11 ──────────────────────────────────────────────────────────────
  { conservadora: {
      macro: { pos_fixada:70, inflacao:12.5, pre_fixada:5, renda_fixa_global:2.5, multimercados:5, renda_variavel_brasil:0, renda_variavel_global:2.5, fundos_listados:2.5, alternativos:0 },
      produtos: {
        pos_fixada:            [{ nome:'LFT – Selic + 0,01% - 01/09/2028',peso:25},{nome:'Cra Minerva - 97% do CDI - 16/11/2029',peso:5},{nome:'Selection RF Light FIC FIRF CP LP',peso:8},{nome:'Legacy Capital Credit Advisory FIC FIM CP',peso:6},{nome:'Root Capital High Yield Advisory FIC FIM CP',peso:6},{nome:'SulAmérica Crédito Ativo FIRF CP LP',peso:8},{nome:'Novus Renda Fixa Ativo Isento',peso:6},{nome:'XP Crédito Estruturado 120 FIC FIM CP',peso:6}],
        inflacao:              [{ nome:'NTN-B – IPCA + 7,5% – 15/05/2029',peso:2.5},{nome:'CDB Agibank - IPCA+8,8% - 27/10/2027',peso:6},{nome:'ARX Elbrus Advisory FIC INFRA RF',peso:2},{nome:'XP Debêntures Incentivadas CP FIC FIM',peso:2}],
        pre_fixada:            [{ nome:'IRFM11',peso:5}],
        renda_fixa_global:     [{ nome:'T10R11',peso:1.5},{nome:'PIMCO Income FIC FIM IE',peso:1}],
        multimercados:         [{ nome:'Absolute Vertex Advisory FIC FIM',peso:2.5},{nome:'Genoa Capital Radar Advisory FIC FIM',peso:2.5}],
        renda_variavel_brasil: [],
        renda_variavel_global: [{ nome:'Trend Bolsas Globais',peso:2.5}],
        fundos_listados:       [{ nome:'Top FIIs',peso:2.5}],
        alternativos:          [],
      }
    },
    moderada: {
      macro: { pos_fixada:32.5, inflacao:22.5, pre_fixada:10, renda_fixa_global:2.5, multimercados:16.5, renda_variavel_brasil:7.5, renda_variavel_global:3.5, fundos_listados:2, alternativos:3 },
      produtos: {
        pos_fixada:            [{ nome:'LFT – Selic + 0,01% - 01/09/2028',peso:12},{nome:'Cra Minerva - 97% do CDI - 16/11/2029',peso:3.5},{nome:'Selection RF Light FIC FIRF CP LP',peso:4},{nome:'Legacy Capital Credit Advisory FIC FIM CP',peso:3},{nome:'Root Capital High Yield Advisory FIC FIM CP',peso:3},{nome:'Novus Renda Fixa Ativo Isento',peso:3},{nome:'XP Crédito Estruturado 120 FIC FIM CP',peso:4}],
        inflacao:              [{ nome:'NTN-B – IPCA + 7,5% – 15/05/2029',peso:4},{nome:'CDB Agibank - IPCA+8,8% - 27/10/2027',peso:12},{nome:'ARX Elbrus Advisory FIC INFRA RF',peso:3.5},{nome:'XP Debêntures Incentivadas CP FIC FIM',peso:3}],
        pre_fixada:            [{ nome:'IRFM11',peso:10}],
        renda_fixa_global:     [{ nome:'T10R11',peso:1.5},{nome:'PIMCO Income FIC FIM IE',peso:1}],
        multimercados:         [{ nome:'Kinea Atlas II FIM',peso:4.5},{nome:'Kapitalo K10 Advisory FIF em Cotas de FIM',peso:4},{nome:'Absolute Vertex Advisory FIC FIM',peso:4},{nome:'Genoa Capital Radar Advisory FIC FIM',peso:4}],
        renda_variavel_brasil: [{ nome:'Real Investor FIC FIA BDR Nível 1',peso:3},{nome:'Carteira Top Dividendos',peso:2.5},{nome:'Carteira Top Ações',peso:2}],
        renda_variavel_global: [{ nome:'Trend Bolsas Globais',peso:3.5}],
        fundos_listados:       [{ nome:'Top FIIs',peso:2}],
        alternativos:          [{ nome:'Trend Ouro',peso:2},{nome:'Trend IA',peso:1}],
      }
    },
    agressiva: {
      macro: { pos_fixada:12.5, inflacao:27.5, pre_fixada:7.5, renda_fixa_global:2.5, multimercados:12.5, renda_variavel_brasil:17.5, renda_variavel_global:5, fundos_listados:8, alternativos:7 },
      produtos: {
        pos_fixada:            [{ nome:'LFT – Selic + 0,01% - 01/09/2028',peso:5},{nome:'Cra Minerva - 97% do CDI - 16/11/2029',peso:2.5},{nome:'Root Capital High Yield Advisory FIC FIM CP',peso:2.5},{nome:'XP Crédito Estruturado 120 FIC FIM CP',peso:2.5}],
        inflacao:              [{ nome:'NTN-B – IPCA + 7,5% – 15/05/2029',peso:10},{nome:'CDB Agibank - IPCA+8,8% - 27/10/2027',peso:10},{nome:'ARX Elbrus Advisory FIC INFRA RF',peso:4},{nome:'XP Debêntures Incentivadas CP FIC FIM',peso:3.5}],
        pre_fixada:            [{ nome:'IRFM11',peso:7.5}],
        renda_fixa_global:     [{ nome:'T10R11',peso:1.5},{nome:'PIMCO Income FIC FIM IE',peso:1}],
        multimercados:         [{ nome:'Kinea Atlas II FIM',peso:3.5},{nome:'Kapitalo K10 Advisory FIF em Cotas de FIM',peso:3},{nome:'Absolute Vertex Advisory FIC FIM',peso:3},{nome:'Genoa Capital Radar Advisory FIC FIM',peso:3}],
        renda_variavel_brasil: [{ nome:'Real Investor FIC FIA BDR Nível 1',peso:4},{nome:'Oceana Long Biased Advisory FIC FIA',peso:7},{nome:'Carteira Top Dividendos',peso:3.5},{nome:'Carteira Top Ações',peso:3}],
        renda_variavel_global: [{ nome:'WHG Global Long Biased BRL FIC FIM CP IE',peso:2},{nome:'Trend Bolsas Globais',peso:3}],
        fundos_listados:       [{ nome:'Top FIIs',peso:8}],
        alternativos:          [{ nome:'Trend Ouro',peso:5},{nome:'Trend IA',peso:2}],
      }
    },
  },
  // ── 2025-12 ──────────────────────────────────────────────────────────────
  { conservadora: {
      macro: { pos_fixada:70, inflacao:12.5, pre_fixada:5, renda_fixa_global:2.5, multimercados:5, renda_variavel_brasil:0, renda_variavel_global:2.5, fundos_listados:2.5, alternativos:0 },
      produtos: {
        pos_fixada:            [{ nome:'LFT – Selic + 0,01% - 01/03/2028',peso:25},{nome:'LCA SICOOB - 92% do CDI - 31/10/2030',peso:12.5},{nome:'Selection RF Light FIC FIRF CP LP',peso:5.5},{nome:'Legacy Capital Credit Advisory FIC FIM CP',peso:5},{nome:'Root Capital High Yield Advisory FIC FIM CP',peso:5.5},{nome:'SulAmérica Crédito Ativo FIRF CP LP',peso:6.5},{nome:'Novus Renda Fixa Ativo Isento',peso:5},{nome:'XP Crédito Estruturado 120 FIC FIM CP',peso:5}],
        inflacao:              [{ nome:'NTN-B – IPCA + 7,5% – 15/05/2029',peso:4},{nome:'CRA Minerva - IPCA + 8,5% - 16/11/2034',peso:2},{nome:'ARX Elbrus Advisory FIC INFRA RF',peso:3.5},{nome:'XP Debêntures Incentivadas CP FIC FIM',peso:3}],
        pre_fixada:            [{ nome:'CDB Banco Paraná - 14,05% - 26/11/2027',peso:5}],
        renda_fixa_global:     [{ nome:'T10R11',peso:1.5},{nome:'HYBR11',peso:1}],
        multimercados:         [{ nome:'Absolute Vertex Advisory FIC FIM',peso:2.5},{nome:'Genoa Capital Radar Advisory FIC FIM',peso:2.5}],
        renda_variavel_brasil: [],
        renda_variavel_global: [{ nome:'Trend Bolsas Globais',peso:2.5}],
        fundos_listados:       [{ nome:'Top FIIs',peso:2.5}],
        alternativos:          [],
      }
    },
    moderada: {
      macro: { pos_fixada:32.5, inflacao:22.5, pre_fixada:10, renda_fixa_global:2.5, multimercados:16.5, renda_variavel_brasil:7.5, renda_variavel_global:3.5, fundos_listados:2, alternativos:3 },
      produtos: {
        pos_fixada:            [{ nome:'LFT – Selic + 0,01% - 01/03/2028',peso:12},{nome:'LCA SICOOB - 92% do CDI - 31/10/2030',peso:6.5},{nome:'Selection RF Light FIC FIRF CP LP',peso:3.5},{nome:'Legacy Capital Credit Advisory FIC FIM CP',peso:2.5},{nome:'Root Capital High Yield Advisory FIC FIM CP',peso:3},{nome:'Novus Renda Fixa Ativo Isento',peso:2.5},{nome:'XP Crédito Estruturado 120 FIC FIM CP',peso:2.5}],
        inflacao:              [{ nome:'NTN-B – IPCA + 7,5% – 15/05/2029',peso:7.5},{nome:'CRA Minerva - IPCA + 8,5% - 16/11/2034',peso:4},{nome:'ARX Elbrus Advisory FIC INFRA RF',peso:6},{nome:'XP Debêntures Incentivadas CP FIC FIM',peso:5}],
        pre_fixada:            [{ nome:'CDB Banco Paraná - 14,05% - 26/11/2027',peso:10}],
        renda_fixa_global:     [{ nome:'T10R11',peso:1.5},{nome:'HYBR11',peso:1}],
        multimercados:         [{ nome:'Kinea Atlas II FIM',peso:4.5},{nome:'Kapitalo K10 Advisory FIF em Cotas de FIM',peso:4},{nome:'Absolute Vertex Advisory FIC FIM',peso:4},{nome:'Genoa Capital Radar Advisory FIC FIM',peso:4}],
        renda_variavel_brasil: [{ nome:'Real Investor FIC FIA BDR Nível 1',peso:2.5},{nome:'Carteira Top Dividendos',peso:2.5},{nome:'Carteira Top Ações',peso:2.5}],
        renda_variavel_global: [{ nome:'Trend Bolsas Globais',peso:3.5}],
        fundos_listados:       [{ nome:'Top FIIs',peso:2}],
        alternativos:          [{ nome:'Trend Ouro',peso:2},{nome:'Trend IA',peso:1}],
      }
    },
    agressiva: {
      macro: { pos_fixada:12.5, inflacao:27.5, pre_fixada:7.5, renda_fixa_global:2.5, multimercados:12.5, renda_variavel_brasil:17.5, renda_variavel_global:5, fundos_listados:8, alternativos:7 },
      produtos: {
        pos_fixada:            [{ nome:'LFT – Selic + 0,01% - 01/03/2028',peso:5},{nome:'LCA SICOOB - 92% do CDI - 31/10/2030',peso:4},{nome:'Root Capital High Yield Advisory FIC FIM CP',peso:2},{nome:'XP Crédito Estruturado 120 FIC FIM CP',peso:1.5}],
        inflacao:              [{ nome:'NTN-B – IPCA + 7,5% – 15/05/2029',peso:9},{nome:'CRA Minerva - IPCA + 8,5% - 16/11/2034',peso:5},{nome:'ARX Elbrus Advisory FIC INFRA RF',peso:7.5},{nome:'XP Debêntures Incentivadas CP FIC FIM',peso:6}],
        pre_fixada:            [{ nome:'CDB Banco Paraná - 14,05% - 26/11/2027',peso:7.5}],
        renda_fixa_global:     [{ nome:'T10R11',peso:1.5},{nome:'HYBR11',peso:1}],
        multimercados:         [{ nome:'Kinea Atlas II FIM',peso:3.5},{nome:'Kapitalo K10 Advisory FIF em Cotas de FIM',peso:3},{nome:'Absolute Vertex Advisory FIC FIM',peso:3},{nome:'Genoa Capital Radar Advisory FIC FIM',peso:3}],
        renda_variavel_brasil: [{ nome:'Real Investor FIC FIA BDR Nível 1',peso:4.5},{nome:'Trend Valor Brasil FIA RL',peso:4.5},{nome:'Carteira Top Dividendos',peso:4.5},{nome:'Carteira Top Ações',peso:4}],
        renda_variavel_global: [{ nome:'WHG Global Long Biased BRL FIC FIM CP IE',peso:2},{nome:'Trend Bolsas Globais',peso:3}],
        fundos_listados:       [{ nome:'Top FIIs',peso:8}],
        alternativos:          [{ nome:'Trend Ouro',peso:5},{nome:'Trend IA',peso:2}],
      }
    },
  },
]

// ── Prepared statements ──────────────────────────────────────────────────────
const insAloc = db.prepare(`
  INSERT OR REPLACE INTO alocacoes_macro
    (perfil_id, mes, pos_fixado, inflacao, prefixado, rf_global, multimercado,
     rv_brasil, rv_global, fundos_listados, alternativos)
  VALUES
    (@perfil_id, @mes, @pos_fixado, @inflacao, @prefixado, @rf_global, @multimercado,
     @rv_brasil, @rv_global, @fundos_listados, @alternativos)
`)

const insEstado = db.prepare(`
  INSERT INTO estados_portfolio (carteira_id, mes, data_inicio, data_fim)
  VALUES (@carteira_id, @mes, @data_inicio, @data_fim)
`)

const insProd = db.prepare(`
  INSERT INTO produtos
    (estado_id, tipo, classe, nome, identificador, peso,
     indexador, tipo_cdi, taxa, data_emissao, data_vencimento, isento_ir)
  VALUES
    (@estado_id, @tipo, @classe, @nome, @identificador, @peso,
     @indexador, @tipo_cdi, @taxa, @data_emissao, @data_vencimento, @isento_ir)
`)

// ── Execução ─────────────────────────────────────────────────────────────────
let stats = { estados:0, alocacoes:0, produtos:0 }

db.transaction(() => {
  // Deletar na ordem correta (alertas → produtos → estados → aloc)
  db.prepare(`
    UPDATE alertas_auditoria SET produto_id = NULL
    WHERE produto_id IN (
      SELECT id FROM produtos WHERE estado_id IN (
        SELECT id FROM estados_portfolio
        WHERE carteira_id IN (2,4,6) AND mes IN ('2025-07','2025-08','2025-09','2025-10','2025-11','2025-12')
      )
    )
  `).run()
  db.prepare(`
    DELETE FROM produtos WHERE estado_id IN (
      SELECT id FROM estados_portfolio
      WHERE carteira_id IN (2,4,6) AND mes IN ('2025-07','2025-08','2025-09','2025-10','2025-11','2025-12')
    )
  `).run()
  const d1 = db.prepare(`
    DELETE FROM estados_portfolio
    WHERE carteira_id IN (2,4,6) AND mes IN ('2025-07','2025-08','2025-09','2025-10','2025-11','2025-12')
  `).run()
  const d2 = db.prepare(`
    DELETE FROM alocacoes_macro
    WHERE perfil_id IN (1,2,3) AND mes IN ('2025-07','2025-08','2025-09','2025-10','2025-11','2025-12')
  `).run()
  console.log(`Deletados: ${d1.changes} estados, ${d2.changes} alocações`)

  for (let pi = 0; pi < PERIODS.length; pi++) {
    const { data, mes, data_fim } = PERIODS[pi]
    const periodoData = DATA[pi]

    for (const [profile, { perfil_id, carteira_id }] of Object.entries(PROFILE_MAP)) {
      const pd = periodoData[profile]
      const m  = pd.macro

      insAloc.run({
        perfil_id, mes,
        pos_fixado:       m.pos_fixada,
        inflacao:         m.inflacao,
        prefixado:        m.pre_fixada,
        rf_global:        m.renda_fixa_global,
        multimercado:     m.multimercados,
        rv_brasil:        m.renda_variavel_brasil,
        rv_global:        m.renda_variavel_global,
        fundos_listados:  m.fundos_listados,
        alternativos:     m.alternativos,
      })
      stats.alocacoes++

      const r = insEstado.run({ carteira_id, mes, data_inicio: data, data_fim })
      const estadoId = r.lastInsertRowid
      stats.estados++

      for (const [inputClass, prods] of Object.entries(pd.produtos)) {
        const classe = CLASS_MAP[inputClass]
        if (!classe) { console.warn('Classe desconhecida:', inputClass); continue }
        for (const p of prods) {
          if (!p.peso || p.peso <= 0) continue
          const tipo        = inferTipo(p.nome)
          const rf          = RF_PARAMS[p.nome] ?? {}
          const identificador = SUB_CARTEIRAS[p.nome] ?? (tipo === 'acao' ? p.nome.trim() : null)
          insProd.run({
            estado_id:       estadoId,
            tipo,
            classe,
            nome:            p.nome,
            identificador,
            peso:            p.peso,
            indexador:       rf.indexador        ?? null,
            tipo_cdi:        rf.tipo_cdi         ?? null,
            taxa:            rf.taxa             ?? null,
            data_emissao:    data,
            data_vencimento: rf.data_vencimento  ?? null,
            isento_ir:       rf.isento_ir        ?? 0,
          })
          stats.produtos++
        }
      }
    }
  }
})()

console.log(`\n=== Resumo ===`)
console.log(`  Estados:   ${stats.estados}`)
console.log(`  Alocações: ${stats.alocacoes}`)
console.log(`  Produtos:  ${stats.produtos}`)

// ── Verificação ───────────────────────────────────────────────────────────────
console.log('\n=== Verificação pós-import ===')
const rows = db.prepare(`
  SELECT c.nome as carteira, ep.mes, ep.data_inicio, ep.data_fim,
         COUNT(p.id) as n_prods, ROUND(SUM(p.peso),2) as soma_peso
  FROM estados_portfolio ep
  JOIN carteiras c ON c.id = ep.carteira_id
  LEFT JOIN produtos p ON p.estado_id = ep.id
  WHERE ep.mes IN ('2025-07','2025-08','2025-09','2025-10','2025-11','2025-12')
    AND ep.carteira_id IN (2,4,6)
  GROUP BY ep.id ORDER BY ep.mes, ep.carteira_id
`).all()

for (const r of rows) {
  const ok = r.soma_peso === 100 ? '✓' : `✗ (${r.soma_peso}%)`
  console.log(`  ${r.mes}  ${r.carteira.padEnd(18)} ${r.data_inicio} → ${r.data_fim}  ${String(r.n_prods).padStart(2)} prods  ${ok}`)
}
