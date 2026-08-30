import 'server-only';
import { BrevoClient } from '@getbrevo/brevo';
import { getEnv, getAppUrl } from '@/lib/env';
import { formatKz } from '@/lib/format';
import {
  isManualTransferMethod,
  PAYMENT_METHOD_LABELS,
} from '@/lib/payments-manual';

/**
 * AngoStart — Notificações por email (Brevo, ex-Sendinblue).
 *
 * ⚠️ SERVER-ONLY: a BREVO_API_KEY vive exclusivamente no servidor
 * (`.env` em dev / Environment Variables da Vercel) e NUNCA entra
 * no bundle do cliente — garantido pelo módulo `server-only`.
 *
 * Porquê Brevo? O Resend em modo testing só permitia enviar para o email
 * da conta (erro 403). O Brevo (plano grátis, 300 emails/dia) envia para
 * QUALQUER destinatário sem precisar de domínio verificado — basta o
 * remetente estar confirmado no painel (Senders & IP).
 *
 * Sem BREVO_API_KEY configurada, os envios tornam-se no-ops registados
 * na consola (modo dev) — a app nunca falha por causa do email.
 */

/**
 * Remetente por omissão: o email da conta Brevo (criandojogodenovo@gmail.com),
 * que tem de estar VERIFICADO no painel Brevo → Senders & IP.
 * Pode ser overridden com EMAIL_FROM («AngoStart <conta@dominio.ao>» ou só o email).
 */
const FROM_EMAIL_DEFAULT = 'criandojogodenovo@gmail.com';
const FROM_NAME_DEFAULT = 'AngoStart';

function resolveSender(emailFrom?: string): { email: string; name: string } {
  const raw = (emailFrom ?? '').trim();
  if (!raw) return { email: FROM_EMAIL_DEFAULT, name: FROM_NAME_DEFAULT };
  /* Suporta o formato «Nome <email@dominio>» ou apenas «email@dominio». */
  const comNome = raw.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (comNome) {
    return {
      name: comNome[1].trim().replace(/^["']|["']$/g, '') || FROM_NAME_DEFAULT,
      email: comNome[2].trim(),
    };
  }
  return { email: raw, name: FROM_NAME_DEFAULT };
}

interface MailInput {
  to: string | string[];
  subject: string;
  html: string;
}

/** Cliente Brevo partilhado (a chave é constante por processo). */
let brevoClient: BrevoClient | null = null;

/** Envio base (exportado para casos pontuais fora dos templates). */
export async function sendMail({ to, subject, html }: MailInput): Promise<boolean> {
  let apiKey: string | undefined;
  let sender: { email: string; name: string };
  try {
    const env = getEnv();
    apiKey = env.BREVO_API_KEY;
    sender = resolveSender(env.EMAIL_FROM);
  } catch {
    console.error('[email] Variáveis de ambiente inválidas — email não enviado.');
    return false;
  }

  if (!apiKey) {
    console.log(
      `[email] BREVO_API_KEY ausente — modo dev. Email não enviado:\n` +
        `  para: ${Array.isArray(to) ? to.join(', ') : to}\n  assunto: ${subject}`
    );
    return false;
  }

  try {
    if (!brevoClient) {
      brevoClient = new BrevoClient({ apiKey, timeoutInSeconds: 15 });
    }
    const destinatarios = (Array.isArray(to) ? to : [to])
      .filter(Boolean)
      .map((email) => ({ email }));
    if (destinatarios.length === 0) return false;

    const resultado = await brevoClient.transactionalEmails.sendTransacEmail({
      sender,
      to: destinatarios,
      subject,
      htmlContent: html,
    });
    const id = resultado.messageId ?? resultado.messageIds?.join(', ') ?? 'ok';
    console.log(`[email] Enviado via Brevo (messageId: ${id}).`);
    return true;
  } catch (error) {
    console.error('[email] Falha ao enviar via Brevo:', error);
    return false;
  }
}

/* ──────────────────────────── Templates ───────────────────────────── */

function layout(title: string, bodyHtml: string): string {
  return `
  <div style="font-family:Segoe UI,Arial,sans-serif;background:#f1f5f9;padding:24px">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
      <div style="background:#0f172a;padding:20px 24px">
        <span style="color:#ffffff;font-size:20px;font-weight:bold">Ango<span style="color:#10b981">Start</span></span>
      </div>
      <div style="padding:24px;color:#0f172a">
        <h1 style="margin:0 0 12px;font-size:18px">${title}</h1>
        ${bodyHtml}
      </div>
      <div style="padding:16px 24px;background:#f8fafc;color:#64748b;font-size:12px">
        © ${new Date().getFullYear()} AngoStart — Marketplace angolano · ${getAppUrl()}
      </div>
    </div>
  </div>`;
}

function orderItemsTable(items: { name: string; quantity: number; price_kz: number }[]): string {
  const rows = items
    .map(
      (i) =>
        `<tr><td style="padding:6px 0">${i.quantity}× ${i.name}</td>` +
        `<td style="padding:6px 0;text-align:right">${formatKz(i.quantity * i.price_kz)}</td></tr>`
    )
    .join('');
  return `<table style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>`;
}

/* ─────────────────────── Notificações de encomenda ─────────────────── */

interface OrderEmailPayload {
  orderId: number;
  customerName: string;
  customerEmail?: string | null;
  customerPhone: string;
  totalKz: number;
  items: { name: string; quantity: number; price_kz: number }[];
  /** 'kwik' | 'paypay' | 'multicaixa_express' | 'whatsapp' | 'carteira'… */
  paymentMethod?: string;
  /** Referência do pedido (ex.: AngoStart-ORD-00042). */
  reference?: string;
  /** true se o cliente já anexou o comprovativo. */
  proofAttached?: boolean;
}

/** Email de confirmação para o cliente + aviso "novo pedido" aos vendedores. */
export async function sendOrderNotifications(
  order: OrderEmailPayload,
  sellerEmails: string[]
): Promise<void> {
  const linhas = orderItemsTable(order.items);
  const manualMethod = isManualTransferMethod(order.paymentMethod)
    ? order.paymentMethod
    : null;
  const methodLabel = manualMethod
    ? PAYMENT_METHOD_LABELS[manualMethod]
    : null;
  const referencia = order.reference ?? `AngoStart-ORD-${String(order.orderId).padStart(5, '0')}`;

  const instrucoesKwik = manualMethod && methodLabel
    ? `<div style="margin:12px 0;padding:14px;border:1px solid #10b981;border-radius:12px;background:#ecfdf5">
         <p style="margin:0 0 8px;font-weight:bold;color:#065f46">Pagamento ${methodLabel} — Transferência</p>
         <p style="margin:0;font-size:14px;line-height:1.6">
           1. Transfere <strong>${formatKz(order.totalKz)}</strong> para
           <strong>+244 958 176 915</strong> (${methodLabel}).<br/>
           2. Indica na descrição a referência
           <strong>${referencia}</strong>.<br/>
           3. Anexa o comprovativo no site (ou responde a este email).
         </p>
         <p style="margin:8px 0 0;font-size:13px;color:#047857">
           ${order.proofAttached
             ? '✓ Comprovativo já recebido — a tua encomenda está a aguardar validação da equipa.'
             : 'Assim que anexares o comprovativo, a equipa valida e a entrega é preparada.'}
         </p>
       </div>`
    : '';

  if (order.customerEmail) {
    await sendMail({
      to: order.customerEmail,
      subject: `Encomenda n.º ${order.orderId} registada — AngoStart`,
      html: layout(
        'Obrigado pela tua encomenda!',
        `<p>Olá ${order.customerName},</p>
         <p>A tua encomenda <strong>n.º ${order.orderId}</strong> foi registada com sucesso
         (referência <strong>${referencia}</strong>).</p>
         ${linhas}
         <p style="margin-top:12px"><strong>Total: ${formatKz(order.totalKz)}</strong></p>
         ${instrucoesKwik}
         <p>Iremos contactar-te pelo telefone <strong>${order.customerPhone}</strong> para combinar a entrega.</p>`
      ),
    });
  }

  const validSellers = sellerEmails.filter(Boolean);
  if (validSellers.length > 0) {
    await sendMail({
      to: validSellers,
      subject: `Novo pedido recebido — encomenda n.º ${order.orderId}`,
      html: layout(
        'Tens um novo pedido!',
        `<p>Uma encomenda que inclui os teus produtos/serviços foi registada.</p>
         <p><strong>Encomenda:</strong> n.º ${order.orderId} (${referencia})<br/>
         <strong>Cliente:</strong> ${order.customerName} (${order.customerPhone})<br/>
         <strong>Pagamento:</strong> ${
           manualMethod && methodLabel
             ? `${methodLabel} — aguarda validação do comprovativo`
             : order.paymentMethod === 'carteira'
               ? 'pago com o saldo da carteira (escrow até entrega)'
               : 'a combinar pelo WhatsApp'
         }</p>
         ${linhas}
         <p style="margin-top:12px">Entra no teu <a href="${getAppUrl()}/dashboard/vendedor">painel de vendas</a> para ver os detalhes.</p>`
      ),
    });
  }
}

/** Confirmação de aprovação de comprovativo (validação admin). */
export async function sendOrderValidatedEmail(
  orderId: number,
  customerEmail: string | null | undefined,
  approved: boolean
): Promise<void> {
  if (!customerEmail) return;

  /* ── Ponto 3 do fluxo de e-books: após o admin validar (status `pago`),
   * o email ao cliente traz os LINKS DE DOWNLOAD dos infoprodutos —
   * a libertação no perfil também acontece (gated por status pago). ── */
  let downloadSection = '';
  if (approved) {
    try {
      const { sql } = await import('@/lib/db');
      const ebooks = (await sql`
        SELECT DISTINCT ON (p.id) p.id, p.name
        FROM orders o,
             jsonb_array_elements(o.items) item
        JOIN products p ON p.id = (item->>'id')::int
        WHERE o.id = ${orderId}
          AND p.type = 'infoproduto'
          AND p.file_url IS NOT NULL
      `) as unknown as { id: number; name: string }[];

      if (ebooks.length > 0) {
        const links = ebooks
          .map(
            (b) =>
              `<li style="margin:8px 0"><a href="${getAppUrl()}/api/products/${b.id}/download"
                 style="color:#059669;font-weight:600">${b.name}</a></li>`
          )
          .join('');
        downloadSection = `
          <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;padding:16px;margin:16px 0">
            <p style="margin:0 0 8px;font-weight:700;color:#065f46">📚 Os teus downloads estão prontos:</p>
            <ul style="margin:0;padding-left:20px">${links}</ul>
            <p style="margin:10px 0 0;font-size:13px;color:#047857">
              O link abre a tua conta AngoStart para descarregar com segurança.
            </p>
          </div>`;
      }
    } catch (ebookError) {
      console.error('[email] Secção de downloads falhou (não crítico):', ebookError);
    }
  }

  await sendMail({
    to: customerEmail,
    subject: approved
      ? `Encomenda n.º ${orderId} aprovada — AngoStart`
      : `Encomenda n.º ${orderId} rejeitada — AngoStart`,
    html: layout(
      approved ? 'O teu comprovativo foi aprovado!' : 'O teu comprovativo foi rejeitado',
      approved
        ? `<p>A encomenda <strong>n.º ${orderId}</strong> foi validada pela nossa equipa.
           O vendedor já foi notificado para preparar a entrega.</p>${downloadSection}`
        : `<p>Infelizmente o comprovativo da encomenda <strong>n.º ${orderId}</strong>
           não foi validado. Contacta-nos pelo chat para esclarecer.</p>`
    ),
  });
}

/* ──────────────────────────── Carteira (Fase 4) ────────────────────── */

/**
 * Alerta ao ADMIN quando um utilizador pede depósito ou saque.
 * Melhor-esforço: falha de envio nunca bloqueia a operação.
 */
export async function sendWalletRequestAlert(
  tipo: 'deposito' | 'saque',
  referencia: string,
  valorKz: number,
  userName: string | null,
  userEmail: string | null
): Promise<boolean> {
  let to: string | undefined;
  try {
    to = getEnv().ADMIN_EMAIL;
  } catch {
    return false;
  }
  if (!to) return false;

  const label = tipo === 'deposito' ? 'Depósito' : 'Saque';
  return sendMail({
    to,
    subject: `${label} ${referencia} pendente — AngoStart`,
    html: layout(
      `Novo pedido de ${label.toLowerCase()} na carteira`,
      `<p><strong>${userName ?? userEmail ?? 'Utilizador'}</strong> pediu um
       ${label.toLowerCase()} de <strong>${formatKz(valorKz)}</strong>
       (referência <strong>${referencia}</strong>).</p>
       <p>Aprova ou rejeita no painel de administração → separador
       <strong>Carteira</strong>.</p>`
    ),
  });
}

/** Resultado da decisão do admin sobre depósito/saque (para o utilizador). */
export async function sendWalletDecisionEmail(
  to: string,
  tipo: 'deposito' | 'saque',
  approved: boolean,
  valorKz: number,
  referencia: string
): Promise<boolean> {
  const label = tipo === 'deposito' ? 'Depósito' : 'Saque';
  const title = approved
    ? `${label} aprovado — AngoStart`
    : `${label} recusado — AngoStart`;
  const body = approved
    ? tipo === 'deposito'
      ? `<p>O teu depósito <strong>${referencia}</strong> de
         <strong>${formatKz(valorKz)}</strong> foi confirmado — o valor já está
         disponível no saldo da tua carteira.</p>`
      : `<p>O teu saque <strong>${referencia}</strong> de
         <strong>${formatKz(valorKz)}</strong> foi aprovado. O valor será enviado
         para o teu número via Afrimoney / UNITEL Money em breve.</p>`
    : tipo === 'deposito'
      ? `<p>O depósito <strong>${referencia}</strong> de
         <strong>${formatKz(valorKz)}</strong> não foi confirmado. Se transferiste,
         responde a este email com o comprovativo.</p>`
      : `<p>O pedido de saque <strong>${referencia}</strong> de
         <strong>${formatKz(valorKz)}</strong> foi recusado — o valor já foi
         devolvido ao teu saldo disponível.</p>`;

  return sendMail({ to, subject: title, html: layout(title, body) });
}

/** Alerta genérico ao ADMIN (anti-burla, monitorização, sistema). */
export async function sendAdminAlertEmail(
  subject: string,
  htmlBody: string
): Promise<boolean> {
  let to: string | undefined;
  try {
    to = getEnv().ADMIN_EMAIL;
  } catch {
    return false;
  }
  if (!to) return false;
  return sendMail({ to, subject: `${subject} — AngoStart`, html: layout(subject, htmlBody) });
}

/* ───────────────────────────── Disputas (Fase 6) ────────────────────────── */

/** Notifica as partes do resultado de uma disputa (Fase 6, ponto 7). */
export async function sendDisputeDecisionEmail(
  to: string,
  orderId: number,
  favorCliente: boolean,
  resolutionNote: string
): Promise<boolean> {
  const title = favorCliente
    ? `Disputa da encomenda #${orderId} — resolvida a teu favor`
    : `Disputa da encomenda #${orderId} — resolvida`;

  const body = favorCliente
    ? `<p>A tua disputa sobre a encomenda <strong>#${orderId}</strong> foi
       analisada pela equipa AngoStart e <strong>resolvida a teu favor</strong>:
       o valor da encomenda foi devolvido ao saldo da tua carteira.</p>`
    : `<p>A disputa sobre a encomenda <strong>#${orderId}</strong> foi analisada
       pela equipa AngoStart e <strong>resolvida a favor do vendedor</strong>.
       Os valores retidos em escrow foram libertados para o vendedor.</p>`;

  const note = resolutionNote
    ? `<div style="margin:12px 0;padding:14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;color:#065f46">
         <strong>Nota da equipa:</strong> ${resolutionNote}
       </div>`
    : '';

  return sendMail({
    to,
    subject: `${title} — AngoStart`,
    html: layout('Resultado da disputa', `${body}${note}`),
  });
}

/* ────────────────────────────── Chat (Fase 5) ────────────────────────── */

/** Notifica um utilizador que recebeu uma nova mensagem no chat. */
export async function sendChatNotificationEmail(
  to: string,
  senderName: string,
  preview: string,
  link: string
): Promise<boolean> {
  return sendMail({
    to,
    subject: `${senderName} enviou-te uma mensagem — AngoStart`,
    html: layout(
      'Tens uma nova mensagem',
      `<p><strong>${senderName}</strong> escreveu-te no chat da AngoStart:</p>
       <div style="margin:12px 0;padding:14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;color:#065f46">
         ${preview.slice(0, 300)}
       </div>
       <p><a href="${link}" style="color:#059669;font-weight:bold">Responde no chat →</a></p>
       <p style="font-size:13px;color:#64748b">Mantém toda a negociação dentro da plataforma
       — é o que garante a tua proteção na AngoStart.</p>`
    ),
  });
}

/* ──────────────────────── Recuperação de senha (Fase 5) ──────────────── */

/** Email com link de redefinição de senha (token de 1 h). */
export async function sendPasswordResetEmail(
  to: string,
  resetLink: string
): Promise<boolean> {
  return sendMail({
    to,
    subject: 'Recuperação de senha — AngoStart',
    html: layout(
      'Recupera a tua senha',
      `<p>Recebemos um pedido para redefinir a senha da tua conta.</p>
       <p><a href="${resetLink}" style="display:inline-block;background:#10b981;color:#fff;
          padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:bold">
          Redefinir senha</a></p>
       <p style="font-size:13px;color:#64748b">O link expira em 2 horas e só funciona uma vez.
       Se pediste mais do que um link, usa apenas o deste email (o mais recente) — os anteriores
       deixam de valer. Se não foste tu, ignora este email — a tua senha continua igual.</p>`
    ),
  });
}

/* ─────────────────────── Administração dinâmica ────────────────────── */

/**
 * Email de CONVITE para admin limitado: código de 8 caracteres (24 h) +
 * link do painel oculto. O código só é usado uma vez, na criação da conta.
 */
export async function sendAdminInviteEmail(
  to: string,
  name: string | null,
  code: string,
  expiresAt: Date
): Promise<boolean> {
  const horas = Math.max(
    1,
    Math.round((expiresAt.getTime() - Date.now()) / (60 * 60 * 1000))
  );
  return sendMail({
    to,
    subject: 'Convite para Administração Limitada — AngoStart',
    html: layout(
      'Foste convidado para a equipa de validação',
      `<p>Olá ${name || ''},</p>
       <p>Foste convidado(a) para <strong>Administrador Limitado</strong> da AngoStart
       — vais validar comprovativos de pagamento KWiK no painel de validação.</p>
       <div style="margin:14px 0;padding:16px;border:2px dashed #10b981;border-radius:12px;background:#ecfdf5;text-align:center">
         <p style="margin:0 0 6px;font-size:12px;color:#065f46;font-weight:bold">CÓDIGO DE CONVITE (expira em ${horas} h)</p>
         <p style="margin:0;font-size:28px;letter-spacing:6px;font-weight:bold;color:#065f46">${code}</p>
       </div>
       <p><strong>Como ativar a conta (só a primeira vez):</strong></p>
       <p style="line-height:1.7">
         1. Abre <strong>${getAppUrl()}/admin-limitado</strong><br/>
         2. Escolhe <em>“Primeiro acesso”</em> e introduz o teu email + o código acima<br/>
         3. Lê o QR do 2FA com a app autenticadora (obrigatório)<br/>
         4. Valida o código TOTP — a conta fica ativa
       </p>
       <p style="margin-top:12px;font-size:13px;color:#64748b">
         Todos os dias receberás um <strong>código diário</strong> de 6 dígitos neste email —
         é ele + o 2FA que te dá acesso ao painel. Não há palavra-passe fixa.
       </p>`
    ),
  });
}

/** Email do CÓDIGO DIÁRIO (6 dígitos) para um admin limitado ativo. */
export async function sendDailyCodeEmail(
  to: string,
  code: string,
  expiresAt: Date
): Promise<boolean> {
  const horas = Math.max(
    1,
    Math.ceil((expiresAt.getTime() - Date.now()) / (60 * 60 * 1000))
  );
  return sendMail({
    to,
    subject: 'Código diário de acesso — AngoStart',
    html: layout(
      'O teu código de acesso de hoje',
      `<p>Olá,</p>
       <p>Usa este código de 6 dígitos para entrar no painel de validação
       (<strong>${getAppUrl()}/admin-limitado</strong>) — a seguir, introduz o
       código TOTP da tua app autenticadora.</p>
       <div style="margin:14px 0;padding:16px;border:2px dashed #10b981;border-radius:12px;background:#ecfdf5;text-align:center">
         <p style="margin:0 0 6px;font-size:12px;color:#065f46;font-weight:bold">CÓDIGO DIÁRIO (expira em ${horas} h · uso único)</p>
         <p style="margin:0;font-size:32px;letter-spacing:8px;font-weight:bold;color:#065f46">${code}</p>
       </div>
       <p style="font-size:13px;color:#64748b">Se não foste tu que pediste o acesso, ignora este email
       e avisa o administrador — o código só funciona uma vez e expira hoje.</p>`
    ),
  });
}

/* ──────────────────────── Propostas (Fase 7) ─────────────────────────── */

const kz = (v: number) => `${new Intl.NumberFormat('pt-AO').format(v)} Kz`;

/** Notifica o vendedor/prestador de uma nova proposta recebida (Fase 7). */
export async function sendNewProposalEmail(
  to: string,
  clientName: string,
  serviceName: string,
  priceKz: number,
  deadlineDays: number | null,
  link: string
): Promise<boolean> {
  return sendMail({
    to,
    subject: `Nova proposta de ${clientName} (${kz(priceKz)}) — AngoStart`,
    html: layout(
      'Recebeste uma nova proposta',
      `<p>O cliente <strong>${clientName}</strong> enviou-te uma proposta
       para <strong>${serviceName}</strong>:</p>
       <div style="margin:12px 0;padding:14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;color:#065f46">
         <p style="margin:0 0 6px"><strong>Preço proposto:</strong> ${kz(priceKz)}</p>
         ${deadlineDays ? `<p style="margin:0"><strong>Prazo:</strong> ${deadlineDays} dias</p>` : ''}
       </div>
       <p><a href="${link}" style="color:#059669;font-weight:bold">Aceitar, recusar ou contrapropor →</a></p>
       <p style="font-size:13px;color:#64748b">Responde rapidamente — propostas com resposta
       rápida aumentam a confiança dos clientes.</p>`,
    ),
  });
}

/** Confirma a aceitação de uma proposta com os detalhes da negociação (Fase 7). */
export async function sendProposalAcceptedEmail(
  to: string,
  role: 'cliente' | 'vendedor',
  serviceName: string,
  priceKz: number,
  deadlineDays: number | null,
  orderId: number,
  link: string
): Promise<boolean> {
  return sendMail({
    to,
    subject: `Proposta aceite — pedido #${orderId} criado — AngoStart`,
    html: layout(
      'Proposta aceite — negócio fechado!',
      `<p>Os termos acordados para <strong>${serviceName}</strong> foram aceites
       ${role === 'cliente' ? 'pelo vendedor e por ti' : 'pelo cliente e por ti'}:</p>
       <div style="margin:12px 0;padding:14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;color:#065f46">
         <p style="margin:0 0 6px"><strong>Valor acordado:</strong> ${kz(priceKz)}</p>
         ${deadlineDays ? `<p style="margin:0 0 6px"><strong>Prazo acordado:</strong> ${deadlineDays} dias</p>` : ''}
         <p style="margin:0"><strong>Pedido gerado:</strong> #${orderId}</p>
       </div>
       ${
         role === 'cliente'
           ? `<p><a href="${link}" style="color:#059669;font-weight:bold">Pagar agora com KWiK e garantir o negócio →</a></p>
              <p style="font-size:13px;color:#64748b">O valor fica protegido em escrow até confirmares a entrega.</p>`
           : `<p><a href="${link}" style="color:#059669;font-weight:bold">Ver pedido no meu painel →</a></p>
              <p style="font-size:13px;color:#64748b">Aguarda o pagamento do cliente — recebe aviso assim que for validado.</p>`
       }`,
    ),
  });
}
