#!/bin/bash
# AngoStart — Teste E2E das APIs multi-perfil (registo, login, publicação, compra)
set -e
BASE="http://localhost:3000"
PASS=""
FAIL=""

check() { # name expected actual
  if [[ "$3" == *"$2"* ]]; then PASS+="✅ $1\n"; else FAIL+="❌ $1 (esperava '$2', recebi: ${3:0:180})\n"; fi
}

rand=$RANDOM
CLI_EMAIL="cliente$rand@teste.ao"
VEN_EMAIL="vendedor$rand@teste.ao"

echo "── 1. Registo de cliente ──"
R=$(curl -s -X POST $BASE/api/auth/register/cliente -H 'Content-Type: application/json' \
  -d "{\"name\":\"Ana Kiala\",\"email\":\"$CLI_EMAIL\",\"password\":\"segredo123\",\"telefone\":\"923000111\"}")
check "registo cliente" '"role":"cliente"' "$R"
CLI_TOKEN=$(echo "$R" | grep -o '"token":"[^"]*' | cut -d'"' -f4)

echo "── 2. Registo de vendedor (criador, com bio) ──"
R=$(curl -s -X POST $BASE/api/auth/register/vendedor -H 'Content-Type: application/json' \
  -d "{\"name\":\"João Macuácua\",\"email\":\"$VEN_EMAIL\",\"password\":\"segredo123\",\"telefone\":\"958000222\",\"role\":\"criador\",\"bio\":\"Formador em marketing digital e criador de eBooks para empresas angolanas.\"}")
check "registo vendedor criador" '"role":"criador"' "$R"
VEN_TOKEN=$(echo "$R" | grep -o '"token":"[^"]*' | cut -d'"' -f4)

echo "── 3. Registo vendedor sem bio (deve falhar) ──"
R=$(curl -s -X POST $BASE/api/auth/register/vendedor -H 'Content-Type: application/json' \
  -d "{\"name\":\"Teste Sem Bio\",\"email\":\"sb$rand@teste.ao\",\"password\":\"segredo123\",\"telefone\":\"958000333\",\"role\":\"criador\"}")
check "bio obrigatória validada" 'bio de pelo menos 10' "$R"

echo "── 4. Login genérico (cliente) ──"
R=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$CLI_EMAIL\",\"password\":\"segredo123\"}")
check "login devolve role" '"role":"cliente"' "$R"

echo "── 5. Login com password errada ──"
R=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$CLI_EMAIL\",\"password\":\"errada999\"}")
check "password errada rejeitada" 'incorretos' "$R"

echo "── 6. GET /api/auth/me (vendedor) ──"
R=$(curl -s $BASE/api/auth/me -H "Authorization: Bearer $VEN_TOKEN")
check "me devolve utilizador" '"email":"'$VEN_EMAIL'"' "$R"

echo "── 7. Cliente tenta publicar (deve ser 403) ──"
R=$(curl -s -X POST $BASE/api/products -H 'Content-Type: application/json' -H "Authorization: Bearer $CLI_TOKEN" \
  -d '{"name":"X","description":"desc muito curta","price":100,"type":"infoproduto"}')
check "cliente bloqueado ao publicar" 'Apenas vendedores' "$R"

echo "── 8. Vendedor publica infoproduto ──"
R=$(curl -s -X POST $BASE/api/products -H 'Content-Type: application/json' -H "Authorization: Bearer $VEN_TOKEN" \
  -d '{"name":"Curso E2E de Vendas no WhatsApp","description":"Curso completo de vendas por WhatsApp criado no teste E2E automático.","price":19900,"type":"infoproduto"}')
check "produto criado" '"price_kz":19900' "$R"
PROD_ID=$(echo "$R" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
echo "   → produto id=$PROD_ID"

echo "── 9. Catálogo público mostra vendedor ──"
R=$(curl -s "$BASE/api/products?type=infoproduto")
check "catálogo inclui seller_name" 'João Macuácua' "$R"

echo "── 10. Cliente compra (encomenda ligada ao user) ──"
R=$(curl -s -X POST $BASE/api/orders -H 'Content-Type: application/json' -H "Authorization: Bearer $CLI_TOKEN" \
  -d "{\"customer_name\":\"Ana Kiala\",\"customer_phone\":\"923000111\",\"items\":[{\"id\":$PROD_ID,\"name\":\"Curso E2E de Vendas no WhatsApp\",\"price_kz\":19900,\"quantity\":1}],\"delivery_type\":\"retirada\"}")
check "encomenda criada" '"ok":true' "$R"

echo "── 11. Histórico do cliente (mine=1) ──"
R=$(curl -s "$BASE/api/orders?mine=1" -H "Authorization: Bearer $CLI_TOKEN")
check "histórico contém encomenda" '"total_kz":19900' "$R"

echo "── 12. Vendedor vê os seus produtos (meu=1) ──"
R=$(curl -s "$BASE/api/products?meu=1" -H "Authorization: Bearer $VEN_TOKEN")
check "meus produtos listados" 'Curso E2E' "$R"

echo "── 13. Cliente tenta editar produto do vendedor (403) ──"
R=$(curl -s -X PUT "$BASE/api/products/$PROD_ID" -H 'Content-Type: application/json' -H "Authorization: Bearer $CLI_TOKEN" \
  -d '{"name":"Hackeado"}')
check "não-dono bloqueado" 'Só podes editar' "$R"

echo "── 14. Dono edita o produto ──"
R=$(curl -s -X PUT "$BASE/api/products/$PROD_ID" -H 'Content-Type: application/json' -H "Authorization: Bearer $VEN_TOKEN" \
  -d '{"price":24900}')
check "dono edita preço" '"price_kz":24900' "$R"

echo "── 15. Sem token → /meu=1 dá 401 ──"
R=$(curl -s "$BASE/api/products?meu=1")
check "meu=1 sem token rejeitado" 'Sessão inválida' "$R"

echo "── 16. Dono elimina o produto ──"
R=$(curl -s -X DELETE "$BASE/api/products/$PROD_ID" -H "Authorization: Bearer $VEN_TOKEN")
check "dono elimina" '"ok":true' "$R"

echo ""
echo "════════════════════════════════════"
echo -e "$PASS"
if [[ -n "$FAIL" ]]; then echo -e "$FAIL"; echo "❌ FALHOU"; exit 1; else echo "🎉 TODOS OS 16 TESTES PASSARAM"; fi
