#!/usr/bin/env bash
# AngoStart — executa os testes E2E da Fase 13 contra o build standalone.
# Uso (segredos via ambiente — nunca commitar):
#   DATABASE_URL=postgres://… bash scripts/run-test-fase13.sh
set -u
cd /home/z/my-project

if [ -z "${DATABASE_URL:-}" ]; then
  echo "❌ DATABASE_URL não definida — usa: DATABASE_URL=postgres://… bash $0"
  exit 1
fi

LOG="/home/z/my-project/scripts/test-server-f13.log"
PORT=3111
JWT_SECRET="${JWT_SECRET:-fase13-local-test-jwt-secret-0123456789abcdef}"
CRON_SECRET="${CRON_SECRET:-fase13-local-cron-secret-0123456789}"

rm -f "$LOG"

# Servidor standalone (produção) com segredos inline do ambiente.
PORT=$PORT HOSTNAME=127.0.0.1 \
DATABASE_URL="$DATABASE_URL" \
JWT_SECRET="$JWT_SECRET" \
CRON_SECRET="$CRON_SECRET" \
node .next/standalone/server.js > "$LOG" 2>&1 &
SERVER_PID=$!

# Espera o servidor responder (máx. 60 s)
for i in $(seq 1 60); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/api/config"; then
    echo "🌐 Servidor acima (pid $SERVER_PID) após ${i}s"
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "❌ Servidor morreu ao arrancar:"; tail -20 "$LOG"; exit 1
  fi
  sleep 1
done

CRON_SECRET="$CRON_SECRET" \
BASE_URL="http://127.0.0.1:$PORT" \
node scripts/test-fase13.js
EXIT=$?

kill "$SERVER_PID" 2>/dev/null || true
echo "--- últimas linhas do log do servidor ---"
tail -5 "$LOG"
exit $EXIT
