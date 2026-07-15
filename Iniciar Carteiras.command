#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║    Carteiras Multiestratégia - v1.0.0        ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# Mata um processo e toda sua árvore de descendentes (npx vite gera um
# processo filho para o servidor real — matar só o PID direto o deixava
# orfão rodando). Usa pgrep -P (relação real de processo pai/filho do SO),
# não porta — evita derrubar outro app que porventura esteja nas mesmas
# portas 3001/5173.
matar_arvore() {
  local pid=$1
  for filho in $(pgrep -P "$pid" 2>/dev/null); do
    matar_arvore "$filho"
  done
  kill -9 "$pid" 2>/dev/null
}

cleanup() {
  [ -n "$BACKEND_PID" ] && matar_arvore "$BACKEND_PID"
  [ -n "$FRONTEND_PID" ] && matar_arvore "$FRONTEND_PID"
}
trap cleanup EXIT
trap "exit" INT TERM HUP

echo "▶ Iniciando backend (porta 3001)..."
cd "$DIR/backend" && node src/index.js &
BACKEND_PID=$!

sleep 1

echo "▶ Iniciando frontend (porta 5173)..."
cd "$DIR/frontend" && npx vite &
FRONTEND_PID=$!

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
