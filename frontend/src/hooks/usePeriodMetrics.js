import { useState, useEffect } from 'react'
import { api } from '../services/api'

export function usePeriodMetrics(carteiraId, period) {
  const [metricas, setMetricas] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!carteiraId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const params = {}
    if (period?.start) params.start = period.start
    if (period?.end) params.end = period.end

    api.getMetricas(carteiraId, params)
      .then((data) => { if (!cancelled) { setMetricas(data); setError(null) } })
      .catch((e) => { if (!cancelled) { setMetricas(null); setError(e.message) } })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [carteiraId, period?.start, period?.end])

  return { metricas, loading, error }
}
