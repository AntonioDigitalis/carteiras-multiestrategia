import { useState, useEffect } from 'react'
import { api } from '../services/api'

export function usePeriodMetrics(carteiraId, period) {
  const [metricas, setMetricas] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!carteiraId) return
    setLoading(true)
    const params = {}
    if (period?.start) params.start = period.start
    if (period?.end) params.end = period.end

    api.getMetricas(carteiraId, params)
      .then(setMetricas)
      .catch(() => setMetricas(null))
      .finally(() => setLoading(false))
  }, [carteiraId, period?.start, period?.end])

  return { metricas, loading }
}
