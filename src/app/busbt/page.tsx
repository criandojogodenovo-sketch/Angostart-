import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import BusbtClient from '@/components/BusbtClient';

export const metadata = {
  title: 'Busbt — Publicidade em vídeo | AngoStart',
  description:
    'Grelha de vídeos de publicidade da comunidade AngoStart. Publica o vídeo do teu produto ou serviço (MP4, WebM, MOV até 100 MB) e aparece para milhares de clientes.',
};

export default function BusbtPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center gap-3 py-32 text-slate-400">
          <Loader2 className="h-7 w-7 animate-spin text-blue-600" />
          <span className="text-sm">A carregar a Busbt…</span>
        </div>
      }
    >
      <BusbtClient />
    </Suspense>
  );
}
