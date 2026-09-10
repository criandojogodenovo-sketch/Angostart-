# GOMBUONE — Relatório de Evolução Preservadora (ex-AngoStart)

> Data: 10 de Setembro de 2026 · Método: auditoria real do código → plano de
> mudanças mínimas → implementação incremental → validação de não-regressão.
>
> **Regra seguida:** PRESERVAR → REUTILIZAR → ADAPTAR → ESTENDER → CRIAR.

---

## A) Análise da Aplicação Atual

A AngoStart é um marketplace angolano multi-perfil em produção, com 21+ fases
de desenvolvimento acumuladas (ficheiros `migrate-fase*.js`, `test-fase*.js`).
Nada foi reconstruído: a auditoria confirmou uma base sólida e madura.

**Stack real (verificada no código):**
- Next.js 16.1.3 (App Router, Turbopack) + TypeScript 5 + React 19
- Tailwind CSS 4 + shadcn/ui (Radix) + framer-motion + Recharts + Leaflet
- **Neon PostgreSQL via `@neondatabase/serverless`** (driver HTTPS:443, SQL
  cru com tagged templates `sql```) — o `prisma/schema.prisma` é um scaffold
  vestigial **não usado em runtime** (as ~40 tabelas são geridas por DDL
  idempotente nos scripts `migrate-*.js`)
- JWT HS256 (7 dias, Bearer) + bcryptjs + 2FA TOTP (otplib) + sessão admin
  em cookie HttpOnly assinado (jose, 8h)
- Brevo (email), Vercel Blob (uploads), web-push (PWA), Groq/z-ai (IA)
- Deploy: Vercel + 5 cron jobs (`vercel.json`)

**Perfis (roles):** cliente · criador · prestador_domicilio · prestador_remoto ·
admin · admin_limitado — guardas `requireAdmin/requireAnyAdmin/requireSeller`.

**Superfície funcional existente:** marketplace de infoprodutos/produtos
físicos/serviços, lojas virtuais (stores/slug), portfólios, feed social
(posts), chat interno, carteira com escrow, pagamentos KWiK manuais,
afiliados com refCode `AFG-XXXXXX` + sub-ID por canal, KYC com prazo,
disputas, propostas, gamificação, anúncios, notificações push, assistente IA,
painéis admin com 2FA + códigos diários HMAC.

**Segurança (nível bancário, documentada em SECURITY.md):** 126 testes de
auditoria, CSP completa, rate limiting, sanitização anti-XSS, recalculo de
preços na BD, proteção IDOR/BOLA/CSRF, magic bytes em uploads, segredos só
via env com `server-only`, `robots.txt` e painéis ocultos.

## B) Mapa da Arquitetura (existente — inalterada)

```
Cliente (React 19, PWA)  ──►  Next.js 16 App Router  ──►  API Routes (/api/*)
                                                        │  guards: requireRole/
                                                        │  requireAdmin/…+
                                                        │  rateLimit por IP +
                                                        │  sanitize (security.ts)
                                                        ▼
                                              sql`` tagged templates
                                                        │
                                                        ▼
                                     Neon PostgreSQL (HTTPS:443) ~40 tabelas
                                     users · products · orders · stores ·
                                     affiliates · affiliate_earnings · wallets ·
                                     … + NOVO: campaigns · opportunities ·
                                              redemption_codes
```

- `src/lib/*` = módulos server-only de domínio (affiliate, wallet, kyc, …)
- `src/components/*` = UI (shadcn/ui + componentes próprios)
- `src/proxy.ts` = proteção edge dos painéis ocultos
- Autenticação dupla: Bearer JWT (APIs) + cookie admin 2FA (painéis)

## C) Funcionalidades Preservadas (verificado — sem alterações de comportamento)

| Sistema | Estado |
|---|---|
| Autenticação JWT + 2FA + cookies admin | ✅ intocado (identificadores preservados) |
| RBAC (6 perfis) e todos os guards | ✅ reutilizados tal-como-estão |
| Marketplace completo (produtos/lojas/portfólios) | ✅ intocado |
| Carrinho → encomendas → KWiK → escrow | ✅ fluxo mantido |
| Afiliados (AFG-XXXXXX, sub_id, 30 dias) | ✅ **reutilizado como motor de attribution** |
| Carteira, gamificação, KYC, disputas, chat, feed | ✅ intocados |
| Todos os ~130 testes existentes | ✅ nenhum alterado/apagado |
| Tabelas e dados existentes | ✅ migração nova é `IF NOT EXISTS` puramente aditiva |
| URLs, rotas e APIs existentes | ✅ nenhuma rota antiga alterada |

## D) Funcionalidades Adaptadas (reuso com extensão mínima)

1. **`RefCapture`** (?ref= + ?sub=, localStorage 30d) — **reutilizado sem
   alterações** como capturador de atribuição para claims de campanhas
   (`ClaimButton` lê `getStoredRefData()` no resgate).
2. **`AffiliateCopyButton`** — reutilizado na página da campanha para o
   distribuidor partilhar `/campanhas/[id]?ref=AFG-XXXXXX`.
3. **Padrões de guarda/sanitização/rate limit** (`security.ts`) — as 8 rotas
   novas seguem exatamente os mesmos padrões (401/403/429, mensagens PT-AO).
4. **Modelo de posse** (`products.user_id` / `stores.owner_id`) — campanhas
   usam `campaigns.owner_id` → mesmas regras de dono/admin.
5. **Página de roteamento de SW/manifest/metadata** — atualizados para a nova
   identidade pública.

## E) Funcionalidades Novas (criadas por não existirem)

**Motor de oportunidades e campanhas** (fluxo conceptual implementado):

```
EMPRESA (vendedor) → CAMPANHA → OPORTUNIDADE (+ MISSÃO verificável)
   → DISTRIBUIÇÃO (partilha ?ref=AFG-…&sub=canal) → CONSUMIDOR
   → CLAIM idempotente → CÓDIGO GMB-XXXXXX (CSPRNG) → VALIDAÇÃO atómica
   → RESULTADOS/MÉTRICAS (por campanha/oportunidade/canal/distribuidor)
```

- `scripts/migrate-gombuone.js` — 3 tabelas novas + índices (idempotente)
- `src/lib/campaigns.ts` — domínio server-only (geração de código com
  `crypto.randomInt`, claim idempotente, validação atómica, métricas)
- 8 rotas de API (ver G) · 3 páginas + 1 componente (ver H)

## F) Alterações de Banco (aditivas — nenhuma destrutiva)

```sql
-- Novas tabelas (CREATE TABLE IF NOT EXISTS — pode correr 2×):
campaigns         (id, owner_id→users, title, description, status[rascunho/
                   ativa/pausada/terminada], starts_at, ends_at, created/updated)
opportunities     (id, campaign_id→campaigns, title, description, kind[oferta/
                   desconto/missao/brinde/evento], discount_percent 1–100,
                   mission_text, total_codes(-1=ilimitado),
                   max_claims_per_consumer, code_ttl_hours, status, timestamps)
redemption_codes  (id, opportunity_id, code UNIQUE, anon_id (cookie httpOnly
                   UUID), user_id?, ref_affiliate_id→affiliates, sub_id,
                   status[emitido/utilizado/expirado/invalidado], claimed_at,
                   expires_at, used_at, used_by)

-- Índices (todos IF NOT EXISTS):
idx_campaigns_owner, idx_campaigns_status_created, idx_opportunities_campaign,
idx_opportunities_status, idx_redemption_opportunity, idx_redemption_code,
idx_redemption_affiliate (parcial),
idx_redemption_active_per_anon  -- UNIQUE parcial (opportunity_id, anon_id)
                                 WHERE status='emitido' → idempotência do claim
```

**Execução:** `DATABASE_URL=postgres://… node scripts/migrate-gombuone.js`
**Nenhuma tabela/coluna/linha existente foi alterada ou removida.**

## G) Alterações de API (8 rotas novas — zero rotas antigas modificadas)

| Rota | Método(s) | Acesso | Segurança |
|---|---|---|---|
| `/api/campanhas` | GET, POST | GET público / POST vendedor | rate limit 60/min, 10/min; sanitização; validação título/datas |
| `/api/campanhas/[id]` | GET, PATCH, DELETE | GET público (ativa/pausada) / resto dono+admin | anti-IDOR por owner; DELETE arquiva se tem resultados |
| `/api/campanhas/[id]/oportunidades` | GET, POST | GET público (ativas) / POST dono | validação kind/desconto/limites |
| `/api/campanhas/[id]/estatisticas` | GET | dono/admin | métricas completas |
| `/api/campanhas/distribuicoes` | GET | autenticado (afiliado) | resultados por partilha (ref_affiliate_id) |
| `/api/oportunidades/[id]` | GET, PATCH, DELETE | GET público / resto dono | PATCH com CASE por campo |
| `/api/oportunidades/[id]/resgatar` | POST | **público** (visitante ou conta) | **anon_id cookie httpOnly UUID** (nunca IP, nunca WhatsApp); **idempotente** (índice único parcial); rate limit 5/min; atribuição opcional ref+sub |
| `/api/oportunidades/validar` | POST | vendedor (dono) ou admin | **validação atómica** `UPDATE…WHERE status='emitido' AND expires_at>now()`; 404 genérico anti-enumeração; rate limit 10/min |

**Formato dos códigos:** `GMB-XXXXXX` — CSPRNG (`crypto.randomInt`), alfabeto
sem ambíguos, verificação de colisão, UNIQUE na BD. (O prefixo `AFG-` dos
afiliados foi **preservado** — códigos existentes continuam válidos.)

## H) Alterações de UI/UX (integradas ao design existente)

| Página/Componente | Descrição |
|---|---|
| `/campanhas` | Descoberta pública (server component com form GET sem JS — igual a `/lojas`); pesquisa por título/descrição/empresa; cards `rounded-3xl` + `PatternWaves` + `FadeIn` (linguagem visual existente) |
| `/campanhas/[id]` | Detalhe com header gradiente, oportunidades (badge por tipo, missão em destaque), botão **Resgatar código**, partilha pública (`ShareButton`) e de distribuidor (`AffiliateCopyButton` reutilizado) |
| `components/campaigns/ClaimButton.tsx` | Claim → mostra código GMB- em destaque + copiar + expiração |
| `/dashboard/vendedor/campanhas` | Painel de gestão (4 tabs): Campanhas (criar/publicar/pausar/terminar/eliminar), Oportunidades (criar/gerir), **Validar código** (uso na loja), Distribuição (resultados do afiliado) |
| Navbar / HamburgerMenu | Novo item «Campanhas» (desktop + mobile) |
| Painel principal do vendedor | Botão «Campanhas» no header de ações |

## I) Riscos e Regressões Possíveis (avaliados e mitigados)

| Risco | Avaliação | Mitigação aplicada |
|---|---|---|
| Sessões admin invalididas | Eliminado | cookie `angostart_admin` **mantido** (renomear faria logout geral) |
| Atribuições de afiliado perdidas | Eliminado | localStorage `angostart.ref.v1` **mantido** (janela de 30d preservada) |
| Preferência de tema perdida | Eliminado | `angostart-theme` **mantido** |
| Códigos AFG existentes invalidados | Eliminado | prefixo e tabela `affiliates` **intocados** |
| Cache PWA obsoleto pós-rebrand | Baixo | cache `gombuone-v1`: o `activate` limpa o antigo e re-carrega 1× |
| Referências KWiK antigas vs novas | Baixo | novos pedidos usam `GOMBUONE-ORD-`; a referência é gerada e comunicada no mesmo fluxo (instruções+email coerentes); admin valida visualmente o comprovativo — sem dependência de prefixo |
| Issuer 2FA muda para novos registos | Cosmético | inscrições existentes mantêm o segredo (funcionam); novas mostram GOMBUONE no authenticator |
| Rotas estáticas vs dinâmicas (`/api/campanhas/distribuicoes` vs `/[id]`) | Eliminado | Next resolve segmento estático antes do dinâmico (comportamento nativo) |
| Concorrência em claim/validação | Eliminado | índice único parcial + `UPDATE … WHERE status='emitido'` atómico |
| Lint/typecheck regressões | Verificado | baseline idêntico (3 erros + 14 avisos pré-existentes); `tsc --noEmit` limpo; build de produção ✓ |

**Decisões conscientes de rebranding incompleto (a concluir quando existir
infraestrutura):** email `geral@angostart.ao` e fallback
`https://angostart.vercel.app` mantidos — trocar antes de o domínio/email
GOMBUONE existirem criaria contactos quebrados.

## J) Plano de Testes

**Baseline registado ANTES das alterações:** `tsc --noEmit` = 0 erros;
`eslint` = 3 erros + 14 avisos (GreetingAvatar:60, ThemeToggle:23,
PersonalizedHero:65 — pré-existentes, não relacionados). **Após:** idêntico.

**Validações executadas nesta evolução (todas ✓):**
1. `bunx tsc --noEmit` — 0 erros
2. `bunx eslint .` — exatamente o baseline (zero novos problemas)
3. `bun run build` (produção, envs dummy) — compilou com sucesso; 8 rotas
   novas geradas; todas as rotas antigas presentes
4. Dev server: 11 páginas testadas (200), `/admin` → 307 gate (segurança
   ativa), `/campanhas` renderiza com estado vazio gracioso sem BD, sem
   erros no log
5. **Nenhum teste existente foi alterado ou apagado**

**Teste E2E novo — `scripts/test-gombuone.js` (15 verificações):**
registo+login de vendedor de teste → criar campanha → publicar → criar
oportunidade → claim público (formato GMB-) → idempotência (mesmo código) →
validação do dono → re-validação bloqueada (400) → código inexistente (404) →
401 em criação anónima → 404 em claim inexistente → XSS sanitizado →
estatísticas → cleanup.

```bash
# 1. Migrar a BD (idempotente):
DATABASE_URL=postgres://… node scripts/migrate-gombuone.js
# 2. Servidor dev a correr, depois:
BASE_URL=http://localhost:3000 node scripts/test-gombuone.js
# 3. Suite de segurança existente (não-regressão — 126 testes):
npm run test   # scripts/security-audit.js (contra build de produção)
```

## K) Plano de Deployment

1. **Merge/push** para `main` (feito nesta entrega).
2. **Vercel deteta e faz build** — nenhuma variável de ambiente nova é
   obrigatória (opcional: `AFFILIATE_*` continuam a aplicar-se ao marketplace;
   o motor de campanhas não introduz envs novas).
3. **Executar a migração UMA vez** (local ou painel Neon):
   `DATABASE_URL=… node scripts/migrate-gombuone.js` — idempotente, aditiva,
   pode correr em produção com segurança. Sem ela, as páginas de campanhas
   mostram estado vazio e as APIs respondem 503/[] (degradação graciosa,
   sem crash).
4. Cron jobs existentes (5) inalterados — nenhum cron novo necessário.
5. Pós-deploy: (a) confirmar `https://…/campanhas` carrega; (b) correr
   `scripts/test-gombuone.js` contra produção apenas se aceitável criar dados
   de teste; (c) rever a decisão do domínio/email públicos.

## L) Critérios de Aceitação (mapeados aos do enunciado)

1. ✅ Aplicação continua a funcionar como antes (páginas 200, build ✓, admin
   gate 307 ativo)
2. ✅ Funcionalidades existentes não destruídas (nada removido; migração
   aditiva; testes intactos)
3. ✅ Nome público evoluiu para GOMBUONE (metadata, PWA/manifest, UI, emails,
   SW, docs)
4. ✅ Motor de campanhas integrado (não paralelo: reutiliza users, guards,
   affiliates, padrões)
5. ✅ Campanhas = estratégias (rascunho→ativa→pausada→terminada)
6. ✅ Oportunidades = ofertas/ações (5 tipos + missão verificável)
7. ✅ Distribuição rastreada (ref_affiliate_id + sub_id por canal)
8. ✅ Attribution segura (reutiliza sistema AFG; IP nunca é identidade;
   anon_id httpOnly)
9. ✅ Redemption seguro (GMB- CSPRNG único, validação server-side atómica,
   idempotente)
10. ✅ Sistema testável (test-gombuone.js + suites existentes intactas)
11. ✅ Sem regressões críticas (lint/typecheck/build idênticos ou melhores
    que o baseline)
12. ✅ Aplicação deployável (build de produção verificado)
13. ✅ Arquitetura permite evolução futura (kinds extensíveis, sub_id por
    canal, métricas por oportunidade)

## M) Resumo das Mudanças Realizadas

**Novos ficheiros (14):**
- `scripts/migrate-gombuone.js` — migração idempotente (3 tabelas + índices)
- `scripts/test-gombuone.js` — E2E do motor (15 verificações)
- `src/lib/campaigns.ts` — domínio do motor (server-only)
- `src/app/api/campanhas/route.ts`, `[id]/route.ts`,
  `[id]/oportunidades/route.ts`, `[id]/estatisticas/route.ts`,
  `distribuicoes/route.ts`
- `src/app/api/oportunidades/[id]/route.ts`, `[id]/resgatar/route.ts`,
  `validar/route.ts`
- `src/app/campanhas/page.tsx`, `src/app/campanhas/[id]/page.tsx`
- `src/app/dashboard/vendedor/campanhas/page.tsx`
- `src/components/campaigns/ClaimButton.tsx`

**Ficheiros modificados ( mínimos e cirúrgicos ):**
- Navegação: `Navbar.tsx`, `HamburgerMenu.tsx`, `dashboard/vendedor/page.tsx`
  (1 botão)
- Rebranding público: `layout.tsx` (metadata/OG), `manifest.ts` (PWA),
  `sw.js` (push+cache), `Footer.tsx`, `WhatsAppButton.tsx`,
  `SupportChatWidget.tsx`, `kwik.ts` (ref novas), `email.ts` (assuntos/corpos),
  `wallet.ts` (refs novas), `ai/providers.ts`, termos/privacidade/home e
  strings públicas restantes (~245 substituições controladas em 159 ficheiros
  — apenas a forma «AngoStart»; identificadores internos minúsculos e
  prefixo AFG- intocados)
- Documentação: `README.md` (nota de evolução + rebrand), `SECURITY.md`
- `package.json` (name→gombuone, version→1.0.0)

**Preservado por decisão explícita:** cookie `angostart_admin`, localStorage
`angostart.ref.v1` e `angostart-theme`, evento `angostart:ai-open`,
globalThis `angostartSql`/`angostartRateMap`, prefixo `AFG-`, todos os
testes/migrations/tabelas/rotas existentes, email e domínio públicos
(pending infra).

**Métricas de validação:** 8 rotas novas · 3 páginas novas · 14 ficheiros
novos · build de produção ✓ · typecheck 0 erros · lint = baseline · 11
páginas verificadas no browser de dev · 0 alterações destrutivas.
