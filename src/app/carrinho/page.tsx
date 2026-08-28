'use client';

/**
 * AngoStart — Carrinho de compras.
 * Adicionar/remover produtos, ajustar quantidades, total em Kz e
 * finalização do pedido (registado no Neon + confirmação no WhatsApp).
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  Minus,
  PackageOpen,
  Plus,
  Send,
  ShoppingBag,
  Trash2,
} from 'lucide-react';
import ProductIcon from '@/components/ProductIcon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCart } from '@/context/StoreContext';
import { useAuth, authHeaders } from '@/context/AuthContext';
import { formatKz } from '@/lib/format';
import { useToast } from '@/hooks/use-toast';

interface PlacedOrder {
  id: number;
  total_kz: number;
  whatsappUrl: string;
}

const WHATSAPP_NUMBER = '244958176915';

export default function CarrinhoPage() {
  const { items, count, totalKz, isReady, setQuantity, removeItem, clearCart } =
    useCart();
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const { user } = useAuth();

  // Pré-preenche com os dados da conta autenticada (perfil multi-perfil)
  useEffect(() => {
    if (user) {
      setName(user.name);
      setPhone(user.telefone ?? '');
      setEmail(user.email);
    }
  }, [user]);

  const whatsappMessage = useMemo(() => {
    if (items.length === 0) return '';
    const lines = items.map(
      (i) =>
        `• ${i.quantity}x ${i.product.name} — ${formatKz(
          i.quantity * i.product.price_kz
        )}`
    );
    return encodeURIComponent(
      `Olá AngoStart! Acabei de fazer a encomenda e quero confirmar o pagamento.\n\n${lines.join(
        '\n'
      )}\n\nTotal: ${formatKz(totalKz)}`
    );
  }, [items, totalKz]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (items.length === 0) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          customer_name: name,
          customer_phone: phone,
          customer_email: email || undefined,
          delivery_type: 'entrega',
          notes: notes || undefined,
          items: items.map((i) => ({
            id: i.product.id,
            name: i.product.name,
            price_kz: i.product.price_kz,
            quantity: i.quantity,
          })),
        }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        order?: { id: number; total_kz: number };
        error?: string;
      };

      if (!res.ok || !data.ok || !data.order) {
        toast({
          title: 'Não foi possível finalizar',
          description: data.error ?? 'Tenta novamente em instantes.',
        });
        return;
      }

      setPlaced({
        id: data.order.id,
        total_kz: data.order.total_kz,
        whatsappUrl: `https://wa.me/${WHATSAPP_NUMBER}?text=${whatsappMessage}`,
      });
      clearCart();
      toast({
        title: 'Encomenda registada!',
        description: `Pedido n.º ${data.order.id} guardado na base de dados.`,
      });
    } catch {
      toast({
        title: 'Erro de ligação',
        description:
          'Sem resposta do servidor. Verifica a internet e tenta novamente.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  /* ─────────── Encomenda concluída ─────────── */
  if (placed) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 sm:px-6">
        <div className="rounded-3xl border border-emerald-200 bg-white p-8 text-center shadow-sm">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <CheckCircle2 className="h-9 w-9 text-emerald-600" />
          </span>
          <h1 className="mt-5 text-2xl font-bold text-slate-900">
            Encomenda confirmada!
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Pedido <strong>n.º {placed.id}</strong> registado na base de dados
            com um total de{' '}
            <strong className="text-emerald-600">{formatKz(placed.total_kz)}</strong>.
            A nossa equipa entra em contacto para combinar a entrega e o
            pagamento.
          </p>
          <div className="mt-8 space-y-3">
            <Button
              asChild
              className="h-12 w-full bg-[#25D366] text-base font-semibold text-white hover:bg-[#1fb857]"
            >
              <a href={placed.whatsappUrl} target="_blank" rel="noopener noreferrer">
                <Send className="mr-2 h-5 w-5" /> Confirmar no WhatsApp
              </a>
            </Button>
            <Button
              asChild
              variant="outline"
              className="h-11 w-full border-emerald-500 text-emerald-600 hover:bg-emerald-50"
            >
              <Link href="/produtos">
                Continuar a comprar <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  /* ─────────── Carrinho vazio ─────────── */
  if (!isReady) {
    return (
      <div className="flex items-center justify-center py-32 text-slate-400">
        <Loader2 className="mr-3 h-5 w-5 animate-spin text-emerald-500" />
        <span className="text-sm">A abrir o carrinho…</span>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center sm:px-6">
        <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-slate-100">
          <PackageOpen className="h-10 w-10 text-slate-400" />
        </span>
        <h1 className="mt-6 text-2xl font-bold text-slate-900">
          O teu carrinho está vazio
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Explora o catálogo e adiciona produtos ou serviços — tudo em
          Kwanzas e com entrega em Luanda.
        </p>
        <Button
          asChild
          className="mt-8 h-12 bg-emerald-500 px-8 text-base font-semibold text-white hover:bg-emerald-600"
        >
          <Link href="/produtos">
            <ShoppingBag className="mr-2 h-5 w-5" /> Ver produtos
          </Link>
        </Button>
      </div>
    );
  }

  /* ─────────── Carrinho com artigos ─────────── */
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">
        Carrinho de compras
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        {count} {count === 1 ? 'artigo' : 'artigos'} — revê as quantidades e
        finaliza a tua encomenda.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-5">
        {/* Lista de artigos */}
        <section
          aria-label="Artigos no carrinho"
          className="space-y-4 lg:col-span-3"
        >
          {items.map(({ product, quantity }) => (
            <article
              key={product.id}
              className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div
                className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${product.gradient} text-white`}
              >
                <ProductIcon name={product.icon} className="h-8 w-8" />
              </div>

              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-slate-900">
                      {product.name}
                    </h3>
                    <p className="mt-0.5 text-sm text-slate-500">
                      {formatKz(product.price_kz)} cada
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      removeItem(product.id);
                      toast({ title: 'Removido', description: product.name });
                    }}
                    aria-label={`Remover ${product.name} do carrinho`}
                    className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-auto flex items-center justify-between pt-3">
                  {/* Stepper de quantidade */}
                  <div className="inline-flex items-center rounded-full border border-slate-200">
                    <button
                      onClick={() => setQuantity(product.id, quantity - 1)}
                      aria-label={`Diminuir quantidade de ${product.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span
                      className="w-9 text-center text-sm font-semibold text-slate-900"
                      aria-live="polite"
                    >
                      {quantity}
                    </span>
                    <button
                      onClick={() => setQuantity(product.id, quantity + 1)}
                      aria-label={`Aumentar quantidade de ${product.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>

                  <p className="text-base font-bold text-emerald-600">
                    {formatKz(product.price_kz * quantity)}
                  </p>
                </div>
              </div>
            </article>
          ))}

          <button
            onClick={clearCart}
            className="text-sm font-medium text-slate-400 underline-offset-4 hover:text-rose-500 hover:underline"
          >
            Esvaziar carrinho
          </button>
        </section>

        {/* Resumo + finalização */}
        <section aria-label="Finalizar encomenda" className="lg:col-span-2">
          <div className="sticky top-24 space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">
              Resumo da encomenda
            </h2>

            <dl className="space-y-2 text-sm">
              <div className="flex justify-between text-slate-500">
                <dt>Subtotal ({count} artigos)</dt>
                <dd>{formatKz(totalKz)}</dd>
              </div>
              <div className="flex justify-between text-slate-500">
                <dt>Entrega em Luanda</dt>
                <dd>A combinar no WhatsApp</dd>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-3 text-base font-bold text-slate-900">
                <dt>Total</dt>
                <dd className="text-emerald-600">{formatKz(totalKz)}</dd>
              </div>
            </dl>

            <form onSubmit={handleSubmit} className="space-y-4 pt-2" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="cart-nome">Nome completo</Label>
                <Input
                  id="cart-nome"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="O teu nome"
                  className="h-11"
                  required
                  minLength={3}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cart-telefone">Telefone / WhatsApp</Label>
                <Input
                  id="cart-telefone"
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="9xx xxx xxx"
                  className="h-11"
                  required
                  minLength={9}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cart-notas">Notas (opcional)</Label>
                <Input
                  id="cart-notas"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ex.: entregar depois das 17h, no Mutamba"
                  className="h-11"
                />
              </div>

              <Button
                type="submit"
                disabled={submitting}
                className="h-12 w-full bg-emerald-500 text-base font-semibold text-white hover:bg-emerald-600 disabled:opacity-60"
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    A registar encomenda…
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-5 w-5" />
                    Finalizar pedido
                  </>
                )}
              </Button>

              <p className="text-center text-xs text-slate-400">
                Pagamento por transferência, Multicaixa Express ou dinheiro na
                entrega.
              </p>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
