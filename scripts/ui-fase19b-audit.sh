#!/bin/bash
# Fase 19b — auditoria de overflow mobile (375/390/414) + CTAs contextuais.
# Deteção objetiva: document.documentElement.scrollWidth > clientWidth (+2px tolerância).
set -u
cd /home/z/my-project
OUT=/home/z/my-project/download/ui-fase19b-test
mkdir -p "$OUT"
DUMMY='postgres://dummy:dummy@ep-dummy-build-123456.eu-central-1.aws.neon.tech/dummy?sslmode=require'
VENDEDOR='{"user":{"id":1,"name":"Ana Kiala","email":"ana@angostart.ao","role":"criador","username":"ana","telefone":null,"bio":null,"area_atuacao":null,"cidade":"Luanda","especialidade":null,"portfolio_url":null,"blocked":false}}'
CLIENTE='{"user":{"id":2,"name":"Miguel Santos","email":"miguel@angostart.ao","role":"cliente","username":null,"telefone":null,"bio":null,"area_atuacao":null,"cidade":null,"especialidade":null,"portfolio_url":null,"blocked":false}}'

DATABASE_URL="$DUMMY" PORT=3000 bun .next/standalone/server.js > /tmp/angostart.log 2>&1 &
SRV=$!
for i in $(seq 1 25); do code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ || true); [ "$code" = "200" ] && break; sleep 1; done
echo "server: $code"
trap 'kill $SRV 2>/dev/null; agent-browser close 2>/dev/null' EXIT

check_overflow() { # $1=etiqueta $2=url  (usa viewport atual; mock já configurado)
  agent-browser open "$2" > /dev/null 2>&1
  agent-browser wait --load networkidle > /dev/null 2>&1
  agent-browser wait 1200 > /dev/null 2>&1
  local ow=$(agent-browser eval "document.documentElement.scrollWidth - document.documentElement.clientWidth" 2>/dev/null | grep -oE '^-?[0-9]+$' | tail -1)
  if [ "${ow:-0}" -gt 2 ]; then
    echo "❌ OVERFLOW ${ow}px — $1"
    agent-browser screenshot "$OUT/overflow-$(echo "$1" | tr ' /' '__').png" > /dev/null 2>&1
  else
    echo "✅ ok ($1)"
  fi
}

# ── visitante ──
agent-browser open http://localhost:3000/ > /dev/null 2>&1
agent-browser storage local clear > /dev/null 2>&1
agent-browser network unroute > /dev/null 2>&1
for vw in 375 390 414; do
  agent-browser set viewport $vw 812 > /dev/null
  check_overflow "home-visitante-$vw" "http://localhost:3000/"
  check_overflow "produtos-$vw" "http://localhost:3000/produtos"
  check_overflow "lojas-$vw" "http://localhost:3000/lojas"
  check_overflow "prestadores-$vw" "http://localhost:3000/prestadores"
  check_overflow "perfil-visitante-$vw" "http://localhost:3000/perfil"
  check_overflow "carrinho-$vw" "http://localhost:3000/carrinho"
  check_overflow "chat-$vw" "http://localhost:3000/chat"
done

# ── vendedor logado (mock) ──
agent-browser set viewport 375 812 > /dev/null
agent-browser network route "**/api/auth/me" --body "$VENDEDOR" > /dev/null 2>&1
agent-browser storage local set angostart.token.v1 token-teste > /dev/null 2>&1
for vw in 375 390 414; do
  agent-browser set viewport $vw 812 > /dev/null
  check_overflow "home-vendedor-$vw" "http://localhost:3000/"
  check_overflow "dashboard-vendedor-$vw" "http://localhost:3000/dashboard/vendedor"
  check_overflow "carteira-vendedor-$vw" "http://localhost:3000/carteira"
  check_overflow "perfil-vendedor-$vw" "http://localhost:3000/perfil"
done

# ── cliente logado (mock) ──
agent-browser network unroute > /dev/null 2>&1
agent-browser network route "**/api/auth/me" --body "$CLIENTE" > /dev/null 2>&1
for vw in 375 414; do
  agent-browser set viewport $vw 812 > /dev/null
  check_overflow "home-cliente-$vw" "http://localhost:3000/"
done

# ── screenshots de prova: seções de CTA + dashboard KYC ──
agent-browser set viewport 375 812 > /dev/null
agent-browser open http://localhost:3000/ > /dev/null 2>&1
agent-browser wait --load networkidle > /dev/null 2>&1
agent-browser eval "document.querySelector('section:nth-of-type(4)')?.scrollIntoView()" > /dev/null 2>&1
agent-browser wait 900 > /dev/null 2>&1
agent-browser screenshot "$OUT/home-vendedor-seccao-quem-vende-375.png" > /dev/null 2>&1
agent-browser open http://localhost:3000/dashboard/vendedor > /dev/null 2>&1
agent-browser wait --load networkidle > /dev/null 2>&1
agent-browser wait 1500 > /dev/null 2>&1
agent-browser screenshot "$OUT/dashboard-vendedor-375.png" > /dev/null 2>&1

agent-browser network unroute > /dev/null 2>&1
agent-browser storage local clear > /dev/null
echo "=== fim ==="
