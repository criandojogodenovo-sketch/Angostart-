# AngoStart 🚀

**A plataforma angolana de infoprodutos, produtos físicos e serviços** — construída com Next.js, Tailwind CSS e Neon PostgreSQL.

AngoStart liga vendedores e prestadores de serviços a clientes em Luanda e em toda Angola: ebooks e cursos online, telemóveis e acessórios, limpeza e reparações ao domicílio, design e websites feitos à distância — tudo com preços em **Kwanzas (Kz)** e confirmação por **WhatsApp**.

---

## Stack Tecnológica

| Camada | Tecnologia |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript |
| Estilos | Tailwind CSS 4 + shadcn/ui |
| Base de dados | Neon PostgreSQL (serverless) |
| Driver | `@neondatabase/serverless` (HTTPS:443) + `pg` |
| Ícones | lucide-react |
| Estado global | React Context (carrinho + pesquisa) |
| Fonte | Poppins (Google Fonts) |

## Paleta da Marca

- Azul escuro: `#0F172A` (navbar, hero, rodapé)
- Verde esmeralda: `#10B981` (botões, destaques, CTA)
- WhatsApp: `#25D366` (botão flutuante)

## Estrutura do Projeto

```
src/
├── app/
│   ├── page.tsx              # Home: hero + 4 categorias + apresentação + destaques
│   ├── produtos/page.tsx     # Catálogo com filtro por tipo + pesquisa
│   ├── perfil/page.tsx       # Perfil do utilizador (localStorage)
│   ├── carrinho/page.tsx     # Carrinho + finalização de encomenda
│   └── api/
│       ├── products/route.ts # GET produtos (com filtro ?tipo= &q= &featured=1)
│       └── orders/route.ts   # POST encomenda · GET últimas encomendas
├── components/
│   ├── Navbar.tsx            # Menu hambúrguer (mobile) + links + pesquisa
│   ├── HamburgerMenu.tsx     # Menu móvel deslizante
│   ├── SearchBar.tsx         # Pesquisa global em tempo real
│   ├── ProductCard.tsx       # Card com preço em Kz e botão comprar
│   ├── WhatsAppButton.tsx    # Botão flutuante wa.me/244923456789
│   ├── Footer.tsx            # Contactos em Luanda + redes sociais
│   ├── CatalogClient.tsx     # Grid responsivo com filtros
│   ├── FeaturedProducts.tsx  # Destaques da home
│   └── ProductIcon.tsx       # Mapeamento de ícones lucide
├── context/
│   └── StoreContext.tsx      # Carrinho (localStorage) + pesquisa globais
└── lib/
    ├── db.ts                 # Cliente Neon serverless
    ├── products-data.ts      # Tipos + catálogo de fallback
    └── format.ts             # Formatação em Kz
scripts/
└── createTables.js           # Cria tabelas users/products/orders + seed
```

## Base de Dados (Neon PostgreSQL)

Tabelas: `users`, `products`, `orders` (com índices e constraints).

```bash
# 1. Configura a connection string no .env.local
DATABASE_URL=postgresql://user:password@host/neondb?sslmode=require

# 2. Cria as tabelas e insere os produtos de exemplo
node --env-file=.env.local scripts/createTables.js
```

> O driver `@neondatabase/serverless` comunica por HTTPS:443 — funciona em qualquer ambiente (incluindo redes que bloqueiam a porta 5432) e é a recomendação oficial para deploys serverless na Vercel.

## Rodar Localmente

```bash
npm install
npm run dev
# abre http://localhost:3000
```

## Deploy na Vercel

1. Importa este repositório em [vercel.com](https://vercel.com) (**Add New Project → Import**).
2. Em **Settings → Environment Variables**, adiciona:
   - `DATABASE_URL` = connection string do Neon (`?sslmode=require`)
3. Clica em **Deploy**. Pronto — o site e as APIs ficam online.

## Funcionalidades

- ✅ Mobile first (testado a 375px, 768px e 1280px+)
- ✅ Catálogo com filtro por tipo e pesquisa global em tempo real
- ✅ Carrinho persistente (localStorage) com total em Kz
- ✅ Finalização de encomenda gravada no Neon + confirmação no WhatsApp
- ✅ Perfil do utilizador com dados pré-preenchidos no checkout
- ✅ Botão flutuante do WhatsApp em todas as páginas
- ✅ Fallback offline: se o Neon ficar inacessível, o catálogo continua a funcionar
