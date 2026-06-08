import express from 'express'
import cors from 'cors'
import { getDb, closeDb } from './db/database.js'
import carteirasRouter from './routes/carteiras.js'
import perfisRouter from './routes/perfis.js'
import produtosRouter from './routes/produtos.js'
import estadosRouter from './routes/estados.js'
import cotasRouter from './routes/cotas.js'
import auditoriaRouter from './routes/auditoria.js'
import externalRouter from './routes/external.js'
import configRouter from './routes/config.js'
import otimizadorRouter from './routes/otimizador.js'

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }))
app.use(express.json({ limit: '50mb' }))

// Inicializar DB antes das rotas
getDb()

// Rotas
app.use('/api/carteiras', carteirasRouter)
app.use('/api/perfis', perfisRouter)
app.use('/api/estados', estadosRouter)
app.use('/api/estados', produtosRouter)
app.use('/api/produtos', produtosRouter)
app.use('/api/cotas', cotasRouter)
app.use('/api/auditoria', auditoriaRouter)
app.use('/api/external', externalRouter)
app.use('/api/config', configRouter)
app.use('/api/otimizador', otimizadorRouter)

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() })
})

// Error handler
app.use((err, req, res, next) => {
  console.error('[error]', err)
  res.status(500).json({ error: err.message })
})

app.listen(PORT, () => {
  console.log(`\n🚀 Backend rodando em http://localhost:${PORT}`)
  console.log(`   Banco de dados: ./data/carteiras.db\n`)
})

function gracefulShutdown(signal) {
  console.log(`\n[server] Encerrando por ${signal}...`)
  closeDb()
  process.exit(0)
}

process.on('SIGINT',  () => gracefulShutdown('SIGINT'))
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
