/**
 * Teste: base de conhecimento do chatbot de IA (lib/ai/knowledge.ts).
 *
 * Garante que o system prompt menciona TODAS as funcionalidades do
 * produto — se um dia uma feature deixar de existir ou aparecer outra,
 * este teste obriga a manter a IA informada.
 *
 * Executar: bun run scripts/test-ai-knowledge.ts
 */

import { AI_SUPPORT_SYSTEM_PROMPT as P } from '../src/lib/ai/knowledge';

let failed = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    console.error(`  ❌ ${name}`);
    failed++;
  }
}

console.log('— Base de conhecimento da IA (system prompt) —');

/* Publicações (feed social) */
check('menciona as Publicações (/publicacoes)', P.includes('/publicacoes') && /PUBLICAÇÕES/i.test(P));
check('explica gostos e comentários', P.includes('«Gostar»') && P.includes('comentários'));
check('explica o código de contacto', P.includes('CONTATO-') && P.includes('/contato/'));
check('explica a privacidade (sem telefone nos posts)', P.includes('sem números de telefone'));

/* Pedidos no Ar + aceitação única */
check('menciona os Pedidos no Ar (/pedidos)', P.includes('/pedidos'));
check('explica a ACEITAÇÃO ÚNICA', /ACEITAÇÃO ÚNICA/i.test(P) && P.includes('Pedido já aceite por outro prestador'));
check('lista estados aberto → aceite → concluído', P.includes('aberto → aceite → concluído'));

/* Contactos + Estabelecimentos */
check('explica o fluxo «Entrar em Contacto» (Airbnb/Booking)', /ENTRAR EM CONTACTO/i.test(P) && P.includes('Ir para Chat'));
check('explica o bloqueio de contactos externos (privacidade)', P.includes('PRIVACIDADE') && P.includes('chat interno'));
check('menciona os Estabelecimentos (/estabelecimentos)', P.includes('/estabelecimentos'));

/* Keywords */
check('explica as keywords (até 10, 30 caracteres)', P.includes('10 por produto') && P.includes('30 caracteres'));
check('explica o anti-spam e o boost na busca', P.includes('anti-spam') && P.includes('busca'));

/* Comissões */
check('explica as comissões (5% / 10% / 6,5%)', P.includes('5%') && P.includes('10%') && P.includes('6,5%'));
check('explica o teto de 50% e a auditoria', P.includes('50%') && P.includes('auditoria'));
check('explica os afiliados (10%, 30 dias)', P.includes('afiliados') && P.includes('30 dias'));

/* Restantes features */
check('explica a carteira (limites Kz + escrow)', P.includes('200 000 Kz') && P.includes('Escrow'));
check('explica os métodos de pagamento (KWiK/PayPay/Multicaixa Express)', P.includes('KWiK') && P.includes('PayPay') && P.includes('Multicaixa Express'));
check('explica o KYC/selo azul e a tolerância de 30 dias', P.includes('selo azul') && P.includes('30 dias'));
check('explica os infoprodutos (e-books com download)', P.includes('e-books'));
check('explica prestadores, portfólio e disputas', P.includes('/prestadores') && P.includes('disputa'));
check('explica lojas, gamificação, push e PWA', P.includes('Mini-loja') && P.includes('gamificação') && P.includes('push') && P.includes('PWA'));

/* Regras de segurança intactas */
check('mantém as REGRAS INEGOCIÁVEIS', P.includes('REGRAS INEGOCIÁVEIS'));
check('nunca pede senha/códigos/cartão', P.includes('NUNCA peças nem aceites'));
check('indica o suporte humano (email + WhatsApp)', P.includes('geral@angostart.ao') && P.includes('+244 958 176 915'));
check('responde em português de Angola, curto', P.includes('português de Angola'));

console.log(
  failed === 0
    ? '\n✅ Todos os checks da base de conhecimento passaram.'
    : `\n❌ ${failed} check(s) falharam — atualiza lib/ai/knowledge.ts.`
);
process.exit(failed === 0 ? 0 : 1);
