import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../services/api'

const IDLE = { running: false, percent: 0, processed: 0, total: 0, sincronizados: 0, erros: [] }

// Progresso do sync-all (processo único no backend). Ao montar, consulta o
// status atual — se já houver uma sincronização em andamento (disparada por
// outro botão), passa a acompanhar automaticamente.
export function useSyncProgress() {
  const [status, setStatus] = useState(IDLE)
  const intervalRef = useRef(null)

  const pararPolling = useCallback(() => {
    clearInterval(intervalRef.current)
    intervalRef.current = null
  }, [])

  const iniciarPolling = useCallback(() => {
    if (intervalRef.current) return
    intervalRef.current = setInterval(async () => {
      try {
        const s = await api.syncStatus()
        setStatus(s)
        if (!s.running) pararPolling()
      } catch {
        pararPolling()
      }
    }, 1000)
  }, [pararPolling])

  useEffect(() => {
    api.syncStatus().then((s) => {
      setStatus(s)
      if (s.running) iniciarPolling()
    }).catch(() => {})
    return pararPolling
  }, [iniciarPolling, pararPolling])

  const start = useCallback(async () => {
    try {
      const r = await api.syncTodas()
      setStatus((prev) => ({ ...prev, running: true, total: r.total, processed: 0, percent: 0 }))
    } catch (e) {
      // 409 = já rodando (ex: outro botão disparou) — só acompanhar
      if (!/andamento/i.test(e.message)) throw e
    }
    iniciarPolling()
  }, [iniciarPolling])

  return { status, start }
}
