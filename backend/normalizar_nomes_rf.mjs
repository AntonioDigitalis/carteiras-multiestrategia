import Database from 'better-sqlite3'

const db = new Database('/home/antonio/carteiras/backend/data/carteiras.db')

function gerarNomeRF(tipo, emissor, indexador, taxa, tipo_cdi, data_vencimento) {
  if (!tipo || taxa == null || taxa === '' || !data_vencimento) return null
  const [y, m] = data_vencimento.split('-')
  const venc = `${m}/${y}`
  let taxaStr
  if (indexador === 'CDI') {
    taxaStr = tipo_cdi === 'spread' ? `CDI +${taxa}%` : `${taxa}% CDI`
  } else if (indexador === 'IPCA') {
    taxaStr = `IPCA +${taxa}%`
  } else {
    taxaStr = `${taxa}%`
  }
  const emissorPart = emissor ? ` ${emissor}` : ''
  return `${tipo}${emissorPart} – ${taxaStr} – ${venc}`
}

// Mapeamento: nome antigo → { tipo, emissor }
// null = pular (taxa ou data_vencimento ausente)
const MAPEAMENTO = {
  // --- CDB ---
  'CBD BMG 2029 7,5%':                        { tipo: 'CDB', emissor: 'BMG' },
  'CDB Agibank - Abr/2028 107% do CDI':       { tipo: 'CDB', emissor: 'Agibank' },
  'CDB Agibank - IPCA+8,8% - 27/10/2027':     { tipo: 'CDB', emissor: 'Agibank' },
  'CDB Agibank 15,75% 14/01/2027':            { tipo: 'CDB', emissor: 'Agibank' },
  'CDB BANCO C6 15%':                          null,  // data_vencimento = null
  'CDB BMG 2028 103%':                         { tipo: 'CDB', emissor: 'BMG' },
  'CDB Banco C6 - 13,7% - Out/2027':          { tipo: 'CDB', emissor: 'Banco C6' },
  'CDB Banco C6 - 13,9% - 07/2029':           { tipo: 'CDB', emissor: 'Banco C6' },
  'CDB Banco C6 - 14,6% - 24/03/2030':        { tipo: 'CDB', emissor: 'Banco C6' },
  'CDB Banco C6 - 14,6% - 24/04/2030':        { tipo: 'CDB', emissor: 'Banco C6' },
  'CDB Banco C6 - Jul/2027 - 14,05%':         { tipo: 'CDB', emissor: 'Banco C6' },
  'CDB Banco Paraná - 14,05% - 26/11/2027':   { tipo: 'CDB', emissor: 'Banco Paraná' },
  'CDB C6 IPCA+8,15 15/08/2028':              { tipo: 'CDB', emissor: 'Banco C6' },
  'CDB PicPay - 14,2% - 31/01/2029':          { tipo: 'CDB', emissor: 'PicPay' },
  // --- CRA ---
  'CRA BRF – IPCA + 7,3% - 16/04/2035': { tipo: 'CRA', emissor: 'BRF' },
  'CRA CMAA - Out/2034 IPCA+8,5':             { tipo: 'CRA', emissor: 'CMAA' },
  'CRA Minerva - 13,7% - 11/2032':            { tipo: 'CRA', emissor: 'Minerva' },
  'CRA Minerva - IPCA + 8,3% - 16/07/2029':  { tipo: 'CRA', emissor: 'Minerva' },
  'CRA Minerva - IPCA + 8,5% - 16/11/2034':  { tipo: 'CRA', emissor: 'Minerva' },
  'CRA RAIZEN 7,55% 2029':                    { tipo: 'CRA', emissor: 'Raizen' },
  'CRA SÃO MARTINHO 2029':                    null,  // taxa = null
  'Cra Minerva - 97% do CDI - 16/11/2029':   { tipo: 'CRA', emissor: 'Minerva' },
  // --- CRI ---
  'CRI CYRELA Abr/2030 95% do CDI':           { tipo: 'CRI', emissor: 'Cyrela' },
  'CRI Guardian Atacadão – IPCA + 7,9 – 15/12/2037': { tipo: 'CRI', emissor: 'Guardian Atacadão' },
  'CRI Lavvi - 100% do CDI - 15/10/2032':     { tipo: 'CRI', emissor: 'Lavvi' },
  // --- CRPF ---
  'CRPF Suzano - IPCA + 6,7 - 09/2035':       { tipo: 'CRPF', emissor: 'Suzano' },
  // --- DEB Incentivada ---
  'DEB CTEEP (Isa Energia) - Out/2039 - IPCA + 6,5%':          { tipo: 'DEB Incentivada', emissor: 'CTEEP (Isa Energia)' },
  'DEB Eletrobras - Set/2034 IPCA+ 6,85%':                      { tipo: 'DEB Incentivada', emissor: 'Eletrobras' },
  'DEB Eletrobras IPCA+6,9% 15/09/2031':                        { tipo: 'DEB Incentivada', emissor: 'Eletrobras' },
  'DEB Eletronorte - 12,7% - Jul/2032':                         { tipo: 'DEB Incentivada', emissor: 'Eletronorte' },
  'DEB Rumo - Abr/2030 IPCA+6,9':                               { tipo: 'DEB Incentivada', emissor: 'Rumo' },
  'Debênture Eletrobras (Axia) - IPCA + 6,60% - 15/09/2034': { tipo: 'DEB Incentivada', emissor: 'Eletrobras (Axia)' },
  'Debênture Engie - IPCA + 6,1% - 15/06/2035':            { tipo: 'DEB Incentivada', emissor: 'Engie' },
  'Debênture Isa Energia (CTEEP) - IPCA + 6,65% - 15/10/2036': { tipo: 'DEB Incentivada', emissor: 'Isa Energia (CTEEP)' },
  // --- LCA ---
  'LCA BCOOM BBM – 92% do CDI – 22/09/2030': { tipo: 'LCA', emissor: 'Banco BBM' },
  'LCA BNDES 84% 15/01/2026':                  { tipo: 'LCA', emissor: 'BNDES' },
  'LCA Banco Original - 91% CDI - 05/04/2029': { tipo: 'LCA', emissor: 'Banco Original' },
  'LCA Banco Original - 91% CDI - 24/03/2028': { tipo: 'LCA', emissor: 'Banco Original' },
  'LCA SICOOB':                                 null,  // taxa = null, data_vencimento = null
  'LCA SICOOB - 92% do CDI - 31/10/2030':     { tipo: 'LCA', emissor: 'SICOOB' },
  'LCA SICOOB - Abr/2028 91% do CDI':         { tipo: 'LCA', emissor: 'SICOOB' },
  'LCA SICOOB - Mai/2028 90% do CDI':         { tipo: 'LCA', emissor: 'SICOOB' },
  // --- LCD ---
  'LCD BNDES 93% 2026':                        { tipo: 'LCD', emissor: 'BNDES' },
  'LCD BNDES Dez/2029 91% CDI':               { tipo: 'LCD', emissor: 'BNDES' },
  'LCD BNDES – 92% do CDI – 05/2029': { tipo: 'LCD', emissor: 'BNDES' },
  'LCD BRDE - Mai/2027 94% CDI':              { tipo: 'LCD', emissor: 'BRDE' },
  'LCD BRDE - Mai/2029 94% do CDI':           { tipo: 'LCD', emissor: 'BRDE' },
  // --- LFT (Tesouro Selic) ---
  'LFT – Selic + 0,01% - 01/03/2028':   { tipo: 'LFT', emissor: 'Tesouro Nacional' },
  'LFT – Selic + 0,01% - 01/03/2029':   { tipo: 'LFT', emissor: 'Tesouro Nacional' },
  'LFT – Selic + 0,01% - 01/09/2028':   { tipo: 'LFT', emissor: 'Tesouro Nacional' },
  'LFT – Selic + 0,05% - 01/03/2028':   { tipo: 'LFT', emissor: 'Tesouro Nacional' },
  'LTN Jul/2027 13,34%':                       { tipo: 'NTN-F', emissor: 'Tesouro Nacional' },
  // --- NTN-B ---
  'NTN-B - Ago/2028 IPCA+7,30':               { tipo: 'NTN-B', emissor: 'Tesouro Nacional' },
  'NTN-B - Ago/2028 IPCA+7,60':               { tipo: 'NTN-B', emissor: 'Tesouro Nacional' },
  'NTN-B - Ago/2030 - IPCA +7,4%':            { tipo: 'NTN-B', emissor: 'Tesouro Nacional' },
  'NTN-B 15/08/2032 IPCA + 7,30%':            { tipo: 'NTN-B', emissor: 'Tesouro Nacional' },
  'NTN-B 2030 7,29%':                          { tipo: 'NTN-B', emissor: 'Tesouro Nacional' },
  'NTN-B 2030 7,38%':                          { tipo: 'NTN-B', emissor: 'Tesouro Nacional' },
  'NTN-B IPCA+7,48 2030':                      { tipo: 'NTN-B', emissor: 'Tesouro Nacional' },
  'NTN-B – IPCA + 7,2 – 15/05/2033':   { tipo: 'NTN-B', emissor: 'Tesouro Nacional' },
  'NTN-B – IPCA + 7,2% – 15/05/2033':  { tipo: 'NTN-B', emissor: 'Tesouro Nacional' },
  'NTN-B – IPCA + 7,4 – 08/2030':      { tipo: 'NTN-B', emissor: 'Tesouro Nacional' },
  'NTN-B – IPCA + 7,5% – 15/05/2029':  { tipo: 'NTN-B', emissor: 'Tesouro Nacional' },
  // --- NTN-F ---
  'NTN-F 15,05% 2027':                         { tipo: 'NTN-F', emissor: 'Tesouro Nacional' },
  // --- Tesouro Selic (nomes antigos → LFT) ---
  'Tesouro Selic - Set/2028 Selic +0,01%':     { tipo: 'LFT', emissor: 'Tesouro Nacional' },
  'Tesouro Selic 2028':                         { tipo: 'LFT', emissor: 'Tesouro Nacional' },
  'Tesouro Selic CDI+0,08% 2027':              { tipo: 'LFT', emissor: 'Tesouro Nacional' },
}

// Busca todos os rf_curva produtos distintos com seus campos estruturais
const produtos = db.prepare(`
  SELECT DISTINCT nome, indexador, tipo_cdi, taxa, data_vencimento
  FROM produtos
  WHERE tipo = 'rf_curva'
  ORDER BY nome
`).all()

const updates = []
const skipped = []
const unmapped = []

for (const p of produtos) {
  if (!(p.nome in MAPEAMENTO)) {
    unmapped.push(p.nome)
    continue
  }
  const map = MAPEAMENTO[p.nome]
  if (map === null) {
    skipped.push({ nome: p.nome, motivo: p.taxa == null ? 'taxa=null' : 'data_vencimento=null' })
    continue
  }
  const novoNome = gerarNomeRF(map.tipo, map.emissor, p.indexador, p.taxa, p.tipo_cdi, p.data_vencimento)
  if (!novoNome) {
    skipped.push({ nome: p.nome, motivo: 'gerarNomeRF retornou vazio' })
    continue
  }
  if (novoNome !== p.nome) {
    updates.push({ nomeAntigo: p.nome, nomeNovo: novoNome })
  }
}

console.log('\n=== PREVIEW DE NORMALIZAÇÕES ===\n')
console.log(`Total de nomes distintos: ${produtos.length}`)
console.log(`Serão renomeados: ${updates.length}`)
console.log(`Pulados (dados incompletos): ${skipped.length}`)
console.log(`Sem mapeamento: ${unmapped.length}`)

if (updates.length > 0) {
  console.log('\nRenomeações:')
  for (const u of updates) {
    console.log(`  [ANTES] ${u.nomeAntigo}`)
    console.log(`  [DEPOIS] ${u.nomeNovo}`)
    console.log()
  }
}

if (skipped.length > 0) {
  console.log('Pulados:')
  for (const s of skipped) {
    console.log(`  [SKIP] ${s.nome}  (${s.motivo})`)
  }
  console.log()
}

if (unmapped.length > 0) {
  console.log('Sem mapeamento definido:')
  for (const n of unmapped) console.log(`  [???] ${n}`)
  console.log()
}

// Conta quantas linhas (não distinct) serão afetadas
let totalLinhas = 0
for (const u of updates) {
  const cnt = db.prepare(`SELECT COUNT(*) as n FROM produtos WHERE tipo='rf_curva' AND nome=?`).get(u.nomeAntigo)
  totalLinhas += cnt.n
}
console.log(`Linhas a atualizar no banco: ${totalLinhas}`)

// Executa
const stmtUpdate = db.prepare(`UPDATE produtos SET nome = ? WHERE tipo = 'rf_curva' AND nome = ?`)

const aplicar = db.transaction(() => {
  for (const u of updates) {
    const res = stmtUpdate.run(u.nomeNovo, u.nomeAntigo)
    console.log(`  OK: ${res.changes} linha(s)  "${u.nomeAntigo}" → "${u.nomeNovo}"`)
  }
})

console.log('\nAplicando atualizações...')
aplicar()
console.log('\nConcluído.')
