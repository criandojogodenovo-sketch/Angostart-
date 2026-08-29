'use client';

/**
 * AngoStart — Painel Admin Limitado (/admin-limitado) — ROTA OCULTA.
 *
 * 🔒 Acesso: apenas role='admin_limitado' (middleware + APIs). Sem
 * palavra-passe fixa: o primeiro acesso usa o código de CONVITE enviado
 * por email pelo admin total; os acessos seguintes usam o CÓDIGO DIÁRIO
 * (6 dígitos, muda a cada 24 h, uso único) + 2FA obrigatório.
 *
 * O painel tem UMA única função: validar comprovativos KWiK pendentes
 * (aprovar/rejeitar com observação interna). Sem listas de utilizadores,
 * produtos ou criação de admins.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, LogOut, ShieldCheck } from 'lucide-react';
import AdminGate from '@/components/AdminGate';
import ProofReviewList, {
  type KwikAdminOrder,
} from '@/components/ProofReviewList';
import { Button } from '@/components/ui/button';
import { authHeaders, useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';

export default function AdminLimitadoPage() {
  return (
    <AdminGate title="Administração Limitada" authMode="code">
      {({ role }) => <LimitedPanel expectedRole={role} />}
    </AdminGate>
  );
}

function LimitedPanel({ expectedRole }: { expectedRole: 'admin' | 'admin_limitado' }) {
  const { logout } = useAuth();
  const { toast } = useToast();
  const [orders, setOrders] = useState<KwikAdminOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/orders?status=aguardando_validacao', {
        headers: authHeaders(),
      });
      const data = (await res.json()) as { orders?: KwikAdminOrder[]; error?: string };
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

  async function reviewOrder(
    order: KwikAdminOrder,
    approve: boolean,
    note: string
  ) {
    const res = await fetch(`/api/admin/orders/${order.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        status: approve ? 'pago' : 'rejeitado',
        admin_note: note || undefined,
      }),
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
            Bem-vindo, {expectedRole === 'admin' ? 'administrador' : 'validador'} — aqui só
            podes validar comprovativos KWiK de pagamento.
          </p>
        </div>
        <Button variant="outline" onClick={logoutAdmin} className="h-10">
          <LogOut className="mr-2 h-4 w-4" /> Sair do painel
        </Button>
      </div>

      {loading ? (
        <p className="mt-10 flex items-center justify-center text-sm text-slate-400">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> A carregar comprovativos…
        </p>
      ) : (
        <ProofReviewList
          orders={orders}
          loading={loading}
          emptyMessage="Sem comprovativos KWiK à espera de validação."
          onReload={loadOrders}
          onReview={reviewOrder}
        />
      )}
    </div>
  );
}
