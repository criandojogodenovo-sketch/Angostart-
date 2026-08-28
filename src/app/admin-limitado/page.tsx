'use client';

/**
 * AngoStart — Painel Admin Limitado (/admin-limitado) — ROTA OCULTA.
 *
 * 🔒 Acesso: apenas role='admin_limitado' (middleware + APIs). Este painel
 * tem UMA única função: validar comprovativos pendentes (aprovar/rejeitar).
 * Sem listas de utilizadores, produtos ou criação de admins.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import AdminGate from '@/components/AdminGate';
import { Button } from '@/components/ui/button';
import { authHeaders, useAuth } from '@/context/AuthContext';
import { formatKz } from '@/lib/format';
import { useToast } from '@/hooks/use-toast';

interface AdminOrder {
  id: number;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  items: { id: number; name: string; price_kz: number; quantity: number }[];
  total_kz: number;
  status: string;
  comprovativo_url: string | null;
  created_at: string;
}

export default function AdminLimitadoPage() {
  return (
    <AdminGate title="Administração Limitada">
      {({ role }) => <LimitedPanel expectedRole={role} />}
    </AdminGate>
  );
}

function LimitedPanel({ expectedRole }: { expectedRole: 'admin' | 'admin_limitado' }) {
  const { logout } = useAuth();
  const { toast } = useToast();
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/orders?status=pendente', { headers: authHeaders() });
      const data = (await res.json()) as { orders?: AdminOrder[]; error?: string };
      if (!res.ok) {
        toast({ title: 'Erro', description: data.error });
        return;
      }
      setOrders(data.orders ?? []);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  async function reviewOrder(order: AdminOrder, approve: boolean) {
    const res = await fetch(`/api/admin/orders/${order.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ status: approve ? 'pago' : 'rejeitado' }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      toast({ title: 'Não foi possível validar', description: data.error });
      return;
    }
    toast({
      title: approve ? `Encomenda #${order.id} aprovada` : `Encomenda #${order.id} rejeitada`,
    });
    loadOrders();
  }

  async function logoutAdmin() {
    await fetch('/api/auth/2fa/logout', { method: 'POST' });
    logout();
    window.location.href = '/?admin=out';
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <ShieldCheck className="h-7 w-7 text-amber-500" /> Administração Limitada
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Bem-vindo, {expectedRole === 'admin' ? 'administrador' : 'validador'} — aqui só podes
            validar comprovativos de pagamento.
          </p>
        </div>
        <Button variant="outline" onClick={logoutAdmin} className="h-10">
          <LogOut className="mr-2 h-4 w-4" /> Sair do painel
        </Button>
      </div>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">
            Comprovativos pendentes ({orders.length})
          </h2>
          <Button variant="ghost" size="sm" onClick={loadOrders}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
          </Button>
        </div>

        {loading ? (
          <p className="flex items-center justify-center py-10 text-sm text-slate-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> A carregar…
          </p>
        ) : orders.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">
            Sem encomendas pendentes de validação.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {orders.map((order) => (
              <li key={order.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      #{order.id} — {order.customer_name}{' '}
                      <span className="font-normal text-slate-400">({order.customer_phone})</span>
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {order.items.map((i) => `${i.quantity}× ${i.name}`).join(' · ')}
                    </p>
                    <p className="text-xs text-slate-400">
                      {new Date(order.created_at).toLocaleString('pt-PT')}
                    </p>
                    {order.comprovativo_url ? (
                      <a
                        href={order.comprovativo_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-sky-600 hover:underline"
                      >
                        <FileText className="h-3.5 w-3.5" /> Ver comprovativo{' '}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <p className="mt-2 text-xs text-slate-400">Sem comprovativo anexado</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-base font-bold text-emerald-600">
                      {formatKz(order.total_kz)}
                    </span>
                    <Button
                      size="sm"
                      onClick={() => reviewOrder(order, true)}
                      className="h-9 bg-emerald-500 text-white hover:bg-emerald-600"
                    >
                      <CheckCircle2 className="mr-1 h-4 w-4" /> Aprovar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => reviewOrder(order, false)}
                      className="h-9 border-rose-300 text-rose-600 hover:bg-rose-50"
                    >
                      <XCircle className="mr-1 h-4 w-4" /> Rejeitar
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
