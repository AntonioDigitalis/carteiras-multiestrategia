import { useState } from 'react'
import { api } from '../services/api'
import {
  CORES_OTIMIZADOR, LABELS_CLASSE_OT, fmtPct,
  FronteiraChart, PesosCard, PesosAtivoCard,
} from '../components/OtimizadorShared'

// Benchmark real usado por classe (para exibição)
const BENCHMARK_CLASSE = {
  pos_fixado:      'DEBB11 + CDI',
  inflacao:        'IMA-B (IMAB11)',
  prefixado:       'IRF-M (IRFM11)',
  rf_global:       'AGG + hedge BRL',
  multimercado:    'IHFA',
  rv_brasil:       'Ibovespa',
  rv_global:       'ACWI + hedge BRL',
  fundos_listados: 'IFIX',
}

const CLASSES_DISPONIVEIS = Object.keys(LABELS_CLASSE_OT).filter(k => k !== 'alternativos')
const DEFAULT_CLASSES = CLASSES_DISPONIVEIS

export default function OtimizadorLivre() {
  const [subTab, setSubTab] = useState('macro')

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Otimizador Livre</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Simule alocações sem vincular a uma carteira existente.
        </p>
      </div>

      <div className="flex gap-1 border-b border-border pb-3">
        {[
          { key: 'macro', label: 'Por Classe' },
          { key: 'ativo', label: 'Por Ativo' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              subTab === t.key ? 'bg-accent-blue text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === 'macro' && <OtimizadorMacroLivre />}
      {subTab === 'ativo' && <OtimizadorAtivoLivre />}
    </div>
  )
}

function OtimizadorMacroLivre() {
  const [classesSelecionadas, setClassesSelecionadas] = useState(new Set(DEFAULT_CLASSES))
  const [resultado, setResultado] = useState(null)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState(null)
  const [minPeso, setMinPeso] = useState(0)
  const [maxPeso, setMaxPeso] = useState(0)

  function toggleClasse(cls) {
    setClassesSelecionadas((prev) => {
      const next = new Set(prev)
      if (next.has(cls)) { next.delete(cls) } else { next.add(cls) }
      return next
    })
    setResultado(null)
  }

  async function otimizar() {
    if (classesSelecionadas.size < 2) { setErro('Selecione ao menos 2 classes'); return }
    setLoading(true); setErro(null); setResultado(null)
    try {
      const params = { classes: [...classesSelecionadas] }
      if (minPeso > 0) params.min_peso = minPeso
      if (maxPeso > 0) params.max_peso = maxPeso
      const data = await api.otimizarMacroLivre(params)
      if (data?.error) { setErro(data.error); return }
      setResultado(data)
    } catch (e) { setErro(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div className="space-y-6">
      <div className="card space-y-4">
        <div>
          <div className="text-sm font-medium text-slate-300 mb-1">Otimizador de Alocação por Classe (Monte Carlo)</div>
          <p className="text-xs text-slate-500">
            Usa benchmarks passivos de cada classe para simular {(5000).toLocaleString()} combinações e identificar os portfólios de máximo Sharpe, mínima volatilidade e paridade de risco. Baseado nos últimos 24 meses de dados macro.
          </p>
        </div>

        {/* Seletor de classes */}
        <div>
          <div className="text-xs text-slate-500 mb-2">
            Classes a incluir <span className="text-slate-600">({classesSelecionadas.size} selecionadas)</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {CLASSES_DISPONIVEIS.map((cls) => {
              const ativo = classesSelecionadas.has(cls)
              return (
                <button
                  key={cls}
                  onClick={() => toggleClasse(cls)}
                  className={`flex items-center justify-between px-3 py-2 rounded text-xs border transition-colors text-left ${
                    ativo
                      ? 'bg-accent-blue/10 border-accent-blue/40 text-slate-200'
                      : 'bg-bg-tertiary border-border text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <span className="font-medium">{LABELS_CLASSE_OT[cls]}</span>
                  <span className={`text-[10px] ${ativo ? 'text-slate-400' : 'text-slate-600'}`}>
                    {BENCHMARK_CLASSE[cls]}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 whitespace-nowrap">Mín. por classe (%)</label>
            <input
              type="number" min={0} max={100} step={1} value={minPeso}
              onChange={(e) => setMinPeso(Math.max(0, Number(e.target.value)))}
              className="w-16 bg-bg-tertiary border border-border rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-accent-blue"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 whitespace-nowrap">Máx. por classe (%)</label>
            <input
              type="number" min={0} max={100} step={1} value={maxPeso}
              onChange={(e) => setMaxPeso(Math.max(0, Number(e.target.value)))}
              className="w-16 bg-bg-tertiary border border-border rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-accent-blue"
            />
          </div>
          <span className="text-[10px] text-slate-600">0 = sem restrição</span>
        </div>

        <button onClick={otimizar} disabled={loading || classesSelecionadas.size < 2} className="btn-primary flex items-center gap-2">
          {loading ? <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />Otimizando...</> : 'Otimizar'}
        </button>
        {erro && <div className="mt-3 text-xs text-accent-red bg-red-900/20 border border-red-800/50 rounded px-3 py-2">{erro}</div>}
      </div>

      {resultado && (
        <>
          {/* Alertas de qualidade de dados */}
          {resultado.qualidade_dados && Object.entries(resultado.qualidade_dados).some(([, q]) => q.meses_reais < q.total) && (
            <div className="card border border-amber-800/40 bg-amber-900/10">
              <div className="text-xs font-medium text-amber-400 mb-2">Cobertura de dados por classe</div>
              <div className="space-y-1.5">
                {Object.entries(resultado.qualidade_dados).map(([cls, q]) => {
                  if (q.meses_reais === q.total) return null
                  const pct = Math.round((q.meses_reais / q.total) * 100)
                  const semDados = q.meses_reais === 0
                  const label = LABELS_CLASSE_OT[cls] || cls
                  const benchmark = BENCHMARK_CLASSE[cls] || '—'
                  return (
                    <div key={cls} className={`flex items-start gap-2 text-xs rounded px-2 py-1.5 ${semDados ? 'bg-red-900/20' : 'bg-amber-900/10'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-0.5 ${semDados ? 'bg-accent-red' : 'bg-amber-500'}`} />
                      <div className="flex-1 min-w-0">
                        <span className={semDados ? 'text-accent-red font-medium' : 'text-amber-400'}>{label}</span>
                        {semDados
                          ? <span className="text-slate-500 ml-1">— sem dados de {benchmark} no banco; toda a série usa estimativa CDI+spread. Considere desmarcar esta classe ou sincronizar os dados macro.</span>
                          : <span className="text-slate-600 ml-1">— {q.meses_reais}/{q.total} meses com {benchmark} real; restante usa estimativa CDI+spread</span>
                        }
                      </div>
                      <span className={`font-mono flex-shrink-0 ${semDados ? 'text-accent-red' : 'text-amber-500'}`}>{pct}%</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="card">
            <div className="text-sm font-medium text-slate-300 mb-1">Fronteira Eficiente</div>
            <p className="text-xs text-slate-500 mb-4">Cada ponto representa um portfólio simulado. Os portfólios ótimos estão destacados.</p>
            <FronteiraChart resultado={resultado} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <PesosCard titulo="Máximo Sharpe" subtitulo={`Sharpe: ${Number.isFinite(resultado.max_sharpe.sharpe) ? resultado.max_sharpe.sharpe.toFixed(2) : '—'}`} cor={CORES_OTIMIZADOR.max_sharpe} portfolio={resultado.max_sharpe} classes={resultado.classes} labels={resultado.labels} />
            <PesosCard titulo="Mínima Volatilidade" subtitulo={`Vol: ${fmtPct(resultado.min_vol.vol)}`} cor={CORES_OTIMIZADOR.min_vol} portfolio={resultado.min_vol} classes={resultado.classes} labels={resultado.labels} />
            {resultado.paridade_risco && (
              <PesosCard titulo="Paridade de Risco" subtitulo={`Vol: ${fmtPct(resultado.paridade_risco.vol)}`} cor={CORES_OTIMIZADOR.paridade_risco} portfolio={resultado.paridade_risco} classes={resultado.classes} labels={resultado.labels} />
            )}
          </div>
          <div className="card overflow-x-auto">
            <div className="text-sm font-medium text-slate-300 mb-4">Comparação de Portfólios</div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-slate-500">
                  <th className="text-left pb-2 font-medium">Métrica</th>
                  <th className="text-right pb-2 font-medium" style={{ color: CORES_OTIMIZADOR.max_sharpe }}>Máx. Sharpe</th>
                  <th className="text-right pb-2 font-medium" style={{ color: CORES_OTIMIZADOR.min_vol }}>Mín. Vol.</th>
                  {resultado.paridade_risco && <th className="text-right pb-2 font-medium" style={{ color: CORES_OTIMIZADOR.paridade_risco }}>Par. Risco</th>}
                </tr>
              </thead>
              <tbody>
                {[
                  { label: 'CAGR esperado', key: 'cagr', fmt: fmtPct },
                  { label: 'Volatilidade', key: 'vol', fmt: fmtPct },
                  { label: 'Sharpe', key: 'sharpe', fmt: (v) => v?.toFixed(2) },
                ].map(({ label, key, fmt }) => (
                  <tr key={key} className="border-b border-border/30">
                    <td className="py-2 text-slate-400">{label}</td>
                    <td className="py-2 text-right font-mono text-accent-green">{fmt(resultado.max_sharpe[key]) ?? '—'}</td>
                    <td className="py-2 text-right font-mono text-accent-yellow">{fmt(resultado.min_vol[key]) ?? '—'}</td>
                    {resultado.paridade_risco && <td className="py-2 text-right font-mono" style={{ color: CORES_OTIMIZADOR.paridade_risco }}>{fmt(resultado.paridade_risco[key]) ?? '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 text-[10px] text-slate-600">
              Baseado em {resultado.n_meses} meses · {resultado.n_simulacoes?.toLocaleString()} simulações · benchmarks passivos por classe
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function OtimizadorAtivoLivre() {
  const [classe, setClasse] = useState('multimercado')
  const [ativos, setAtivos] = useState([])
  const [novoId, setNovoId] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [addErro, setAddErro] = useState(null)
  const [resultado, setResultado] = useState(null)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState(null)
  const [minPeso, setMinPeso] = useState(0)
  const [maxPeso, setMaxPeso] = useState(0)
  const [usarDuration, setUsarDuration] = useState(false)
  const [usarMinValue, setUsarMinValue] = useState(false)
  const [targetDuration, setTargetDuration] = useState('')
  const [durationTolerancia, setDurationTolerancia] = useState(1)
  const [maxPortfolioMin, setMaxPortfolioMin] = useState('')

  function handleClasseChange(novaClasse) {
    setClasse(novaClasse)
    setAtivos([])
    setResultado(null)
    setMinPeso(0)
    setMaxPeso(0)
  }

  function atualizarAtivo(id, campo, valor) {
    setAtivos((prev) => prev.map((a) => a.identificador === id ? { ...a, [campo]: valor } : a))
  }

  async function adicionarAtivo() {
    const id = novoId.trim()
    if (!id) return
    if (ativos.some((a) => a.identificador === id)) { setAddErro('Ativo já está na lista'); return }
    setAddLoading(true); setAddErro(null)
    try {
      const isCNPJ = id.replace(/\D/g, '').length === 14
      let nome = id
      let tipo = 'acao'
      if (isCNPJ) {
        const fundo = await api.buscarFundo(id)
        nome = fundo.nome || id
        tipo = 'fundo'
      } else {
        const tick = await api.validarTicker(id)
        nome = tick.nome || id
        tipo = 'acao'
      }
      setAtivos((prev) => [...prev, { identificador: id, nome, tipo, classe, duration: '', min_lote: '' }])
      setNovoId('')
    } catch (e) { setAddErro(e.message) }
    finally { setAddLoading(false) }
  }

  function removerAtivo(id) { setAtivos((prev) => prev.filter((a) => a.identificador !== id)) }

  async function otimizar() {
    if (ativos.length < 2) { setErro('Adicione ao menos 2 ativos'); return }
    if (minPeso > 0 && minPeso * ativos.length > 100) {
      setErro(`Mín. ${minPeso}% × ${ativos.length} ativos = ${minPeso * ativos.length}% — impossível somar 100%. Reduza o mínimo.`)
      return
    }
    setLoading(true); setErro(null); setResultado(null)
    try {
      const ativosBody = ativos.map((a) => ({
        ...a,
        duration: usarDuration && a.duration !== '' ? Number(a.duration) : undefined,
        min_lote: usarMinValue && a.min_lote !== '' ? Number(a.min_lote) : undefined,
      }))
      const body = { classe, ativos: ativosBody, n_simulacoes: 5000 }
      if (minPeso > 0) body.min_peso = minPeso
      if (maxPeso > 0) body.max_peso = maxPeso
      if (usarDuration && targetDuration !== '') {
        body.target_duration = Number(targetDuration)
        body.duration_tolerancia = Number(durationTolerancia)
      }
      if (usarMinValue && maxPortfolioMin !== '') body.max_portfolio_min = Number(maxPortfolioMin)
      const data = await api.otimizarAtivosLivre(body)
      if (data?.error) { setErro(data.error); return }
      setResultado(data)
    } catch (e) { setErro(e.message) }
    finally { setLoading(false) }
  }

  const restricoesAtivas = (usarDuration && targetDuration !== '') || (usarMinValue && maxPortfolioMin !== '')

  return (
    <div className="space-y-6">
      <div className="card space-y-4">
        <div className="text-sm font-medium text-slate-300">Otimizador por Ativo</div>
        <p className="text-xs text-slate-500">
          Adicione ativos por ticker ou CNPJ. O sistema sincroniza os dados automaticamente e otimiza os pesos dentro da classe selecionada.
        </p>

        <div>
          <label className="text-xs text-slate-500 block mb-1">Classe de ativo</label>
          <select
            value={classe}
            onChange={(e) => handleClasseChange(e.target.value)}
            className="bg-bg-tertiary border border-border rounded px-3 py-1.5 text-xs text-slate-200 w-full"
          >
            {Object.entries(LABELS_CLASSE_OT).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        {/* Lista de ativos com inputs inline de restrições */}
        <div>
          <div className="text-xs text-slate-500 mb-2">Ativos na simulação</div>
          {ativos.length === 0 && (
            <p className="text-xs text-slate-600 italic">Nenhum ativo adicionado.</p>
          )}
          <div className="space-y-1.5">
            {ativos.map((a) => (
              <div key={a.identificador} className="bg-surface-2 rounded px-3 py-2">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs text-slate-200">{a.nome}</span>
                    <span className="text-[10px] text-slate-500 ml-2">{a.identificador}</span>
                  </div>
                  <button onClick={() => removerAtivo(a.identificador)} className="text-slate-600 hover:text-accent-red text-xs ml-2">✕</button>
                </div>
                {(usarDuration || usarMinValue) && (
                  <div className="flex flex-wrap gap-3 mt-2 pt-2 border-t border-border/30">
                    {usarDuration && (
                      <div className="flex items-center gap-1.5">
                        <label className="text-[10px] text-slate-500 whitespace-nowrap">Duration (anos)</label>
                        <input
                          type="number" min={0} step={0.1} value={a.duration}
                          onChange={(e) => atualizarAtivo(a.identificador, 'duration', e.target.value)}
                          placeholder="—"
                          className="w-16 bg-bg-tertiary border border-border rounded px-2 py-0.5 text-xs text-slate-200 focus:outline-none focus:border-accent-blue"
                        />
                      </div>
                    )}
                    {usarMinValue && (
                      <div className="flex items-center gap-1.5">
                        <label className="text-[10px] text-slate-500 whitespace-nowrap">Lote mín. (R$)</label>
                        <input
                          type="number" min={0} step={1} value={a.min_lote}
                          onChange={(e) => atualizarAtivo(a.identificador, 'min_lote', e.target.value)}
                          placeholder="—"
                          className="w-24 bg-bg-tertiary border border-border rounded px-2 py-0.5 text-xs text-slate-200 focus:outline-none focus:border-accent-blue"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs text-slate-500 mb-1">Adicionar ativo por CNPJ ou ticker</div>
          <div className="flex gap-2">
            <input
              value={novoId}
              onChange={(e) => setNovoId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && adicionarAtivo()}
              placeholder="Ex: 12.345.678/0001-90 ou IVVB11"
              className="flex-1 bg-bg-tertiary border border-border rounded px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-accent-blue"
            />
            <button onClick={adicionarAtivo} disabled={addLoading} className="btn-primary text-xs px-3">
              {addLoading ? '...' : 'Adicionar'}
            </button>
          </div>
          {addErro && <div className="mt-1 text-xs text-accent-red">{addErro}</div>}
        </div>

        {/* Restrições de pesos */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 whitespace-nowrap">Mín. por ativo (%)</label>
            <input
              type="number" min={0} max={100} step={1} value={minPeso}
              onChange={(e) => setMinPeso(Math.max(0, Number(e.target.value)))}
              className="w-16 bg-bg-tertiary border border-border rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-accent-blue"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 whitespace-nowrap">Máx. por ativo (%)</label>
            <input
              type="number" min={0} max={100} step={1} value={maxPeso}
              onChange={(e) => setMaxPeso(Math.max(0, Number(e.target.value)))}
              className="w-16 bg-bg-tertiary border border-border rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-accent-blue"
            />
          </div>
          <span className="text-[10px] text-slate-600">0 = sem restrição</span>
        </div>

        {/* Toggles de restrições avançadas */}
        <div className="border-t border-border pt-3 space-y-3">
          <div className="text-[10px] text-slate-600 uppercase tracking-wider">Restrições avançadas</div>

          {/* Duration */}
          <div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={usarDuration} onChange={(e) => setUsarDuration(e.target.checked)}
                className="w-3.5 h-3.5 accent-accent-blue" />
              <span className="text-xs text-slate-300">Restrição de Duration</span>
            </label>
            {usarDuration && (
              <div className="mt-2 ml-5 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs text-slate-500 whitespace-nowrap">Duration alvo (anos)</label>
                  <input
                    type="number" min={0} step={0.1} value={targetDuration}
                    onChange={(e) => setTargetDuration(e.target.value)}
                    placeholder="ex: 3.5"
                    className="w-20 bg-bg-tertiary border border-border rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-accent-blue"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <label className="text-xs text-slate-500 whitespace-nowrap">Tolerância ±</label>
                  <input
                    type="number" min={0} step={0.1} value={durationTolerancia}
                    onChange={(e) => setDurationTolerancia(Math.max(0, Number(e.target.value)))}
                    className="w-16 bg-bg-tertiary border border-border rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-accent-blue"
                  />
                  <span className="text-[10px] text-slate-600">anos</span>
                </div>
                <p className="text-[10px] text-slate-600 w-full">
                  Informe a duration (anos) de cada ativo na lista acima.
                  Apenas portfólios com duration dentro do intervalo [{targetDuration !== '' ? (Number(targetDuration) - durationTolerancia).toFixed(1) : '?'} – {targetDuration !== '' ? (Number(targetDuration) + durationTolerancia).toFixed(1) : '?'}] anos serão considerados.
                </p>
              </div>
            )}
          </div>

          {/* Valor mínimo */}
          <div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={usarMinValue} onChange={(e) => setUsarMinValue(e.target.checked)}
                className="w-3.5 h-3.5 accent-accent-blue" />
              <span className="text-xs text-slate-300">Restrição de Valor Mínimo da Carteira</span>
            </label>
            {usarMinValue && (
              <div className="mt-2 ml-5 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs text-slate-500 whitespace-nowrap">Valor máximo (R$)</label>
                  <input
                    type="number" min={0} step={1000} value={maxPortfolioMin}
                    onChange={(e) => setMaxPortfolioMin(e.target.value)}
                    placeholder="ex: 50000"
                    className="w-28 bg-bg-tertiary border border-border rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-accent-blue"
                  />
                </div>
                <p className="text-[10px] text-slate-600 w-full">
                  Informe o lote mínimo (R$) de cada ativo acima. Portfólios que exijam capital mínimo maior que R$ {maxPortfolioMin !== '' ? Number(maxPortfolioMin).toLocaleString('pt-BR') : '?'} serão descartados.
                </p>
              </div>
            )}
          </div>
        </div>

        <button onClick={otimizar} disabled={loading || ativos.length < 2} className="btn-primary flex items-center gap-2">
          {loading ? <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />Otimizando...</> : 'Otimizar Ativos'}
        </button>
        {erro && <div className="text-xs text-accent-red bg-red-900/20 border border-red-800/50 rounded px-3 py-2">{erro}</div>}
      </div>

      {resultado && (
        <>
          {resultado.ativos?.some((a) => !a.valido) && (
            <div className="card">
              <div className="text-xs text-slate-400 mb-2">Status dos dados por ativo</div>
              {resultado.ativos.map((a) => (
                <div key={a.identificador} className="flex items-center justify-between text-xs py-1 border-b border-border/20 last:border-0">
                  <span className={a.valido ? 'text-slate-300' : 'text-slate-500'}>{a.nome}</span>
                  <span className={a.valido ? 'text-accent-green' : 'text-accent-red'} title={a.sync_erro}>
                    {a.valido
                      ? `${a.n_meses_com_dados} meses`
                      : a.sync_erro
                        ? `não sincronizado — ${a.sync_erro}`
                        : 'sem dados históricos'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {restricoesAtivas && resultado.n_simulacoes_total != null && (
            <div className="card border border-border/50">
              <div className="text-xs text-slate-400">
                Restrições aplicadas: <span className="text-slate-200 font-mono">{resultado.n_simulacoes_validas?.toLocaleString()}</span> de <span className="font-mono">{resultado.n_simulacoes_total?.toLocaleString()}</span> simulações atenderam às restrições
                {resultado.n_simulacoes_validas / resultado.n_simulacoes_total < 0.1 && (
                  <span className="text-amber-400 ml-2">— amostra pequena, considere ampliar as tolerâncias</span>
                )}
              </div>
            </div>
          )}

          <div className="card">
            <div className="text-sm font-medium text-slate-300 mb-1">
              Fronteira Eficiente — {resultado.label_classe}
            </div>
            <p className="text-xs text-slate-500 mb-4">
              {restricoesAtivas ? 'Portfólios dentro das restrições definidas.' : 'Distribuição ótima dos ativos dentro da classe.'}
            </p>
            <FronteiraChart resultado={resultado} />
          </div>

          <div className={`grid gap-4 ${resultado.paridade_risco ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <PesosAtivoCard titulo="Máximo Sharpe" subtitulo={`Sharpe: ${Number.isFinite(resultado.max_sharpe.sharpe) ? resultado.max_sharpe.sharpe.toFixed(2) : '—'}`} cor={CORES_OTIMIZADOR.max_sharpe} portfolio={resultado.max_sharpe} ativos={resultado.ativos.filter((a) => a.valido)} />
            <PesosAtivoCard titulo="Mínima Volatilidade" subtitulo={`Vol: ${fmtPct(resultado.min_vol.vol)}`} cor={CORES_OTIMIZADOR.min_vol} portfolio={resultado.min_vol} ativos={resultado.ativos.filter((a) => a.valido)} />
            {resultado.paridade_risco && (
              <PesosAtivoCard
                titulo="Paridade de Risco"
                subtitulo={resultado.paridade_risco.viola_restricoes ? '⚠ não atende às restrições' : `Vol: ${fmtPct(resultado.paridade_risco.vol)}`}
                cor={resultado.paridade_risco.viola_restricoes ? '#94a3b8' : CORES_OTIMIZADOR.paridade_risco}
                portfolio={resultado.paridade_risco}
                ativos={resultado.ativos.filter((a) => a.valido)}
              />
            )}
          </div>

          <div className="card overflow-x-auto">
            <div className="text-sm font-medium text-slate-300 mb-4">Comparação de Portfólios</div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-slate-500">
                  <th className="text-left pb-2 font-medium">Métrica</th>
                  <th className="text-right pb-2 font-medium" style={{ color: CORES_OTIMIZADOR.max_sharpe }}>Máx. Sharpe</th>
                  <th className="text-right pb-2 font-medium" style={{ color: CORES_OTIMIZADOR.min_vol }}>Mín. Vol.</th>
                  {resultado.paridade_risco && <th className="text-right pb-2 font-medium" style={{ color: resultado.paridade_risco.viola_restricoes ? '#94a3b8' : CORES_OTIMIZADOR.paridade_risco }}>Par. Risco{resultado.paridade_risco.viola_restricoes ? ' ⚠' : ''}</th>}
                </tr>
              </thead>
              <tbody>
                {[
                  { label: 'CAGR esperado', key: 'cagr', fmt: fmtPct },
                  { label: 'Volatilidade', key: 'vol', fmt: fmtPct },
                  { label: 'Sharpe', key: 'sharpe', fmt: (v) => v?.toFixed(2) },
                ].map(({ label, key, fmt }) => (
                  <tr key={key} className="border-b border-border/30">
                    <td className="py-2 text-slate-400">{label}</td>
                    <td className="py-2 text-right font-mono text-accent-green">{fmt(resultado.max_sharpe[key]) ?? '—'}</td>
                    <td className="py-2 text-right font-mono text-accent-yellow">{fmt(resultado.min_vol[key]) ?? '—'}</td>
                    {resultado.paridade_risco && <td className="py-2 text-right font-mono" style={{ color: CORES_OTIMIZADOR.paridade_risco }}>{fmt(resultado.paridade_risco[key]) ?? '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 text-[10px] text-slate-600">
              Baseado em {resultado.n_meses} meses · {resultado.n_simulacoes?.toLocaleString()} simulações
            </div>
          </div>
        </>
      )}
    </div>
  )
}
