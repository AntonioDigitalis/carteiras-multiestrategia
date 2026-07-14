// Teste manual da Economatica News API (credenciais de teste).
// Uso: node backend/test_economatica_api.mjs [path]
// path default: /v1/me
import { createHash, createHmac } from 'crypto'
import { getDb } from './src/db/database.js'

const BASE_URL = 'https://news-api.economatica.com'
const path = process.argv[2] || '/v1/me'

const db = getDb()
const getConfig = (chave) => db.prepare('SELECT valor FROM configuracoes WHERE chave = ?').get(chave)?.valor?.trim() || null

const apiKey = getConfig('economatica_api_key')
const apiSecret = getConfig('economatica_api_secret')

if (!apiKey || !apiSecret) {
  console.error('Faltam credenciais: configure economatica_api_key e economatica_api_secret em Configurações.')
  process.exit(1)
}

function assinar(method, path, body, secret) {
  const bodyHash = createHash('sha256').update(body).digest('hex')
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const canonical = `${method}\n${path}\n${timestamp}\n${bodyHash}`
  const signature = createHmac('sha256', secret).update(canonical).digest('hex')
  return { timestamp, signature }
}

async function main() {
  console.log(`GET ${BASE_URL}${path}`)

  // health check primeiro (sem auth) — confirma que o serviço está no ar
  const health = await fetch(`${BASE_URL}/v1/health`)
  console.log(`/v1/health -> ${health.status}`, await health.json().catch(() => null))

  const { timestamp, signature } = assinar('GET', path, '', apiSecret)
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'x-api-key': apiKey,
      'x-timestamp': timestamp,
      'x-signature': signature,
    },
  })
  const body = await res.json().catch(() => null)
  console.log(`${path} -> ${res.status}`)
  console.log(JSON.stringify(body, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })
