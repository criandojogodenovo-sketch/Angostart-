/**
 * AngoStart — Secções informativas da Home (Fase 18, movidas para o fundo).
 *
 * «Quem pode vender» + «Porque escolher a AngoStart» são conteúdo
 * SECUNDÁRIO: vivem no final da página, antes do CTA final/rodapé,
 * sem bloquear a ação imediata do utilizador (categorias, destaques).
 * Server component estático — conteúdo migrado do page.tsx original.
 */

import { GraduationCap, Globe, Headset, Home as HomeIcon, ShieldCheck, Truck, Wallet } from 'lucide-react';
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

const DIFFERENTIALS: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: ShieldCheck,
    title: 'Confiança e segurança',
    text: 'Profissionais e vendedores verificados. Cada serviço é avaliado por clientes reais, e o teu pagamento só é libertado depois da confirmação do pedido.',
  },
  {
    icon: Wallet,
    title: 'Pagamento em Kwanzas',
    text: 'Paga por KWiK (transferência instantânea), transferência bancária (BAI, BFA) ou dinheiro na entrega. Sem cartões internacionais nem taxas escondidas.',
  },
  {
    icon: Truck,
    title: 'Entrega em Luanda',
    text: 'Entregas ao domicílio em toda a cidade de Luanda em até 48 horas, com opção de recolha direta no nosso ponto de atendimento no Ingombota.',
  },
  {
    icon: Headset,
    title: 'Apoio por WhatsApp',
    text: 'Fala com a equipa AngoStart diretamente no WhatsApp: tiramos dúvidas, confirmamos encomendas e acompanhamos a entrega do início ao fim.',
  },
];

export default function HomeInfoSections() {
  return (
    <div aria-label="Sobre a AngoStart">
      {/* ── Porque escolher (conteúdo secundário — fundo da página) ── */}
      <section className="bg-slate-50">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
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
                  <div className="h-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600">
                      <Icon className="h-5 w-5" />
                    </span>
                    <h3 className="mt-3 text-base font-semibold text-slate-900">{title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{text}</p>
                  </div>
                </FadeIn>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Quem pode vender (conteúdo secundário — fundo da página) ── */}
      <section className="bg-slate-50">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
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
                <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-blue-300 hover:shadow-lg">
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
