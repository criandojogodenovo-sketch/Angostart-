import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import PublicacoesClient from "@/components/PublicacoesClient";

export const metadata = {
  title: "Publicações — AngoStart",
  description:
    "Feed social da AngoStart: novidades de produtos e serviços publicadas pelos vendedores. Gosta, comenta e contacta o vendedor pelo código de contacto.",
};

export default function PublicacoesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center gap-3 py-32 text-slate-400">
          <Loader2 className="h-7 w-7 animate-spin text-blue-600" />
          <span className="text-sm">A carregar as publicações…</span>
        </div>
      }
    >
      <PublicacoesClient />
    </Suspense>
  );
}
