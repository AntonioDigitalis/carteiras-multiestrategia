#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

cd /home/antonio/carteiras/backend
nohup node src/index.js > /tmp/carteiras-backend.log 2>&1 &

cd /home/antonio/carteiras/frontend
nohup npx vite > /tmp/carteiras-frontend.log 2>&1 &

sleep 3
xdg-open http://localhost:5173
