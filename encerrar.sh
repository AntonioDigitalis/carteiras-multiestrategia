#!/bin/bash
fuser -k 3001/tcp 5173/tcp 2>/dev/null
notify-send "Carteiras Multiestratégia" "Aplicação encerrada." --icon=utilities-finance 2>/dev/null || true
