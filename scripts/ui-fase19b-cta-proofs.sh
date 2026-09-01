#!/bin/bash
# Fase 19b — prova visual dos CTAs contextuais (route armado ANTES da navegação).
set -u
cd /home/z/my-project
OUT=/home/z/my-project/download/ui-fase19b-test
mkdir -p "$OUT"
DUMMY='postgres://dummy:dummy@ep-dummy-build-123456.eu-central-1.aws.neon.tech/dummy?sslmode=require'
VENDEDOR='{"user":{"id":1,"name":"Ana Kiala","email":"ana@angostart.ao","role":"criador","username":"ana","telefone":null,"bio":null,"area_atuacao":null,"cidade":null,"especialidade":null,"portfolio_url":null,"blocked":false}}'
CLIENTE='{"user":{"id":2,"name":"Miguel Santos","email":"miguel@angostart.ao","role":"cliente","username":null,"telefone":null,"bio":null,"area_atuacao":null,"cidade":null,"especialidade":null,"portfolio_url":null,"blocked":false}}'

DATABASE_URL="$DUMMY" PORT=3000 bun .next/standalone/server.js > /tmp/angostart.log 2>&1 &
SRV=$!
for i in $(seq 1 25); do code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ || true); [ "$code" = "200" ] && break; sleep 1; done
echo "server: $code"
trap 'kill $SRV 2>/dev/null; agent-browser close 2>/dev/null' EXIT

shots_for() { # $1=user-JSON $2=etiqueta
  agent-browser open http://localhost:3000/ > /dev/null 2>&1
  agent-browser storage local set angostart.token.v1 token-teste > /dev/null 2>&1
  agent-browser network route "**/api/auth/me" --body "$1" > /dev/null 2>&1
  # route fica armado; sair da origem e voltar = load novo SEM race
  agent-browser open about:blank > /dev/null 2>&1
  agent-browser open http://localhost:3000/ > /dev/null 2>&1
  agent-browser wait --load networkidle > /dev/null 2>&1
  agent-browser wait 2500 > /dev/null 2>&1
  local h1=$(agent-browser eval "document.querySelector('h1')?.textContent?.slice(0,50)" 2>/dev/null)
  echo "h1[$2]: $h1"
  agent-browser eval "document.querySelectorAll('section')[3]?.scrollIntoView({block:'start'})" > /dev/null 2>&1
  agent-browser wait 700 > /dev/null 2>&1
  agent-browser screenshot "$OUT/cta-quem-vende-$2-375.png" > /dev/null 2>&1
  agent-browser eval "window.scrollTo(0, document.body.scrollHeight - 900)" > /dev/null 2>&1
  agent-browser wait 700 > /dev/null 2>&1
  agent-browser screenshot "$OUT/cta-final-$2-375.png" > /dev/null 2>&1
  agent-browser network unroute > /dev/null 2>&1
}

shots_for "$VENDEDOR" "vendedor"
shots_for "$CLIENTE" "cliente"
agent-browser storage local clear > /dev/null
echo "=== fim ==="
