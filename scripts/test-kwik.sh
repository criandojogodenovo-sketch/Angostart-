#!/bin/bash
# AngoStart — Teste E2E do fluxo KWiK (pedido → comprovativo → guards admin)
# Uso: DATABASE_URL='postgres://…' JWT_SECRET='…' bash scripts/test-kwik.sh
set -u
cd "$(dirname "$0")/.."

: "${DATABASE_URL:?Define DATABASE_URL (connection string Neon)}"
: "${JWT_SECRET:?Define JWT_SECRET (>= 32 caracteres)}"

echo "→ A iniciar servidor standalone na porta 3111…"
NODE_ENV=production PORT=3111 HOSTNAME=127.0.0.1 bun .next/standalone/server.js > /tmp/kwik-server.log 2>&1 &
SERVER_PID=$!

for i in $(seq 1 30); do
  if curl -s -o /dev/null http://127.0.0.1:3111/; then break; fi
  sleep 1
done
echo "✓ Servidor pronto (pid $SERVER_PID)"

PNG_B64="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
PNG_DATAURL="data:image/png;base64,${PNG_B64}"
FAKE_PDF="data:application/pdf;base64,$(echo 'isto nao e um pdf' | base64)"

# ── Produto temporário para o teste (a tabela de produtos está limpa) ──
TEST_PRODUCT_ID=$(DATABASE_URL="$DATABASE_URL" node scripts/kwik-test-helper.js create-product)
echo "✓ produto de teste criado (id=$TEST_PRODUCT_ID)"

cleanup() {
  kill $SERVER_PID 2>/dev/null
  DATABASE_URL="$DATABASE_URL" node scripts/kwik-test-helper.js cleanup "$TEST_PRODUCT_ID" || true
}
trap cleanup EXIT

echo
echo "══ 1. POST /api/orders — KWiK com comprovativo válido (convidado)"
RESP=$(curl -s -X POST http://127.0.0.1:3111/api/orders -H 'Content-Type: application/json' -d "{
  \"customer_name\":\"Teste KWiK\",\"customer_phone\":\"958111222\",
  \"payment_method\":\"kwik\",\"payment_proof\":\"${PNG_DATAURL}\",\"payment_proof_name\":\"recibo.png\",
  \"items\":[{\"id\":${TEST_PRODUCT_ID},\"quantity\":1}]}")
echo "$RESP"
ORDER_ID=$(echo "$RESP" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)
echo "→ order_id=$ORDER_ID"

echo
echo "══ 2. POST /api/orders — comprovativo FALSO (PDF inválido) → esperado 400"
curl -s -w '\nHTTP:%{http_code}\n' -X POST http://127.0.0.1:3111/api/orders -H 'Content-Type: application/json' -d "{
  \"customer_name\":\"Teste Falso\",\"customer_phone\":\"958111222\",
  \"payment_method\":\"kwik\",\"payment_proof\":\"${FAKE_PDF}\",
  \"items\":[{\"id\":${TEST_PRODUCT_ID},\"quantity\":1}]}"

echo "══ 3. GET /api/admin/orders sem auth → esperado 401"
curl -s -w '\nHTTP:%{http_code}\n' 'http://127.0.0.1:3111/api/admin/orders?status=aguardando_validacao'

echo "══ 4. GET /api/admin/orders/$ORDER_ID/proof sem auth → esperado 401"
curl -s -w '\nHTTP:%{http_code}\n' "http://127.0.0.1:3111/api/admin/orders/$ORDER_ID/proof"

echo
echo "══ 5. POST /api/orders/$ORDER_ID/proof com telefone ERRADO (convidado) → esperado 403"
curl -s -w '\nHTTP:%{http_code}\n' -X POST "http://127.0.0.1:3111/api/orders/$ORDER_ID/proof" \
  -H 'Content-Type: application/json' \
  -d "{\"payment_proof\":\"${PNG_DATAURL}\",\"phone\":\"988999888\"}"

echo
echo "══ 6. POST /api/orders/$ORDER_ID/proof com telefone CERTO → esperado 200"
curl -s -w '\nHTTP:%{http_code}\n' -X POST "http://127.0.0.1:3111/api/orders/$ORDER_ID/proof" \
  -H 'Content-Type: application/json' \
  -d "{\"payment_proof\":\"${PNG_DATAURL}\",\"payment_proof_name\":\"recibo2.png\",\"phone\":\"958111222\"}"

echo
echo "══ 7. XSS nos campos de texto → deve ser sanitizado"
RESP7=$(curl -s -X POST http://127.0.0.1:3111/api/orders -H 'Content-Type: application/json' -d "{
  \"customer_name\":\"<script>alert(1)</script>Joana\",\"customer_phone\":\"958111333\",
  \"notes\":\"<img src=x onerror=alert(2)>entregar cedo\",
  \"payment_method\":\"kwik\",
  \"items\":[{\"id\":${TEST_PRODUCT_ID},\"quantity\":1}]}")
echo "$RESP7"

echo
echo "══ 8. Verificar estados na base de dados"
DATABASE_URL="$DATABASE_URL" node scripts/kwik-test-helper.js check-orders

echo
echo "══ LIMPEZA + TESTES KWiK CONCLUÍDOS ══"
