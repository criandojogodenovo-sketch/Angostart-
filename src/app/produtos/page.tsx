import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import CatalogClient from "@/components/CatalogClient";

export const metadata = {
  title: "Produtos — AngoStart",
  description:
    "Catálogo completo AngoStart: infoprodutos, produtos físicos, serviços ao domicílio e serviços remotos. Preços em Kwanzas.",
};

export default function ProdutosPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center gap-3 py-32 text-slate-400">
          <Loader2 className="h-7 w-7 animate-spin text-blue-600" />
          <span className="text-sm">A carregar o catálogo…</span>
        </div>
      }
    >
      <CatalogClient />
    </Suspense>
  );
}
