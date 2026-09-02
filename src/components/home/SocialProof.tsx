'use client';

/**
 * AngoStart — Prova Social da Home (Fase 18).
 *
 * Mostra números REAIS da plataforma (GET /api/home/stats):
 * vendedores ativos, produtos publicados, estabelecimentos e vendas
 * concluídas. Nada inventado — se a API falhar ou tudo estiver a zero,
 * a secção degrada para uma faixa de confiança qualitativa (sem números
 * falsos), mantendo a regra anti-fake do projeto.
 */

import { useEffect, useState } from 'react';
import { Building2, Handshake, Package, UserRound } from 'lucide-react';
import { FadeIn } from '@/components/motion';

interface HomeStats {
  vendedores_ativos: number;
  produtos_publicados: number;
  estabelecimentos: number;
  vendas_concluidas: number;
}

const FALLBACK_TRUST = [
  'Pagamento protegido em Kwanzas',
  'Profissionais verificados por KYC',
  'Suporte humano por WhatsApp',
];

function formatCount(n: number): string {
  return n.toLocaleString('pt-AO');
}

export default function SocialProof() {
  const [stats, setStats] = useState<HomeStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/home/stats', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('indisponível'))))
      .then((data: HomeStats) => {
        if (cancelled) return;
        const total =
          data.vendedores_ativos + data.produtos_publicados + data.vendas_concluidas;
        if (total <= 0) {
          setFailed(true); // plataforma vazia → faixa qualitativa
        } else {
          setStats(data);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (stats) {
    const items = [
      { icon: Handshake, value: formatCount(stats.vendas_concluidas), label: stats.vendas_concluidas === 1 ? 'venda concluída' : 'vendas concluídas' },
      { icon: UserRound, value: formatCount(stats.vendedores_ativos), label: stats.vendedores_ativos === 1 ? 'vendedor ativo' : 'vendedores ativos' },
      { icon: Package, value: formatCount(stats.produtos_publicados), label: stats.produtos_publicados === 1 ? 'produto publicado' : 'produtos publicados' },
      { icon: Building2, value: formatCount(stats.estabelecimentos), label: stats.estabelecimentos === 1 ? 'estabelecimento' : 'estabelecimentos' },
    ].filter((it) => Number(it.value.replace(/\D/g, '')) > 0);

    return (
      <section aria-label="Prova social" className="bg-gradient-to-r from-blue-600 via-blue-700 to-purple-700">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <FadeIn>
            <dl className="grid grid-cols-2 gap-6 text-center text-white lg:grid-cols-4">
              {items.map(({ icon: Icon, value, label }) => (
                <div key={label} className="flex flex-col items-center">
                  <Icon className="mb-1.5 h-5 w-5 text-blue-200" aria-hidden="true" />
                  <dd className="text-2xl font-black tracking-tight sm:text-3xl">{value}</dd>
                  <dt className="mt-0.5 text-xs font-medium text-blue-100 sm:text-sm">{label}</dt>
                </div>
              ))}
            </dl>
          </FadeIn>
        </div>
      </section>
    );
  }

  /* Estado vazio / falha de rede — faixa de confiança sem números inventados */
  return (
    <section aria-label="Confiança AngoStart" className="border-y border-blue-100 bg-blue-50/60">
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-center">
          {FALLBACK_TRUST.map((item) => (
            <li key={item} className="flex items-center gap-1.5 text-xs font-semibold text-blue-800 sm:text-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500" aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
