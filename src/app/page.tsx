import Link from "next/link";
import {
  ArrowRight,
  Globe,
  GraduationCap,
  Headset,
  Home as HomeIcon,
  Package,
  ShieldCheck,
  Truck,
  Wallet,
} from "lucide-react";
import FeaturedProducts from "@/components/FeaturedProducts";
import AnnouncementBanner from "@/components/AnnouncementBanner";
import { FadeIn } from "@/components/motion";
import PersonalizedHero from "@/components/home/PersonalizedHero";
import { SellerTypesCta, FinalCta } from "@/components/home/HomeCtas";
import PatternWaves from "@/components/illustrations/PatternWaves";
import { PRODUCT_TYPES, PRODUCT_TYPE_ORDER } from "@/lib/products-data";
import type { LucideIcon } from "lucide-react";

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  infoproduto: GraduationCap,
  produto_fisico: Package,
  servico_domicilio: HomeIcon,
  servico_remoto: Globe,
};

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  infoproduto:
    "eBooks, cursos online e templates prontos para acelerar o teu conhecimento e o teu negócio.",
  produto_fisico:
    "Telemóveis, acessórios e eletrodomésticos com garantia, entrega rápida em Luanda.",
  servico_domicilio:
    "Limpeza, electricista, canalização e ar condicionado — profissionais verificadas à tua porta.",
  servico_remoto:
    "Design, websites e gestão de redes sociais feitos à distância, com qualidade internacional.",
};

const SELLER_TYPES = [
  {
    icon: GraduationCap,
    gradient: 'from-blue-600 to-teal-600',
    title: 'Criador de Cursos',
    text: 'Transforma o teu conhecimento em rendimento: publica eBooks, cursos online e templates digitais e vende para todo o país sem sair de casa.',
  },
  {
    icon: HomeIcon,
    gradient: 'from-teal-500 to-blue-600',
    title: 'Prestador ao Domicílio',
    text: 'És electricista, técnico de limpeza ou canalizador? Publica os teus serviços, recebe pedidos na tua cidade e cresce a tua carteira de clientes.',
  },
  {
    icon: Globe,
    gradient: 'from-violet-600 to-purple-500',
    title: 'Freelancer Remoto',
    text: 'Design, websites, gestão de redes sociais… Trabalha à distância para clientes em todo o Angola e recebe pelos teus projetos com preços em Kwanzas.',
  },
];

const DIFFERENTIALS = [
  {
    icon: ShieldCheck,
    title: "Confiança e segurança",
    text: "Profissionais e vendedores verificados. Cada serviço é avaliado por clientes reais, e o teu pagamento só é libertado depois da confirmação do pedido.",
  },
  {
    icon: Wallet,
    title: "Pagamento em Kwanzas",
    text: "Paga por KWiK (transferência instantânea), transferência bancária (BAI, BFA) ou dinheiro na entrega. Sem cartões internacionais nem taxas escondidas.",
  },
  {
    icon: Truck,
    title: "Entrega em Luanda",
    text: "Entregas ao domicílio em toda a cidade de Luanda em até 48 horas, com opção de recolha direta no nosso ponto de atendimento no Ingombota.",
  },
  {
    icon: Headset,
    title: "Apoio por WhatsApp",
    text: "Fala com a equipa AngoStart diretamente no WhatsApp: tiramos dúvidas, confirmamos encomendas e acompanhamos a entrega do início ao fim.",
  },
];

export default function HomePage() {
  return (
    <>
      {/* Anúncios / promoções ativas (Fase 5) */}
      <AnnouncementBanner />

      {/* ─────────────────────── Hero ─────────────────────── */}
      {/* Fase 19: hero personalizado por sessão (visitante / vendedor / cliente) */}
      <PersonalizedHero />

      {/* ─────────────── 4 categorias ─────────────── */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="mb-10 text-center">
          <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">
            O que podes encontrar na AngoStart
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-500 sm:text-base">
            Quatro categorias pensadas para cobrir o dia-a-dia das famílias e
            crescer negócios em Angola.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PRODUCT_TYPE_ORDER.map((type) => {
            const info = PRODUCT_TYPES[type];
            const Icon = CATEGORY_ICONS[type];
            return (
              <FadeIn key={type} delay={0.05 * PRODUCT_TYPE_ORDER.indexOf(type)} className="h-full">
              <Link
                href={`/produtos?tipo=${type}`}
                className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-blue-300 hover:shadow-xl"
              >
                <span
                  className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${info.gradient} text-white shadow-md`}
                >
                  <Icon className="h-6 w-6" />
                </span>
                <h3 className="mt-4 text-lg font-semibold text-slate-900">
                  {info.label}
                </h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-500">
                  {CATEGORY_DESCRIPTIONS[type]}
                </p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-blue-600 transition-transform group-hover:translate-x-1">
                  Ver categoria
                  <ArrowRight className="h-4 w-4" />
                </span>
              </Link>
              </FadeIn>
            );
          })}
        </div>
      </section>

      {/* ─────────────── Apresentação ─────────────── */}
      <section className="bg-slate-50">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="grid items-start gap-10 lg:grid-cols-2">
            <div>
              <span className="text-sm font-semibold uppercase tracking-wider text-blue-600">
                Porque escolher a AngoStart
              </span>
              <h2 className="mt-3 text-2xl font-bold text-slate-900 sm:text-3xl">
                Uma startup angolana construída para resolver problemas reais
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-slate-600 sm:text-base">
                A AngoStart nasceu em Luanda com uma missão simples: ligar
                quem vende e quem presta serviços a quem precisa deles, num
                único sítio, com confiança e sem burocracia. Sabemos que
                encontrar produtos de qualidade ou um profissional de
                confiança em Angola pode demorar horas — por isso reunimos
                tudo aqui, com preços em Kwanzas e atendimento próximo, em
                português e por WhatsApp.
              </p>
              <p className="mt-4 text-sm leading-relaxed text-slate-600 sm:text-base">
                Trabalhamos com pequenos produtores, criadores de conteúdo e
                técnicos locais, garantindo que cada encomenda move a economia
                angolana. Do ebook que ensina a vender online ao electricista
                que resolve a tua instalação em casa, a AngoStart é o ponto de
                partida do teu próximo projeto.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {DIFFERENTIALS.map(({ icon: Icon, title, text }, i) => (
                <FadeIn key={title} delay={i * 0.06} className="h-full">
                <div
                  className="h-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-3 text-base font-semibold text-slate-900">
                    {title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
                    {text}
                  </p>
                </div>
                </FadeIn>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────── Quem pode vender ─────────────── */}
      <section className="bg-slate-50">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="mb-10 text-center">
            <span className="text-sm font-semibold uppercase tracking-wider text-blue-600">
              Marketplace multi-perfil
            </span>
            <h2 className="mt-3 text-2xl font-bold text-slate-900 sm:text-3xl">
              Quem pode vender na AngoStart?
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-500 sm:text-base">
              Cria a tua conta de vendedor e começa a publicar em minutos.
              Três formas de ganhar dinheiro com a tua habilidade:
            </p>
          </div>

          <div className="grid gap-5 md:grid-cols-3">
            {SELLER_TYPES.map(({ icon: Icon, gradient, title, text }, i) => (
              <FadeIn key={title} delay={i * 0.08} className="h-full">
              <div
                className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-blue-300 hover:shadow-xl"
              >
                <span
                  className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${gradient} text-white shadow-md`}
                >
                  <Icon className="h-6 w-6" />
                </span>
                <h3 className="mt-4 text-lg font-semibold text-slate-900">{title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-500">{text}</p>
              </div>
              </FadeIn>
            ))}
          </div>

          {/* Fase 19b: CTA contextual — logados vêem atalhos do seu perfil */}
          <div className="mt-8 text-center">
            <SellerTypesCta />
          </div>
        </div>
      </section>

      {/* ─────────────── Destaques ─────────────── */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="mb-10 text-center">
          <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">
            Produtos em destaque
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-500 sm:text-base">
            Os favoritos dos nossos clientes esta semana, direto da base de
            dados AngoStart.
          </p>
        </div>
        <FeaturedProducts />
      </section>

      {/* ─────────────── CTA final ─────────────── */}
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
          {/* Fase 19b: CTA contextual — logados não vêem registo */}
          <FinalCta />
        </div>
        </FadeIn>
      </section>
    </>
  );
}
