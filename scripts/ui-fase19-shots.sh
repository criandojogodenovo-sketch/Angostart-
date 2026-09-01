#!/bin/bash
# Fase 19 — teste visual headless (server efémero + mocks /api/auth/me)
# Corre TUDO numa única chamada: server, screenshots 1280/375, teste carrinho, teardown.
set -u
cd /home/z/my-project
OUT=/home/z/my-project/download/ui-fase19-test
mkdir -p "$OUT"
DUMMY='postgres://dummy:dummy@ep-dummy-build-123456.eu-central-1.aws.neon.tech/dummy?sslmode=require'

VENDEDOR_USER='{"user":{"id":1,"name":"Ana Kiala","email":"ana@angostart.ao","role":"criador","username":"ana","telefone":"+244900000000","bio":null,"area_atuacao":null,"cidade":"Luanda","especialidade":null,"portfolio_url":null,"blocked":false}}'
CLIENTE_USER='{"user":{"id":2,"name":"Miguel Dos Santos","email":"miguel@angostart.ao","role":"cliente","username":null,"telefone":"+244911111111","bio":null,"area_atuacao":null,"cidade":"Luanda","especialidade":null,"portfolio_url":null,"blocked":false}}'
CART_EMERALD='[{"product":{"id":9999,"name":"eBook esmeralda (teste visual)","description":"Produto com gradiente esmeralda antigo guardado na BD — deve renderizar azul→teal.","price_kz":12500,"type":"infoproduto","icon":"graduation-cap","gradient":"from-emerald-500 to-emerald-700","featured":true,"rating":null},"quantity":1}]'

echo "=== 1. start server ==="
DATABASE_URL="$DUMMY" PORT=3000 bun .next/standalone/server.js > /tmp/angostart.log 2>&1 &
SRV=$!
for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ || true)
  [ "$code" = "200" ] && break
  sleep 1
done
echo "server ready: $code"

trap 'kill $SRV 2>/dev/null; agent-browser close 2>/dev/null' EXIT

echo "=== 2. visitante 1280 ==="
agent-browser set viewport 1280 800
agent-browser open http://localhost:3000/
agent-browser wait --load networkidle
agent-browser wait 1800
agent-browser screenshot "$OUT/home-visitante-1280.png"
agent-browser storage local clear > /dev/null
agent-browser network unroute > /dev/null 2>&1

echo "=== 3. vendedor 1280 (mock criador) ==="
agent-browser storage local set angostart.token.v1 token-teste
agent-browser network route "**/api/auth/me" --body "$VENDEDOR_USER"
agent-browser reload
agent-browser wait --load networkidle
agent-browser wait 2200
agent-browser screenshot "$OUT/home-vendedor-1280.png"

echo "=== 4. cliente 1280 (mock cliente) ==="
agent-browser network unroute > /dev/null 2>&1
agent-browser network route "**/api/auth/me" --body "$CLIENTE_USER"
agent-browser reload
agent-browser wait --load networkidle
agent-browser wait 2200
agent-browser screenshot "$OUT/home-cliente-1280.png"

echo "=== 5. mobile 375: vendedor / cliente / visitante ==="
agent-browser set viewport 375 812
agent-browser reload
agent-browser wait --load networkidle
agent-browser wait 2200
agent-browser screenshot "$OUT/home-vendedor-375.png"
agent-browser screenshot --full "$OUT/home-vendedor-375-full.png"

agent-browser network unroute > /dev/null 2>&1
agent-browser network route "**/api/auth/me" --body "$CLIENTE_USER"
agent-browser reload
agent-browser wait --load networkidle
agent-browser wait 2200
agent-browser screenshot "$OUT/home-cliente-375.png"

agent-browser network unroute > /dev/null 2>&1
agent-browser storage local clear > /dev/null
agent-browser reload
agent-browser wait --load networkidle
agent-browser wait 1800
agent-browser screenshot "$OUT/home-visitante-375.png"

echo "=== 6. carrinho com gradiente esmeralda (sanitizador) ==="
agent-browser set viewport 1280 800
agent-browser storage local set angostart.cart.v1 "$CART_EMERALD"
agent-browser open http://localhost:3000/carrinho
agent-browser wait --load networkidle
agent-browser wait 1800
agent-browser screenshot "$OUT/carrinho-emerald-1280.png"
agent-browser storage local clear > /dev/null

echo "=== done ==="
ls -la "$OUT"
