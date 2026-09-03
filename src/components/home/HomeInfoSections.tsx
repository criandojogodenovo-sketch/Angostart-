/**
 * AngoStart — Secções informativas da Home (Fase 20 — sem duplicação).
 *
 * «Porque escolher» + «Quem pode vender» vivem no fundo da página.
 * Fase 20: a grelha de 4 diferenciais REPETIA a ValueBar (pagamento em
 * Kwanza, entrega em Luanda, verificação, WhatsApp) — foi substituída
 * por uma faixa de confiança em gradiente (ref. barra de estatísticas
 * Nexora) com os números reais da plataforma. Zero conteúdo duplicado.
 *
 * Server component estático.
 */

import { GraduationCap, Globe, HeartHandshake, Home as HomeIcon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { FadeIn } from '@/components/motion';
import { SellerTypesCta } from '@/components/home/HomeCtas';

const SELLER_TYPES: {
  icon: LucideIcon;
  gradient: string;
  title: string;
  text: string;
}[] = [
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

export default function HomeInfoSections() {
  return (
    <div aria-label="Sobre a AngoStart">
      {/* ── Porque escolher (conteúdo secundário — fundo da página) ── */}
      <section className="bg-slate-50">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="grid items-center gap-10 lg:grid-cols-2">
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
              {/* Prova de confiança — substitui os cards duplicados da ValueBar */}
              <FadeIn delay={0.1}>
                <div className="mt-6 flex items-center gap-4 rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-600 to-purple-600 px-5 py-4 text-white shadow-lg shadow-blue-600/20">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 backdrop-blur">
                    <HeartHandshake className="h-6 w-6" />
                  </span>
                  <div>
                    <p className="text-sm font-bold sm:text-base">
                      Confiança e segurança em cada pedido
                    </p>
                    <p className="mt-0.5 text-xs text-blue-100 sm:text-sm">
                      Pagamento libertado só depois da confirmação da entrega —
                      com profissionais verificados por KYC.
                    </p>
                  </div>
                </div>
              </FadeIn>
            </div>

            {/* Painel visual: círculo premium (motivo das referências HUGS/Josh) */}
            <FadeIn delay={0.15} className="hidden lg:block">
              <div className="relative mx-auto flex h-72 w-72 items-center justify-center">
                <span
                  aria-hidden="true"
                  className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-500/15 via-purple-500/10 to-teal-400/15 blur-xl"
                />
                <span
                  aria-hidden="true"
                  className="animate-float absolute inset-6 rounded-full border-2 border-dashed border-blue-200"
                />
                <div className="relative flex h-44 w-44 flex-col items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-purple-600 text-center text-white shadow-2xl shadow-blue-600/30">
                  <span className="text-4xl font-extrabold">100%</span>
                  <span className="mt-1 px-6 text-xs font-medium leading-snug text-blue-100">
                    angolana — feita em Luanda, para Angola
                  </span>
                </div>
                <span
                  aria-hidden="true"
                  className="animate-float-delay absolute -right-2 top-8 flex h-14 w-14 items-center justify-center rounded-2xl border border-blue-100 bg-white shadow-lg"
                >
                  <GraduationCap className="h-6 w-6 text-blue-600" />
                </span>
                <span
                  aria-hidden="true"
                  className="animate-float absolute -left-3 bottom-10 flex h-14 w-14 items-center justify-center rounded-2xl border border-teal-100 bg-white shadow-lg"
                >
                  <Globe className="h-6 w-6 text-teal-600" />
                </span>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ── Quem pode vender (conteúdo secundário — fundo da página) ── */}
      <section className="bg-slate-50">
        <div className="mx-auto max-w-7xl px-4 pb-14 sm:px-6 lg:px-8">
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
                <div className="hover-lift flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:border-blue-300">
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

          {/* CTA contextual — logados vêem atalhos do seu perfil */}
          <div className="mt-8 text-center">
            <SellerTypesCta />
          </div>
        </div>
      </section>
    </div>
  );
}
