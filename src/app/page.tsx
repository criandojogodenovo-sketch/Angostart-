import FeaturedProducts from "@/components/FeaturedProducts";
import AnnouncementBanner from "@/components/AnnouncementBanner";
import PersonalizedHero from "@/components/home/PersonalizedHero";
import ValueBar from "@/components/home/ValueBar";
import CategoryTiles from "@/components/home/CategoryTiles";
import SocialProof from "@/components/home/SocialProof";
import HowItWorks from "@/components/home/HowItWorks";
import HomeInfoSections from "@/components/home/HomeInfoSections";
import { FinalCta } from "@/components/home/HomeCtas";
import PatternWaves from "@/components/illustrations/PatternWaves";
import { FadeIn } from "@/components/motion";

/**
 * AngoStart — Home como HUB DE NAVEGAÇÃO (Fase 18).
 *
 * Ordem orientada à AÇÃO do utilizador:
 *   1. Hero (saudação personalizada + CTAs contextuais)
 *   2. Barra de Valor (4 benefícios-chave, faixa fina)
 *   3. Categorias em Destaque (4 tiles → catálogo filtrado)
 *   4. Prova Social (números reais da plataforma)
 *   5. Produtos em Destaque (comprar imediatamente)
 *   6. Como Funciona (3 passos compactos)
 *   7. Conteúdo secundário no fundo: «Quem pode vender» + «Porque escolher»
 *   8. CTA final
 *
 * Navbar e BottomNav (no layout) não são afetadas.
 */
export default function HomePage() {
  return (
    <>
      {/* Anúncios / promoções ativas (Fase 5) */}
      <AnnouncementBanner />

      {/* ── 1. Hero personalizado por sessão (visitante / vendedor / cliente) ── */}
      <PersonalizedHero />

      {/* ── 2. Barra de Valor — benefícios-chave numa faixa fina ── */}
      <ValueBar />

      {/* ── 3. Categorias em Destaque — ação imediata de navegação ── */}
      <CategoryTiles />

      {/* ── 4. Prova Social — números reais (API /api/home/stats) ── */}
      <SocialProof />

      {/* ── 5. Produtos em Destaque — comprar sem sair da Home ── */}
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="mb-8 text-center">
          <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">
            Produtos em destaque
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-slate-500 sm:text-base">
            Os favoritos dos nossos clientes esta semana, direto da base de
            dados AngoStart.
          </p>
        </div>
        <FeaturedProducts />
      </section>

      {/* ── 6. Como Funciona — 3 passos compactos ── */}
      <HowItWorks />

      {/* ── 7. Conteúdo secundário movido para o fundo ── */}
      <HomeInfoSections />

      {/* ── 8. CTA final ── */}
      <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
        <FadeIn>
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-blue-950 to-purple-950 px-6 py-12 text-center text-white sm:px-12">
            <PatternWaves />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-blue-600/20 blur-3xl"
            />
            <h2 className="relative text-2xl font-bold sm:text-3xl">
              Pronto para começar?
            </h2>
            <p className="relative mx-auto mt-3 max-w-xl text-sm text-slate-300 sm:text-base">
              Cria a tua encomenda em minutos e recebe a confirmação no WhatsApp.
              A equipa AngoStart está disponível de segunda a sábado, das 08h às
              18h.
            </p>
            {/* CTA contextual — logados não vêem registo */}
            <FinalCta />
          </div>
        </FadeIn>
      </section>
    </>
  );
}
