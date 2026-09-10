import { useState } from 'react'
import { RefreshCw, FileDown } from 'lucide-react'
import { useCarteiras } from '../hooks/useCarteiras'
import { useSyncProgress } from '../hooks/useSyncProgress'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import { api } from '../services/api'

function groupByPerfil(carteiras) {
  const map = {}
  for (const c of carteiras) {
    if (!map[c.perfil_id]) map[c.perfil_id] = { id: c.perfil_id, nome: c.perfil_nome, carteiras: [] }
    map[c.perfil_id].carteiras.push(c)
  }
  return Object.values(map)
}

export default function Relatorios() {
  const { carteiras, loading } = useCarteiras()
  const { status, start } = useSyncProgress()
  const [selecionadas, setSelecionadas] = useState(new Set())
  const [gerando, setGerando] = useState(false)
  const [erro, setErro] = useState(null)

  function toggle(id) {
    setSelecionadas((prev) => {
      const novo = new Set(prev)
      novo.has(id) ? novo.delete(id) : novo.add(id)
      return novo
    })
  }

  function toggleTodas() {
    setSelecionadas((prev) => (prev.size === carteiras.length ? new Set() : new Set(carteiras.map((c) => c.id))))
  }

  async function gerarRelatorio() {
    setErro(null)
    setGerando(true)
    try {
      const blob = await api.gerarRelatorioMensal([...selecionadas])
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `relatorio_mensal_${new Date().toISOString().split('T')[0]}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setErro(e.message)
    } finally {
      setGerando(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Relatórios</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Cota diária (base 100) vs. CDI, atribuição por classe desde a última alteração e alocação atual — uma aba por carteira.
          </p>
        </div>
        <button
          onClick={() => start()}
          disabled={status.running}
          className="btn-secondary relative overflow-hidden flex items-center gap-2"
        >
          {status.running && (
            <span
              className="absolute inset-y-0 left-0 bg-accent-blue/20 transition-all duration-300"
              style={{ width: `${status.percent}%` }}
            />
          )}
          <span className="relative flex items-center gap-2">
            <RefreshCw size={13} className={status.running ? 'animate-spin' : ''} />
            {status.running
              ? `Sincronizando... ${status.percent}% (${status.processed}/${status.total})`
              : 'Sincronizar Dados'}
          </span>
        </button>
      </div>

      {loading ? (
        <LoadingSpinner text="Carregando carteiras..." />
      ) : (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-medium text-slate-300">
              Carteiras <span className="text-slate-600">({selecionadas.size} selecionadas)</span>
            </div>
            <button onClick={toggleTodas} className="text-xs text-accent-blue hover:underline">
              {selecionadas.size === carteiras.length ? 'Limpar seleção' : 'Selecionar todas'}
            </button>
          </div>

          <div className="space-y-4">
            {groupByPerfil(carteiras).map((perfil) => (
              <div key={perfil.id}>
                <div className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                  {perfil.nome}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {perfil.carteiras.map((c) => (
                    <label
                      key={c.id}
                      className="flex items-center gap-2 px-3 py-2 rounded text-xs border border-border bg-bg-tertiary text-slate-300 cursor-pointer hover:border-accent-blue/40"
                    >
                      <input
                        type="checkbox"
                        checked={selecionadas.has(c.id)}
                        onChange={() => toggle(c.id)}
                        className="accent-accent-blue"
                      />
                      {c.nome}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {erro && <div className="mt-3 text-xs text-accent-red bg-red-900/20 border border-red-800/50 rounded px-3 py-2">{erro}</div>}

          <button
            onClick={gerarRelatorio}
            disabled={selecionadas.size === 0 || gerando}
            className="btn-primary mt-4 flex items-center gap-2"
          >
            {gerando ? (
              <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <FileDown size={14} />
            )}
            {gerando ? 'Gerando...' : 'Gerar Relatório'}
          </button>
        </div>
      )}
    </div>
  )
}
