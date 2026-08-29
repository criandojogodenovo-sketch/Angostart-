import Link from 'next/link';

export const metadata = {
  title: 'Política de Privacidade — AngoStart',
  description:
    'Como a AngoStart recolhe, usa e protege os dados pessoais dos utilizadores da plataforma.',
};

const SECTIONS: { title: string; paragraphs: string[] }[] = [
  {
    title: '1. Que dados recolhemos',
    paragraphs: [
      'Dados de conta: nome, email, telefone e palavra-passe (guardada apenas como hash criptográfico — nunca em texto simples).',
      'Dados de perfil: bio, cidade, área de atuação, portfólio e, se quiseres aumentar a confiança dos clientes, BI/NIF (verificação simples de identidade).',
      'Dados operacionais: encomendas, movimentações da carteira, comprovativos de pagamento, mensagens do chat e avaliações.',
    ],
  },
  {
    title: '2. Como usamos os dados',
    paragraphs: [
      'Para operar a plataforma: criar encomendas, validar pagamentos KWiK, gerir a carteira com retenção (escrow), creditar comissões de afiliados e permitir o chat entre cliente e vendedor.',
      'Para comunicações essenciais: emails transacionais (confirmação de encomenda, códigos de acesso, notificações de mensagens) enviados via Resend. Nunca enviamos spam.',
      'Para segurança: monitorização de atividades suspeitas (ciclos de depósito/saque, partilha de contactos no chat, reclamações repetidas) para proteger compradores e vendedores.',
    ],
  },
  {
    title: '3. O que NUNCA fazemos',
    paragraphs: [
      'Não vendemos nem partilhamos os teus dados pessoais com terceiros para marketing.',
      'Não guardamos números de cartão nem credenciais bancárias — os pagamentos são por transferência manual KWiK ou saldo da carteira.',
      'Não expomos o teu email ou telefone público: o chat interno é o canal oficial de contacto.',
    ],
  },
  {
    title: '4. Localização (serviços ao domicílio)',
    paragraphs: [
      'Se prestas serviços ao domicílio, podes partilhar a tua localização aproximada com o botão "Estou disponível" — expira em 2 horas e podes desligar quando quiseres.',
      'Clientes podem partilhar a localização no checkout de um serviço ao domicílio. É usada apenas para a entrega e nunca aparece publicamente.',
    ],
  },
  {
    title: '5. Segurança e retenção',
    paragraphs: [
      'Usamos HTTPS em toda a plataforma, hash bcrypt para senhas, JWT com expiração, 2FA obrigatório na administração e auditoria das ações sensíveis.',
      'Mantemos os registos operacionais (encomendas, movimentações) enquanto a conta existir, para efeitos de suporte e prevenção de fraude. Podes pedir a eliminação da conta — os registos financeiros obrigatórios são conservados pelo período legal.',
    ],
  },
  {
    title: '6. Os teus direitos',
    paragraphs: [
      'Podes aceder, corrigir e pedir a eliminação dos teus dados a qualquer momento no teu perfil ou pelo WhatsApp +244 958 176 915.',
      'Podes também desativar notificações por email (exceto transacionais essenciais) e apagar a localização guardada.',
    ],
  },
];

export default function PrivacidadePage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-bold text-slate-900">Política de Privacidade</h1>
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
        Questões de privacidade? Consulta também os nossos{' '}
        <Link href="/termos" className="font-semibold text-emerald-600 hover:underline">
          Termos de Uso
        </Link>{' '}
        ou fala connosco pelo WhatsApp{' '}
        <a
          href="https://wa.me/244958176915"
          className="font-semibold text-emerald-600 hover:underline"
          rel="noopener noreferrer"
          target="_blank"
        >
          +244 958 176 915
        </a>
        .
      </p>
    </article>
  );
}
