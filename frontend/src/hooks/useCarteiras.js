import { useState, useEffect } from 'react'
import { api } from '../services/api'

export function useCarteiras() {
  const [carteiras, setCarteiras] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = () => api.getCarteiras().then(setCarteiras).catch(setError).finally(() => setLoading(false))

  useEffect(() => { load() }, [])

  return { carteiras, loading, error, refetch: load }
}

export function useCarteira(id) {
  const [carteira, setCarteira] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    api.getCarteira(id)
      .then(setCarteira)
      .catch(setError)
      .finally(() => setLoading(false))
  }, [id])

  return { carteira, loading, error, setCarteira }
}

export function useMetricas(carteiraId, period) {
  const [metricas, setMetricas] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!carteiraId || !period) return
    setLoading(true)
    setError(null)
    const params = {}
    if (period.start) params.start = period.start
    if (period.end) params.end = period.end

    api.getMetricas(carteiraId, params)
      .then(setMetricas)
      .catch(setError)
      .finally(() => setLoading(false))
  }, [carteiraId, period?.start, period?.end])

  return { metricas, loading, error }
}

export function usePerfis() {
  const [perfis, setPerfis] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getPerfis()
      .then(setPerfis)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  return { perfis, loading, refetch: () => api.getPerfis().then(setPerfis) }
}
