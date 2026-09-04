#!/usr/bin/env bash
# AngoStart — garante que o servidor standalone (porta 3210) está vivo.
# O sandbox ceifa processos em background entre chamadas do bash, por isso
# este script é chamado no INÍCIO de cada batch de testes de browser.
# Uso: bash scripts/ensure-server.sh [espera_s]
set -u
PORT=3210
ROOT="/home/z/my-project/angostart"

if curl -s -o /dev/null --max-time 2 "http://localhost:${PORT}/"; then
  echo "servidor já está vivo"
  exit 0
fi

# Mata restos (porto ocupado mas a morrer / zombie)
lsof -ti:"${PORT}" 2>/dev/null | xargs -r kill -9 2>/dev/null
sleep 1

cd "${ROOT}/.next/standalone" || exit 1
set -a
. "${ROOT}/.env.local"
set +a
PORT="${PORT}" HOSTNAME=0.0.0.0 nohup bun server.js > "${ROOT}/server.log" 2>&1 &
ESPERA="${1:-5}"
for i in $(seq 1 "${ESPERA}"); do
  if curl -s -o /dev/null --max-time 2 "http://localhost:${PORT}/"; then
    echo "servidor arrancou (${i}s)"
    exit 0
  fi
  sleep 1
done
echo "FALHA: servidor não respondeu em ${ESPERA}s"
exit 1
