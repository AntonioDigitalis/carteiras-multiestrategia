import { useState, useEffect, useRef } from 'react'
import { usePerfis, useCarteiras } from '../hooks/useCarteiras'
import { api } from '../services/api'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import Alert from '../components/ui/Alert'
import { Download, Upload, Save, Plus, Trash2 } from 'lucide-react'
import { format } from 'date-fns'

export default function Configurações() {
  const { perfis, loading, refetch: refetchPerfis } = usePerfis()
  const { carteiras, refetch: refetchCarteiras } = useCarteiras()
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [editPerfis, setEditPerfis] = useState([])
  const fileRef = useRef()
  const [importMode, setImportMode] = useState(null)
  const [importing, setImporting] = useState(false)
  const [alphaKey, setAlphaKey] = useState('')
  const [savingKey, setSavingKey] = useState(false)

  useEffect(() => {
    if (perfis.length > 0) setEditPerfis([...perfis])
  }, [perfis])

  useEffect(() => {
    api.getConfig().then((c) => { if (c.alpha_vantage_key) setAlphaKey(c.alpha_vantage_key) }).catch(() => {})
  }, [])

  async function salvarAlphaKey() {
    setSavingKey(true)
    try {
      await api.saveConfig({ alpha_vantage_key: alphaKey.trim() })
      setMsg({ type: 'success', text: 'Chave Alpha Vantage salva!' })
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setSavingKey(false)
    }
  }

  const [novoPerfil, setNovoPerfil] = useState('')
  const [novaCarteira, setNovaCarteira] = useState({ nome: '', perfil_id: '', tipo: 'A' })

  async function salvarPerfis() {
    setSaving(true)
    try {
      for (const p of editPerfis) {
        await api.updatePerfil(p.id, { nome: p.nome })
      }
      setMsg({ type: 'success', text: 'Perfis salvos com sucesso!' })
      refetchPerfis()
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setSaving(false)
    }
  }

  async function criarPerfil() {
    if (!novoPerfil.trim()) return
    try {
      await api.createPerfil({ nome: novoPerfil.trim() })
      setNovoPerfil('')
      setMsg({ type: 'success', text: 'Perfil criado!' })
      refetchPerfis()
    } catch (e) { setMsg({ type: 'error', text: e.message }) }
  }

  async function excluirPerfil(id) {
    if (!confirm('Excluir este perfil? Esta ação não pode ser desfeita.')) return
    try {
      await api.deletePerfil(id)
      setMsg({ type: 'success', text: 'Perfil excluído.' })
      refetchPerfis()
    } catch (e) { setMsg({ type: 'error', text: e.message }) }
  }

  async function criarCarteira() {
    if (!novaCarteira.nome.trim() || !novaCarteira.perfil_id) return
    try {
      await api.createCarteira(novaCarteira)
      setNovaCarteira({ nome: '', perfil_id: '', tipo: 'A' })
      setMsg({ type: 'success', text: 'Carteira criada! Configure a alocação macro dentro da carteira.' })
      refetchCarteiras()
    } catch (e) { setMsg({ type: 'error', text: e.message }) }
  }

  async function excluirCarteira(id, nome) {
    if (!confirm(`Excluir a carteira "${nome}"?`)) return
    try {
      await api.deleteCarteira(id)
      setMsg({ type: 'success', text: 'Carteira excluída.' })
      refetchCarteiras()
    } catch (e) { setMsg({ type: 'error', text: e.message }) }
  }

  async function exportar() {
    try {
      const data = await api.exportar()
      const json = JSON.stringify(data, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `carteiras_export_${format(new Date(), 'yyyy-MM-dd_HH-mm')}.json`
      a.click()
      URL.revokeObjectURL(url)
      setMsg({ type: 'success', text: 'Exportação concluída!' })
    } catch (e) {
      setMsg({ type: 'error', text: `Erro ao exportar: ${e.message}` })
    }
  }

  function handleFileSelect(e) {
    const file = e.target.files[0]
    if (!file) return
    if (!importMode) {
      setImportMode('select')
      return
    }
    doImport(file, importMode)
  }

  async function doImport(file, modo) {
    if (modo === 'substituir') {
      const ok = window.confirm(
        'ATENÇÃO: Esta ação irá APAGAR todos os dados locais (carteiras, produtos, histórico de cotas e alocações) e substituí-los pelo arquivo importado.\n\nEsta operação não pode ser desfeita. Deseja continuar?'
      )
      if (!ok) {
        setImportMode(null)
        if (fileRef.current) fileRef.current.value = ''
        return
      }
    }
    setImporting(true)
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      await api.importar(data, modo, modo === 'substituir')
      setMsg({ type: 'success', text: `Importação (${modo}) concluída! Recarregue a página.` })
    } catch (e) {
      setMsg({ type: 'error', text: `Erro ao importar: ${e.message}` })
    } finally {
      setImporting(false)
      setImportMode(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Configurações</h1>
        <p className="text-xs text-slate-500 mt-0.5">Perfis, exportação e importação de dados</p>
      </div>

      {msg && (
        <Alert
          type={msg.type}
          message={msg.text}
          onDismiss={() => setMsg(null)}
        />
      )}

      {/* Perfis */}
      <div className="card space-y-4">
        <div className="text-sm font-semibold text-slate-300">Nomes dos Perfis</div>
        <p className="text-xs text-slate-500">
          O sistema possui 3 perfis, cada um com 2 carteiras (A e B).
          Você pode renomear os perfis aqui.
        </p>
        {editPerfis.map((p, i) => (
          <div key={p.id} className="flex items-center gap-3">
            <span className="text-xs text-slate-500 w-20">Perfil {i + 1}</span>
            <input
              type="text"
              value={p.nome}
              onChange={(e) => {
                const novo = [...editPerfis]
                novo[i] = { ...p, nome: e.target.value }
                setEditPerfis(novo)
              }}
              className="input text-sm flex-1"
              placeholder={`Nome do Perfil ${i + 1}`}
            />
          </div>
        ))}
        <div className="pt-1">
          <button onClick={salvarPerfis} disabled={saving} className="btn-primary flex items-center gap-2">
            <Save size={13} />
            {saving ? 'Salvando...' : 'Salvar Perfis'}
          </button>
        </div>
      </div>

      {/* Gerenciar Perfis e Carteiras */}
      <div className="card space-y-5">
        <div className="text-sm font-semibold text-slate-300">Perfis e Carteiras</div>

        {/* Lista de perfis existentes */}
        <div className="space-y-2">
          {perfis.map((p) => {
            const carteirasDoPerfil = carteiras.filter((c) => c.perfil_id === p.id)
            return (
              <div key={p.id} className="border border-border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-200">{p.nome}</span>
                  <button onClick={() => excluirPerfil(p.id)} className="text-slate-600 hover:text-accent-red" title="Excluir perfil">
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="space-y-1 pl-2">
                  {carteirasDoPerfil.map((c) => (
                    <div key={c.id} className="flex items-center justify-between text-xs text-slate-400">
                      <span>{c.nome}</span>
                      <button onClick={() => excluirCarteira(c.id, c.nome)} className="text-slate-600 hover:text-accent-red ml-2" title="Excluir carteira">
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {/* Criar novo perfil */}
        <div>
          <div className="text-xs text-slate-400 font-medium mb-2">Novo perfil</div>
          <div className="flex gap-2">
            <input
              value={novoPerfil}
              onChange={(e) => setNovoPerfil(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && criarPerfil()}
              placeholder="Ex: ETF"
              className="input text-xs flex-1"
            />
            <button onClick={criarPerfil} className="btn-primary text-xs px-3 flex items-center gap-1">
              <Plus size={12} /> Criar
            </button>
          </div>
        </div>

        {/* Criar nova carteira */}
        <div>
          <div className="text-xs text-slate-400 font-medium mb-2">Nova carteira</div>
          <div className="grid grid-cols-2 gap-2">
            <input
              value={novaCarteira.nome}
              onChange={(e) => setNovaCarteira((p) => ({ ...p, nome: e.target.value }))}
              placeholder="Nome da carteira"
              className="input text-xs col-span-2"
            />
            <select
              value={novaCarteira.perfil_id}
              onChange={(e) => setNovaCarteira((p) => ({ ...p, perfil_id: Number(e.target.value) }))}
              className="input text-xs"
            >
              <option value="">Perfil...</option>
              {perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
            <input
              value={novaCarteira.tipo}
              onChange={(e) => setNovaCarteira((p) => ({ ...p, tipo: e.target.value }))}
              placeholder="Tipo (A, B...)"
              className="input text-xs"
            />
          </div>
          <button onClick={criarCarteira} className="btn-primary text-xs px-3 flex items-center gap-1 mt-2">
            <Plus size={12} /> Criar Carteira
          </button>
          <p className="text-[10px] text-slate-600 mt-1.5">
            Após criar, configure a alocação macro acessando a carteira no Dashboard.
          </p>
        </div>
      </div>

      {/* Exportar / Importar */}
      <div className="card space-y-4">
        <div className="text-sm font-semibold text-slate-300">Exportar / Importar</div>
        <p className="text-xs text-slate-500">
          Exporte o banco de dados completo em JSON para backup ou compartilhamento.
          Importe para restaurar ou mesclar com dados existentes.
        </p>

        <div className="flex flex-col gap-3">
          <button onClick={exportar} className="btn-secondary flex items-center gap-2 w-fit">
            <Download size={13} />
            Exportar banco de dados (JSON)
          </button>

          <div className="flex flex-col gap-2">
            {!importMode && (
              <button
                onClick={() => setImportMode('choose')}
                className="btn-secondary flex items-center gap-2 w-fit"
              >
                <Upload size={13} />
                Importar banco de dados
              </button>
            )}

            {importMode === 'choose' && (
              <div className="bg-bg-tertiary border border-border rounded-lg p-4 space-y-3">
                <div className="text-sm font-medium text-slate-300">Modo de importação</div>
                <div className="space-y-2">
                  <label className="flex items-start gap-3 cursor-pointer group">
                    <input
                      type="radio"
                      name="modo"
                      value="substituir"
                      onChange={() => setImportMode('substituir')}
                      className="mt-0.5 accent-accent-blue"
                    />
                    <div>
                      <div className="text-sm text-slate-300 group-hover:text-white">Substituir tudo</div>
                      <div className="text-xs text-slate-500">Apaga os dados locais e carrega o arquivo importado</div>
                    </div>
                  </label>
                  <label className="flex items-start gap-3 cursor-pointer group">
                    <input
                      type="radio"
                      name="modo"
                      value="merge"
                      onChange={() => setImportMode('merge')}
                      className="mt-0.5 accent-accent-blue"
                    />
                    <div>
                      <div className="text-sm text-slate-300 group-hover:text-white">Mesclar</div>
                      <div className="text-xs text-slate-500">Mantém dados locais e adiciona/atualiza com o arquivo</div>
                    </div>
                  </label>
                </div>
                <button onClick={() => setImportMode(null)} className="text-xs text-slate-500 hover:text-slate-300">
                  Cancelar
                </button>
              </div>
            )}

            {(importMode === 'substituir' || importMode === 'merge') && (
              <div className="space-y-2">
                <div className="text-xs text-slate-400">
                  Modo: <strong>{importMode}</strong> — selecione o arquivo JSON
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".json"
                  onChange={(e) => {
                    const file = e.target.files[0]
                    if (file) doImport(file, importMode)
                  }}
                  className="text-xs text-slate-400 file:btn-secondary file:mr-3 file:text-xs file:border-0 file:cursor-pointer"
                />
                {importing && <div className="text-xs text-slate-500">Importando...</div>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Chaves de API */}
      <div className="card space-y-4">
        <div className="text-sm font-semibold text-slate-300">Chaves de API</div>
        <div>
          <div className="text-xs text-slate-400 font-medium mb-1">Alpha Vantage (fallback para ações)</div>
          <p className="text-xs text-slate-500 mb-3">
            Usado como fallback quando o Yahoo Finance está indisponível. Chave gratuita em{' '}
            <span className="text-accent-blue">alphavantage.co</span> (25 req/dia).
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              value={alphaKey}
              onChange={(e) => setAlphaKey(e.target.value)}
              placeholder="Cole sua chave aqui"
              className="input text-xs flex-1 font-mono"
            />
            <button onClick={salvarAlphaKey} disabled={savingKey} className="btn-primary text-xs px-3">
              {savingKey ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
          {alphaKey && (
            <div className="mt-1.5 text-[10px] text-accent-green">
              Chave configurada — usada automaticamente se o Yahoo Finance falhar
            </div>
          )}
        </div>
      </div>

      {/* Informações do sistema */}
      <div className="card space-y-2">
        <div className="text-sm font-semibold text-slate-300">Sistema</div>
        <div className="text-xs text-slate-500 space-y-1">
          <div>Backend: Express + SQLite (localhost:3001)</div>
          <div>Frontend: React + Vite (localhost:5173)</div>
          <div>Dados externos: BCB SGS, CVM, Yahoo Finance / Alpha Vantage</div>
        </div>
      </div>
    </div>
  )
}
