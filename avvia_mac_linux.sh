#!/bin/sh
set -e
cd "$(dirname "$0")"
if [ ! -f .env ]; then
  echo "Configurazione mancante: .env"
  echo "Copia .env.example in .env e imposta VV_INITIAL_PASSWORD."
  exit 1
fi
exec python3 server.py
