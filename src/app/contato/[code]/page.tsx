'use client';

/**
 * GOMBUONE — /contato/[code] — resolver CÓDIGO DE CONTACTO.
 *
 * Quem recebe um código CONTATO-XXXXXX (num post, WhatsApp, Instagram)
 * abre este URL: a página resolve o código e encaminha para o perfil
 * público do vendedor (/portfolio/[username]). Sem expor telefone.
 */

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Loader2, SearchX } from 'lucide-react';

export default function ContatoCodePage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const code = decodeURIComponent(String(params?.code ?? ''));

  const [state, setState] = useState<'resolving' | 'not-found' | 'error'>(
    'resolving'
  );
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    let active = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/contact/${encodeURIComponent(code.toUpperCase())}`,
          { cache: 'no-store' }
        );
        const data = (await res.json()) as { username?: string; error?: string };
        if (!active) return;
        if (res.ok && data.username) {
          router.replace(`/portfolio/${encodeURIComponent(data.username)}`);
        } else {
          setState('not-found');
        }
      } catch {
        if (active) setState('error');
      }
    })();

    return () => {
      active = false;
    };
  }, [code, router]);

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center px-4 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-purple-600 shadow-lg">
        {state === 'resolving' ? (
          <Loader2 className="h-7 w-7 animate-spin text-white" />
        ) : (
          <SearchX className="h-7 w-7 text-white" />
        )}
      </div>

      {state === 'resolving' && (
        <>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            A resolver o código de contacto…
          </h1>
          <p className="mt-2 font-mono text-sm text-blue-600 dark:text-blue-400">
            {code.toUpperCase()}
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Vamos levar-te ao perfil do vendedor num instante.
          </p>
        </>
      )}

      {state === 'not-found' && (
        <>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            Código não encontrado
          </h1>
          <p className="mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">
            O código <span className="font-mono">{code.toUpperCase()}</span> não
            corresponde a nenhum vendedor activo. Confirma-o com quem to enviou —
            um carácter trocado já não resolve.
          </p>
          <Link
            href="/publicacoes"
            className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-md transition-colors hover:bg-blue-700"
          >
            Ver Publicações <ArrowRight className="h-4 w-4" />
          </Link>
        </>
      )}

      {state === 'error' && (
        <>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            Não foi possível resolver agora
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Verifica a tua ligação e tenta abrir o link novamente.
          </p>
        </>
      )}
    </main>
  );
}
