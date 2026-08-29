import 'server-only';
import { Resend } from 'resend';
import { getEnv, getAppUrl } from '@/lib/env';
import { formatKz } from '@/lib/format';

/**
 * AngoStart — Notificações por email (Resend).
 *
 * ⚠️ SERVER-ONLY: a RESEND_API_KEY vive exclusivamente no servidor
 * (`.env.local` em dev / Environment Variables da Vercel) e NUNCA entra
 * no bundle do cliente — garantido pelo módulo `server-only`.
 *
 * Sem RESEND_API_KEY configurada, os envios tornam-se no-ops registados
 * na consola (modo dev) — a app nunca falha por causa do email.
 */

const FROM_DEFAULT = 'AngoStart <onboarding@resend.dev>';

interface MailInput {
  to: string | string[];
  subject: string;
  html: string;
}

async function sendMail({ to, subject, html }: MailInput): Promise<boolean> {
  let apiKey: string | undefined;
  let from: string;
  try {
    const env = getEnv();
    apiKey = env.RESEND_API_KEY;
    from = env.EMAIL_FROM || FROM_DEFAULT;
  } catch {
    console.error('[email] Variáveis de ambiente inválidas — email não enviado.');
    return false;
  }

  if (!apiKey) {
    console.log(
      `[email] RESEND_API_KEY ausente — modo dev. Email não enviado:\n` +
        `  para: ${Array.isArray(to) ? to.join(', ') : to}\n  assunto: ${subject}`
    );
    return false;
  }

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({ from, to, subject, html });
    if (error) {
      console.error('[email] Erro do Resend:', error);
      return false;
    }
    return true;
  } catch (error) {
    console.error('[email] Falha ao enviar:', error);
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
  /** 'kwik' (transferência manual) ou 'whatsapp' (combinar com a equipa). */
  paymentMethod?: string;
  /** Referência do pedido (ex.: AngoStart-ORD-00042). */
  reference?: string;
  /** true se o cliente já anexou o comprovativo KWiK. */
  proofAttached?: boolean;
}

/** Email de confirmação para o cliente + aviso "novo pedido" aos vendedores. */
export async function sendOrderNotifications(
  order: OrderEmailPayload,
  sellerEmails: string[]
): Promise<void> {
  const linhas = orderItemsTable(order.items);
  const isKwik = order.paymentMethod !== 'whatsapp';
  const referencia = order.reference ?? `AngoStart-ORD-${String(order.orderId).padStart(5, '0')}`;

  const instrucoesKwik = isKwik
    ? `<div style="margin:12px 0;padding:14px;border:1px solid #10b981;border-radius:12px;background:#ecfdf5">
         <p style="margin:0 0 8px;font-weight:bold;color:#065f46">Pagamento KWiK — Transferência Instantânea</p>
         <p style="margin:0;font-size:14px;line-height:1.6">
           1. Transfere <strong>${formatKz(order.totalKz)}</strong> para
           <strong>+244 958 176 915</strong> (KWiK).<br/>
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
         <strong>Pagamento:</strong> ${isKwik ? 'KWiK — aguarda validação do comprovativo' : 'a combinar pelo WhatsApp'}</p>
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
  await sendMail({
    to: customerEmail,
    subject: approved
      ? `Encomenda n.º ${orderId} aprovada — AngoStart`
      : `Encomenda n.º ${orderId} rejeitada — AngoStart`,
    html: layout(
      approved ? 'O teu comprovativo foi aprovado!' : 'O teu comprovativo foi rejeitado',
      approved
        ? `<p>A encomenda <strong>n.º ${orderId}</strong> foi validada pela nossa equipa.
           O vendedor já foi notificado para preparar a entrega.</p>`
        : `<p>Infelizmente o comprovativo da encomenda <strong>n.º ${orderId}</strong>
           não foi validado. Contacta-nos pelo WhatsApp para esclarecer.</p>`
    ),
  });
}
