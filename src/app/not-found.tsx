import Link from 'next/link';
import EmptyIllustration from '@/components/illustrations/EmptyIllustration';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center px-4 py-20 text-center">
      <EmptyIllustration className="h-44 w-44" />
      <p className="mt-6 text-sm font-semibold uppercase tracking-wider text-blue-600">
        Erro 404
      </p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900">
        Esta página fugiu da caixa
      </h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-500 sm:text-base">
        O endereço que procuras não existe ou foi movido. Volta à página
        inicial e continua a explorar produtos, lojas e profissionais de
        confiança em Kwanzas.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/"
          className="inline-flex h-11 items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-6 text-sm font-semibold text-white shadow-lg shadow-blue-600/25 transition-all hover:shadow-xl hover:brightness-110"
        >
          Voltar ao início
        </Link>
        <Link
          href="/produtos"
          className="inline-flex h-11 items-center justify-center rounded-xl bg-gray-100 px-6 text-sm font-semibold text-slate-700 transition hover:bg-gray-200"
        >
          Ver produtos
        </Link>
      </div>
    </main>
  );
}
