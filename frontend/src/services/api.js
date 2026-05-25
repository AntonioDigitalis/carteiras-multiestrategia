const BASE = '/api'

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }

  return res.json()
}

// ── Carteiras ──────────────────────────────────────────────
export const api = {
  // Carteiras
  getCarteiras: () => request('/carteiras'),
  getCarteira: (id) => request(`/carteiras/${id}`),
  updateCarteira: (id, data) => request(`/carteiras/${id}`, { method: 'PUT', body: data }),

  // Perfis
  getPerfis: () => request('/perfis'),
  createPerfil: (data) => request('/perfis', { method: 'POST', body: data }),
  updatePerfil: (id, data) => request(`/perfis/${id}`, { method: 'PUT', body: data }),
  deletePerfil: (id) => request(`/perfis/${id}`, { method: 'DELETE' }),

  // Carteiras (CRUD)
  createCarteira: (data) => request('/carteiras', { method: 'POST', body: data }),
  deleteCarteira: (id) => request(`/carteiras/${id}`, { method: 'DELETE' }),

  // Alocações macro
  getAlocacoes: (carteiraId) => request(`/carteiras/${carteiraId}/alocacoes`),
  getMesesComEstados: (carteiraId) => request(`/carteiras/${carteiraId}/meses-com-estados`),
  upsertAlocacao: (carteiraId, data) =>
    request(`/carteiras/${carteiraId}/alocacoes`, { method: 'POST', body: data }),

  // Estados do portfólio (produtos por mês)
  getEstados: (carteiraId, mes) =>
    request(`/carteiras/${carteiraId}/estados?mes=${mes}`),
  criarEstado: (carteiraId, data) =>
    request(`/carteiras/${carteiraId}/estados`, { method: 'POST', body: data }),
  atualizarEstado: (estadoId, data) =>
    request(`/estados/${estadoId}`, { method: 'PUT', body: data }),
  deletarEstado: (estadoId) =>
    request(`/estados/${estadoId}`, { method: 'DELETE' }),

  // Produtos
  getProdutos: (estadoId) => request(`/estados/${estadoId}/produtos`),
  adicionarProduto: (estadoId, data) =>
    request(`/estados/${estadoId}/produtos`, { method: 'POST', body: data }),
  atualizarProduto: (produtoId, data) =>
    request(`/produtos/${produtoId}`, { method: 'PUT', body: data }),
  removerProduto: (produtoId) =>
    request(`/produtos/${produtoId}`, { method: 'DELETE' }),

  // Cotas / preços históricos
  getCotasCache: (produtoId) => request(`/cotas/${produtoId}`),
  syncCotas: (produtoId) => request(`/cotas/${produtoId}/sync`, { method: 'POST' }),
  syncTodas: () => request('/cotas/sync-all', { method: 'POST' }),

  // Métricas
  getMetricas: (carteiraId, params) => {
    const qs = new URLSearchParams(params).toString()
    return request(`/carteiras/${carteiraId}/metricas?${qs}`)
  },
  getAtribuicao: (carteiraId, params) => {
    const qs = new URLSearchParams(params).toString()
    return request(`/carteiras/${carteiraId}/atribuicao?${qs}`)
  },
  getCarteiraPassiva: (carteiraId, params) => {
    const qs = new URLSearchParams(params).toString()
    return request(`/carteiras/${carteiraId}/passiva?${qs}`)
  },

  // Auditoria
  getAlertas: (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    return request(`/auditoria/alertas?${qs}`)
  },
  getLogCaptacao: (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    return request(`/auditoria/log?${qs}`)
  },
  marcarAlerta: (alertaId, status) =>
    request(`/auditoria/alertas/${alertaId}`, { method: 'PUT', body: { status } }),
  getSaude: () => request('/auditoria/saude'),
  getEventos: (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    return request(`/auditoria/eventos?${qs}`)
  },
  revisarEvento: (id) => request(`/auditoria/eventos/${id}/revisar`, { method: 'PUT' }),
  fetchMacro: (inicio, fim) =>
    request('/external/macro', { method: 'POST', body: { inicio, fim } }),
  fetchIndices: (inicio, fim) =>
    request('/external/indices', { method: 'POST', body: { inicio, fim } }),

  // Otimizador
  otimizar: (carteiraId, params = {}) =>
    request(`/carteiras/${carteiraId}/otimizar`, { method: 'POST', body: params }),
  exportarExcel: (carteiraId, params = {}) => {
    const qs = new URLSearchParams(params).toString()
    return fetch(`/api/carteiras/${carteiraId}/exportar-excel?${qs}`).then((r) => r.blob())
  },
  getAtivosClasse: (carteiraId, classe) =>
    request(`/carteiras/${carteiraId}/ativos-classe?classe=${classe}`),
  otimizarClasse: (carteiraId, body) =>
    request(`/carteiras/${carteiraId}/otimizar-classe`, { method: 'POST', body }),

  // Exportar / Importar
  exportar: () => request('/config/exportar'),
  importar: (data, modo) =>
    request('/config/importar', { method: 'POST', body: { data, modo } }),

  // Configurações
  getConfig: () => request('/config'),
  saveConfig: (data) => request('/config', { method: 'PUT', body: data }),

  // Dados externos (proxied)
  buscarFundo: (cnpj) => request(`/external/fundo/${cnpj}`),
  validarTicker: (ticker) => request(`/external/ticker/${ticker}`),
  getCDI: (inicio, fim) => request(`/external/cdi?inicio=${inicio}&fim=${fim}`),
  getIPCA: (inicio, fim) => request(`/external/ipca?inicio=${inicio}&fim=${fim}`),
}
