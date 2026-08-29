# 🛡️ SECURITY — AngoStart

Documentação de segurança: arquitetura, auditoria automática, testes de
intrusão simulados e triagem dos achados. Última atualização: **Fase 4 —
Administração dinâmica (convites + código diário)**.

---

## 1. Superfície protegida

| Ativo | Proteção |
|---|---|
| `JWT_SECRET`, `DATABASE_URL` | `src/lib/env.ts` (Zod + `server-only`); leitura apenas em `db.ts`/`auth.ts`/`admin-session.ts` — módulos com `import 'server-only'` que **falham o build** se importados por Client Components |
| `RESEND_API_KEY` | `src/lib/email.ts` (`server-only`), lazy init, nunca no bundle |
| Comprovativos KWiK | `src/lib/kwik.ts` client-safe (só constantes) + validação server-side: MIME whitelist, 2 MB, magic bytes, nome sanitizado; guardados na BD e servidos **apenas** em `/api/admin/orders/[id]/proof` com auth admin |
| Sessão admin | cookie `angostart_admin` HttpOnly/SameSite=Lax/Secure, HS256 (jose), 8 h, emitido **após código TOTP válido** |
| Painéis `/admin`, `/admin-limitado` | `src/proxy.ts` valida cookie+role no edge; rotas sem link, fora do sitemap, bloqueadas no `robots.txt` |
| Admin limitado dinâmico | sem senha fixa: convite por email (código 8 caracteres, 24 h) + **código diário** (6 dígitos, uso único, expira à meia-noite de Luanda) + 2FA; códigos guardados só como **HMAC-SHA256** com pepper `JWT_SECRET`, comparação timing-safe (`src/lib/admin-invites.ts`) |
| Cron de códigos diários | `/api/cron/daily-codes` exige `Authorization: Bearer $CRON_SECRET`; em produção sem a variável responde 403 (`vercel.json` agenda 00:00 em África/Luanda) |
| Auditoria de acessos | tabela `admin_audit` registra logins (OK/falha) de admins, convites criados/aceites/revogados, códigos diários gerados/validados/falhados, com IP e detalhe |
| APIs de escrita | rate limiting por IP + validação/sanitização de todos os campos + role guard (`requireAdmin` / `requireAnyAdmin` / `requireSeller`) |
| Encomendas | preços, nomes e vendedor **recalculados na BD**; cliente envia apenas `id` + `quantity` |
| Upload de comprovativo | 4 camadas no servidor (`parseAndValidateProof`): MIME whitelist (JPG/PNG/WebP/PDF) → 2 MB máx. → **magic bytes** → nome sanitizado; rate limit 6/min |

## 2. Auditoria automática

Comandos executados na Fase 3 (a partir da raiz do projeto):

```bash
npx next-secure-check scan .      # 36 achados (18 HIGH, 16 MEDIUM, 1 LOW, 1 INFO)
npx next-secret-guard scan        # sem fugas de segredos detetadas
npm audit --omit=dev              # 0 vulnerabilidades em dependências de produção
```

### Triagem dos achados `next-secure-check`

| Achado | Classificação | Ação |
|---|---|---|
| `.env` / `.env.local` "committed" | **Falso positivo** | `git ls-files` confirma que **nenhum** ficheiro `.env*` está versionado (gitignore ativo desde a Fase 1) |
| `Weak JWT secret` (env.ts:55) | **Falso positivo** | o scanner marca a linha `JWT_SECRET: process.env.JWT_SECRET`; a chave real tem 64 hex (256 bits), gerada aleatoriamente |
| `Admin route without auth` (5 rotas admin/dashboard) | **Falso positivo** | heurística procura padrão inline; a validação existe via `requireAdmin/requireAnyAdmin` — provado pelos testes de intrusão (401/403) |
| `Login without rate limit` (logout/session/me/AuthContext/auth.ts) | **Falso positivo** | rate limit existe no `login` e `2fa/verify` (10/5min e 8/5min); os outros endpoints não autenticam |
| `Password without bcrypt` (login route) | **Falso positivo** | `bcrypt.compare` é usado 6 linhas abaixo da linha sinalizada |
| `Wildcard CORS` (examples/websocket) | Fora do app | diretório de exemplos do sandbox, gitignored |
| `child_process` (skills/pdf) | Fora do app | ferramentas internas do sandbox, gitignored |
| `dangerouslySetInnerHTML` (ui/chart.tsx) | Aceite | componente shadcn/ui que injeta **variáveis CSS estáticas** (sem input do utilizador) |
| `Missing security headers` | **Corrigido** | `next.config.ts` agora define `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, CSP `frame-ancestors 'none'; base-uri 'self'; object-src 'none'; upgrade-insecure-requests` |
| `X-Powered-By` | **Corrigido** | `poweredByHeader: false` |
| `Missing input validation` (heurística Zod) | Aceite | validação manual completa (tamanho/tipo/formato) em todas as rotas; sanitização dedicada anti-XSS |

## 3. Testes de intrusão simulados

Script: `scripts/security-tests.sh` — **20/20 PASSARAM** (execução de 2026-08-28).

| # | Vetor de ataque | Esperado | Obtido |
|---|---|---|---|
| 1 | `<script>alert('xss')</script>` + `<img onerror>` no nome/descrição do produto | payload removido | ✔ guardado `Limpeza Maliciosa` (sem tags/handlers) |
| 2 | `"><svg/onload=alert(1)>` na pesquisa `?q=` | resposta sem HTML ativo | ✔ JSON limpo (200) |
| 3a | login `' OR 1=1 --` | 401/400 | ✔ 401 |
| 3b | login `' UNION SELECT password_hash FROM users--` | 401/400 | ✔ 401 |
| 3c | pesquisa `'; DROP TABLE products;--` | 200 sem efeito | ✔ 200 e tabela intacta |
| 3d | id `1 OR 1=1` no detalhe | 400/404 | ✔ 400 |
| 4a | GET `/api/admin/users` sem token | 401 | ✔ 401 |
| 4b | GET `/api/admin/orders` sem token | 401 | ✔ 401 |
| 4c | GET `/api/dashboard/vendedor` sem token | 401 | ✔ 401 |
| 4d | POST `/api/products` sem token | 401 | ✔ 401 |
| 4e | POST `/api/products` com token de **cliente** | 403 | ✔ 403 |
| 4f | POST `/api/reviews` sem compra confirmada | 403 | ✔ 403 |
| 4g | GET `/api/orders` (global) sem ser admin | 401 | ✔ 401 (era público na Fase 2 — corrigido) |
| 5 | encomenda com `price_kz: 1` forjado no corpo | preço da BD | ✔ total recalculado para 5 000 Kz |
| 6 | webhook `TRADE_SUCCESS` sem assinatura | 401 | ✔ 401 |
| 7 | 12 logins inválidos seguidos | 429 no 11.º+/12.º | ✔ 429 |
| 8 | `/admin` e `/admin-limitado` sem cookie 2FA | redirect | ✔ 307 → `?gate=1` |
| 9 | `image_url: "javascript:alert(1)"` | 400 | ✔ 400 |

### Testes de autorização (RBAC) verificados no browser
- `/admin` sem sessão → redirect ao gate; com login+2FA → painel carrega utilizadores.
- `admin_limitado` entra em `/admin-limitado` com 2FA própria, mas: `/admin` → redirect e `GET /api/admin/users` → **403**.
- Utilizador anónimo em `/dashboard/vendedor` → ecrã "Acesso restrito".

## 4. Vulnerabilidades corrigidas

**Listagem pública de encomendas (Fase 2).** `GET /api/orders` devolvia as
últimas 50 encomendas (nome, telefone, total) sem autenticação. Corrigido:
agora exige role `admin`/`admin_limitado`; clientes continuam a ter
`?mine=1` para o próprio histórico.

**Credenciais fixas de administração (Fase 4).** Os painéis dependiam de
contas de administração com senha estática, criadas por script e
referenciadas na documentação de versões anteriores — alvo privilegiado
de tentativas de credencial stuffing. Corrigido:
- admin total único com email/senha **definidos apenas por variáveis de
  ambiente** no bootstrap (hash bcrypt na BD; nenhum segredo no repositório);
- `admin_limitado` substituído por **convites por email + código diário**
  (sem qualquer palavra-passe fixa — a conta nasce com hash irrecuperável);
- todas as referências a contas antigas removidas do código, README e
  SECURITY.md; contas antigas eliminadas da BD;
- 2FA reiniciado no admin total — nova inscrição TOTP obrigatória no
  primeiro login.

## 5. Recomendações para produção

1. **Rodar o token GitHub** partilhado no chat (está embutido no remote local).
2. Pagamentos KWiK são manuais (sem gateway) — se no futuro voltar a existir um gateway externo, adicionar assinatura HMAC no webhook e guardar o segredo só no servidor.
3. Usar um domínio verificado na Resend e `EMAIL_FROM` corporativo — os emails de convite/código diário têm de chegar à caixa de entrada (não a spam) para os validadores conseguirem entrar.
4. Definir `CRON_SECRET` na Vercel e confirmar no painel Cron Jobs que `GET /api/cron/daily-codes` corre às 00:00 (África/Luanda).
5. Rate limiting em memória é por-instância — para escala, migrar para um store partilhado (Upstash Redis) mantendo a mesma interface.
6. Limpar periodicamente `admin_audit` (ex.: retenção de 12 meses) e rever tentativas `*_failed` no painel de administração.
7. Revisitar `next-secure-check` após cada release e manter o `npm audit` limpo.
