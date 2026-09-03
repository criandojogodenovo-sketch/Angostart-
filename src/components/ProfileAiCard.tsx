'use client';

/**
 * AngoStart — Fase 21: «Analisar o meu perfil com IA» (self-service).
 *
 * Cartão no /perfil do vendedor: um clique envia bio + produtos/keywords +
 * avaliações para /api/ai/profile-analysis (tarefa 'chat' → Hy3/Tencent no
 * servidor; chaves nunca expostas) e mostra o parecer:
 *   - nota 0-10 com anel de progresso;
 *   - resumo curto;
 *   - pontos fortes e pontos a melhorar (acionáveis).
 *
 * Quota: 3 análises/dia (o saldo vem do GET; erros 429/502 são amigáveis).
 * Detalhes internos (modelo, provider, latência) NUNCA aparecem aqui —
 * visibilidade por perfil: isso vive só no painel admin.
 */

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Sparkles, TrendingUp, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { authHeaders, type AuthUser } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';

interface ProfileAnalysis {
  nota: number;
  resumo: string;
  pontos_fortes: string[];
  pontos_a_melhorar: string[];
}

/** Anel de progresso 0-10 (SVG puro — sem dependências). */
function NotaRing({ nota }: { nota: number }) {
  const clamped = Math.max(0, Math.min(10, nota));
  const raio = 30;
  const circ = 2 * Math.PI * raio;
  const preenchido = (clamped / 10) * circ;
  const cor = clamped >= 7 ? '#0d9488' : clamped >= 5 ? '#2563eb' : '#e11d48';

  return (
    <div className="relative h-20 w-20 shrink-0">
      <svg viewBox="0 0 80 80" className="h-20 w-20 -rotate-90">
        <circle cx="40" cy="40" r={raio} fill="none" stroke="#e2e8f0" strokeWidth="7" />
        <circle
          cx="40"
          cy="40"
          r={raio}
          fill="none"
          stroke={cor}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${preenchido} ${circ - preenchido}`}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-lg font-extrabold text-slate-900">
        {clamped.toFixed(1)}
      </span>
    </div>
  );
}

export default function ProfileAiCard({ user }: { user: AuthUser }) {
  const { toast } = useToast();
  const [aberta, setAberta] = useState(false);
  const [aAnalisar, setAAnalisar] = useState(false);
  const [analise, setAnalise] = useState<ProfileAnalysis | null>(null);
  const [restantes, setRestantes] = useState<number | null>(null);

  /* Saldo de hoje (para desativar o botão com quota esgotada). */
  const carregarSaldo = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/profile-analysis', { headers: authHeaders() });
      if (!res.ok) return;
      const data = (await res.json()) as { restantes?: number };
      setRestantes(typeof data.restantes === 'number' ? data.restantes : null);
    } catch {
      /* silencioso — o botão continua utilizável */
    }
  }, []);

  useEffect(() => {
    if (aberta && analise === null && restantes === null) void carregarSaldo();
  }, [aberta, analise, restantes, carregarSaldo]);

  async function analisar() {
    if (aAnalisar) return;
    setAAnalisar(true);
    try {
      const res = await fetch('/api/ai/profile-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
      });
      const data = (await res.json()) as Partial<ProfileAnalysis> & {
        error?: string;
        code?: string;
      };
      if (!res.ok || typeof data.nota !== 'number') {
        toast({ title: 'Análise indisponível', description: data.error });
        if (data.code === 'QUOTA_EXCEEDED') setRestantes(0);
        return;
      }
      setAnalise({
        nota: data.nota,
        resumo: data.resumo ?? '',
        pontos_fortes: data.pontos_fortes ?? [],
        pontos_a_melhorar: data.pontos_a_melhorar ?? [],
      });
      setRestantes((r) => (r === null ? null : Math.max(0, r - 1)));
    } catch {
      toast({
        title: 'Erro de ligação',
        description: 'Tenta novamente em instantes.',
      });
    } finally {
      setAAnalisar(false);
    }
  }

  if (user.role === 'cliente') return null;

  const semSaldo = restantes === 0;

  return (
    <div className="overflow-hidden rounded-3xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-purple-50 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-purple-600 text-white">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-bold text-slate-900">
              Analisar o meu perfil com IA
            </p>
            <p className="text-xs text-slate-500">
              Recebe uma nota 0-10 e sugestões concretas para vender mais.
              {restantes !== null && ` (${restantes} de 3 hoje)`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(aberta || analise) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAberta(false);
                setAnalise(null);
              }}
              aria-label="Fechar análise"
              className="h-9 px-2 text-slate-400 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
          <Button
            onClick={() => {
              setAberta(true);
              if (!analise) void analisar();
            }}
            disabled={aAnalisar || semSaldo}
            className="h-10 bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:brightness-110 disabled:opacity-50"
          >
            {aAnalisar ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> A analisar…
              </>
            ) : semSaldo ? (
              'Limite diário atingido'
            ) : (
              <>
                <TrendingUp className="mr-2 h-4 w-4" />
                {analise ? 'Analisar de novo' : 'Analisar agora'}
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Resultado */}
      {aberta && analise && (
        <div className="border-t border-blue-100 bg-white/70 px-6 py-5">
          <div className="flex items-center gap-4">
            <NotaRing nota={analise.nota} />
            <p className="text-sm leading-relaxed text-slate-700">
              {analise.resumo || 'Aqui está a análise do teu perfil.'}
            </p>
          </div>

          {analise.pontos_fortes.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-bold uppercase tracking-wide text-teal-700">
                Pontos fortes
              </p>
              <ul className="mt-1.5 space-y-1">
                {analise.pontos_fortes.map((p, i) => (
                  <li key={i} className="flex gap-2 text-sm text-slate-700">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analise.pontos_a_melhorar.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-bold uppercase tracking-wide text-blue-700">
                Podes melhorar
              </p>
              <ul className="mt-1.5 space-y-1">
                {analise.pontos_a_melhorar.map((p, i) => (
                  <li key={i} className="flex gap-2 text-sm text-slate-700">
                    <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-4 border-t border-slate-100 pt-3 text-[11px] text-slate-400">
            Dica: atualiza a tua bio e as palavras-chave dos produtos antes de
            analisar de novo — a IA avalia o perfil atual.
          </p>
        </div>
      )}
    </div>
  );
}
