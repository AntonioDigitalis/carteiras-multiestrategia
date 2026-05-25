#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║    Carteiras Multiestratégia - v1.0.0        ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

echo "▶ Iniciando backend (porta 3001)..."
cd "$DIR/backend" && node src/index.js &
BACKEND_PID=$!

sleep 1

echo "▶ Iniciando frontend (porta 5173)..."
cd "$DIR/frontend" && npx vite &
FRONTEND_PID=$!

echo ""
echo "✅ Aplicação rodando:"
echo "   Frontend: http://localhost:5173"
echo "   Backend:  http://localhost:3001"
echo ""
echo "   Pressione Ctrl+C para encerrar"
echo ""

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; echo 'Encerrado.'" INT TERM
wait
