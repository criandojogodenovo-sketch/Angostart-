import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { sql } from '@/lib/db';
import {
  isSellerRole,
  publicUser,
  signToken,
  generateUniqueUsername,
  type SellerRole,
  type UserRow,
} from '@/lib/auth';
import { clientKey, rateLimit, sanitizeMultiline, sanitizeText, isSafeHttpUrl, getRequestIp } from '@/lib/security';
import { validatePassword, BI_REGEX, calcularIdade } from '@/lib/password';
import { isKycDocumentUrl, KYC_DOCUMENT_TYPES, type KycDocumentType } from '@/lib/kyc';
import { getOrCreateStoreForUser } from '@/lib/stores';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/register/vendedor
 * Corpo: { name, email, password, telefone, role, bi_number?, birth_date?,
 *          kyc_document_url?, kyc_document_type?,
 *          bio?, area_atuacao?, cidade?, especialidade?, portfolio_url?, ref_code? }
 * role deve ser um perfil de vendedor: criador | prestador_domicilio | prestador_remoto
 * Campos condicionais:
 *   - criador            → bio
 *   - prestador_domicilio → area_atuacao + cidade
 *   - prestador_remoto    → especialidade (+ portfolio_url opcional)
 * Fase 12 — KYC flexível orientado a fotos:
 *  - bi_number é OPCIONAL (validado no formato angolano se preenchido).
 *  - birth_date é OPCIONAL (se preenchida valida idade ≥ 15 anos —
 *    mesma regra da Fase 9; se faltar, o admin é alertado na revisão KYC).
 *  - kyc_document_url (foto do documento, BI/Passaporte/Cartão de Eleitor)
 *    é OPCIONAL e tem de vir do upload da AngoStart:
 *      · enviado   → kyc_status = 'pending'  (admin revê a foto)
 *      · não enviado → kyc_status = 'not_submitted'
 *  Em ambos os casos o vendedor pode vender normalmente — o selo azul
 *  chega após a aprovação do admin. Senha forte obrigatória. Loja
 *  virtual criada automaticamente. ref_code opcional (código de afiliado
 *  que indicou a conta).
 */
export async function POST(request: NextRequest) {
  let body: {
    name?: string;
    email?: string;
    password?: string;
    telefone?: string;
    role?: string;
    bi_number?: string;
    birth_date?: string;
    kyc_document_url?: string;
    kyc_document_type?: string;
    bio?: string;
    area_atuacao?: string;
    cidade?: string;
    especialidade?: string;
    portfolio_url?: string;
    ref_code?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Corpo do pedido inválido (JSON esperado).' },
      { status: 400 }
    );
  }

  const name = sanitizeText(body.name, 80);
  const email = body.email?.trim().toLowerCase() ?? '';
  const password = body.password ?? '';
  const telefone = body.telefone?.trim() ?? '';
  const role = body.role?.trim() ?? '';

  if (!rateLimit(clientKey(request, 'register'), 10, 60_000)) {
    return NextResponse.json(
      { error: 'Demasiadas tentativas de registo. Aguarda um minuto.' },
      { status: 429 }
    );
  }

  if (name.length < 3) {
    return NextResponse.json(
      { error: 'Indica o teu nome completo (mínimo 3 letras).' },
      { status: 400 }
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: 'Email inválido — verifica o endereço escrito.' },
      { status: 400 }
    );
  }
  if (password.length < 6) {
    return NextResponse.json(
      { error: 'A palavra-passe deve ter pelo menos 6 caracteres.' },
      { status: 400 }
    );
  }
  /* Fase 9: senha forte obrigatória (≥8, A-Z, a-z, 0-9, símbolo, não-comum). */
  const senhaForte = validatePassword(password);
  if (!senhaForte.ok) {
    return NextResponse.json({ error: senhaForte.error }, { status: 400 });
  }
  /* Fase 12: BI OPCIONAL — validado no formato angolano apenas se preenchido. */
  const biRaw = (body.bi_number ?? '').toUpperCase().replace(/[\s-]/g, '');
  if (biRaw && !BI_REGEX.test(biRaw)) {
    return NextResponse.json(
      { error: 'BI inválido — usa o formato do documento (ex.: 004587896LA038) ou deixa vazio.' },
      { status: 400 }
    );
  }

  /* Fase 12: data de nascimento OPCIONAL — se preenchida, idade ≥ 15 (regra da Fase 9). */
  const birthRaw = (body.birth_date ?? '').trim();
  if (birthRaw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthRaw) || Number.isNaN(new Date(`${birthRaw}T00:00:00Z`).getTime())) {
      return NextResponse.json(
        { error: 'Data de nascimento inválida — usa o formato AAAA-MM-DD.' },
        { status: 400 }
      );
    }
    const idade = calcularIdade(birthRaw);
    if (idade < 0 || idade > 120) {
      return NextResponse.json(
        { error: 'Data de nascimento inválida — verifica o ano.' },
        { status: 400 }
      );
    }
    if (idade < 15) {
      return NextResponse.json(
        { error: 'Idade mínima para aderir como vendedor é 15 anos' },
        { status: 400 }
      );
    }
  }

  /* Fase 12: foto do documento KYC OPCIONAL (URL do upload autorizado).
     O upload exige sessão — na prática o frontend submete após criar a
     conta; a API aceita o campo para flexibilidade (testes/integrações). */
  const kycDocUrlRaw = (body.kyc_document_url ?? '').trim();
  if (kycDocUrlRaw && !isKycDocumentUrl(kycDocUrlRaw)) {
    return NextResponse.json(
      { error: 'A foto do documento deve ser enviada pelo upload da AngoStart (/api/kyc/upload).' },
      { status: 400 }
    );
  }
  const kycDocType: KycDocumentType | null =
    typeof body.kyc_document_type === 'string' &&
    (KYC_DOCUMENT_TYPES as readonly string[]).includes(body.kyc_document_type)
      ? (body.kyc_document_type as KycDocumentType)
      : null;
  const kycStatus = kycDocUrlRaw ? 'pending' : 'not_submitted';
  if (telefone.replace(/\D/g, '').length < 9) {
    return NextResponse.json(
      { error: 'Telefone inválido — indica pelo menos 9 dígitos (ex.: 958 176 915).' },
      { status: 400 }
    );
  }
  if (!isSellerRole(role)) {
    return NextResponse.json(
      { error: 'Escolhe um tipo de vendedor válido: criador, prestador_domicilio ou prestador_remoto.' },
      { status: 400 }
    );
  }

  const bio = sanitizeMultiline(body.bio, 500) || null;
  const areaAtuacao = sanitizeText(body.area_atuacao, 80) || null;
  const cidade = sanitizeText(body.cidade, 60) || null;
  const especialidade = sanitizeText(body.especialidade, 80) || null;
  const portfolioUrl =
    body.portfolio_url?.trim() && isSafeHttpUrl(body.portfolio_url.trim())
      ? body.portfolio_url.trim()
      : null;

  if (body.portfolio_url?.trim() && !portfolioUrl) {
    return NextResponse.json(
      { error: 'O link do portfólio deve começar por https:// e ser um endereço válido.' },
      { status: 400 }
    );
  }

  // Validação condicional por perfil
  if (role === 'criador' && (!bio || bio.length < 10)) {
    return NextResponse.json(
      { error: 'Escreve uma bio de pelo menos 10 caracteres — os clientes querem conhecer-te.' },
      { status: 400 }
    );
  }
  if (role === 'prestador_domicilio' && (!areaAtuacao || !cidade)) {
    return NextResponse.json(
      { error: 'Indica a tua área de atuação e a cidade onde trabalhas.' },
      { status: 400 }
    );
  }
  if (role === 'prestador_remoto' && (!especialidade || especialidade.length < 3)) {
    return NextResponse.json(
      { error: 'Indica a tua especialidade (ex.: Design, Programação, Marketing…).' },
      { status: 400 }
    );
  }
  if (
    portfolioUrl &&
    !/^https?:\/\/.+\..+/.test(portfolioUrl)
  ) {
    return NextResponse.json(
      { error: 'O link do portfólio deve começar por https:// e ser um endereço válido.' },
      { status: 400 }
    );
  }

  try {
    const existing = (await sql`
      SELECT id FROM users WHERE email = ${email} LIMIT 1
    `) as unknown as { id: number }[];

    if (existing.length > 0) {
      return NextResponse.json(
        { error: 'Já existe uma conta com este email. Tenta entrar em vez de criar conta.' },
        { status: 409 }
      );
    }

    /* Fase 9: código de afiliado que indicou a conta (opcional). */
    let referredBy: number | null = null;
    const refCode = (body.ref_code ?? '').trim().toUpperCase();
    if (refCode) {
      if (!/^[A-Z0-9-]{4,20}$/.test(refCode)) {
        return NextResponse.json(
          { error: 'Código de afiliado inválido — usa o formato AFG-XXXXXX.' },
          { status: 400 }
        );
      }
      const ref = (await sql`
        SELECT user_id FROM affiliates WHERE codigo_afiliado = ${refCode} LIMIT 1
      `) as unknown as { user_id: number }[];
      if (ref[0]?.user_id) referredBy = ref[0].user_id;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const username = await generateUniqueUsername(name);

    const inserted = (await sql`
      INSERT INTO users (name, email, password_hash, phone, telefone, role, username, bio, area_atuacao, cidade, especialidade, portfolio_url,
                         bi_number, birth_date, kyc_status, kyc_document_url, kyc_document_type, kyc_submitted_at, is_verified_bi, signup_ip, referred_by)
      VALUES (
        ${name}, ${email}, ${passwordHash}, ${telefone}, ${telefone},
        ${role as SellerRole}, ${username}, ${bio}, ${areaAtuacao}, ${cidade}, ${especialidade}, ${portfolioUrl},
        ${biRaw || null}, ${birthRaw || null}, ${kycStatus}, ${kycDocUrlRaw || null}, ${kycDocType}, ${kycDocUrlRaw ? new Date().toISOString() : null}, FALSE, ${getRequestIp(request)}, ${referredBy}
      )
      RETURNING id, name, email, role, username, telefone, bio, area_atuacao, cidade, especialidade, portfolio_url, blocked::boolean, kyc_status, is_verified_bi::boolean
    `) as unknown as UserRow[];

    const user = publicUser(inserted[0]);
    const token = signToken(user);

    /* Fase 9: loja virtual criada automaticamente com o nome da conta. */
    try {
      await getOrCreateStoreForUser(user.id, user.name);
    } catch (storeError) {
      console.error('[API auth/register/vendedor] Loja automática falhou (não crítico):', storeError);
    }

    return NextResponse.json({ token, user }, { status: 201 });
  } catch (error) {
    console.error('[API auth/register/vendedor] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível criar a conta agora. Tenta novamente em instantes.' },
      { status: 503 }
    );
  }
}
