# AngoStart 🚀

**O marketplace angolano multi-perfil de infoprodutos, produtos físicos e serviços** — construído com Next.js, Tailwind CSS e Neon PostgreSQL.

A AngoStart liga **quem vende** a **quem compra** em Luanda e em toda Angola: criadores de cursos e eBooks, prestadores de serviços ao domicílio, freelancers remotos e lojas de produtos físicos — tudo com preços em **Kwanzas (Kz)**, autenticação segura com JWT e confirmação por **WhatsApp**.

---

## Perfis de Utilizador (Marketplace Multi-Perfil)

| Perfil | `role` | Campos próprios | O que pode fazer |
|---|---|---|---|
| **Cliente** | `cliente` | nome, email, telefone | Navegar, pesquisar, comprar, ver histórico de compras |
| **Criador de Infoprodutos** | `criador` | + bio | Publicar cursos, eBooks e templates; ver e gerir as suas vendas |
| **Prestador ao Domicílio** | `prestador_domicilio` | + área de atuação, cidade | Publicar serviços presenciais; receber pedidos |
| **Freelancer Remoto** | `prestador_remoto` | + especialidade, portfólio | Publicar serviços online; receber pedidos |

- **Registo de cliente:** `POST /api/auth/register/cliente` — { name, email, password, telefone }
- **Registo de vendedor:** `POST /api/auth/register/vendedor` — { name, email, password, telefone, role, …campos condicionais }
- **Login genérico:** `POST /api/auth/login` — devolve `{ token, user }` com o `role` do utilizador
- **Sessão:** `GET /api/auth/me` — restaura a sessão a partir do token JWT (expira em 7 dias)

As palavras-passe são guardadas com **bcrypt** (10 rounds) e as sessões usam **JWT HS256** assinado com `JWT_SECRET`.

## Stack Tecnológica

| Camada | Tecnologia |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript |
| Estilos | Tailwind CSS 4 + shadcn/ui |
| Base de dados | Neon PostgreSQL (serverless) |
| Driver | `@neondatabase/serverless` (HTTPS:443) |
| Autenticação | `bcryptjs` + `jsonwebtoken` (JWT, 7 dias) |
| Ícones | lucide-react |
| Estado global | React Context (auth + carrinho + pesquisa) |
| Fonte | Poppins (Google Fonts) |

## Paleta da Marca

- Azul escuro: `#0F172A` (navbar, hero, rodapé)
- Verde esmeralda: `#10B981` (botões, destaques, CTA de compra)
- Âmbar: `#F59E0B` (ações de vendedor — publicar/gestão)
- WhatsApp: `#25D366` (botão flutuante)

## Estrutura do Projeto

```
src/
├── app/
│   ├── page.tsx                    # Home: hero + categorias + "Quem pode vender?" + destaques
│   ├── produtos/page.tsx           # Catálogo com filtro por tipo + pesquisa
│   ├── perfil/page.tsx             # Login duplo (cliente/vendedor) + perfis distintos
│   ├── adicionar-produto/page.tsx  # Publicar/editar produto (só vendedores)
│   ├── carrinho/page.tsx           # Carrinho + checkout (pré-preenchido + token)
│   └── api/
│       ├── auth/
│       │   ├── register/cliente/   # POST — cria conta de cliente
│       │   ├── register/vendedor/  # POST — cria conta de vendedor (role + campos condicionais)
│       │   ├── login/              # POST — login genérico (devolve token + role)
│       │   └── me/                 # GET — dados da sessão (Bearer)
│       ├── products/
│       │   ├── route.ts            # GET catálogo (join vendedor) + ?meu=1 · POST publicar (só vendedores)
│       │   └── [id]/route.ts       # GET detalhe · PUT editar (dono) · DELETE eliminar (dono)
│       └── orders/route.ts         # POST encomenda (liga ao user) · GET ?mine=1 histórico
├── components/
│   ├── Navbar.tsx                  # + link "Adicionar Produto" (só vendedores)
│   ├── HamburgerMenu.tsx           # Menu móvel + link de publicação
│   ├── ProductCard.tsx             # Card com preço em Kz + nome do vendedor
│   ├── WhatsAppButton.tsx          # Botão flutuante wa.me/244958176915
│   └── … (SearchBar, Footer, CatalogClient, FeaturedProducts, ProductIcon)
├── context/
│   ├── AuthContext.tsx             # Sessão JWT, registo/login multi-perfil, restauração
│   └── StoreContext.tsx            # Carrinho (localStorage) + pesquisa globais
└── lib/
    ├── auth.ts                     # JWT sign/verify + getAuthUser + roles
    ├── db.ts                       # Cliente Neon serverless
    ├── products-data.ts            # Tipos + catálogo de fallback
    └── format.ts                   # Formatação em Kz
scripts/
├── createTables.js                 # Cria tabelas users/products/orders
├── migrate-multi-profile.js        # Migração multi-perfil (roles, user_id, image_url…)
└── test-auth-e2e.sh                # 16 testes E2E das APIs (registo→publicar→comprar→apagar)
```

## Base de Dados (Neon PostgreSQL)

### Esquema

- **users** — `id, name, email (único), password_hash, phone, telefone, role, bio, area_atuacao, cidade, especialidade, portfolio_url, created_at`
- **products** — `id, name, description, price_kz, type, icon, gradient, image_url, featured, rating, stock, user_id → users(id), created_at`
- **orders** — `id, customer_name, customer_phone, customer_email, items (JSONB), total_kz, status, delivery_type, notes, user_id → users(id), created_at`

### Migrações

```bash
# 1. Configura as variáveis no .env.local
DATABASE_URL=postgresql://user:password@host/neondb?sslmode=require
JWT_SECRET=<string aleatória de 64 caracteres hex>

# 2. Cria as tabelas base (projeto novo)
node scripts/createTables.js

# 3. Migração multi-perfil (roles, products.user_id, orders.user_id)
DATABASE_URL="<connection string>" node scripts/migrate-multi-profile.js
```

> O driver `@neondatabase/serverless` comunica por HTTPS:443 — funciona em qualquer ambiente (incluindo redes que bloqueiam a porta 5432) e é a recomendação oficial para deploys serverless na Vercel.

## API — Referência Rápida

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| POST | `/api/auth/register/cliente` | — | Cria conta de cliente |
| POST | `/api/auth/register/vendedor` | — | Cria conta criador / domicílio / remoto |
| POST | `/api/auth/login` | — | Login genérico → `{ token, user }` |
| GET | `/api/auth/me` | Bearer | Dados da sessão atual |
| GET | `/api/products` | — | Catálogo (`?type= &q= &featured=1 &meu=1`) |
| POST | `/api/products` | Bearer (vendedor) | Publicar produto/serviço |
| GET | `/api/products/[id]` | — | Detalhe do produto |
| PUT | `/api/products/[id]` | Bearer (dono) | Editar produto |
| DELETE | `/api/products/[id]` | Bearer (dono) | Eliminar produto |
| POST | `/api/orders` | Bearer (opcional) | Registar encomenda (liga ao cliente) |
| GET | `/api/orders?mine=1` | Bearer | Histórico de compras do cliente |

## Rodar Localmente

```bash
npm install
npm run dev
# abre http://localhost:3000
```

## Testes E2E das APIs

```bash
bash scripts/test-auth-e2e.sh
# ✅ 16 testes: registo cliente, registo vendedor (3 perfis), validações,
# login, permissões (cliente não publica; não-dono não edita/elimina),
# publicação, compra, histórico, edição e eliminação por dono.
```

## Deploy na Vercel

1. Importa este repositório em [vercel.com](https://vercel.com) (**Add New Project → Import**).
2. Em **Settings → Environment Variables**, adiciona:
   - `DATABASE_URL` = connection string do Neon (`?sslmode=require`)
   - `JWT_SECRET` = a mesma chave usada em desenvolvimento (ou uma nova, também em hex)
3. Clica em **Deploy**. Pronto — o site e as APIs ficam online.

> ⚠️ **Nunca** faças commit do `.env.local` nem do token do GitHub — ambos estão no `.gitignore`.

## Segurança

- Palavras-passe com bcrypt — nunca guardadas em texto simples
- JWT assinado (HS256) com expiração de 7 dias; `sub` valida sempre contra a BD
- Autorização no servidor: publicar exige `role` de vendedor; editar/eliminar exige dono
- O histórico de encomendas (`?mine=1`) só devolve dados do próprio utilizador
- Variáveis sensíveis (`DATABASE_URL`, `JWT_SECRET`) apenas em `.env.local` / Vercel

## Funcionalidades

- ✅ Mobile first (testado a 375px, 768px e 1280px+)
- ✅ Autenticação multi-perfil com dois fluxos de registo distintos (cliente vs vendedor)
- ✅ Selector "Quero vender como…" (Criador / Domicílio / Freelancer) com campos condicionais
- ✅ Publicação e edição de produtos/serviços com pré-visualização em tempo real
- ✅ Catálogo com nome do vendedor em cada card
- ✅ Histórico de compras no perfil do cliente
- ✅ Gestão "Os meus produtos" com editar/eliminar (apenas o dono)
- ✅ Link "Adicionar Produto" na navbar (visível só a vendedores autenticados)
- ✅ Carrinho persistente com checkout pré-preenchido pela conta
- ✅ Encomendas ligadas ao utilizador + confirmação no WhatsApp (wa.me/244958176915)
- ✅ Botão flutuante do WhatsApp em todas as páginas
- ✅ Fallback offline: se o Neon ficar inacessível, o catálogo continua a funcionar
