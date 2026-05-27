Processe os dados de rebalanceamento abaixo para importar no banco `/home/antonio/carteiras/backend/data/carteiras.db`.

Execute **exatamente** nestas etapas, sem pular nenhuma:

---

## Formato do JSON de entrada

Cada produto pode ter **dois formatos**:

**Formato padrão** (fundos, ações, sub-carteiras):
```json
{ "nome": "Kinea Atlas II FIM", "peso": 3 }
```

**Formato rf_curva** (renda fixa marcada na curva):
```json
{ "tipo_inst": "NTN-B", "emissor": "Tesouro Nacional", "taxa": 7.4, "vencimento": "2030-08-01", "peso": 7.4 }
```

Campos do formato rf_curva:
- `tipo_inst` (obrigatório): `LFT`, `NTN-B`, `NTN-F`, `CDB`, `LCI`, `LCA`, `LCD`, `CRI`, `CRA`, `DEB`, `DEB Incentivada`, `Outro`
- `emissor` (obrigatório, exceto Tesouro Nacional onde é opcional): nome do emissor
- `taxa` (obrigatório): número decimal
- `vencimento` (obrigatório): `YYYY-MM-DD` ou `YYYY-MM-01`
- `indexador` (opcional): sobrescreve o padrão do tipo_inst
- `tipo_cdi` (opcional): `'pct'` ou `'spread'`, sobrescreve o padrão

Presets por tipo_inst (indexador / tipo_cdi / isento_ir):
```
LFT            → CDI  / spread / 0   (emissorFixo: Tesouro Nacional)
NTN-B          → IPCA / null   / 0   (emissorFixo: Tesouro Nacional)
NTN-F          → PRE  / null   / 0   (emissorFixo: Tesouro Nacional)
CDB            → CDI  / pct    / 0
LCI            → CDI  / pct    / 1
LCA            → CDI  / pct    / 1
LCD            → CDI  / pct    / 1
CRI            → IPCA / null   / 1
CRA            → IPCA / null   / 1
DEB            → IPCA / null   / 0
DEB Incentivada→ IPCA / null   / 1
Outro          → CDI  / pct    / 0
```

---

## ETAPA 1 — Ler estado atual do DB

Rode este snippet antes de qualquer cálculo:
```js
const Database = require('better-sqlite3')
const db = new Database('/home/antonio/carteiras/backend/data/carteiras.db')
const estados = db.prepare(`
  SELECT ep.carteira_id, ep.mes, ep.data_inicio
  FROM estados_portfolio ep WHERE ep.carteira_id IN (2,4,6)
  ORDER BY ep.carteira_id, ep.data_inicio
`).all()
console.log(JSON.stringify(estados))
```
Guarde o resultado para calcular `data_fim` corretamente.

## ETAPA 2 — Calcular datas de vigência

- `data_inicio` = campo `data` do JSON para aquele período.
- `data_fim` = **data_inicio do próximo período - 1 dia**:
  - Se existe período seguinte no JSON: use sua `data_inicio - 1 dia`.
  - Se é o último período do JSON: busque no resultado da ETAPA 1 se já existe um estado posterior para aquela carteira; se sim, use sua `data_inicio - 1 dia`; se não, use o último dia do mês.
- **Nunca** insira com `data_fim = NULL` quando existir um próximo estado conhecido.

## ETAPA 3 — Validar somas

Para cada perfil + período:

**Macro**: some os 9 campos (`pos_fixada + inflacao + pre_fixada + renda_fixa_global + multimercados + renda_variavel_brasil + renda_variavel_global + fundos_listados + alternativos`). Deve ser 100.0 ± 0.01.

**Micro**: para cada classe, some os `peso` dos produtos. Deve ser igual ao valor macro correspondente ± 0.01.

## ETAPA 4 — Inferir tipo, nome e isento_ir

**Produto com campo `tipo_inst`** → sempre `rf_curva`:
1. Aplique os presets da tabela acima para `indexador`, `tipo_cdi`, `isento_ir` (campos explícitos no JSON sobrescrevem o preset).
2. Gere o `nome` com a função abaixo:

```js
function gerarNomeRF(tipo, emissor, indexador, taxa, tipo_cdi, vencimento) {
  const [y, m] = vencimento.split('-')
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
```

**Produto com campo `nome`** → detectar tipo:
- `'carteira'` → nome contém "Carteira de FIIs", "Carteira Top Dividendos", "Carteira Top Ações"
- `'acao'` → ticker de bolsa (ex: BSHV39, HAPV3)
- `'fundo'` → todo o restante

**isento_ir para produtos `nome`** = 1 se contém LCI, LCA, CRI, CRA, LCD, ou debênture incentivada.

**Identificadores fixos para sub-carteiras**:
- "Carteira de FIIs" → `'10'`
- "Carteira Top Dividendos" → `'9'`
- "Carteira Top Ações" → `'8'`

**Mapeamento de perfis**:
- `conservadora` → `perfil_id=1, carteira_id=2`
- `moderada` → `perfil_id=2, carteira_id=4`
- `agressiva` → `perfil_id=3, carteira_id=6`

**Mapeamento de classes** (chave JSON → coluna DB):
```
pos_fixada          → pos_fixado
inflacao            → inflacao
pre_fixada          → prefixado
renda_fixa_global   → rf_global
multimercados       → multimercado
renda_variavel_brasil → rv_brasil
renda_variavel_global → rv_global
fundos_listados     → fundos_listados
alternativos        → alternativos
```

## ETAPA 5 — Mostrar preview e aguardar confirmação

Exiba:

```
=== PREVIEW ===
Período  Carteira          data_inicio  data_fim    #Prods
...

SOMAS MACRO:
Período  Perfil        Soma    OK?
...

SOMAS MICRO (divergências apenas):
Período  Perfil        Classe         Micro  Macro  Diff
...

INFERÊNCIAS rf_curva (nomes gerados):
tipo_inst  Emissor        Nome gerado
...

INFERÊNCIAS outros (tipo / isento_ir):
Produto                   Tipo      IR
...
```

Se houver divergências, pergunte: **"Há N divergências. Corrigir agora, importar assim mesmo ou cancelar?"**

Aguarde resposta explícita do usuário antes de prosseguir.

## ETAPA 6 — Gerar e executar o script de import

Gere um arquivo `.mjs` em `/home/antonio/carteiras/backend/` e execute com `node`.

**O script deve incluir** a função `gerarNomeRF` e o objeto `TIPOS_RF` com os presets, e usá-los para gerar `nome`, `indexador`, `tipo_cdi` e `isento_ir` de cada produto rf_curva.

**Regras obrigatórias de SQL:**

1. DELETE na ordem certa (FK sem CASCADE):
```sql
UPDATE alertas_auditoria SET produto_id = NULL
  WHERE produto_id IN (SELECT id FROM produtos WHERE estado_id IN (...))
DELETE FROM produtos WHERE estado_id IN (...)
DELETE FROM estados_portfolio WHERE carteira_id IN (...) AND mes IN (...)
```

2. INSERT produtos com **parâmetros nomeados** (nunca posicionais):
```sql
INSERT INTO produtos
  (estado_id, tipo, classe, nome, identificador, peso,
   indexador, tipo_cdi, taxa, data_emissao, data_vencimento, isento_ir)
VALUES
  (@estado_id, @tipo, @classe, @nome, @identificador, @peso,
   @indexador, @tipo_cdi, @taxa, @data_emissao, @data_vencimento, @isento_ir)
```

3. INSERT `estados_portfolio` sempre com `data_fim` explícito.

4. INSERT `alocacoes_macro` com todos os campos nomeados explicitamente.

## ETAPA 7 — Verificar resultado

Após executar, rode:
```sql
SELECT c.nome, ep.mes, ep.data_inicio, ep.data_fim,
       COUNT(p.id) as n_prods, ROUND(SUM(p.peso),2) as soma_peso
FROM estados_portfolio ep
JOIN carteiras c ON c.id = ep.carteira_id
LEFT JOIN produtos p ON p.estado_id = ep.id
WHERE ep.mes IN (<meses importados>)
GROUP BY ep.id ORDER BY ep.mes, ep.carteira_id
```

Mostre o resultado completo. Aponte qualquer soma_peso diferente de 100.

---

## Dados para importar:

$ARGUMENTS
