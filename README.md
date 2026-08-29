# 🚀 AngoStart — Marketplace Empresarial Angolano

**Infoprodutos, produtos físicos e serviços (ao domicílio e remotos) — com segurança de nível bancário, pagamento KWiK (transferência instantânea manual), mapas escuros e duplo painel de administração com 2FA.**

> Stack: **Next.js 16** (App Router, TypeScript) · **Tailwind CSS 4** · **Neon PostgreSQL** (driver `@neondatabase/serverless`, HTTPS:443) · **JWT + bcrypt** · **Leaflet** · **Recharts** · **Resend** · **KWiK manual** · **otplib (TOTP 2FA)**

---

## 📋 Índice

1. [Funcionalidades](#-funcionalidades)
2. [Arquitetura de segurança](#-arquitetura-de-segurança)
3. [Perfis de utilizador](#-perfis-de-utilizador)
4. [Rotas ocultas de administração](#-rotas-ocultas-de-administração)
5. [Pagamento KWiK (manual)](#-pagamento-kwik-manual)
6. [Mapa de serviços ao domicílio](#-mapa-de-serviços-ao-domicílio)
7. [Notificações por email (Resend)](#-notificações-por-email-resend)
8. [Referência da API](#-referência-da-api)
9. [Base de dados (Neon)](#-base-de-dados-neon)
10. [Variáveis de ambiente](#-variáveis-de-ambiente)
11. [Testes de segurança](#-testes-de-segurança)
12. [Desenvolvimento e deploy](#-desenvolvimento-e-deploy)
13. [Registo de alterações](#-registo-de-alterações)

---

## ✨ Funcionalidades

### Marketplace multi-perfil
- **6 perfis**: cliente, criador de infoprodutos, prestador ao domicílio, freelancer remoto, admin e admin limitado.
- Publicação de produtos/serviços **apenas por vendedores**; edição/eliminação **apenas pelo dono** (admins podem eliminar qualquer produto).
- Catálogo com pesquisa, filtros por tipo, vendedores identificados e página pública de portfólio por vendedor.
- Carrinho persistente, histórico de compras e **validação server-side de preços** (o cliente não consegue forjar valores).

### Fase 3 (atual)
| Módulo | Descrição |
|---|---|
| 🛡️ Segurança | `server-only` nos módulos com segredos, validação Zod do ambiente, sanitização anti-XSS, rate limiting, guards de role, headers de segurança |
| 🗺️ Mapa | Leaflet + tiles **Esri Dark Gray** (tema escuro, sem API key), geolocalização, marcador do prestador e escolha do ponto de serviço |
| 📊 Painel de vendas | Cartões de métricas, receita por mês (BarChart), produtos mais vendidos (PieChart), encomendas recebidas — **Recharts** |
| 📧 Emails | Resend — confirmação ao cliente + aviso aos vendedores em cada encomenda; alertas de pagamento |
| 💳 Pagamentos | **KWiK (Kwanza Instantâneo)** — transferência manual para `+244 958 176 915`, upload de comprovativo (foto/PDF) validado e **aprovação no painel admin** |
| ⭐ Avaliações | 1–5 estrelas + comentário, **apenas após compra confirmada** (`pago`/`entregue`), média recalculada no produto |
| 👤 Portfólio | Página pública `/portfolio/[username]` com bio, galeria de trabalhos, produtos e CTA WhatsApp + editor em `/dashboard/vendedor/portfolio` |
| 🔐 Admin | Dois painéis ocultos com **login + 2FA TOTP obrigatório**: `/admin` (total) e `/admin-limitado` (só validação de comprovativos) |

---

## 🛡️ Arquitetura de segurança

### Proteção de código-servidor
```
src/lib/env.ts        → import 'server-only' + validação Zod das variáveis
src/lib/db.ts         → import 'server-only' (DATABASE_URL nunca no cliente)
src/lib/auth.ts       → import 'server-only' (JWT_SECRET, bcrypt, roles BD)
src/lib/security.ts   → import 'server-only' (sanitização, rate limit, guards)
src/lib/email.ts      → import 'server-only' (RESEND_API_KEY)
src/lib/admin-session.ts → import 'server-only' (assinatura do cookie 2FA)
src/lib/kwik.ts       → partilhado client-safe (constantes KWiK, SEM segredos)
```
O pacote [`server-only`](https://www.npmjs.com/package/server-only) **quebra o build** se qualquer Client Component tentar importar estes módulos — segredos nunca chegam ao bundle.

**Tipos partilhados client-safe** vivem em `src/lib/roles.ts` e `src/lib/cidades-angola.ts` (sem acesso a `process.env`).

### Defesas implementadas
| Camada | Mecanismo |
|---|---|
| XSS armazenado | `sanitizeText` / `sanitizeMultiline` em todos os inputs guardados; React escapa na renderização |
| XSS de URLs | `isSafeHttpUrl` rejeita `javascript:` / `data:` / credenciais no URL |
| SQL Injection | 100% queries parametrizadas (tagged templates do driver Neon) |
| Preços falsos | Encomendas recalculam nome/preço/vendedor **na base de dados**; o corpo do cliente só envia `id` + `quantity` |
| Força-bruta | Rate limiting por IP: login 10/5min, 2FA 8/5min, registo 10/min, upload de comprovativo 6/min, encomendas 10/min |
| Upload malicioso | Comprovativo KWiK validado em 4 camadas: MIME whitelist (JPG/PNG/WebP/PDF), 2 MB máx., **magic bytes** verificados no servidor, nome sanitizado |
| Comprovativo exposto | Guardado como base64 na BD; servido APENAS via `/api/admin/orders/[id]/proof` com **Bearer/cookie 2FA** — nunca num URL público (`no-store`, `nosniff`) |
| Contas comprometidas | Bloqueio por admin → `getAuthUser` rejeita contas `blocked` imediatamente |
| Clickjacking / sniffing | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, CSP `frame-ancestors 'none'`, `Permissions-Policy`, `Referrer-Policy` |
| Fingerprinting | `poweredByHeader: false` |
| Sessão admin | Cookie **HttpOnly + SameSite=Lax + Secure (prod)**, assinado HS256 (jose), expira em 8 h |

---

## 👥 Perfis de utilizador

| Role | Descrição | Pode |
|---|---|---|
| `cliente` | Comprador | comprar, avaliar pós-compra, ver histórico |
| `criador` | Vendedor de infoprodutos | + publicar infoprodutos, dashboard, portfólio |
| `prestador_domicilio` | Serviços ao domicílio | + publicar com **ponto de serviço no mapa** |
| `prestador_remoto` | Freelancer remoto | + publicar serviços remotos |
| `admin` | Administração total | tudo nos painéis + bloquear utilizadores + eliminar produtos + criar admins limitados |
| `admin_limitado` | Validador | **apenas** aprovar/rejeitar comprovativos |

O registo condicional recolhe: `bio` (criador), `area_atuacao`+`cidade` (domicílio), `especialidade` (remoto). Todos os utilizadores recebem um **username único** automático (slug do nome/email).

---

## 🔐 Rotas ocultas de administração

> ⚠️ **NÃO estão linkadas em menus, footer, sitemap ou robots.txt.** Acesso apenas por URL direto.

### `/admin` — Administração Total
1. **Gate**: email + palavra-passe → se for a primeira vez, o QR TOTP é gerado no próprio gate → código de 6 dígitos → cookie de sessão (8 h).
2. **Proteção dupla**: `src/proxy.ts` (ex-middleware) valida o cookie no edge **e** cada API valida Bearer/cookie + role no servidor.
3. **Funcionalidades**: validar comprovativos (aprovar/rejeitar com notificação ao cliente), listar/bloquear utilizadores, eliminar produtos, criar admins limitados, reconfigurar 2FA (QR).

### `/admin-limitado` — Administração Limitada
- Apenas a validação de comprovativos. Sem listas de utilizadores/produtos nem criação de admins.
- `admin_limitado` é bloqueado em `/admin` (redirect) e recebe **403** nas APIs de utilizadores/produtos.

### Primeiro admin (bootstrap)
```bash
env -u DATABASE_URL node --env-file=.env.local scripts/create-admin.js \
  admin@angostart.ao "PalavraPasseForte!2026" admin "Nome do Admin"
# ou admin_limitado em vez de admin
```
Depois: abrir `/admin` → entrar → o gate mostra o QR → ler na app autenticadora (Google Authenticator, Aegis, Authy…) → introduzir o código → 2FA ativada para sempre.

### 2FA — endpoints
| Rota | Descrição |
|---|---|
| `POST /api/auth/2fa/setup` | gera segredo TOTP pendente + `otpauth://` + QR (data URL) |
| `POST /api/auth/2fa/verify` | valida o código, **ativa** o 2FA e emite o cookie (8 h) |
| `GET /api/auth/2fa/session` | estado da sessão privilegiada |
| `POST /api/auth/2fa/logout` | termina a sessão do painel |

---

## 💳 Pagamento KWiK (manual)

O **KWiK (Kwanza Instantâneo)** é uma transferência instantânea manual:
sem gateway externo, sem chaves de API e sem webhooks — o cliente transfere
para o número KWiK da AngoStart e a equipa valida o comprovativo no painel.

```
Cliente (carrinho)                 Servidor                        Admin
──────────────────                 ────────                        ─────
POST /api/orders ────────────────► encomenda criada
  payment_method: 'kwik'           status: 'pendente' (sem comprovativo)
  payment_proof (opcional)                 │ com comprovativo:
  (data URL base64)                        ▼ 'aguardando_validacao'

Instruções no ecrã de confirmação:
  • Número KWiK: +244 958 176 915   (copiar)
  • Valor exato: formatKz(total)    (copiar)
  • Referência:  AngoStart-ORD-00042 (copiar — indicar na transferência)

POST /api/orders/[id]/proof ─────► valida (MIME + 2MB + magic bytes)
                                   status = 'aguardando_validacao'
                                   comprovativo guardado (base64 BD)

GET /api/admin/orders/[id]/proof ◄─ admin vê imagem/PDF (blob autenticado)
PATCH /api/admin/orders/[id] ────► Aprovar → status 'pago' + email cliente
                                   Rejeitar → status 'rejeitado' + email
                                   + admin_note + validated_at/by (auditoria)
```

### Estados de uma encomenda KWiK
| Estado | Significado |
|---|---|
| `pendente` | encomenda registada, comprovativo ainda não anexado |
| `aguardando_validacao` | comprovativo recebido, à espera de um admin |
| `pago` | comprovativo **aprovado** no painel — entrega preparada |
| `rejeitado` | comprovativo recusado — cliente contactado |
| `entregue` | pedido entregue |

### Fluxo no carrinho
1. Cliente escolhe **KWiK (Transferência Instantânea)** (recomendado) ou **Combinar pelo WhatsApp** (método manual existente).
2. Pode anexar o comprovativo já no carrinho ou depois, no ecrã de confirmação (onde a referência já é visível).
3. Encomendas de convidado validam o telefone no re-upload (últimos 9 dígitos têm de coincidir).
4. Ambos os painéis (`/admin` e `/admin-limitado`) têm a secção **Comprovativos KWiK** com filtros por estado, visualizador (imagem/PDF + download) e campo de observações internas.

---

## 🗺️ Mapa de serviços ao domicílio

- Componente `src/components/ServiceMapInner.tsx` (Leaflet) com wrapper `dynamic(ssr:false)` (`ServiceMap.tsx`).
- **Tema escuro**: tiles Esri World Dark Gray (sem API key), marcadores `divIcon` personalizados (verde = prestador, âmbar = ponto escolhido, azul = utilizador).
- **Geolocation API**: botão "Usar a minha localização" centra no cliente.
- No formulário (`/adicionar-produto`, tipo `servico_domicilio`) o vendedor **marca o ponto de atendimento** (obrigatório, validado nos limites de Angola: lat −18.5…−4.5, lng 11…25).
- Na página do produto (`/produtos/[id]`) o **cliente clica no mapa** para indicar onde precisa do serviço.

---

## 📧 Notificações por email (Resend)

| Evento | Emails |
|---|---|
| Encomenda criada | cliente (confirmação + **instruções KWiK** com número/valor/referência) + vendedores envolvidos (novo pedido) |
| Validação de comprovativo | cliente (aprovado/rejeitado) |

Sem `RESEND_API_KEY` os envios viram logs na consola (modo dev) — **a app nunca falha por causa do email**. Em produção usar um domínio verificado na variável `EMAIL_FROM`.

---

## 📚 Referência da API

### Auth (públicas)
| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/auth/register/cliente` | `{name, email, password, telefone}` |
| POST | `/api/auth/register/vendedor` | + `{role, bio?, area_atuacao?, cidade?, especialidade?, portfolio_url?}` |
| POST | `/api/auth/login` | devolve `{token, user}` (bloqueia contas bloqueadas) |
| GET | `/api/auth/me` | restaura sessão (Bearer) |

### Produtos
| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/api/products?type&q&featured&meu=1` | — | catálogo (Neon + fallback offline vazio) |
| POST | `/api/products` | vendedor | publica (servico_domicilio exige `service_lat/lng`) |
| GET | `/api/products/[id]` | — | detalhe + vendedor + coordenadas |
| PUT | `/api/products/[id]` | dono | edita |
| DELETE | `/api/products/[id]` | dono **ou admin** | elimina (remove reviews em cascata) |

### Encomendas, pagamentos e avaliações
| Método | Rota | Auth | Descrição |
|---|---|---|---|
| POST | `/api/orders` | opcional | cria encomenda (preços validados na BD; `payment_method: kwik\|whatsapp`; `payment_proof` data URL opcional) |
| GET | `/api/orders?mine=1` | cliente | histórico próprio · **sem `mine` → só admins** |
| POST | `/api/orders/[id]/proof` | dono ou convidado+telefone | anexa comprovativo KWiK → `aguardando_validacao` |
| POST | `/api/reviews` | sessão | avaliação (1–5) **só com compra `pago`/`entregue`** |
| GET | `/api/reviews?product_id` | — | lista + média |

### Dashboard e portfólio
| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/api/dashboard/vendedor` | vendedor | métricas do painel (só itens do próprio) |
| GET/PUT | `/api/portfolio` | vendedor | ver/guardar bio, foto, especialidade, cidade, link |
| GET | `/api/portfolio/[username]` | — | portfólio público (sem email) |
| POST | `/api/portfolio/items` | vendedor | adiciona trabalho (máx. 24) |
| DELETE | `/api/portfolio/items/[id]` | dono | remove trabalho |

### Administração
| Método | Rota | Role | Descrição |
|---|---|---|---|
| GET | `/api/admin/users` | admin | lista utilizadores |
| PATCH | `/api/admin/users/[id]` | admin | `{blocked: true/false}` (não pode bloquear-se) |
| GET | `/api/admin/orders?status=` | admin, admin_limitado | fila de validação (`aguardando_validacao` por omissão; sem base64 do comprovativo) |
| GET | `/api/admin/orders/[id]/proof` | admin, admin_limitado | comprovativo em binário (imagem/PDF, `no-store`) |
| PATCH | `/api/admin/orders/[id]` | admin, admin_limitado | `{status: pago\|entregue\|rejeitado\|falhou, admin_note?}` + auditoria |
| POST | `/api/admin/limited` | admin | cria conta `admin_limitado` |

---

## 🗄️ Base de dados (Neon)

```
users     id, name, email, password_hash, phone, telefone, role※, username※UNIQUE,
          bio, area_atuacao, cidade, especialidade, portfolio_url,
          portfolio_bio※, portfolio_image※, blocked※,
          two_factor_secret※, two_factor_enabled※, created_at
products  id, name, description, price_kz, type, icon, gradient, image_url,
          user_id→users, featured, rating, stock, service_lat※, service_lng※, created_at
orders    id, customer_name, customer_phone, customer_email, items(jsonb: seller_id),
          total_kz, status(pendente|aguardando_validacao|pago|entregue|rejeitado|falhou),
          delivery_type, notes, user_id→users, comprovativo_url,
          payment_method(kwik|whatsapp)※, payment_proof※(base64),
          payment_proof_name※, payment_proof_type※, admin_note※,
          validated_at※, validated_by→users※, created_at
reviews※  id, user_id→users, product_id→products, rating 1-5, comment,
          UNIQUE(user_id, product_id), created_at
portfolio_items※ id, user_id→users, title, description, image_url, position, created_at
```
※ = colunas da Fase 3/KWiK · `role CHECK (cliente, criador, prestador_domicilio, prestador_remoto, admin, admin_limitado)` · FKs com `ON DELETE CASCADE`.

Migrações:
```bash
# Fase 3 (roles/2FA/portfolio/mapa)
env -u DATABASE_URL node --env-file=.env.local scripts/migrate-phase3.js
# KWiK (pagamento manual; remove a tabela do gateway antigo)
DATABASE_URL='postgres://…' node scripts/migrate-kwik.js
```

---

## 🔑 Variáveis de ambiente

Validação **Zod** em `src/lib/env.ts` (server-only). Obrigatórias:

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | connection string Neon (`postgresql://…?sslmode=require`) |
| `JWT_SECRET` | ≥ 32 caracteres (HS256 dos JWT de utilizador e do cookie admin) |

Opcionais (funcionalidades premium degradam graciosamente sem elas):

| Variável | Ativa |
|---|---|
| `RESEND_API_KEY` | envio real de emails (sem ela: modo log) |
| `EMAIL_FROM` | remetente (`AngoStart <geral@angostart.ao>`) |
| `ADMIN_EMAIL` | (reservado para futuros alertas ao administrador) |
| `NEXT_PUBLIC_APP_URL` | URL público (links em emails) |

> 💡 **Pagamentos não exigem variáveis**: o KWiK é uma transferência manual para o número da empresa — sem gateway, sem chaves RSA, sem webhooks.

> 🔒 **Nunca** commits de `.env.local` (já no `.gitignore`). Na Vercel, definir todas em *Settings → Environment Variables*.

---

## 🧪 Testes de segurança

```bash
bash scripts/security-tests.sh            # contra localhost:3000
bash scripts/security-tests.sh https://angostart.vercel.app
```

**Última execução: 20/20 testes PASSARAM** (detalhes em [SECURITY.md](SECURITY.md)):

| # | Cenário | Resultado |
|---|---|---|
| 1 | XSS armazenado (`<script>`, `onerror=`) no produto | ✔ removido ao guardar |
| 2 | XSS refletido na pesquisa | ✔ resposta JSON sem HTML ativo |
| 3 | SQL Injection (`' OR 1=1`, `UNION SELECT`, `DROP TABLE`) | ✔ 401/200 sem efeito |
| 4 | Acesso não autorizado (admin/dashboard/orders sem token; cliente a publicar; avaliar sem compra) | ✔ 401/403 |
| 5 | Price tampering (preço 1 Kz no corpo) | ✔ recalculado para 5 000 Kz na BD |
| 6 | Comprovativo falso (PDF inválido disfarçado) | ✔ 400 (magic bytes) |
| 7 | Força-bruta no login (12 tentativas) | ✔ 429 |
| 8 | `/admin` e `/admin-limitado` sem 2FA | ✔ redirect ao gate |
| 9 | `image_url: javascript:` | ✔ 400 |
| 10 | Re-upload de comprovativo de convidado com telefone errado | ✔ 403 |

Testes E2E KWiK (`bash scripts/test-kwik.sh`, servidor standalone): pedido com comprovativo → `aguardando_validacao`; referência `AngoStart-ORD-XXXXX` gerada; guards 401/403/400; sanitização XSS; limpeza automática dos dados de teste.

Auditoria estática: `npx next-secure-check scan .` + `npx next-secret-guard scan` + `npm audit --omit=dev` — metodologia e triagem em [SECURITY.md](SECURITY.md).

---

## 🚀 Desenvolvimento e deploy

```bash
npm install
npm run dev          # http://localhost:3000
npm run lint         # ESLint (0 erros)
npx tsc --noEmit     # TypeScript (0 erros)
npm run build        # produção (38 rotas)
```

**Vercel** (repo `criandojogodenovo-sketch/Angostart-`):
1. Importar o repositório (framework Next.js detetado automaticamente).
2. Environment Variables: `DATABASE_URL`, `JWT_SECRET` (obrigatórias) + opcionais do topo.
3. Deploy — as rotas API correm no runtime Node (driver Neon usa HTTPS:443).
4. Criar o primeiro admin com `scripts/create-admin.js` (local, apontando à BD de produção) e ativar 2FA no painel.

---

## 📜 Registo de alterações

| Fase | Commit | Conteúdo |
|---|---|---|
| 1 | `76afdbf` | Site completo + Neon + carrinho + WhatsApp |
| 2 | `ee63d43` | Auth multi-perfil JWT, publicação de produtos, WhatsApp 244958176915 |
| 3 | `2cd78b0` | Security hardening, maps, payments, admin panels |
| 4 | *atual* | **Remove o gateway anterior, implementa pagamento KWiK manual** (comprovativo + validação admin) |
