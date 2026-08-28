#!/usr/bin/env bash
# AngoStart — Testes de segurança (simulação de ataques reais)
# Executar:  bash scripts/security-tests.sh [base_url]
# Base URL por omissão: http://localhost:3000
#
# Cenários:
#   1. XSS armazenado  — payload de <script> no nome/descrição do produto
#   2. XSS refletido   — payload na pesquisa (?q=)
#   3. SQL Injection   — payloads no login, pesquisa e id de produto
#   4. Acesso não autorizado — APIs admin/dashboard/orders sem token
#   5. Price tampering — encomenda com preços forjados no corpo
#   6. Webhook sem assinatura — tentativa de marcar pagamento como pago
#   7. Rate limiting   — 15 logins seguidos → deve haver 429

set -u
BASE="${1:-http://localhost:3000}"
PASS=0
FAIL=0
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

check() { # $1=name $2=condition_ok(0/1) $3=details
  if [ "$2" -eq 0 ]; then
    PASS=$((PASS+1)); echo "  ✔ PASS — $1 ${3:+($3)}"
  else
    FAIL=$((FAIL+1)); echo "  ✗ FAIL — $1 ${3:+($3)}"
  fi
}

echo "════════════════════════════════════════════════════"
echo " AngoStart — Testes de Segurança ($BASE)"
echo "════════════════════════════════════════════════════"

# ── 0. Criar vendedor + cliente de teste ────────────────────────
echo "→ A preparar contas de teste…"
SELLER_EMAIL="sec-seller-$(date +%s)@teste.ao"
CLIENT_EMAIL="sec-client-$(date +%s)@teste.ao"
SELLER=$(curl -s -X POST "$BASE/api/auth/register/vendedor" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Security Tester\",\"email\":\"$SELLER_EMAIL\",\"password\":\"SenhaSegura123\",\"telefone\":\"958176915\",\"role\":\"prestador_domicilio\",\"area_atuacao\":\"Limpeza\",\"cidade\":\"Luanda\"}")
SELLER_TOKEN=$(echo "$SELLER" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ -n "$SELLER_TOKEN" ] && echo "  · vendedor criado" || echo "  · AVISO: falha ao criar vendedor"

CLIENT=$(curl -s -X POST "$BASE/api/auth/register/cliente" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Cliente Teste\",\"email\":\"$CLIENT_EMAIL\",\"password\":\"SenhaSegura123\",\"telefone\":\"923111222\"}")
CLIENT_TOKEN=$(echo "$CLIENT" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ -n "$CLIENT_TOKEN" ] && echo "  · cliente criado" || echo "  · AVISO: falha ao criar cliente"

echo "→ A publicar produto de teste…"
PROD=$(curl -s -X POST "$BASE/api/products" -H "Authorization: Bearer $SELLER_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Limpeza Profissional Sec","description":"Servico de teste para auditoria de seguranca","price":5000,"type":"servico_domicilio","service_lat":-8.839,"service_lng":13.2894}')
PROD_ID=$(echo "$PROD" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)
echo "  · produto n.º $PROD_ID"

# ── 1. XSS armazenado ────────────────────────────────────────────
echo "[1] XSS armazenado no produto"
EVIL="<script>alert('xss')</script>Limpeza Maliciosa"
RESP=$(curl -s -X POST "$BASE/api/products" -H "Authorization: Bearer $SELLER_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"name\":\"$EVIL\",\"description\":\"<img src=x onerror=alert(1)>descricao de teste com mais de dez\",\"price\":3000,\"type\":\"produto_fisico\"}")
OK=$(echo "$RESP" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)
NAME=$(echo "$RESP" | sed -n 's/.*"name":"\([^"]*\)".*/\1/p')
if [ -n "$OK" ] && [[ "$NAME" != *"<script>"* ]] && [[ "$NAME" != *"onerror"* ]]; then
  check "payload XSS removido do nome" 0 "guardado como: $NAME"
  curl -s -X DELETE "$BASE/api/products/$OK" -H "Authorization: Bearer $SELLER_TOKEN" > /dev/null
else
  check "payload XSS removido do nome" 1 "resposta: $(echo "$RESP" | head -c 160)"
fi

# ── 2. XSS refletido na pesquisa ─────────────────────────────────
echo "[2] XSS refletido na pesquisa"
Q='"><svg/onload=alert(1)>'
HTTP=$(curl -s -o "$TMP/q.json" -w '%{http_code}' "$BASE/api/products?q=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$Q")")
JSON_SAFE=$(python3 -c "
import json,sys
d=json.load(open('$TMP/q.json'))
s=json.dumps(d)
print('1' if ('<svg' in s and 'onload' in s) else '0')
" 2>/dev/null || echo 0)
check "resposta JSON não devolve HTML ativo" $([ "$HTTP" = "200" ] && [ "$JSON_SAFE" = "0" ]; echo $?) "$HTTP"

# ── 3. SQL Injection ─────────────────────────────────────────────
echo "[3] SQL Injection"
# 3a. login
HTTP=$(curl -s -o "$TMP/sqli1.json" -w '%{http_code}' -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"'"'"' OR 1=1 --","password":"x"}')
check "login ' OR 1=1 --" $([ "$HTTP" = "401" ] || [ "$HTTP" = "400" ]; echo $?) "$HTTP"
# 3b. login com UNION
HTTP=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"x@x.ao'"'"' UNION SELECT password_hash FROM users--","password":"x"}')
check "login UNION SELECT" $([ "$HTTP" = "401" ] || [ "$HTTP" = "400" ]; echo $?) "$HTTP"
# 3c. pesquisa com DROP
HTTP=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/products?q=$(python3 -c "import urllib.parse;print(urllib.parse.quote(\"'; DROP TABLE products;--\"))")")
check "pesquisa '; DROP TABLE products;--" $([ "$HTTP" = "200" ]; echo $?) "$HTTP"
COUNT=$(curl -s "$BASE/api/products" | sed -n 's/.*"source":"neon".*/OK/p' | head -1)
check "tabela products sobreviveu" $([ -n "$COUNT" ] && echo 0 || echo 1)
# 3d. id malicioso
HTTP=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/products/1%20OR%201=1")
check "id '1 OR 1=1'" $([ "$HTTP" = "400" ] || [ "$HTTP" = "404" ]; echo $?) "$HTTP"

# ── 4. Acesso não autorizado ─────────────────────────────────────
echo "[4] Acesso não autorizado (RBAC)"
for ep in "api/admin/users" "api/admin/orders?status=pendente" "api/dashboard/vendedor"; do
  HTTP=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/$ep")
  check "GET /$ep sem token → 401" $([ "$HTTP" = "401" ]; echo $?) "$HTTP"
done
HTTP=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/products" -H 'Content-Type: application/json' \
  -d '{"name":"Hack","description":"tentativa sem sessao","price":10,"type":"produto_fisico"}')
check "POST /api/products sem token → 401" $([ "$HTTP" = "401" ]; echo $?) "$HTTP"
HTTP=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/products" -H "Authorization: Bearer $CLIENT_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Hack Cliente","description":"cliente tenta publicar produto","price":10,"type":"produto_fisico"}')
check "POST /api/products com token de CLIENTE → 403" $([ "$HTTP" = "403" ]; echo $?) "$HTTP"
HTTP=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/reviews" -H "Authorization: Bearer $CLIENT_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"product_id\":$PROD_ID,\"rating\":5,\"comment\":\"sem compra\"}")
check "avaliação SEM compra confirmada → 403" $([ "$HTTP" = "403" ]; echo $?) "$HTTP"
HTTP=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/orders")
check "GET /api/orders (global) sem token → 401" $([ "$HTTP" = "401" ]; echo $?) "$HTTP"

# ── 5. Price tampering ───────────────────────────────────────────
echo "[5] Manipulação de preços na encomenda"
FAKE=$(curl -s -X POST "$BASE/api/orders" -H "Authorization: Bearer $CLIENT_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"customer_name\":\"Cliente Teste\",\"customer_phone\":\"923111222\",\"items\":[{\"id\":$PROD_ID,\"name\":\"Hack\",\"price_kz\":1,\"quantity\":1}]}")
TOTAL=$(echo "$FAKE" | sed -n 's/.*"total_kz":\([0-9]*\).*/\1/p')
check "preço forjado (1 Kz) recalculado pela BD" $([ "$TOTAL" = "5000" ]; echo $?) "total=$TOTAL"

# ── 6. Webhook sem assinatura ────────────────────────────────────
echo "[6] Webhook de pagamento sem assinatura"
HTTP=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/payments/webhook" -H 'Content-Type: application/json' \
  -d "{\"out_trade_no\":\"AS-1-FAKE\",\"trade_status\":\"TRADE_SUCCESS\"}")
check "webhook produção sem segredo → 401" $([ "$HTTP" = "401" ]; echo $?) "$HTTP"

# ── 7. Rate limiting no login ────────────────────────────────────
echo "[7] Rate limiting (12 logins inválidos)"
LAST=200
for i in $(seq 1 12); do
  LAST=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"bruteforce@teste.ao\",\"password\":\"errada$i\"}")
done
check "12.º login seguido → 429" $([ "$LAST" = "429" ]; echo $?) "último=$LAST"

# ── 8. Painéis admin (middleware/proxy) ──────────────────────────
echo "[8] Painéis admin por URL direto"
HTTP=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/admin")
check "/admin sem cookie 2FA → redirect" $([ "$HTTP" = "302" ] || [ "$HTTP" = "307" ]; echo $?) "$HTTP"
HTTP=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/admin-limitado")
check "/admin-limitado sem cookie 2FA → redirect" $([ "$HTTP" = "302" ] || [ "$HTTP" = "307" ]; echo $?) "$HTTP"

# ── 9. URL malicioso em campos de imagem/comprovativo ────────────
echo "[9] URLs maliciosos (javascript:/data:)"
HTTP=$(curl -s -o "$TMP/url.json" -w '%{http_code}' -X POST "$BASE/api/products" -H "Authorization: Bearer $SELLER_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Produto URL Malicioso","description":"imagem com javascript alert","price":1000,"type":"produto_fisico","image_url":"javascript:alert(1)"}')
check "image_url javascript: → 400" $([ "$HTTP" = "400" ]; echo $?) "$HTTP"

echo "════════════════════════════════════════════════════"
echo " RESULTADO: $PASS passaram · $FAIL falharam"
echo "════════════════════════════════════════════════════"
[ "$FAIL" -eq 0 ] || exit 1
