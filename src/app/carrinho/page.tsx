'use client';

/**
 * AngoStart — Carrinho de compras.
 * Adicionar/remover produtos, ajustar quantidades, total em Kz e
 * finalização do pedido com pagamento KWiK (transferência instantânea
 * manual) + upload de comprovativo, validado no painel admin.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  Copy,
  CreditCard,
  FileText,
  Hourglass,
  Loader2,
  MapPin,
  Minus,
  PackageOpen,
  Plus,
  Send,
  ShoppingBag,
  Smartphone,
  Trash2,
  Upload,
  Wallet,
} from 'lucide-react';
import ProductIcon from '@/components/ProductIcon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCart } from '@/context/StoreContext';
import { useAuth, authHeaders } from '@/context/AuthContext';
import { formatKz } from '@/lib/format';
import {
  KWIK_PAYEE_NUMBER,
  KWIK_PAYEE_DIGITS,
  KWIK_PROOF_MAX_BYTES,
  KWIK_PROOF_MIME_TYPES,
  buildKwikReference,
  buildKwikTransferNote,
} from '@/lib/kwik';
import { useToast } from '@/hooks/use-toast';

interface PlacedOrder {
  id: number;
  total_kz: number;
  paymentMethod: 'kwik' | 'whatsapp' | 'carteira' | 'momenu';
  reference: string;
  proofAttached: boolean;
  status: string;
  momenuReference?: string | null;
  momenuSandbox?: boolean;
}

type ProofState =
  | { kind: 'none' }
  | { kind: 'selected'; file: File; dataUrl: string }
  | { kind: 'uploading' }
  | { kind: 'sent' }
  | { kind: 'error'; message: string };

const WHATSAPP_NUMBER = '244958176915';

/** URL do WhatsApp para confirmação manual do pagamento. */
function placedWhatsAppUrl(message: string): string {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${message}`;
}

/** Lê um ficheiro como data URL (data:<mime>;base64,<dados>). */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('read-failed'));
    reader.readAsDataURL(file);
  });
}

export default function CarrinhoPage() {
  const { items, count, totalKz, isReady, setQuantity, removeItem, clearCart } =
    useCart();
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [comprovativo, setComprovativo] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<
    'kwik' | 'whatsapp' | 'carteira' | 'momenu'
  >('kwik');
  const [proof, setProof] = useState<ProofState>({ kind: 'none' });
  const [submitting, setSubmitting] = useState(false);
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const proofInputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();

  /* ── MoMenu (Fase 6, ponto 9): opção só aparece se MOMENU_API_KEY existir ── */
  const [momenuEnabled, setMomenuEnabled] = useState(false);

  useEffect(() => {
    fetch('/api/config', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg: { momenuEnabled?: boolean } | null) =>
        setMomenuEnabled(Boolean(cfg?.momenuEnabled))
      )
      .catch(() => setMomenuEnabled(false));
  }, []);

  /* ── Carteira (Fase 4): saldo consultado à API — nunca no bundle ── */
  const [walletSaldo, setWalletSaldo] = useState<number | null>(null);
  /* ── Afiliado (Fase 4): código opcional no checkout ── */
  const [codigoAfiliado, setCodigoAfiliado] = useState('');
  /* ── Fase 5: localização do cliente para serviços ao domicílio ── */
  const [clientLocation, setClientLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);

  const hasDomicilio = items.some((i) => i.product.type === 'servico_domicilio');

  function captureLocation() {
    if (!navigator.geolocation) {
      toast({ title: 'Geolocalização indisponível no teu navegador.' });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setClientLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
        toast({
          title: 'Localização partilhada ✓',
          description: 'O prestador sabe aproximadamente onde prestar o serviço.',
        });
      },
      () => {
        setLocating(false);
        toast({ title: 'Não foi possível obter a localização', description: 'Autoriza a localização no navegador e tenta de novo.' });
      },
      { enableHighAccuracy: false, timeout: 10_000 }
    );
  }

  useEffect(() => {
    if (!user) {
      setWalletSaldo(null);
      return;
    }
    fetch('/api/wallet', { headers: authHeaders(), cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { saldo?: number } | null) => {
        setWalletSaldo(typeof data?.saldo === 'number' ? data.saldo : null);
      })
      .catch(() => setWalletSaldo(null));
  }, [user]);

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

  /** Validação local (o servidor volta a validar tudo — defesa em profundidade). */
  function selectProofFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      setProof({ kind: 'none' });
      return;
    }
    if (file.size > KWIK_PROOF_MAX_BYTES) {
      toast({
        title: 'Ficheiro demasiado grande',
        description: 'O comprovativo deve ter no máximo 2 MB.',
      });
      event.target.value = '';
      setProof({ kind: 'none' });
      return;
    }
    if (
      file.type &&
      !(KWIK_PROOF_MIME_TYPES as readonly string[]).includes(file.type)
    ) {
      toast({
        title: 'Formato não suportado',
        description: 'Usa uma foto (JPG, PNG ou WebP) ou um PDF.',
      });
      event.target.value = '';
      setProof({ kind: 'none' });
      return;
    }
    setProof({ kind: 'selected', file, dataUrl: '' });
    // Lê em segundo plano; o data URL é gerado no submit
    readFileAsDataUrl(file)
      .then((dataUrl) => setProof({ kind: 'selected', file, dataUrl }))
      .catch(() => setProof({ kind: 'none' }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (items.length === 0) return;
    if (proof.kind === 'uploading') return;

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
          payment_method: paymentMethod,
          affiliate_code: codigoAfiliado.trim() || undefined,
          latitude: hasDomicilio && clientLocation ? clientLocation.lat : undefined,
          longitude: hasDomicilio && clientLocation ? clientLocation.lng : undefined,
          comprovativo_url:
            paymentMethod === 'whatsapp' ? comprovativo || undefined : undefined,
          // KWiK: comprovativo (opcional — pode anexar depois na confirmação)
          payment_proof:
            paymentMethod === 'kwik' && proof.kind === 'selected' && proof.dataUrl
              ? proof.dataUrl
              : undefined,
          payment_proof_name:
            paymentMethod === 'kwik' && proof.kind === 'selected'
              ? proof.file.name
              : undefined,
          items: items.map((i) => ({
            id: i.product.id,
            quantity: i.quantity,
          })),
        }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        order?: {
          id: number;
          total_kz: number;
          status: string;
          payment_method: string;
          reference: string;
          proof_attached: boolean;
        };
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
        paymentMethod:
          data.order.payment_method === 'whatsapp'
            ? 'whatsapp'
            : data.order.payment_method === 'carteira'
              ? 'carteira'
              : data.order.payment_method === 'momenu'
                ? 'momenu'
                : 'kwik',
        reference: data.order.reference ?? buildKwikReference(data.order.id),
        proofAttached: data.order.proof_attached,
        status: data.order.status,
      });

      /* MoMenu (Fase 6): cria a intenção de pagamento automático (se ativo) */
      let momenuResult: { reference?: string | null; sandbox?: boolean } | null = null;
      if (data.order.payment_method === 'momenu') {
        try {
          const payRes = await fetch('/api/payments/momenu', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ order_id: data.order.id }),
          });
          const payData = (await payRes.json()) as {
            ok?: boolean;
            sandbox?: boolean;
            payment?: { reference?: string | null };
          };
          if (payRes.ok && payData.ok) {
            momenuResult = {
              reference: payData.payment?.reference ?? null,
              sandbox: payData.sandbox,
            };
          }
        } catch {
          /* pagamento automático opcional — o pedido continua válido */
        }
      }

      setPlaced((prev) =>
        prev
          ? {
              ...prev,
              momenuReference: momenuResult?.reference ?? null,
              momenuSandbox: momenuResult?.sandbox,
            }
          : prev
      );
      clearCart();
      toast({
        title: 'Encomenda registada!',
        description:
          paymentMethod === 'carteira'
            ? 'Pago com o saldo da carteira — a equipa prepara a entrega.'
            : paymentMethod === 'momenu'
              ? 'Pagamento MoMenu iniciado — confirma no teu telefone.'
              : `Referência ${buildKwikReference(data.order.id)}.`,
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

  /** Upload do comprovativo DEPOIS de criar a encomenda (com referência visível). */
  async function uploadProofLate() {
    if (!placed || proof.kind !== 'selected' || !proof.dataUrl) return;
    setProof({ kind: 'uploading' });
    try {
      const res = await fetch(`/api/orders/${placed.id}/proof`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          payment_proof: proof.dataUrl,
          payment_proof_name: proof.file.name,
          phone, // usado para validar encomendas de convidado
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setProof({ kind: 'error', message: data.error ?? 'Tenta novamente.' });
        return;
      }
      setProof({ kind: 'sent' });
      setPlaced({ ...placed, proofAttached: true, status: 'aguardando_validacao' });
      toast({
        title: 'Comprovativo enviado!',
        description: 'A equipa vai validar e entramos em contacto.',
      });
    } catch {
      setProof({ kind: 'error', message: 'Sem resposta do servidor.' });
    }
  }

  function copyText(value: string, label: string) {
    navigator.clipboard
      ?.writeText(value)
      .then(() => toast({ title: `${label} copiado`, description: value }))
      .catch(() => undefined);
  }

  /* ─────────── Encomenda concluída ─────────── */
  if (placed) {
    const isKwik = placed.paymentMethod === 'kwik';
    const transferNote = buildKwikTransferNote(placed.id, name || 'Cliente');
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
            Pedido <strong>n.º {placed.id}</strong> registado com um total de{' '}
            <strong className="text-emerald-600">{formatKz(placed.total_kz)}</strong>.
          </p>

          {/* Instruções KWiK — pagamento manual */}
          {isKwik && (
            <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-left">
              <p className="flex items-center gap-2 text-sm font-bold text-emerald-900">
                <Smartphone className="h-4 w-4" /> Pagamento KWiK — Transferência
                Instantânea
              </p>
              <ol className="mt-3 space-y-2 text-sm text-emerald-900">
                <li className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2">
                  <span>
                    1. Transfere <strong>{formatKz(placed.total_kz)}</strong> para
                  </span>
                </li>
                <li className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2">
                  <span className="font-mono text-base font-bold text-emerald-700">
                    {KWIK_PAYEE_NUMBER}
                  </span>
                  <button
                    type="button"
                    onClick={() => copyText(KWIK_PAYEE_DIGITS, 'Número KWiK')}
                    aria-label="Copiar número KWiK"
                    className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-100"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </li>
                <li className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2">
                  <span className="truncate">
                    2. Referência:{' '}
                    <strong className="font-mono">{placed.reference}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => copyText(transferNote, 'Referência')}
                    aria-label="Copiar referência do pedido"
                    className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-100"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </li>
              </ol>

              {/* Estado do comprovativo */}
              {placed.proofAttached || proof.kind === 'sent' ? (
                <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-emerald-700">
                  <BadgeCheck className="h-4 w-4" /> Comprovativo recebido —
                  aguardando validação da equipa.
                </p>
              ) : (
                <div className="mt-3 rounded-lg bg-white p-3">
                  <p className="text-xs font-semibold text-slate-700">
                    3. Depois de transferir, anexa o comprovativo (foto ou PDF,
                    máx. 2 MB):
                  </p>
                  <input
                    ref={proofInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={selectProofFile}
                    className="mt-2 block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-500 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-emerald-600"
                  />
                  {proof.kind === 'selected' && (
                    <p className="mt-1.5 truncate text-[11px] text-slate-500">
                      {proof.file.name} · {Math.max(1, Math.round(proof.file.size / 1024))} KB
                    </p>
                  )}
                  {proof.kind === 'error' && (
                    <p className="mt-1.5 text-[11px] font-semibold text-rose-600">
                      {proof.message}
                    </p>
                  )}
                  <Button
                    type="button"
                    onClick={uploadProofLate}
                    disabled={proof.kind !== 'selected' || !proof.dataUrl}
                    className="mt-2 h-10 w-full bg-emerald-500 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                  >
                    {proof.kind === 'uploading' ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> A enviar…
                      </>
                    ) : (
                      <>
                        <Upload className="mr-2 h-4 w-4" /> Enviar comprovativo
                      </>
                    )}
                  </Button>
                </div>
              )}

              <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-emerald-700">
                <Hourglass className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Assim que o comprovativo for validado, o pedido passa a{' '}
                <strong>pago</strong> e a entrega é preparada.
              </p>
            </div>
          )}

          {!isKwik && placed.paymentMethod === 'carteira' && (
            <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-left">
              <p className="flex items-center gap-2 text-sm font-bold text-emerald-900">
                <Wallet className="h-4 w-4" /> Pago com o saldo da carteira
              </p>
              <p className="mt-2 text-sm leading-relaxed text-emerald-800">
                Foi debitado <strong>{formatKz(placed.total_kz)}</strong> do teu saldo
                (referência <strong className="font-mono">{placed.reference}</strong>).
                O valor fica retido em <strong>escrow</strong> até a entrega ser
                concluída — só então o vendedor recebe.
              </p>
            </div>
          )}

          {!isKwik && placed.paymentMethod === 'whatsapp' && (
            <p className="mt-5 text-sm text-slate-500">
              A nossa equipa entra em contacto pelo WhatsApp para combinar a
              entrega e o pagamento.
            </p>
          )}

          {!isKwik && placed.paymentMethod === 'momenu' && (
            <div className="mt-6 rounded-2xl border border-sky-200 bg-sky-50 p-5 text-left">
              <p className="flex items-center gap-2 text-sm font-bold text-sky-900">
                <Smartphone className="h-4 w-4" /> MoMenu — Multicaixa Express
              </p>
              <p className="mt-2 text-sm leading-relaxed text-sky-900">
                Foi enviada uma intenção de pagamento de{' '}
                <strong>{formatKz(placed.total_kz)}</strong> para o teu telefone.
                Confirma no ecrã do Multicaixa Express introduzindo o teu PIN.
              </p>
              {placed.momenuReference && (
                <p className="mt-2 text-xs font-semibold text-sky-800">
                  Referência:{' '}
                  <span className="font-mono">{placed.momenuReference}</span>
                  {placed.momenuSandbox && (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                      SANDBOX — sem cobrança real
                    </span>
                  )}
                </p>
              )}
            </div>
          )}

          <div className="mt-8 space-y-3">
            {isKwik ? (
              <Button
                asChild
                className="h-12 w-full bg-emerald-500 text-base font-semibold text-white hover:bg-emerald-600"
              >
                <Link href="/perfil">
                  <CreditCard className="mr-2 h-5 w-5" /> Ver estado da encomenda
                </Link>
              </Button>
            ) : (
              <Button
                asChild
                className="h-12 w-full bg-[#25D366] text-base font-semibold text-white hover:bg-[#1fb857]"
              >
                <a href={placedWhatsAppUrl(whatsappMessage)} target="_blank" rel="noopener noreferrer">
                  <Send className="mr-2 h-5 w-5" /> Confirmar no WhatsApp
                </a>
              </Button>
            )}
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

              {/* Método de pagamento */}
              <fieldset className="space-y-2 rounded-xl border border-slate-200 p-3">
                <legend className="px-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Pagamento
                </legend>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg p-2 transition-colors hover:bg-slate-50">
                  <input
                    type="radio"
                    name="pagamento"
                    value="kwik"
                    checked={paymentMethod === 'kwik'}
                    onChange={() => setPaymentMethod('kwik')}
                    className="mt-0.5 h-4 w-4 accent-emerald-600"
                  />
                  <span className="text-sm">
                    <span className="font-semibold text-slate-900">
                      KWiK (Transferência Instantânea){' '}
                      <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                        RECOMENDADO
                      </span>
                    </span>
                    <span className="block text-xs text-slate-500">
                      Transfere para <strong>{KWIK_PAYEE_NUMBER}</strong> e anexa
                      o comprovativo — validamos e despachamos.
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg p-2 transition-colors hover:bg-slate-50">
                  <input
                    type="radio"
                    name="pagamento"
                    value="whatsapp"
                    checked={paymentMethod === 'whatsapp'}
                    onChange={() => setPaymentMethod('whatsapp')}
                    className="mt-0.5 h-4 w-4 accent-slate-600"
                  />
                  <span className="text-sm">
                    <span className="font-semibold text-slate-900">
                      Combinar pelo WhatsApp
                    </span>
                    <span className="block text-xs text-slate-500">
                      Dinheiro na entrega ou outra forma — combinado com a
                      equipa.
                    </span>
                  </span>
                </label>

                {/* MoMenu (Multicaixa Express) — apenas com MOMENU_API_KEY definida (Fase 6) */}
                {momenuEnabled && user && (
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg p-2 transition-colors hover:bg-slate-50">
                    <input
                      type="radio"
                      name="pagamento"
                      value="momenu"
                      checked={paymentMethod === 'momenu'}
                      onChange={() => setPaymentMethod('momenu')}
                      className="mt-0.5 h-4 w-4 accent-emerald-600"
                    />
                    <span className="text-sm">
                      <span className="font-semibold text-slate-900">
                        MoMenu (Multicaixa Express){' '}
                        <span className="ml-1 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-700">
                          AUTOMÁTICO
                        </span>
                      </span>
                      <span className="block text-xs text-slate-500">
                        Confirma o pagamento no teu telefone com Multicaixa Express.
                      </span>
                    </span>
                  </label>
                )}

                {/* Pagamento automático MoMenu — em breve (Fase 5/6, estrutura preparada) */}
                {!momenuEnabled && (
                  <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    🔒 Pagamento automático (MoMenu) <strong>em breve</strong> — por agora o KWiK
                    manual é o método principal e mais seguro.
                  </p>
                )}

                {/* Carteira (Fase 4) — apenas utilizadores autenticados */}
                {user && (
                  <label
                    className={`flex items-start gap-3 rounded-lg p-2 transition-colors ${
                      walletSaldo !== null && walletSaldo < totalKz
                        ? 'opacity-70'
                        : 'cursor-pointer hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="pagamento"
                      value="carteira"
                      checked={paymentMethod === 'carteira'}
                      onChange={() => setPaymentMethod('carteira')}
                      disabled={walletSaldo !== null && walletSaldo < totalKz}
                      className="mt-0.5 h-4 w-4 accent-emerald-600"
                    />
                    <span className="text-sm">
                      <span className="font-semibold text-slate-900">
                        Carteira AngoStart{' '}
                        {walletSaldo !== null && (
                          <span
                            className={`ml-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              walletSaldo >= totalKz
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-rose-100 text-rose-600'
                            }`}
                          >
                            SALDO: {formatKz(walletSaldo)}
                          </span>
                        )}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {walletSaldo !== null && walletSaldo < totalKz
                          ? 'Saldo insuficiente — carrega a carteira ou usa KWiK.'
                          : 'Paga já com o teu saldo — retido em escrow até a entrega.'}
                      </span>
                    </span>
                  </label>
                )}

                {/* Localização para serviços ao domicílio (Fase 5) */}
                {hasDomicilio && paymentMethod !== 'whatsapp' && (
                  <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
                    <p className="text-xs font-bold text-orange-900">
                      Serviço ao domicílio no carrinho — partilha a tua localização (opcional)
                    </p>
                    <p className="mt-1 text-[11px] text-orange-800">
                      Ajuda o prestador a chegar mais rápido. Só é partilhada com o vendedor da tua
                      encomenda.
                    </p>
                    {clientLocation ? (
                      <p className="mt-2 text-xs font-semibold text-emerald-700">
                        ✓ Localização registada ({clientLocation.lat.toFixed(4)}, {clientLocation.lng.toFixed(4)})
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={captureLocation}
                        disabled={locating}
                        className="mt-2 inline-flex h-9 items-center gap-2 rounded-lg bg-orange-500 px-4 text-xs font-semibold text-white transition-colors hover:bg-orange-600 disabled:opacity-60"
                      >
                        {locating ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <MapPin className="h-4 w-4" />
                        )}
                        Partilhar localização
                      </button>
                    )}
                  </div>
                )}

                {/* KWiK: instruções + comprovativo */}
                {paymentMethod === 'kwik' && (
                  <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <p className="text-xs font-bold text-emerald-900">
                      Como funciona o KWiK:
                    </p>
                    <ol className="list-decimal space-y-1 pl-4 text-xs leading-relaxed text-emerald-800">
                      <li>
                        Transfere <strong>{formatKz(totalKz)}</strong> para{' '}
                        <strong>{KWIK_PAYEE_NUMBER}</strong> (KWiK — Kwanza
                        Instantâneo).
                      </li>
                      <li>
                        A referência do pedido (ex.:{' '}
                        <span className="font-mono">AngoStart-ORD-00042</span>)
                        aparece logo após confirmar — indica-a na descrição da
                        transferência.
                      </li>
                      <li>
                        Anexa o comprovativo (foto ou PDF, máx. 2 MB) — agora ou
                        no ecrã seguinte.
                      </li>
                      <li>
                        A equipa valida no painel e o pedido passa a{' '}
                        <strong>pago</strong>.
                      </li>
                    </ol>
                    <input
                      ref={proofInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      onChange={selectProofFile}
                      aria-label="Comprovativo KWiK (opcional)"
                      className="mt-1 block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-500 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-emerald-600"
                    />
                    {proof.kind === 'selected' && (
                      <p className="truncate text-[11px] text-emerald-700">
                        ✓ {proof.file.name} pronto ({Math.max(1, Math.round(proof.file.size / 1024))} KB)
                      </p>
                    )}
                  </div>
                )}

                {/* WhatsApp: link de comprovativo opcional (método manual existente) */}
                {paymentMethod === 'whatsapp' && (
                  <div className="space-y-1.5 pl-2 pt-1">
                    <Label htmlFor="cart-comprovativo" className="text-xs text-slate-500">
                      Link do comprovativo (opcional — validado pela equipa)
                    </Label>
                    <Input
                      id="cart-comprovativo"
                      type="url"
                      value={comprovativo}
                      onChange={(e) => setComprovativo(e.target.value)}
                      placeholder="https://…/comprovativo.jpg"
                      className="h-10 text-sm"
                    />
                  </div>
                )}
              </fieldset>

              {/* Afiliado: código opcional (Fase A) */}
              <div className="space-y-1.5">
                <Label htmlFor="cart-afiliado" className="text-xs text-slate-500">
                  Código de afiliado (opcional — ex.: AFG-3K9PQX)
                </Label>
                <Input
                  id="cart-afiliado"
                  value={codigoAfiliado}
                  onChange={(e) => setCodigoAfiliado(e.target.value)}
                  placeholder="AFG-XXXXXX"
                  className="h-10 text-sm uppercase"
                  maxLength={20}
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
                Pagamento por KWiK (transferência instantânea), carteira
                AngoStart, WhatsApp ou dinheiro na entrega.
              </p>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
