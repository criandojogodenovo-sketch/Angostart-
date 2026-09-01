import Link from 'next/link';

export const metadata = {
  title: 'Termos de Uso — AngoStart',
  description:
    'Termos de uso da AngoStart: regras para comprar, vender e prestar serviços na plataforma angolana.',
};

const SECTIONS: { title: string; paragraphs: string[] }[] = [
  {
    title: '1. Sobre a AngoStart',
    paragraphs: [
      'A AngoStart é um marketplace digital angolano que liga compradores a vendedores de infoprodutos, produtos físicos, serviços ao domicílio e serviços remotos. A AngoStart atua como intermediária: não é proprietária dos produtos publicados nem empregadora dos prestadores de serviços.',
      'Ao criar uma conta ou utilizar a plataforma, aceitas estes Termos de Uso. Se não concordares com alguma parte, não deves utilizar a AngoStart.',
    ],
  },
  {
    title: '2. Contas e responsabilidade',
    paragraphs: [
      'Cada utilizador pode criar uma conta com email e telefone válidos. É responsável por manter a tua palavra-passe e o código 2FA em segredo. Contas com atividades suspeitas podem ser bloqueadas temporariamente para proteção da comunidade.',
      'Vendedores e prestadores devem ser maiores de 18 anos e ter capacidade legal para celebrar contratos em Angola. Os dados de identificação (BI/NIF) fornecidos voluntarymente aumentam a confiança dos clientes.',
    ],
  },
  {
    title: '3. Pagamentos e carteira',
    paragraphs: [
      'Os pagamentos são processados por transferência manual KWiK ou pelo saldo da carteira AngoStart. Depósitos são validados pela equipa antes de entrarem no saldo; saques são processados via Afrimoney ou UNITEL Money.',
      'A carteira usa retenção (escrow): o valor pago pelo cliente é retido até a entrega ser confirmada. A AngoStart cobra uma comissão sobre vendas — 5% para criadores, 10% para prestadores ao domicílio e 6,5% para freelancers remotos — descontada automaticamente.',
      'Limites de depósito e saque aplicam-se por operação e por dia para cumprir as regras anti-lavagem.',
    ],
  },
  {
    title: '4. Negociação fora da plataforma',
    paragraphs: [
      'Partilhar contactos pessoais (email, telefone, WhatsApp) no chat para negociar fora da AngoStart é proibido. Todas as conversas são monitorizadas: tentativas repetidas levam ao bloqueio da conta.',
      'Negociar dentro da plataforma é o que garante a tua proteção: comprovativos, escrow, historial e suporte em caso de conflito.',
    ],
  },
  {
    title: '5. Conteúdos e produtos proibidos',
    paragraphs: [
      'É proibido publicar produtos ou serviços ilegais em Angola, conteúdos que violem direitos de autor, material enganoso ou fraudulentos. Infoprodutos devem ser de autoria própria ou ter licença de revenda.',
      'A AngoStart pode remover conteúdos que violem estas regras e suspender as contas responsáveis.',
    ],
  },
  {
    title: '6. Avaliações e reclamações',
    paragraphs: [
      'Só clientes com compra confirmada podem avaliar (1 a 5 estrelas). Reclamações repetidas (avaliações de 1-2 estrelas) colocam a conta do vendedor sob supervisão manual.',
      'Em caso de conflito, a equipa da AngoStart analisa as provas (comprovativos, chat, entregas) e decide a devolução ou libertação dos valores retidos.',
    ],
  },
  {
    title: '7. Alterações aos termos',
    paragraphs: [
      'Estes termos podem ser atualizados a qualquer momento. Alterações relevantes serão comunicadas por anúncio na plataforma ou email. Continuar a usar a AngoStart após uma alteração significa que a aceitas.',
    ],
  },
];

export default function TermosPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-bold text-slate-900">Termos de Uso</h1>
      <p className="mt-2 text-sm text-slate-500">
        Última atualização: Agosto 2026 · A AngoStart — marketplace angolano
      </p>

      <div className="mt-8 space-y-8">
        {SECTIONS.map((section) => (
          <section key={section.title}>
            <h2 className="text-lg font-bold text-slate-900">{section.title}</h2>
            <div className="mt-2 space-y-3">
              {section.paragraphs.map((p, i) => (
                <p key={i} className="text-sm leading-relaxed text-slate-600">
                  {p}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-10 rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
        Dúvidas sobre estes termos? Fala connosco pelo WhatsApp{' '}
        <a
          href="https://wa.me/244958176915"
          className="font-semibold text-blue-600 hover:underline"
          rel="noopener noreferrer"
          target="_blank"
        >
          +244 958 176 915
        </a>{' '}
        ou consulta a nossa{' '}
        <Link href="/privacidade" className="font-semibold text-blue-600 hover:underline">
          Política de Privacidade
        </Link>
        .
      </p>
    </article>
  );
}
