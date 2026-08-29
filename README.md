# 🚀 AngoStart — Marketplace Empresarial Angolano

**Infoprodutos, produtos físicos e serviços (ao domicílio e remotos) — com segurança de nível bancário, pagamento KWiK (transferência manual) + carteira com escrow, comissões configuráveis, programa de afiliados, chat interno, anúncios, sistema anti-burla, configuração central de negócio e duplo painel de administração com 2FA.**

> Stack: **Next.js 16** (App Router, TypeScript) · **Tailwind CSS 4** · **Neon PostgreSQL** (driver `@neondatabase/serverless`, HTTPS:443) · **JWT + bcrypt** · **Leaflet** · **Recharts** · **Resend** · **Vercel Blob** · **KWiK manual** · **Carteira escrow** · **otplib (TOTP 2FA)**

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

### Fase 3
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

### Fase 4
| Módulo | Descrição |
|---|---|
| 🎯 Favicon | `src/app/icon.png` (128×128) gerado por script com **sharp** — logo verde esmeralda com foguete, auto-wired pelo App Router (`node scripts/generate-icon.js`) |
| 🔥 Hot badge | Campo `is_hot` em `products`; vendedor marca «em alta» no painel; badge de chama no cartão; filtro `?hot=1` na API e botão «Em alta» no catálogo |
| 🔎 Prestadores | Página `/prestadores` com pesquisa **ILIKE** (nome/especialidade/bio/cidade), filtro domicílio/remoto, ordenação por reputação; cartões ligam ao portfólio + WhatsApp |
| ⭐ Reputação | Média ponderada do vendedor no portfólio público e média por prestador na pesquisa |
| 💰 Carteira | `/carteira` — saldo disponível + **escrow** (`saldo_bloqueado`); depósito manual **Afrimoney / UNITEL Money** com referência única (`AngoStart-DEP-…`); saque com reserva; aprovação no painel admin (separador «Carteira») |
| 🛒 Checkout com saldo | Opção «Carteira AngoStart» no carrinho (só utilizadores autenticados, validação server-side de saldo) — pago = `pago` imediato com valor retido em escrow até `entregue`; recusa = reembolso automático |
| 🤝 Afiliados | Código único `AFG-XXXXXX` por utilizador; campo de código no checkout; **comissão automática** creditada na carteira quando a venda é paga; dashboard do vendedor mostra código + total ganho |
| 🧹 Catálogo real | `DELETE FROM products` — zero produtos de exemplo; sem BD o site mostra estado vazio honesto (nunca produtos fictícios) |

### Fase 5 (atual)
| Módulo | Descrição |
|---|---|
| ⚙️ Configuração central | `src/lib/config.ts` — comissões e limites da carteira carregados de variáveis de ambiente com defaults seguros; validação partilhada cliente/servidor (`validateAmount`) |
| 💸 Comissões AngoStart | **5% criadores · 10% prestadores ao domicílio · 6,5% freelancers** — descontadas automaticamente no escrow quando a venda é paga; registadas em `wallet_transactions.commission_kz` e `orders.platform_commission_kz`; dashboard mostra receita bruta, líquida e comissão retida |
| 💰 Limites da carteira | Mín/Máx por operação **+ limites DIÁRIOS** (soma das transações do dia validada no servidor) — anti-lavagem; limites exibidos no formulário |
| 📄 PDF de infoprodutos | Upload para **Vercel Blob** (`/api/products/upload`, MIME + magic bytes `%PDF-` + 20 MB); download protegido `/api/products/[id]/download` (só comprador com pedido pago, vendedor ou admin); secção «Histórico» no perfil com botão «Descarregar» |
| 📢 Anúncios | Tabela `announcements` (promo / destaque / novidade / **exclusivo** só para admin total); visibilidade por perfil (`target_role`); banner na página inicial (dispensável); secção completa no painel admin |
| 💬 Chat interno | `/chat` — conversas cliente ↔ vendedor a partir de um produto; isolamento estrito (só as 2 partes); email de notificação (Resend) + sino no site; polling 5 s |
| 🛡️ Anti-burla | Regras automáticas: **tentativa_fora** (partilha de contactos no chat), **ciclo_deposito_saque** (3+3 idênticos em 24 h), **reclamacoes_cliente** (2 avaliações ≤ 2★); 2 atividades abertas → **conta bloqueada automaticamente** + alerta ao admin; secção «Monitorização» no painel (desbloquear / banir / ignorar) |
| 🗺️ Mapa + disponibilidade | Botão «Estou disponível» do prestador (geolocalização, expira em 2 h); **tempo estimado de chegada** no produto (haversine ≈ 25 km/h + 5 min); localização do cliente capturada no checkout de serviços ao domicílio (`orders.latitude/longitude`) |
| 📊 Dashboard pro | KPIs: vendas, receita bruta, **receita líquida**, comissão retida, clientes distintos, avaliação média real, mensagens do chat (7 d); últimas avaliações; alertas de reclamações/suspeitas |
| 🔔 Notificações | Sino na Navbar com contador de não lidas (`/api/notifications`); eventos: chat, bloqueios, alertas |
| 🔑 Recuperar senha | `/recuperar-senha` → token SHA-256 de uso único (1 h) → `/redefinir-senha?token=…`; resposta anti-enumerção |
| 🪪 KYC simples | BI/NIF opcional no formulário de publicação e guardados em `users.bi_number/nif_number/kyc_status` — aumenta a confiança dos clientes |
| 📜 Termos e privacidade | Páginas `/termos` e `/privacidade` + links no footer |
| 📈 Relatórios admin | `/api/admin/report` — receita mensal, utilizadores por perfil, encomendas por estado, comissões da plataforma (tab «Relatórios») |
| 🍽️ MoMenu (estrutura) | `src/lib/momenu.ts` com `createPayment()` placeholder — **não ativado**; checkout mostra nota «Pagamento automático em breve» |

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
src/lib/wallet.ts     → import 'server-only' (escrow, saldos, movimentações, comissões)
src/lib/affiliate.ts  → import 'server-only' (códigos AFG, comissões)
src/lib/antifraud.ts  → import 'server-only' (regras anti-burla, bloqueio automático)
src/lib/notifications.ts → import 'server-only' (sino do site)
src/lib/momenu.ts     → import 'server-only' (placeholder gateway futuro)
src/lib/config.ts     → partilhado client-safe (DEFAULTS no cliente; getBusinessConfig() lê env no servidor)
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
3. **Funcionalidades**: validar comprovativos (aprovar/rejeitar com notificação ao cliente), listar/bloquear utilizadores, eliminar produtos, **gerir admins limitados (convites + códigos diários)**, reconfigurar 2FA (QR).

### `/admin-limitado` — Administração Limitada (SEM palavra-passe fixa)
- Acesso **100 % dinâmico** — não existem credenciais fixas para validadores:
  - **Primeiro acesso**: o admin total convida um email no painel `/admin` → o sistema envia um **código de convite de 8 caracteres** (validade 24 h) por email (Resend) → o convidado abre `/admin-limitado`, escolhe *“Primeiro acesso”*, introduz email + código → a conta é criada com role `admin_limitado` → ativa o 2FA (QR).
  - **Acesso diário**: todos os dias às 00:00 (África/Luanda) um **código de 6 dígitos** é gerado e enviado por email (Vercel Cron → `/api/cron/daily-codes`; também gerado a pedido no primeiro login do dia). O código muda a cada 24 h, é de **uso único** e expira no fim do dia. Entrada = email + código diário + 2FA.
- Apenas a validação de comprovativos. Sem listas de utilizadores/produtos nem criação de admins.
- `admin_limitado` é bloqueado em `/admin` (redirect) e recebe **403** nas APIs de utilizadores/produtos.

### Segurança do sistema dinâmico (convites + códigos diários)
| Regra | Implementação |
|---|---|
| Códigos nunca em texto claro | Guardados apenas como **HMAC-SHA256** (pepper = `JWT_SECRET`), comparação *timing-safe* (`node:crypto.timingSafeEqual`) |
| Geração imprevisível | `crypto.randomInt` — convite: 8 caracteres sem ambíguos (0/O/1/I/L); diário: 6 dígitos |
| Validade | Convite 24 h; código diário expira à meia-noite de Luanda **ou no 1.º uso** |
| Reenvio | Roda o código (novo valor invalida o anterior) — painel `/admin` → “Código diário” ou rota protegida |
| Rate limiting | Convite/aceite 5/min·IP; código diário 5/min·IP; geração (admin) 10/min |
| Auditoria | Tabela `admin_audit`: acessos, tentativas falhadas, convites, códigos gerados/validados (IP + detalhe) |
| 2FA obrigatório | Ambos os painéis exigem TOTP (otplib) para emitir o cookie de sessão (8 h) |
| Cron seguro | `/api/cron/daily-codes` exige `Authorization: Bearer $CRON_SECRET` (403 em produção sem a variável) |

### Endpoints da administração dinâmica
| Rota | Acesso | Descrição |
|---|---|---|
| `POST /api/admin/invites` | admin | cria/reemite convite (email Resend; código só na resposta se o email falhar) |
| `GET /api/admin/invites` | admin | lista convites + contas limitadas + histórico de códigos (sem valores) |
| `DELETE /api/admin/invites/[id]` | admin | revoga convite pendente |
| `POST /api/admin/invites/accept` | público (5/min) | valida convite, cria conta `admin_limitado`, devolve JWT → 2FA |
| `POST /api/admin/daily-code/generate` | admin ou `Bearer CRON_SECRET` | gera/roda e envia código diário (1 conta ou todas) |
| `POST /api/admin/daily-code/verify` | público (5/min) | valida código diário (uso único) → JWT → 2FA |
| `DELETE /api/admin/limited-admins/[id]` | admin | remove conta admin_limitado + códigos |
| `GET /api/cron/daily-codes` | Vercel Cron (`Bearer CRON_SECRET`) | gera os códigos do dia às 00:00 em Luanda |

### Bootstrap do admin total (credenciais só por env — nunca no repositório)
```bash
env -u DATABASE_URL \
  ADMIN_EMAIL='o-teu-email@exemplo.com' ADMIN_PASSWORD='senha-forte-aleatoria' \
  node --env-file=.env.local scripts/migrate-admin-dynamic.js
```
O script cria as tabelas do sistema dinâmico, define o admin total (bcrypt, sem texto claro no repo) e remove contas antigas.
Depois: abrir `/admin` → entrar → o gate mostra o QR → ler na app autenticadora (Google Authenticator, Aegis, Authy…) → introduzir o código → 2FA ativada.

Admins **limitados** não são criados por script — são sempre **convidados** no painel `/admin` (tab *Gerir Admins Limitados*).

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
| GET/POST | `/api/admin/announcements` | admin, admin_limitado* | lista/cria anúncios (*limitado sem `exclusivo`) |
| PATCH/DELETE | `/api/admin/announcements/[id]` | admin, admin_limitado* | edita/ativa/remove (*limitado sem `exclusivo`) |
| GET/POST | `/api/admin/monitorizacao` | admin | atividades suspeitas + ações (desbloquear/banir/ignorar/resolver) |
| GET | `/api/admin/report` | admin | relatório de desempenho (receita, utilizadores, comissões) |
| PATCH | `/api/admin/limited-admins/[id]` | admin | `{whatsapp_contact}` — contacto para envio MANUAL do código diário |

### Chat, notificações e conta (Fase 5)
| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET/POST | `/api/chat/conversations` | sessão | lista conversas · inicia por `{product_id}` |
| GET | `/api/chat/conversations/[id]` | partes | mensagens da conversa (isolamento estrito) |
| POST | `/api/chat/conversations/[id]/messages` | partes | envia mensagem + anti-burla + notificações |
| GET/POST | `/api/notifications` | sessão | sino: lista + marca lidas |
| POST | `/api/perfil/kyc` | sessão | guarda BI/NIF (opcional) |
| POST | `/api/perfil/location` | sessão | disponibilidade prestador `{latitude, longitude}` ou `{clear}` |
| POST | `/api/auth/forgot-password` | público (5/15min) | envia link de recuperação (1 h, uso único) |
| POST | `/api/auth/reset-password` | público (10/15min) | redefine senha com token |
| GET/POST | `/api/announcements` | — | anúncios ativos visíveis ao utilizador |
| GET | `/api/wallet/deposit` · `/api/wallet/withdraw` | — | limites atuais da carteira (config) |
| POST | `/api/products/upload` | vendedor | upload PDF (Vercel Blob, 20 MB) |
| GET | `/api/products/[id]/download` | comprador pago / dono / admin | download do PDF do infoproduto |

---

## 🗄️ Base de dados (Neon)

```
users     id, name, email, password_hash, phone, telefone, role※, username※UNIQUE,
          bio, area_atuacao, cidade, especialidade, portfolio_url,
          portfolio_bio※, portfolio_image※, blocked※,
          two_factor_secret※, two_factor_enabled※, created_at
products  id, name, description, price_kz, type, icon, gradient, image_url,
          user_id→users, featured, is_hot※F4, rating, stock,
          service_lat※, service_lng※, created_at
orders    id, customer_name, customer_phone, customer_email, items(jsonb: seller_id),
          total_kz, status(pendente|aguardando_validacao|pago|entregue|rejeitado|falhou),
          delivery_type, notes, user_id→users, comprovativo_url,
          payment_method(kwik|whatsapp|carteira)※, payment_proof※(base64),
          payment_proof_name※, payment_proof_type※, admin_note※,
          validated_at※, validated_by→users※, affiliate_code※F4, created_at
reviews※  id, user_id→users, product_id→products, rating 1-5, comment,
          UNIQUE(user_id, product_id), created_at
portfolio_items※ id, user_id→users, title, description, image_url, position, created_at
wallets※F4   user_id PK→users, saldo, saldo_bloqueado (escrow), updated_at
wallet_transactions※F4  id, user_id→users,
          tipo(deposito|saque|pagamento|recebimento|comissao|liberacao|reembolso),
          valor>0, status(pendente|concluido|rejeitado|bloqueado),
          referencia(AngoStart-DEP-/WD-…), order_id, descricao,
          processed_by→users, processed_at, created_at
          · UNIQUE parcial (order_id, tipo, user_id) = movimentos idempotentes
affiliates※F4  id, user_id UNIQUE→users, codigo_afiliado UNIQUE (AFG-XXXXXX),
          comissao_percentual (10%), created_at
affiliate_earnings※F4  id, affiliate_id→affiliates, order_id, comissao,
          percentual, status(pago|cancelado), UNIQUE(affiliate_id, order_id)
```
※ = colunas/tabelas da Fase 3/KWiK · ※F4 = Fase 4 · `role CHECK (cliente, criador, prestador_domicilio, prestador_remoto, admin, admin_limitado)` · FKs com `ON DELETE CASCADE`.

Migrações:
```bash
# Fase 3 (roles/2FA/portfolio/mapa)
env -u DATABASE_URL node --env-file=.env.local scripts/migrate-phase3.js
# KWiK (pagamento manual; remove a tabela do gateway antigo)
DATABASE_URL='postgres://…' node scripts/migrate-kwik.js
# Fase 4 (is_hot, carteira, afiliados; limpa products)
node --env-file=.env.local scripts/migrate-fase4.js
# Fase 5 (file_url, whatsapp_contact, lat/lng, KYC, chat, anúncios, anti-burla,
#          password_resets, notifications, commission_kz)
node --env-file=.env scripts/migrate-fase5.js
```

### 💰 Ciclo de vida da carteira (escrow + comissões)
```
Depósito:  pedido → pendente → admin aprova → saldo disponível
           (limites por operação + DIÁRIO da lib/config.ts)
Compra:    checkout «Carteira» → débito atómico (BD recusa negativos)
           → encomenda «pago» → vendedor recebe LÍQUIDO em saldo_bloqueado
             (comissão AngoStart: 5% criador · 10% domicílio · 6,5% remoto)
           → afiliado (se código) recebe AFFILIATE_COMMISSION_PERCENT no saldo
Entrega:   admin marca «entregue» → saldo_bloqueado → saldo do vendedor
Recusa:    admin marca «rejeitado/falhou» → reembolso automático ao comprador
Saque:     pedido reserva o valor → admin envia via Afrimoney/UNITEL
           → recusa devolve o valor ao saldo
Anti-burla: 3 depósitos + 3 saques idênticos em 24 h → atividade suspeita
```
Todos os movimentos ficam no diário `wallet_transactions` (auditoria completa,
idempotência por encomenda — creditar 2× é impossível).

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
| `ADMIN_EMAIL` | email do admin total (referência; credenciais reais vivem só na BD com bcrypt) |
| `CRON_SECRET` | protege o cron `/api/cron/daily-codes` (Bearer; obrigatória em produção) |
| `BLOB_READ_WRITE_TOKEN` | **Fase 5** — upload de PDFs de infoprodutos (Vercel Blob Store); sem ela o upload responde com instrução clara |
| `MOMENU_API_KEY` | placeholder para gateway de pagamentos futuro (não usada ainda) |
| `NEXT_PUBLIC_APP_URL` | URL público (links em emails) |

**Configuração central de negócio (Fase 5)** — todas opcionais com defaults:

| Variável | Default | Descrição |
|---|---|---|
| `AFFILIATE_COMMISSION_PERCENT` | `10` | comissão de novos afiliados (%) |
| `MIN_DEPOSIT_AMOUNT` / `MAX_DEPOSIT_AMOUNT` | `1000` / `200000` | limites por operação de depósito (Kz) |
| `MIN_WITHDRAW_AMOUNT` / `MAX_WITHDRAW_AMOUNT` | `5000` / `100000` | limites por operação de saque (Kz) |
| `MAX_DAILY_DEPOSIT` / `MAX_DAILY_WITHDRAW` | `500000` / `300000` | limites diários por utilizador (Kz) |
| `COMMISSION_PRODUCT` | `5` | comissão AngoStart para criadores (%) |
| `COMMISSION_SERVICE_DOMICILIO` | `10` | comissão para prestadores ao domicílio (%) |
| `COMMISSION_FREELANCER` | `6.5` | comissão para freelancers remotos (%) |

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
2. Environment Variables: `DATABASE_URL`, `JWT_SECRET` (obrigatórias) + opcionais do topo (incluindo `BLOB_READ_WRITE_TOKEN` para PDFs e as variáveis de negócio da Fase 5).
3. Deploy — as rotas API correm no runtime Node (driver Neon usa HTTPS:443).
4. Definir o admin total com `scripts/migrate-admin-dynamic.js` (credenciais apenas por variáveis de ambiente) e ativar 2FA no painel.
5. Na Vercel: definir `CRON_SECRET` (aleatória, 32+ caracteres) para o cron dos códigos diários funcionar.
6. **Fase 5**: criar um Blob Store (Storage → Blob) para os PDFs de infoprodutos e ligar `BLOB_READ_WRITE_TOKEN`; ajustar comissões/limites adicionando as variáveis de negócio sem redeploy de código.

---

## 📜 Registo de alterações

| Fase | Commit | Conteúdo |
|---|---|---|
| 1 | `76afdbf` | Site completo + Neon + carrinho + WhatsApp |
| 2 | `ee63d43` | Auth multi-perfil JWT, publicação de produtos, WhatsApp 244958176915 |
| 3 | `2cd78b0` | Security hardening, maps, payments, admin panels |
| 3.5 | `8451adc` | Remove PayPay, implementa pagamento KWiK manual |
| 3.6 | `110bb6a` | Administração dinâmica: convites por email e código diário |
| 4 | `d2146cd` | **Fase 4: Favicon, Hot, Busca, Reputação, Carteira, Afiliados** |
| 5 | *atual* | **feat: comissões, anúncios, chat, anti-burla, mapa, dashboard pro, UX, business config** |

## 🧪 Testes da Fase 5

```bash
node --env-file=.env scripts/test-fase5.js
```
Suite com 38 verificações: estrutura da BD (tabelas/colunas) → anúncios
(criação + visibilidade por perfil) → chat (conversa, mensagem, isolamento,
cascade) → anti-burla (regra dos 2 avisos: bloqueio automático + limpeza) →
regressão da Fase 4 (is_hot, catálogo real, carteiras, afiliados, escrow,
prestadores, avaliações). Limpa os dados de teste no fim.
