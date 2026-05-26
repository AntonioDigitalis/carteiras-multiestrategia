import { useState, useEffect } from 'react'
import { useCarteiras } from '../hooks/useCarteiras'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import { clsx } from 'clsx'
import { ChevronLeft, ChevronRight, Plus, Edit2, Trash2, Check, AlertTriangle } from 'lucide-react'
import { api } from '../services/api'
import { format, addMonths, subMonths, startOfMonth, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export default function GestãoDados() {
  const { carteiras, loading } = useCarteiras()
  const [carteiraId, setCarteiraId] = useState(null)
  const [mesCursor, setMesCursor] = useState(new Date())
  const [mesSelecionado, setMesSelecionado] = useState(null)
  const [mesesComAlocacao, setMesesComAlocacao] = useState([])
  const [mesesComProdutos, setMesesComProdutos] = useState([])
  const [mesesLoaded, setMesesLoaded] = useState(false)

  useEffect(() => {
    if (carteiras.length > 0 && !carteiraId) {
      setCarteiraId(carteiras[0].id)
    }
  }, [carteiras])

  useEffect(() => {
    if (!carteiraId) return
    setMesesLoaded(false)
    Promise.all([
      api.getAlocacoes(carteiraId).then((data) => setMesesComAlocacao(data.map((a) => a.mes))),
      api.getMesesComEstados(carteiraId).then(setMesesComProdutos),
    ])
      .catch(console.error)
      .finally(() => setMesesLoaded(true))
  }, [carteiraId])

  if (loading) return <LoadingSpinner text="Carregando..." />

  const mesesNoCalendario = gerarMeses(mesCursor)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Gestão de Dados</h1>
          <p className="text-xs text-slate-500 mt-0.5">Alocação macro e produtos por mês</p>
        </div>
        {/* Seletor de carteira */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400">Carteira:</label>
          <select
            value={carteiraId ?? ''}
            onChange={(e) => setCarteiraId(Number(e.target.value))}
            className="input text-sm w-52"
          >
            {carteiras.map((c) => (
              <option key={c.id} value={c.id}>{c.perfil_nome} – {c.nome}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Calendário */}
        <div className="col-span-1">
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <button onClick={() => setMesCursor(subMonths(mesCursor, 1))} className="text-slate-400 hover:text-slate-200">
                <ChevronLeft size={16} />
              </button>
              <div className="text-sm font-medium text-slate-300 capitalize">
                {format(mesCursor, 'MMMM yyyy', { locale: ptBR })}
              </div>
              <button onClick={() => setMesCursor(addMonths(mesCursor, 1))} className="text-slate-400 hover:text-slate-200">
                <ChevronRight size={16} />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {mesesNoCalendario.map((m) => {
                const mesStr = format(m, 'yyyy-MM')
                const temAlocacao = mesesComAlocacao.includes(mesStr)
                const temProdutos = mesesComProdutos.includes(mesStr)
                const selecionado = mesSelecionado === mesStr
                return (
                  <button
                    key={mesStr}
                    onClick={() => setMesSelecionado(mesStr)}
                    className={clsx(
                      'text-xs py-2 px-1 rounded text-center transition-colors',
                      selecionado
                        ? 'bg-accent-blue text-white font-medium'
                        : temProdutos
                        ? 'bg-green-900/30 text-accent-green hover:bg-green-900/50'
                        : temAlocacao
                        ? 'bg-slate-700/40 text-slate-400 hover:bg-slate-700/60'
                        : 'text-slate-500 hover:text-slate-300 hover:bg-bg-tertiary'
                    )}
                  >
                    {format(m, 'MMM', { locale: ptBR })}
                    <br />
                    <span className="text-[10px] opacity-70">{format(m, 'yyyy')}</span>
                    <div className="flex justify-center gap-0.5 mt-0.5 h-1">
                      {temAlocacao && !selecionado && (
                        <div className="w-1 h-1 rounded-full bg-accent-blue opacity-60" />
                      )}
                      {temProdutos && !selecionado && (
                        <div className="w-1 h-1 rounded-full bg-accent-green" />
                      )}
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="mt-4 flex items-center gap-3 text-[10px] text-slate-500">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-accent-green" />
                Com produtos
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-accent-blue opacity-60" />
                Só alocação macro
              </div>
            </div>
          </div>
        </div>

        {/* Formulário do mês */}
        <div className="col-span-2 space-y-3">
          {mesesLoaded && mesesComProdutos.length === 0 && (
            <div className="flex items-start gap-2 bg-yellow-900/20 border border-yellow-700/40 rounded-lg px-4 py-3 text-xs text-yellow-300">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>
                Esta carteira não possui produtos cadastrados em nenhum mês.
                Os produtos são específicos por carteira — verifique se selecionou a carteira correta
                (ex: <strong>Conservador Alfa</strong> em vez de <strong>Conservador A</strong>).
              </span>
            </div>
          )}
          {mesSelecionado ? (
            <FormularioMes
              carteiraId={carteiraId}
              mes={mesSelecionado}
              onSave={() => {
                api.getAlocacoes(carteiraId)
                  .then((data) => setMesesComAlocacao(data.map((a) => a.mes)))
                api.getMesesComEstados(carteiraId)
                  .then(setMesesComProdutos)
              }}
            />
          ) : (
            <div className="card flex flex-col items-center justify-center py-16 text-center">
              <div className="text-slate-500 text-sm">
                Selecione um mês no calendário para adicionar ou editar dados
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function FormularioMes({ carteiraId, mes, onSave }) {
  const [alocacao, setAlocacao] = useState(null)
  const [estados, setEstados] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [tabEstado, setTabEstado] = useState(0)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.getAlocacoes(carteiraId).then((all) => all.find((a) => a.mes === mes) || null),
      api.getEstados(carteiraId, mes),
    ])
      .then(([aloc, ests]) => {
        setAlocacao(
          aloc || {
            mes,
            pos_fixado: 0,
            inflacao: 0,
            prefixado: 0,
            rf_global: 0,
            multimercado: 0,
            rv_brasil: 0,
            rv_global: 0,
            fundos_listados: 0,
            alternativos: 0,
          }
        )
        setEstados(ests.length > 0 ? ests : [{ id: null, inicio: mes + '-01', fim: null, produtos: [] }])
        setTabEstado(0)
      })
      .catch(setError)
      .finally(() => setLoading(false))
  }, [carteiraId, mes])

  function totalAlocacao() {
    if (!alocacao) return 0
    return Object.keys(CLASSES).reduce((s, k) => s + (alocacao[k] || 0), 0)
  }

  async function salvar() {
    setSaving(true)
    setError(null)
    try {
      await api.upsertAlocacao(carteiraId, { ...alocacao, mes })
      onSave()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingSpinner />
  if (!alocacao) return null

  const total = totalAlocacao()
  const totalOk = Math.abs(total - 100) < 0.01

  return (
    <div className="space-y-4">
      {/* Alocação Macro */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-medium text-slate-300">
            Alocação Macro — {mes}
          </div>
          <div className={clsx(
            'text-xs font-mono font-medium px-2 py-0.5 rounded',
            totalOk ? 'bg-green-900/30 text-accent-green' : 'bg-red-900/30 text-accent-red'
          )}>
            {total.toFixed(1)}% / 100%
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {Object.entries(CLASSES).map(([key, label]) => (
            <div key={key}>
              <label className="label">{label}</label>
              <div className="flex items-center gap-1.5 min-w-0">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={0.5}
                  value={alocacao[key] || 0}
                  onChange={(e) => setAlocacao({ ...alocacao, [key]: parseFloat(e.target.value) })}
                  className="flex-1 min-w-0 accent-accent-blue"
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={alocacao[key] || 0}
                  onChange={(e) => setAlocacao({ ...alocacao, [key]: parseFloat(e.target.value) || 0 })}
                  className="input !w-14 text-right text-xs py-1 shrink-0"
                />
                <span className="text-xs text-slate-500 shrink-0">%</span>
              </div>
            </div>
          ))}
        </div>

        {!totalOk && (
          <div className="mt-3 flex items-center gap-2 text-xs text-accent-red">
            <AlertTriangle size={12} />
            A soma deve ser exatamente 100%. Faltam {(100 - total).toFixed(1)}%
          </div>
        )}
      </div>

      {/* Estados / Produtos */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium text-slate-300">Produtos por Estado</div>
          <button
            onClick={() => {
              const last = estados[estados.length - 1]
              setEstados([...estados, {
                id: null,
                inicio: last?.fim || mes + '-01',
                fim: null,
                produtos: [],
              }])
              setTabEstado(estados.length)
            }}
            className="btn-secondary text-xs py-1 flex items-center gap-1"
          >
            <Plus size={12} />
            Registrar Troca
          </button>
        </div>

        {/* Tab de estados */}
        {estados.length > 1 && (
          <div className="flex gap-2 mb-3">
            {estados.map((e, i) => (
              <button
                key={i}
                onClick={() => setTabEstado(i)}
                className={clsx(
                  'text-xs px-3 py-1 rounded',
                  tabEstado === i
                    ? 'bg-accent-blue text-white'
                    : 'bg-bg-tertiary text-slate-400 hover:text-slate-200'
                )}
              >
                Estado {i + 1}
                {e.inicio && <span className="ml-1 opacity-60">{e.inicio}</span>}
              </button>
            ))}
          </div>
        )}

        {estados[tabEstado] && (
          <EstadoProdutos
            estado={estados[tabEstado]}
            carteiraId={carteiraId}
            mes={mes}
            alocacao={alocacao}
            onUpdate={(est) => {
              const novo = [...estados]
              novo[tabEstado] = est
              setEstados(novo)
            }}
          />
        )}
      </div>

      {error && (
        <div className="text-xs text-accent-red bg-red-900/20 border border-red-800 rounded px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          onClick={salvar}
          disabled={saving || !totalOk}
          className="btn-primary flex items-center gap-2"
        >
          {saving ? 'Salvando...' : 'Salvar Alocação Macro'}
          {!saving && <Check size={14} />}
        </button>
      </div>
    </div>
  )
}

function EstadoProdutos({ estado, carteiraId, mes, alocacao, onUpdate }) {
  const [showForm, setShowForm] = useState(false)
  const [novoProduto, setNovoProduto] = useState({ tipo: 'fundo', nome: '', identificador: '', peso: 0, classe: 'pos_fixado' })
  const [buscando, setBuscando] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editValues, setEditValues] = useState({})

  const produtos = estado.produtos || []

  function startEdit(p) {
    setEditingId(p.id)
    setEditValues({ identificador: p.identificador || '', peso: p.peso ?? 0, nome: p.nome || '' })
  }

  async function salvarEdicao(produtoId) {
    try {
      const original = produtos.find((p) => p.id === produtoId)
      const updated = await api.atualizarProduto(produtoId, { ...original, ...editValues })
      onUpdate({ ...estado, produtos: produtos.map((p) => p.id === produtoId ? { ...p, ...updated } : p) })
      setEditingId(null)
    } catch (e) {
      alert(e.message)
    }
  }

  async function adicionarProduto() {
    setSaving(true)
    try {
      if (estado.id) {
        const created = await api.adicionarProduto(estado.id, novoProduto)
        onUpdate({ ...estado, produtos: [...produtos, created] })
      } else {
        // criar o estado primeiro
        const est = await api.criarEstado(carteiraId, {
          mes,
          data_inicio: estado.inicio,
          data_fim: estado.fim,
        })
        const created = await api.adicionarProduto(est.id, novoProduto)
        onUpdate({ ...est, produtos: [created] })
      }
      setShowForm(false)
      setNovoProduto({ tipo: 'fundo', nome: '', identificador: '', peso: 0, classe: 'pos_fixado' })
    } catch (e) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function removerProduto(produtoId) {
    if (!confirm('Remover produto?')) return
    await api.removerProduto(produtoId)
    onUpdate({ ...estado, produtos: produtos.filter((p) => p.id !== produtoId) })
  }

  const totalPesoPorClasse = {}
  for (const p of produtos) {
    totalPesoPorClasse[p.classe] = (totalPesoPorClasse[p.classe] || 0) + (p.peso || 0)
  }
  const totalPeso = produtos.reduce((s, p) => s + (p.peso || 0), 0)
  const totalPesoOk = Math.abs(totalPeso - 100) < 0.01

  // Classes com divergência entre macro e micro
  const divergencias = alocacao
    ? Object.keys(CLASSES).filter((k) => {
        const macro = alocacao[k] || 0
        const micro = totalPesoPorClasse[k] || 0
        return (macro > 0 || micro > 0) && Math.abs(micro - macro) > 0.01
      })
    : []

  return (
    <div className="space-y-3">
      {/* Datas */}
      <div className="flex gap-3 text-xs">
        <div>
          <label className="label">Data Início</label>
          <input
            type="date"
            value={estado.inicio || ''}
            onChange={(e) => onUpdate({ ...estado, inicio: e.target.value })}
            className="input text-xs py-1"
          />
        </div>
        <div>
          <label className="label">Data Fim (opcional)</label>
          <input
            type="date"
            value={estado.fim || ''}
            onChange={(e) => onUpdate({ ...estado, fim: e.target.value })}
            className="input text-xs py-1"
          />
        </div>
      </div>

      {/* Lista de produtos */}
      {produtos.length > 0 ? (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-border">
              <th className="text-left pb-2 font-medium">Produto</th>
              <th className="text-left pb-2 font-medium">Tipo</th>
              <th className="text-left pb-2 font-medium">Classe</th>
              <th className="text-right pb-2 font-medium">Peso</th>
              <th className="text-right pb-2 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {produtos.map((p) => {
              const isEditing = editingId === p.id
              return (
                <tr key={p.id} className={`border-b border-border/30 ${isEditing ? 'bg-slate-800/40' : ''}`}>
                  {isEditing ? (
                    <>
                      <td className="py-1 pr-2" colSpan={2}>
                        <div className="flex flex-col gap-1">
                          <input
                            className="input text-xs py-0.5 w-full"
                            placeholder="Nome"
                            value={editValues.nome}
                            onChange={(e) => setEditValues({ ...editValues, nome: e.target.value })}
                          />
                          <input
                            className="input text-xs py-0.5 font-mono w-full"
                            placeholder={p.tipo === 'fundo' ? 'CNPJ' : 'Ticker'}
                            value={editValues.identificador}
                            onChange={(e) => setEditValues({ ...editValues, identificador: e.target.value })}
                          />
                        </div>
                      </td>
                      <td className="py-1 text-slate-500 text-xs">{CLASSES[p.classe] || p.classe}</td>
                      <td className="py-1 text-right">
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="100"
                          className="input text-xs py-0.5 w-20 text-right font-mono"
                          value={editValues.peso}
                          onChange={(e) => setEditValues({ ...editValues, peso: parseFloat(e.target.value) || 0 })}
                        />
                      </td>
                      <td className="py-1 text-right">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => salvarEdicao(p.id)} className="text-accent-green hover:text-green-400" title="Salvar">
                            <Check size={13} />
                          </button>
                          <button onClick={() => setEditingId(null)} className="text-slate-500 hover:text-slate-300" title="Cancelar">
                            ✕
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="py-1.5 text-slate-300 font-medium">
                        <div>{p.nome}</div>
                        {p.identificador && <div className="text-[10px] text-slate-500 font-mono">{p.identificador}</div>}
                      </td>
                      <td className="py-1.5 text-slate-500">
                        {p.tipo === 'carteira' ? (
                          <span className="text-[10px] bg-blue-900/20 text-accent-blue border border-blue-800/30 rounded px-1.5 py-0.5">carteira composta</span>
                        ) : p.tipo}
                      </td>
                      <td className="py-1.5 text-slate-500">{CLASSES[p.classe] || p.classe}</td>
                      <td className="py-1.5 text-right font-mono text-slate-300">{p.peso?.toFixed(1)}%</td>
                      <td className="py-1.5 text-right">
                        <div className="flex justify-end gap-2">
                          <button onClick={() => startEdit(p)} className="text-slate-600 hover:text-accent-blue" title="Editar">
                            <Edit2 size={12} />
                          </button>
                          <button onClick={() => removerProduto(p.id)} className="text-slate-600 hover:text-accent-red" title="Remover">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border">
              <td colSpan={3} className="pt-2 text-xs text-slate-500 font-medium">Total</td>
              <td className={clsx(
                'pt-2 text-right font-mono text-xs font-medium',
                totalPesoOk ? 'text-accent-green' : 'text-accent-red'
              )}>
                {totalPeso.toFixed(1)}% / 100%
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      ) : (
        <div className="text-xs text-slate-600 py-4 text-center">Nenhum produto adicionado</div>
      )}

      {produtos.length > 0 && !totalPesoOk && (
        <div className="flex items-center gap-2 text-xs text-accent-red">
          <AlertTriangle size={12} />
          Soma dos produtos: {totalPeso.toFixed(1)}% — {totalPeso < 100 ? `faltam ${(100 - totalPeso).toFixed(1)}%` : `excesso de ${(totalPeso - 100).toFixed(1)}%`}
        </div>
      )}

      {divergencias.length > 0 && (
        <div className="space-y-1">
          {divergencias.map((k) => {
            const macro = alocacao[k] || 0
            const micro = totalPesoPorClasse[k] || 0
            return (
              <div key={k} className="flex items-center gap-2 text-xs text-yellow-400">
                <AlertTriangle size={12} className="shrink-0" />
                <span>
                  <span className="font-medium">{CLASSES[k]}</span>: macro {macro.toFixed(1)}% ≠ produtos {micro.toFixed(1)}%
                  {' '}({micro > macro ? '+' : ''}{(micro - macro).toFixed(1)}%)
                </span>
              </div>
            )
          })}
        </div>
      )}

      {showForm && (
        <FormNovoProduto
          produto={novoProduto}
          onChange={setNovoProduto}
          onSave={adicionarProduto}
          onCancel={() => setShowForm(false)}
          saving={saving}
          carteiraId={carteiraId}
        />
      )}

      <button
        onClick={() => setShowForm(true)}
        className="btn-secondary text-xs py-1.5 w-full flex items-center justify-center gap-1"
      >
        <Plus size={12} />
        Adicionar Produto
      </button>
    </div>
  )
}

function FormNovoProduto({ produto, onChange, onSave, onCancel, saving, carteiraId }) {
  const { carteiras } = useCarteiras()
  const [buscando, setBuscando] = useState(false)
  const [buscaErro, setBuscaErro] = useState(null)

  async function buscarNome() {
    if (!produto.identificador) return
    setBuscando(true)
    setBuscaErro(null)
    try {
      if (produto.tipo === 'fundo') {
        const r = await api.buscarFundo(produto.identificador)
        if (r.nome) {
          onChange({ ...produto, nome: r.nome })
        } else {
          setBuscaErro('CNPJ não encontrado no cadastro CVM. Digite o nome manualmente.')
        }
      } else if (produto.tipo === 'acao') {
        const r = await api.validarTicker(produto.identificador)
        if (r.nome) {
          onChange({ ...produto, nome: r.nome })
        } else {
          setBuscaErro('Ticker não encontrado. Digite o nome manualmente.')
        }
      }
    } catch (e) {
      setBuscaErro('Erro ao buscar. Verifique o CNPJ e tente novamente.')
    } finally {
      setBuscando(false)
    }
  }

  function handleSubCarteira(id) {
    const c = carteiras.find((x) => x.id === Number(id))
    onChange({ ...produto, identificador: String(id), nome: c ? `${c.perfil_nome} — ${c.nome}` : '' })
  }

  return (
    <div className="bg-bg-tertiary border border-border rounded-lg p-4 space-y-3">
      <div className="text-xs font-medium text-slate-300">Novo Produto</div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Tipo</label>
          <select
            value={produto.tipo}
            onChange={(e) => onChange({ ...produto, tipo: e.target.value, identificador: '', nome: '' })}
            className="input text-xs"
          >
            <option value="fundo">Fundo (CNPJ)</option>
            <option value="acao">Ação/ETF (ticker)</option>
            <option value="rf_curva">RF Marcada na Curva</option>
            <option value="carteira">Carteira Composta</option>
          </select>
        </div>
        <div>
          <label className="label">Classe de Ativo</label>
          <select
            value={produto.classe}
            onChange={(e) => onChange({ ...produto, classe: e.target.value })}
            className="input text-xs"
          >
            {Object.entries(CLASSES).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
      </div>

      {produto.tipo === 'carteira' && (
        <div>
          <label className="label">Sub-carteira referenciada</label>
          <select
            value={produto.identificador}
            onChange={(e) => handleSubCarteira(e.target.value)}
            className="input text-xs"
          >
            <option value="">Selecione uma carteira...</option>
            {carteiras
              .filter((c) => c.id !== carteiraId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.perfil_nome} — {c.nome}
                </option>
              ))}
          </select>
          <p className="text-[10px] text-slate-500 mt-1">
            O retorno mensal desta carteira será usado no cálculo desta classe.
          </p>
        </div>
      )}

      {produto.tipo !== 'rf_curva' && produto.tipo !== 'carteira' && (
        <div>
          <label className="label">
            {produto.tipo === 'fundo' ? 'CNPJ' : 'Ticker B3'}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={produto.identificador}
              onChange={(e) => onChange({ ...produto, identificador: e.target.value })}
              placeholder={produto.tipo === 'fundo' ? '00.000.000/0001-00' : 'BOVA11'}
              className="input text-xs flex-1"
            />
            <button onClick={buscarNome} disabled={buscando} className="btn-secondary text-xs px-3">
              {buscando ? '...' : 'Buscar'}
            </button>
          </div>
          {buscaErro && (
            <div className="text-[10px] text-accent-yellow mt-1">{buscaErro}</div>
          )}
        </div>
      )}

      {produto.tipo === 'rf_curva' && <CamposRFCurva produto={produto} onChange={onChange} />}

      <div>
        <label className="label">Nome</label>
        <input
          type="text"
          value={produto.nome}
          onChange={(e) => onChange({ ...produto, nome: e.target.value })}
          placeholder="Nome do produto"
          className="input text-xs"
        />
      </div>

      <div>
        <label className="label">Peso na Classe (%)</label>
        <input
          type="number"
          min={0}
          max={100}
          step={0.1}
          value={produto.peso}
          onChange={(e) => onChange({ ...produto, peso: parseFloat(e.target.value) || 0 })}
          className="input text-xs w-24"
        />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="btn-secondary text-xs py-1">Cancelar</button>
        <button onClick={onSave} disabled={saving || !produto.nome} className="btn-primary text-xs py-1">
          {saving ? 'Salvando...' : 'Adicionar'}
        </button>
      </div>
    </div>
  )
}

function CamposRFCurva({ produto, onChange }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Indexador</label>
          <select
            value={produto.indexador || 'CDI'}
            onChange={(e) => onChange({ ...produto, indexador: e.target.value })}
            className="input text-xs"
          >
            <option value="CDI">CDI</option>
            <option value="IPCA">IPCA</option>
            <option value="PRE">Pré-fixado</option>
          </select>
        </div>
        <div>
          <label className="label">
            {produto.indexador === 'CDI' ? '% do CDI ou spread a.a.' :
             produto.indexador === 'IPCA' ? 'IPCA + spread a.a.' : 'Taxa a.a.'}
          </label>
          <input
            type="number"
            step={0.01}
            value={produto.taxa || ''}
            onChange={(e) => onChange({ ...produto, taxa: parseFloat(e.target.value) || 0 })}
            placeholder={produto.indexador === 'CDI' ? '105 (% CDI) ou 1.2 (spread)' : '6.5'}
            className="input text-xs"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Data Emissão</label>
          <input
            type="date"
            value={produto.data_emissao || ''}
            onChange={(e) => onChange({ ...produto, data_emissao: e.target.value })}
            className="input text-xs"
          />
        </div>
        <div>
          <label className="label">Data Vencimento</label>
          <input
            type="date"
            value={produto.data_vencimento || ''}
            onChange={(e) => onChange({ ...produto, data_vencimento: e.target.value })}
            className="input text-xs"
          />
        </div>
      </div>
      {produto.indexador === 'CDI' && (
        <div>
          <label className="label">Tipo CDI</label>
          <select
            value={produto.tipo_cdi || 'pct'}
            onChange={(e) => onChange({ ...produto, tipo_cdi: e.target.value })}
            className="input text-xs"
          >
            <option value="pct">% do CDI (ex: 105%)</option>
            <option value="spread">CDI + spread a.a.</option>
          </select>
        </div>
      )}
    </div>
  )
}

const CLASSES = {
  pos_fixado:      'Pós-fixado',
  inflacao:        'Inflação',
  prefixado:       'Pré-fixado',
  rf_global:       'RF Global',
  multimercado:    'Multimercado',
  rv_brasil:       'RV Brasil',
  rv_global:       'RV Global',
  fundos_listados: 'Fundos Listados',
  alternativos:    'Alternativos',
}

function gerarMeses(cursor) {
  const meses = []
  for (let i = -5; i <= 6; i++) {
    meses.push(addMonths(startOfMonth(cursor), i))
  }
  return meses
}
