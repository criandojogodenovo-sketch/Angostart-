'use client';

/**
 * AngoStart — Carteira do utilizador (/carteira).
 *
 * - Saldo disponível + saldo bloqueado (escrow de vendas)
 * - Depósito manual: referência única + transferência via Afrimoney /
 *   UNITEL Money para o número KWiK da AngoStart (admin aprova)
 * - Saque: reserva o valor; a equipa envia via Afrimoney / UNITEL Money
 * - Diário de movimentações
 *
 * 🔒 Todos os valores vêm da API autenticada — nada de sensível no bundle.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  BadgeCheck,
  Copy,
  Loader2,
  Lock,
  Receipt,
  Smartphone,
  Wallet as WalletIcon,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth, authHeaders } from '@/context/AuthContext';
import { formatKz } from '@/lib/format';
import { KWIK_PAYEE_NUMBER, KWIK_PAYEE_DIGITS } from '@/lib/kwik';
import { BUSINESS_DEFAULTS } from '@/lib/config';
import { useToast } from '@/hooks/use-toast';

interface WalletTx {
  id: number;
  tipo:
    | 'deposito'
    | 'saque'
    | 'pagamento'
    | 'recebimento'
    | 'comissao'
    | 'liberacao'
    | 'reembolso';
  valor: number;
  status: 'pendente' | 'concluido' | 'rejeitado' | 'bloqueado';
  referencia: string | null;
  order_id: number | null;
  descricao: string | null;
  created_at: string;
}

interface WalletPayload {
  saldo: number;
  saldo_bloqueado: number;
  transactions: WalletTx[];
}

const TIPO_LABELS: Record<WalletTx['tipo'], string> = {
  deposito: 'Depósito',
  saque: 'Saque',
  pagamento: 'Pagamento de encomenda',
  recebimento: 'Venda recebida',
  comissao: 'Comissão de afiliado',
  liberacao: 'Libertação de escrow',
  reembolso: 'Reembolso',
};

const TIPO_TONES: Record<WalletTx['tipo'], string> = {
  deposito: 'bg-sky-100 text-sky-700',
  saque: 'bg-violet-100 text-violet-700',
  pagamento: 'bg-slate-100 text-slate-700',
  recebimento: 'bg-emerald-100 text-emerald-700',
  comissao: 'bg-amber-100 text-amber-700',
  liberacao: 'bg-emerald-100 text-emerald-700',
  reembolso: 'bg-rose-100 text-rose-700',
};

const STATUS_LABELS: Record<WalletTx['status'], string> = {
  pendente: 'Pendente',
  concluido: 'Concluído',
  rejeitado: 'Recusado',
  bloqueado: 'Em escrow',
};

const STATUS_TONES: Record<WalletTx['status'], string> = {
  pendente: 'bg-amber-100 text-amber-700',
  concluido: 'bg-emerald-100 text-emerald-700',
  rejeitado: 'bg-rose-100 text-rose-700',
  bloqueado: 'bg-sky-100 text-sky-700',
};

/** Tipos que aumentam o saldo (+) vs. que reduzem (−). */
const TIPO_POSITIVO = new Set<WalletTx['tipo']>([
  'deposito',
  'recebimento',
  'comissao',
  'liberacao',
  'reembolso',
]);

export default function CarteiraPage() {
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const [data, setData] = useState<WalletPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [depositoValor, setDepositoValor] = useState('');
  const [saqueValor, setSaqueValor] = useState('');
  const [busy, setBusy] = useState<'deposito' | 'saque' | null>(null);
  const [ultimaReferencia, setUltimaReferencia] = useState<string | null>(null);

  /* ── Fase 5: limites reais vindos da configuração central (env-configuráveis) ── */
  const [limites, setLimites] = useState({
    minDeposit: BUSINESS_DEFAULTS.minDepositAmount,
    maxDeposit: BUSINESS_DEFAULTS.maxDepositAmount,
    minWithdraw: BUSINESS_DEFAULTS.minWithdrawAmount,
    maxWithdraw: BUSINESS_DEFAULTS.maxWithdrawAmount,
    maxDailyDeposit: BUSINESS_DEFAULTS.maxDailyDeposit,
    maxDailyWithdraw: BUSINESS_DEFAULTS.maxDailyWithdraw,
  });

  useEffect(() => {
    fetch('/api/wallet/deposit')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { limites?: typeof limites } | null) => {
        if (d?.limites) setLimites(d.limites);
      })
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/wallet', { headers: authHeaders(), cache: 'no-store' });
      if (!res.ok) return;
      setData((await res.json()) as WalletPayload);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (user) load();
    else setLoading(false);
  }, [authLoading, user, load]);

  function copyText(value: string, label: string) {
    navigator.clipboard
      ?.writeText(value)
      .then(() => toast({ title: `${label} copiado`, description: value }))
      .catch(() => undefined);
  }

  async function pedirDeposito(event: React.FormEvent) {
    event.preventDefault();
    const valor = Math.round(Number(depositoValor));
    if (!Number.isFinite(valor) || valor < limites.minDeposit) {
      toast({ title: 'Valor inválido', description: `O depósito mínimo é ${limites.minDeposit} Kz.` });
      return;
    }
    if (valor > limites.maxDeposit) {
      toast({ title: 'Valor acima do limite', description: `O depósito máximo por operação é ${limites.maxDeposit} Kz.` });
      return;
    }
    setBusy('deposito');
    try {
      const res = await fetch('/api/wallet/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ valor }),
      });
      const payload = (await res.json()) as {
        ok?: boolean;
        deposit?: { referencia: string };
        error?: string;
      };
      if (!res.ok || !payload.ok || !payload.deposit) {
        toast({ title: 'Não foi possível', description: payload.error });
        return;
      }
      setUltimaReferencia(payload.deposit.referencia);
      setDepositoValor('');
      toast({
        title: 'Pedido de depósito criado!',
        description: `Referência ${payload.deposit.referencia} — transfere e aguarda a validação.`,
      });
      load();
    } catch {
      toast({ title: 'Erro de ligação', description: 'Tenta novamente em instantes.' });
    } finally {
      setBusy(null);
    }
  }

  async function pedirSaque(event: React.FormEvent) {
    event.preventDefault();
    const valor = Math.round(Number(saqueValor));
    if (!Number.isFinite(valor) || valor < limites.minWithdraw) {
      toast({ title: 'Valor inválido', description: `O saque mínimo é ${limites.minWithdraw} Kz.` });
      return;
    }
    if (valor > limites.maxWithdraw) {
      toast({ title: 'Valor acima do limite', description: `O saque máximo por operação é ${limites.maxWithdraw} Kz.` });
      return;
    }
    setBusy('saque');
    try {
      const res = await fetch('/api/wallet/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ valor }),
      });
      const payload = (await res.json()) as {
        ok?: boolean;
        withdraw?: { referencia: string };
        error?: string;
      };
      if (!res.ok || !payload.ok || !payload.withdraw) {
        toast({ title: 'Não foi possível', description: payload.error });
        return;
      }
      setSaqueValor('');
      toast({
        title: 'Saque pedido!',
        description: `${payload.withdraw.referencia} — a equipa envia para o teu telefone.`,
      });
      load();
    } catch {
      toast({ title: 'Erro de ligação', description: 'Tenta novamente em instantes.' });
    } finally {
      setBusy(null);
    }
  }

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center py-32 text-slate-400">
        <Loader2 className="mr-3 h-5 w-5 animate-spin text-emerald-500" />
        <span className="text-sm">A abrir a carteira…</span>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center sm:px-6">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-rose-100">
          <Lock className="h-8 w-8 text-rose-500" />
        </span>
        <h1 className="mt-5 text-2xl font-bold text-slate-900">Carteira privada</h1>
        <p className="mt-2 text-sm text-slate-500">
          Entra na tua conta para ver o saldo, carregar a carteira e receber
          os pagamentos das tuas vendas.
        </p>
        <Button asChild className="mt-8 h-12 bg-emerald-500 px-8 font-semibold text-white hover:bg-emerald-600">
          <Link href="/perfil">Entrar na minha conta</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Carteira</h1>
          <p className="mt-1 text-sm text-slate-500">
            Carrega, paga e recebe — tudo em Kwanzas, direto na AngoStart.
          </p>
        </div>
        <Button asChild variant="outline" className="h-10 border-emerald-500 text-emerald-600 hover:bg-emerald-50">
          <Link href="/perfil">
            <ArrowLeft className="mr-2 h-4 w-4" /> Voltar ao perfil
          </Link>
        </Button>
      </div>

      {/* Saldos */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-6 text-white shadow-lg">
          <div className="flex items-center gap-2 text-emerald-50">
            <WalletIcon className="h-5 w-5" />
            <p className="text-sm font-semibold">Saldo disponível</p>
          </div>
          <p className="mt-3 text-3xl font-bold">
            {formatKz(data?.saldo ?? 0)}
          </p>
          <p className="mt-1 text-xs text-emerald-100">
            Para pagar encomendas ou pedir saque.
          </p>
        </div>
        <div className="rounded-2xl border border-sky-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2 text-sky-700">
            <Lock className="h-5 w-5" />
            <p className="text-sm font-semibold">Saldo bloqueado (escrow)</p>
          </div>
          <p className="mt-3 text-3xl font-bold text-slate-900">
            {formatKz(data?.saldo_bloqueado ?? 0)}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Vendas confirmadas — libertado quando a entrega é concluída.
          </p>
        </div>
      </div>

      {/* Depósito + saque */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Depósito */}
        <section aria-label="Carregar carteira" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <ArrowDownToLine className="h-5 w-5 text-emerald-600" /> Carregar carteira
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            1. Escolhe o valor e recebe a tua referência única.
            2. Transfere via <strong>Afrimoney</strong> ou <strong>UNITEL Money</strong> para{' '}
            <strong>{KWIK_PAYEE_NUMBER}</strong>, indicando a referência.
            3. A equipa valida e o saldo entra na carteira.
          </p>
          <form onSubmit={pedirDeposito} className="mt-4 flex gap-2">
            <div className="flex-1">
              <Label htmlFor="deposito-valor" className="sr-only">Valor do depósito (Kz)</Label>
              <Input
                id="deposito-valor"
                type="number"
                min={limites.minDeposit}
                max={limites.maxDeposit}
                step={100}
                inputMode="numeric"
                value={depositoValor}
                onChange={(e) => setDepositoValor(e.target.value)}
                placeholder={`Valor em Kz (mín. ${limites.minDeposit})`}
                className="h-11"
                required
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Mín {formatKz(limites.minDeposit)} · Máx {formatKz(limites.maxDeposit)} por operação ·
                limite diário {formatKz(limites.maxDailyDeposit)}
              </p>
            </div>
            <Button
              type="submit"
              disabled={busy === 'deposito'}
              className="h-11 bg-emerald-500 px-5 font-semibold text-white hover:bg-emerald-600 disabled:opacity-60"
            >
              {busy === 'deposito' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Gerar referência'}
            </Button>
          </form>

          {ultimaReferencia && (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-emerald-900">
                <Smartphone className="h-4 w-4" /> Referência do depósito
              </p>
              <div className="mt-2 flex items-center justify-between rounded-lg bg-white px-3 py-2">
                <span className="font-mono text-base font-bold text-emerald-700">
                  {ultimaReferencia}
                </span>
                <button
                  type="button"
                  onClick={() => copyText(ultimaReferencia, 'Referência')}
                  aria-label="Copiar referência do depósito"
                  className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-100"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-sm">
                <span>
                  Número: <strong className="font-mono">{KWIK_PAYEE_NUMBER}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => copyText(KWIK_PAYEE_DIGITS, 'Número KWiK')}
                  aria-label="Copiar número de destino"
                  className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-100"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-emerald-700">
                O valor só entra no saldo depois da validação da equipa
                (confirmação Afrimoney / UNITEL Money).
              </p>
            </div>
          )}
        </section>

        {/* Saque */}
        <section aria-label="Pedir saque" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <ArrowUpFromLine className="h-5 w-5 text-violet-600" /> Pedir saque
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            O valor é reservado do teu saldo e enviado para o telefone da tua
            conta via <strong>Afrimoney</strong> / <strong>UNITEL Money</strong>.
            Se a equipa recusar, o valor volta ao saldo.
          </p>
          <form onSubmit={pedirSaque} className="mt-4 flex gap-2">
            <div className="flex-1">
              <Label htmlFor="saque-valor" className="sr-only">Valor do saque (Kz)</Label>
              <Input
                id="saque-valor"
                type="number"
                min={limites.minWithdraw}
                max={limites.maxWithdraw}
                step={100}
                inputMode="numeric"
                value={saqueValor}
                onChange={(e) => setSaqueValor(e.target.value)}
                placeholder={`Valor em Kz (mín. ${limites.minWithdraw})`}
                className="h-11"
                required
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Mín {formatKz(limites.minWithdraw)} · Máx {formatKz(limites.maxWithdraw)} por operação ·
                limite diário {formatKz(limites.maxDailyWithdraw)}
              </p>
            </div>
            <Button
              type="submit"
              disabled={busy === 'saque'}
              className="h-11 bg-violet-600 px-5 font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
            >
              {busy === 'saque' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Pedir saque'}
            </Button>
          </form>
          <p className="mt-3 text-[11px] text-slate-400">
            Telefone de recebimento: <strong>{user.telefone || '— adiciona no perfil'}</strong>
          </p>
        </section>
      </div>

      {/* Movimentações */}
      <section aria-label="Movimentações da carteira" className="mt-8 rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <Receipt className="h-5 w-5 text-slate-400" /> Movimentações
          </h2>
          <Button variant="ghost" size="sm" onClick={load} className="text-emerald-600 hover:bg-emerald-50">
            Atualizar
          </Button>
        </div>
        {(data?.transactions?.length ?? 0) === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">
            Ainda sem movimentações — carrega a carteira para começar.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data!.transactions.map((tx) => {
              const positivo = TIPO_POSITIVO.has(tx.tipo);
              return (
                <li key={tx.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      {TIPO_LABELS[tx.tipo]}
                      {tx.order_id ? (
                        <span className="font-normal text-slate-400"> · encomenda n.º {tx.order_id}</span>
                      ) : null}
                    </p>
                    <p className="text-xs text-slate-400">
                      {tx.referencia ? `${tx.referencia} · ` : ''}
                      {new Date(tx.created_at).toLocaleString('pt-PT')}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_TONES[tx.status]}`}>
                      {STATUS_LABELS[tx.status]}
                    </span>
                    <span
                      className={`text-sm font-bold ${positivo ? 'text-emerald-600' : 'text-rose-500'}`}
                    >
                      {positivo ? '+' : '−'} {formatKz(tx.valor)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Nota de segurança */}
      <p className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-slate-400">
        <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
        Todos os movimentos são validados no servidor com auditoria completa —
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" aria-hidden="true" />
        nunca partilhes a tua palavra-passe ou códigos com ninguém.
      </p>
    </div>
  );
}
