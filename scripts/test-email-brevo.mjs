/**
 * AngoStart — Teste de envio de email via Brevo.
 *
 * Uso (depois de gerar a API Key no painel Brevo):
 *   BREVO_API_KEY=xkeysib-... node scripts/test-email-brevo.mjs [destinatario]
 *
 * Sem BREVO_API_KEY definida (no ambiente ou no .env), mostra as instruções
 * de configuração e sai com erro — não faz nenhum pedido à API.
 *
 * O remetente é criandojogodenovo@gmail.com (ou EMAIL_FROM do .env) e TEM
 * de estar verificado no painel Brevo → Senders & IP, senão a API devolve
 * erro 400 ("sender not confirmed").
 */
import { readFileSync } from 'node:fs';
import { BrevoClient } from '@getbrevo/brevo';

/* Carrega o .env da raiz (sem dependências externas). */
try {
  const conteudo = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  for (const linha of conteudo.split('\n')) {
    const m = linha.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {
  /* .env ausente — segue apenas com as variáveis do ambiente. */
}

const apiKey = process.env.BREVO_API_KEY;
const to = process.argv[2] || process.env.ADMIN_EMAIL || 'hellyposk@gmail.com';
const fromEmail =
  process.env.EMAIL_FROM?.match(/<([^>]+)>/)?.[1] ||
  process.env.EMAIL_FROM ||
  'criandojogodenovo@gmail.com';

if (!apiKey) {
  console.error('❌ BREVO_API_KEY não definida — configura primeiro:');
  console.error('');
  console.error('   1. Cria a conta grátis em https://app.brevo.com (300 emails/dia).');
  console.error('   2. Confirma o teu email junto à Brevo (email de verificação).');
  console.error('   3. Painel → Senders, Documents & IP → Senders → verifica');
  console.error('      criandojogodenovo@gmail.com como remetente (clica no link que eles enviam).');
  console.error('   4. Painel → SMTP & API → API Keys → Generate new key (v3).');
  console.error('   5. Corre o teste:');
  console.error('');
  console.error('      BREVO_API_KEY=xkeysib-... node scripts/test-email-brevo.mjs hellyposk@gmail.com');
  console.error('');
  console.error('   6. Com a chave a funcionar, adiciona-a à Vercel (Settings → Environment');
  console.error('      Variables → BREVO_API_KEY) e faz Redeploy.');
  process.exit(1);
}

console.log(`A enviar email de teste via Brevo…`);
console.log(`  de: ${fromEmail}`);
console.log(`  para: ${to}`);

const brevo = new BrevoClient({ apiKey, timeoutInSeconds: 15 });

try {
  const res = await brevo.transactionalEmails.sendTransacEmail({
    sender: { email: fromEmail, name: 'AngoStart' },
    to: [{ email: to }],
    subject: 'Teste de email — AngoStart (Brevo)',
    htmlContent: `
      <div style="font-family:Segoe UI,Arial,sans-serif;padding:24px;background:#f1f5f9">
        <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;border:1px solid #e2e8f0">
          <h2 style="margin:0 0 8px;color:#0f172a">Ango<span style="color:#10b981">Start</span></h2>
          <p style="color:#0f172a">✅ Este email foi enviado via <strong>Brevo</strong> —
          a integração de email da AngoStart está a funcionar.</p>
          <p style="color:#64748b;font-size:13px">Se recebeste esta mensagem na caixa de entrada
          (não no spam), a recuperação de senha, os códigos de admin e as notificações de
          encomendas chegarão corretamente a qualquer destinatário.</p>
        </div>
      </div>`,
  });
  console.log('✅ Email aceite pela Brevo:', res.messageId ?? res.messageIds);
  console.log(`   Verifica a caixa de entrada de ${to} — se não chegar em ~2 min, olha o spam.`);
  process.exit(0);
} catch (err) {
  console.error('❌ Falha no envio via Brevo:');
  console.error('   status:', err.statusCode ?? '(sem status)');
  console.error('   mensagem:', err.message);
  if (err.body) console.error('   detalhes:', JSON.stringify(err.body, null, 2));
  if (err.statusCode === 401) {
    console.error('   → A chave é inválida. Gera uma nova em SMTP & API → API Keys.');
  } else if (err.statusCode === 400 && /sender/i.test(JSON.stringify(err.body ?? ''))) {
    console.error('   → O remetente não está verificado. Confirma criandojogodenovo@gmail.com');
    console.error('     em Senders, Documents & IP → Senders (clica no email de verificação).');
  }
  process.exit(1);
}
