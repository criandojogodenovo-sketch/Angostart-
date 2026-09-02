'use client';

/**
 * AngoStart — Página pública do Estabelecimento (/estabelecimentos/[id]).
 *
 * Mini-loja estilo Google Business/Booking:
 *  - cabeçalho com logo/fotos, categoria, horário e descrição;
 *  - LOCALIZAÇÃO FIXA no mapa (dados comerciais públicos);
 *  - produtos/serviços à venda do responsável (checkout normal da app);
 *  - botão «Entrar em Contato» (fluxo Airbnb — prestador aceita/recusa).
 *
 * 🔒 Privacidade: apenas dados comerciais — nunca contactos pessoais.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Building2,
  Clock,
  Handshake,
  Loader2,
  MapPin,
  Package,
  SearchX,
  Star,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth, authHeaders } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import ServiceMap from '@/components/ServiceMap';
import { formatKz } from '@/lib/format';
import { businessCategoryLabel, type BusinessProfile } from '@/lib/business';
import type { Product } from '@/lib/products-data';
import ShareButton from '@/components/ShareButton';

interface BusinessPayload {
  business: BusinessProfile;
  products: Partial<Product>[];
}

export default function EstabelecimentoDetalhePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [id, setId] = useState<number | null>(null);
  const [data, setData] = useState<BusinessPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [contactSent, setContactSent] = useState(false);
  const [contactSending, setContactSending] = useState(false);
  const [fotoAtiva, setFotoAtiva] = useState(0);

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('id');
    // id vem do path — ler do pathname para rotas dinâmicas em cliente
    const match = window.location.pathname.match(/estabelecimentos\/(\d+)/);
    const parsed = Number(match?.[1] ?? raw);
    if (Number.isInteger(parsed) && parsed > 0) setId(parsed);
    else {
      setNotFound(true);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (id === null) return;
    (async () => {
      try {
        const res = await fetch(`/api/estabelecimentos/${id}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('não encontrado');
        setData((await res.json()) as BusinessPayload);
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  async function pedirContato() {
    if (!user || !data) {
      toast({
        title: 'Entra na tua conta',
        description: 'Precisas de sessão iniciada para entrar em contato.',
      });
      return;
    }
    if (contactSending || contactSent) return;
    setContactSending(true);
    try {
      const res = await fetch('/api/contact-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ provider_id: data.business.user_id }),
      });
      const resData = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && resData.ok) {
        setContactSent(true);
        toast({
          title: 'Pedido de contato enviado ✓',
          description: `${data.business.name} recebeu a tua solicitação — acompanha em Pedidos → Contactos.`,
        });
      } else {
        toast({ title: 'Não foi possível enviar', description: resData.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Sem ligação', description: 'Tenta novamente.', variant: 'destructive' });
    } finally {
      setContactSending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-slate-400">
        <Loader2 className="mr-3 h-5 w-5 animate-spin text-blue-600" />
        <span className="text-sm">A carregar o estabelecimento…</span>
      </div>
    );
  }

  if (notFound || !data?.business) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center sm:px-6">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
          <SearchX className="h-8 w-8 text-slate-400" />
        </span>
        <h1 className="mt-5 text-2xl font-bold text-slate-900">Estabelecimento não encontrado</h1>
        <p className="mt-2 text-sm text-slate-500">
          Este espaço não existe, foi desativado ou o link está incorreto.
        </p>
        <Button asChild className="mt-8 h-12 bg-teal-600 px-8 font-semibold text-white hover:bg-teal-700">
          <Link href="/estabelecimentos">
            <ArrowLeft className="mr-2 h-5 w-5" /> Explorar estabelecimentos
          </Link>
        </Button>
      </div>
    );
  }

  const b = data.business;
  const galeria = [
    ...(b.logo_url ? [b.logo_url] : []),
    ...(Array.isArray(b.fotos) ? b.fotos : []),
  ];
  const fotoAtual = galeria.length > 0 ? galeria[Math.min(fotoAtiva, galeria.length - 1)] : null;

  return (
    <div className="mx-auto max-w-4xl px-4 pb-24 pt-6 sm:px-6">
      <Link
        href="/estabelecimentos"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4" /> Todos os estabelecimentos
      </Link>

      {/* Cabeçalho */}
      <header className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="relative h-52 bg-gradient-to-br from-blue-600/10 via-slate-100 to-teal-600/10 sm:h-64">
          {fotoAtual ? (
            <img src={fotoAtual} alt={b.name} className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center">
              <Building2 className="h-14 w-14 text-slate-300" />
            </span>
          )}
          {galeria.length > 1 && (
            <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5 px-4">
              {galeria.slice(0, 6).map((_, i) => (
                <button
                  key={i}
                  onClick={() => setFotoAtiva(i)}
                  aria-label={`Foto ${i + 1}`}
                  className={`h-2 w-2 rounded-full transition-all ${
                    Math.min(fotoAtiva, galeria.length - 1) === i ? 'w-5 bg-white' : 'bg-white/50'
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-semibold text-teal-700 ring-1 ring-teal-200">
                {businessCategoryLabel(b.category)}
              </span>
              <h1 className="mt-2 text-2xl font-extrabold text-slate-900">{b.name}</h1>
              <div className="mt-2 space-y-1 text-sm text-slate-500">
                {(b.address || b.cidade) && (
                  <p className="flex items-center gap-1.5">
                    <MapPin className="h-4 w-4 text-teal-600" /> {b.address ?? b.cidade}
                  </p>
                )}
                {b.horario && (
                  <p className="flex items-center gap-1.5">
                    <Clock className="h-4 w-4 text-blue-500" /> {b.horario}
                  </p>
                )}
                <p className="flex items-center gap-1.5">
                  <Package className="h-4 w-4 text-purple-500" />
                  {data.products.length} produto(s)/serviço(s) à venda
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Button
                onClick={pedirContato}
                disabled={contactSending || contactSent || user?.id === b.user_id}
                className="h-11 bg-gradient-to-r from-blue-600 to-purple-600 px-6 font-semibold text-white hover:from-blue-700 hover:to-purple-700"
              >
                {contactSending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Handshake className="mr-2 h-4 w-4" />
                )}
                {contactSent ? 'Pedido enviado ✓' : 'Entrar em Contato'}
              </Button>
              {/* Partilha pública — URL limpo do espaço, para qualquer utilizador */}
              <ShareButton
                productUrl={`/estabelecimentos/${b.id}`}
                label="Copiar link"
              />
            </div>
          </div>

          {b.description && (
            <p className="mt-4 whitespace-pre-line rounded-xl bg-slate-50 p-4 text-sm leading-relaxed text-slate-600">
              {b.description}
            </p>
          )}
        </div>
      </header>

      {/* Localização fixa */}
      <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-3">
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
            <MapPin className="h-5 w-5 text-teal-600" /> Localização
          </h2>
          {b.latitude != null && b.longitude != null ? (
            <p className="text-xs text-slate-500">
              Localização fixa do espaço comercial — visita-nos ou combina entrega pelo chat.
            </p>
          ) : (
            <p className="text-xs text-slate-500">O responsável ainda não marcou a localização no mapa.</p>
          )}
        </div>
        <ServiceMap
          providerLat={b.latitude ?? undefined}
          providerLng={b.longitude ?? undefined}
          cidade={b.cidade ?? undefined}
          height={280}
        />
      </section>

      {/* Catálogo */}
      <section className="mt-6">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-slate-900">
          <Package className="h-5 w-5 text-blue-600" /> Produtos e serviços
        </h2>
        {data.products.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <Package className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <p className="font-semibold text-slate-700">Nada à venda por agora</p>
            <p className="mt-1 text-sm text-slate-500">
              Os produtos e serviços deste estabelecimento aparecem aqui.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.products.map((p) => (
              <Link
                key={p.id}
                href={`/produtos/${p.id}`}
                className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg"
              >
                <div className="relative h-36 overflow-hidden bg-slate-100">
                  {p.image_url ? (
                    <img
                      src={p.image_url}
                      alt={p.name ?? 'Produto'}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center">
                      <Package className="h-9 w-9 text-slate-300" />
                    </span>
                  )}
                  {p.is_hot && (
                    <span className="absolute left-3 top-3 rounded-full bg-orange-500 px-2 py-0.5 text-[11px] font-bold text-white shadow">
                      🔥 Em alta
                    </span>
                  )}
                </div>
                <div className="p-4">
                  <h3 className="truncate text-sm font-bold text-slate-900">{p.name}</h3>
                  <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{p.description}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-sm font-extrabold text-blue-600">
                      {formatKz(Number(p.price_kz ?? 0))}
                    </span>
                    {typeof p.rating === 'number' && p.rating > 0 && (
                      <span className="flex items-center gap-1 text-xs font-semibold text-amber-600">
                        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" /> {p.rating.toFixed(1)}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
