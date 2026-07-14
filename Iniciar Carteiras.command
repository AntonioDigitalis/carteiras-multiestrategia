#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║    Carteiras Multiestratégia - v1.0.0        ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

cleanup() {
  for port in 3001 5173; do
    pid=$(lsof -ti tcp:$port 2>/dev/null)
    [ -n "$pid" ] && kill -9 $pid 2>/dev/null
  done
}
trap cleanup EXIT
trap "exit" INT TERM HUP

echo "▶ Iniciando backend (porta 3001)..."
cd "$DIR/backend" && node src/index.js &

sleep 1

echo "▶ Iniciando frontend (porta 5173)..."
cd "$DIR/frontend" && npx vite &

sleep 2
open http://localhost:5173

echo ""
echo "✅ Aplicação rodando:"
echo "   Frontend: http://localhost:5173"
echo "   Backend:  http://localhost:3001"
echo ""
echo "   Feche esta janela do Terminal para encerrar."
echo ""

wait
