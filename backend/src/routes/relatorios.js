import { Router } from 'express'
import { calcularDadosRelatorioMensal } from '../services/calculator.js'

const router = Router()

// POST /api/relatorios/mensal — body: { carteira_ids: [1,2,3,...] }
// Gera um Excel com uma aba por carteira: cota diária base 100 (carteira vs.
// CDI) desde o início, atribuição por classe/ativo desde a vigência da
// alocação atual, e a própria alocação vigente. Não sincroniza dados —
// usa o que já estiver em cotas_cache (sincronize antes via /cotas/sync-all).
router.post('/mensal', async (req, res) => {
  try {
    const { carteira_ids } = req.body
    if (!Array.isArray(carteira_ids) || carteira_ids.length === 0) {
      return res.status(400).json({ error: 'Informe ao menos uma carteira em carteira_ids' })
    }

    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const pct = (v, casas = 2) => v == null ? null : +(v * 100).toFixed(casas)
    const nomesUsados = new Set()

    for (const id of carteira_ids) {
      const dados = calcularDadosRelatorioMensal(Number(id))
      if (!dados) continue

      const tabela1 = [
        ['Data', 'Cota Carteira (base 100)', 'Cota CDI (base 100)'],
        ...dados.serieBase100.map((p) => [p.data, p.cota_carteira, p.cota_cdi]),
      ]

      const tabela2 = [
        [`Atribuição por classe — de ${dados.atribuicaoInicio} até ${dados.atribuicaoFim}`],
        ['Classe', 'Peso médio (%)', 'Retorno (%)', 'Contribuição (p.p.)', 'Benchmark (%)', 'vs Benchmark (p.p.)'],
        ...(dados.atribuicao?.classes ?? []).map((c) => [
          c.nome, pct(c.peso), pct(c.retorno), pct(c.contribuicao), pct(c.benchmark), pct(c.vs_benchmark),
        ]),
        ['Total', null, pct(dados.atribuicao?.retorno_total), null, null, null],
      ]

      const tabela2Ativos = [
        [`Atribuição por ativo — de ${dados.atribuicaoInicio} até ${dados.atribuicaoFim}`],
        ['Classe', 'Ativo', 'Identificador', 'Peso na carteira (%)', 'Peso na classe (%)', 'Retorno (%)', 'Contribuição (p.p.)'],
        ...(dados.atribuicao?.classes ?? []).flatMap((c) =>
          c.ativos.map((a) => [
            c.nome, a.nome, a.identificador ?? '', pct(a.peso_portfolio), pct(a.peso_classe), pct(a.retorno), pct(a.contribuicao),
          ])
        ),
      ]

      const tabela3 = [
        [`Alocação a informar ao investidor — vigência a partir de ${dados.alocacaoAtualInicio}`],
        ['Classe', 'Ativo', 'Identificador', 'Tipo', 'Peso (%)'],
        ...dados.alocacaoAtual.map((p) => [p.classe, p.nome, p.identificador, p.tipo, p.peso]),
        [],
        ['Comentários', dados.alocacaoAtualNotas ?? '(sem comentários)'],
      ]

      const linhasFolha = [
        ['TAREFA 1 — Cota diária (base 100): carteira desde o início vs. CDI'],
        [`De ${dados.serieBase100[0]?.data ?? '—'} até ${dados.serieBase100.at(-1)?.data ?? '—'}`],
        [],
        ...tabela1,
        [], [],
        ['TAREFA 2 — Atribuição por classe desde a última alteração'],
        [],
        ...tabela2,
        [],
        ...tabela2Ativos,
        [], [],
        ['TAREFA 3 — Alocação atual'],
        [],
        ...tabela3,
      ]

      const ws = XLSX.utils.aoa_to_sheet(linhasFolha)
      ws['!cols'] = [{ wch: 34 }, { wch: 22 }, { wch: 16 }, { wch: 20 }, { wch: 18 }, { wch: 16 }, { wch: 16 }]

      // Nomes de aba do Excel: máx. 31 chars, sem duplicar
      let nomeAba = dados.carteira.slice(0, 31)
      let sufixo = 2
      while (nomesUsados.has(nomeAba)) {
        nomeAba = `${dados.carteira.slice(0, 28)} ${sufixo}`
        sufixo++
      }
      nomesUsados.add(nomeAba)
      XLSX.utils.book_append_sheet(wb, ws, nomeAba)
    }

    if (nomesUsados.size === 0) {
      return res.status(404).json({ error: 'Nenhuma das carteiras informadas foi encontrada' })
    }

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="relatorio_mensal_${new Date().toISOString().split('T')[0]}.xlsx"`)
    res.send(buffer)
  } catch (e) {
    console.error('[relatorios/mensal]', e)
    res.status(500).json({ error: e.message })
  }
})

export default router
