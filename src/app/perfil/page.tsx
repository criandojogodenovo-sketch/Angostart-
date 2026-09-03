'use client';

/**
 * AngoStart — Perfil multi-perfil (marketplace)
 *
 * - Sem sessão: escolha entre "Sou Cliente" e "Quero Vender" com
 *   formulários de login/registo dedicados (o vendedor escolhe o tipo:
 *   criador, prestador ao domicílio ou freelancer remoto).
 * - Cliente: dados pessoais + histórico de compras.
 * - Vendedor: dados do perfil + botão "Adicionar Produto" + lista dos
 *   seus produtos com editar/eliminar.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import PatternWaves from '@/components/illustrations/PatternWaves';
import { useRouter } from 'next/navigation';
import {
  BadgeCheck,
  BarChart3,
  Briefcase,
  CheckCircle2,
  CircleDollarSign,
  Download,
  ExternalLink,
  GraduationCap,
  History,
  Home as HomeIcon,
  LogIn,
  LogOut,
  Mail,
  MapPin,
  Package,
  Pencil,
  Phone,
  Plus,
  ShoppingCart,
  Sparkles,
  Trash2,
  User as UserIcon,
  UserRound,
  UserRoundPlus,
  Globe,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useAuth, type AuthUser } from '@/context/AuthContext';
import { authHeaders } from '@/context/AuthContext';
import { uploadFileSmart, safeFileName } from '@/lib/upload-client';
import ProfileGamificationCard from '@/components/ProfileGamificationCard';
import MyProposals from '@/components/MyProposals';
import { MustChangePasswordCard } from '@/components/ProfileSecurityCards';
import KycVerificationCard from '@/components/KycVerificationCard';
import ProfilePhotoCard from '@/components/ProfilePhotoCard';
import StoreSetupCard from '@/components/StoreSetupCard';
import MySpaceCard from '@/components/MySpaceCard';
import ProfileAiCard from '@/components/ProfileAiCard';
import ServiceTrackingMap, { type TrackingData } from '@/components/ServiceTrackingMap';
import { formatKz, formatDateTime } from '@/lib/format';
import { validatePassword, passwordStrength } from '@/lib/password';
import { KYC_DOCUMENT_TYPES, KYC_DOCUMENT_TYPE_LABELS, KYC_FILE_ACCEPT, KYC_MAX_FILE_MB, type KycDocumentType } from '@/lib/kyc';
import {
  ORDER_STATUS_BADGES,
  ORDER_STATUS_LABELS,
} from '@/lib/kwik';
import type { Product, ProductType } from '@/lib/products-data';

type AccountKind = 'cliente' | 'vendedor';
type FormMode = 'login' | 'registo';
type SellerRoleChoice = 'criador' | 'prestador_domicilio' | 'prestador_remoto';

const SELLER_ROLES: {
  value: SellerRoleChoice;
  label: string;
  hint: string;
  icon: typeof GraduationCap;
}[] = [
  {
    value: 'criador',
    label: 'Criador de Infoprodutos',
    hint: 'Vende cursos, eBooks e templates digitais',
    icon: GraduationCap,
  },
  {
    value: 'prestador_domicilio',
    label: 'Prestador ao Domicílio',
    hint: 'Limpeza, electricista, canalização, AC…',
    icon: HomeIcon,
  },
  {
    value: 'prestador_remoto',
    label: 'Freelancer Remoto',
    hint: 'Design, websites, redes sociais…',
    icon: Globe,
  },
];

const ROLE_BADGE: Record<string, string> = {
  cliente: 'Cliente',
  criador: 'Criador de Infoprodutos',
  prestador_domicilio: 'Prestador ao Domicílio',
  prestador_remoto: 'Freelancer Remoto',
};

interface OrderRecord {
  id: number;
  items: {
    id: number;
    name: string;
    price_kz: number;
    quantity: number;
    type?: string | null;
    file_url?: string | null;
  }[];
  total_kz: number;
  status: string;
  delivery_type?: string;
  created_at: string;
}

/** Rótulos do tipo de entrega (adaptados ao tipo de produto — ponto 6). */
const DELIVERY_TYPE_LABELS: Record<string, string> = {
  digital: 'Entrega digital imediata',
  domicilio: 'Serviço ao domicílio',
  remoto: 'Serviço remoto (chat/email)',
  entrega: 'Entrega em Luanda',
};

function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export default function PerfilPage() {
  const { user, loading, isSeller, logout } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-slate-400">
        <UserIcon className="mr-3 h-5 w-5 animate-pulse" />
        <span className="text-sm">A verificar a tua sessão…</span>
      </div>
    );
  }

  if (user) {
    return isSeller ? (
      <SellerProfile user={user} onLogout={logout} />
    ) : (
      <ClientProfile user={user} onLogout={logout} />
    );
  }

  return <AuthGate />;
}

/* ═══════════════════ Porta de entrada (sem sessão) ═══════════════════ */

function AuthGate() {
  const [kind, setKind] = useState<AccountKind | null>(null);

  if (!kind) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 text-white shadow-lg shadow-blue-500/30">
            <UserRound className="h-7 w-7" />
          </span>
          <h1 className="mt-4 text-2xl font-bold text-slate-900 sm:text-3xl">
            Bem-vindo(a) à AngoStart
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            Entra na tua conta ou cria um perfil novo. Escolhe a opção que
            descreve melhor o que queres fazer na plataforma.
          </p>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <button
            onClick={() => setKind('cliente')}
            className="group flex flex-col items-center rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-blue-300 hover:shadow-xl"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-teal-600 text-white shadow-md">
              <ShoppingCart className="h-7 w-7" />
            </span>
            <h2 className="mt-4 text-lg font-semibold text-slate-900">Sou Cliente</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              Navega, pesquisa e compra infoprodutos, produtos físicos e
              serviços com preços em Kwanzas.
            </p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-blue-600">
              Entrar / criar conta
              <LogIn className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </span>
          </button>

          <button
            onClick={() => setKind('vendedor')}
            className="group flex flex-col items-center rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-blue-300 hover:shadow-xl"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 text-white shadow-md">
              <Briefcase className="h-7 w-7" />
            </span>
            <h2 className="mt-4 text-lg font-semibold text-slate-900">Quero Vender</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              Publica cursos, produtos ou serviços e recebe pedidos de clientes
              de todo o país.
            </p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-blue-600">
              Entrar / criar conta
              <LogIn className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </span>
          </button>
        </div>

        <div className="mt-8 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm text-blue-800">
          <p className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
            A tua conta serve para comprar <strong>e</strong> vender. Podes ter
            os dois tipos de acesso com emails diferentes — os dados ficam
            seguros com palavra-passe.
          </p>
        </div>
      </div>
    );
  }

  return <AuthForms kind={kind} onBack={() => setKind(null)} />;
}

/* ═══════════════════ Formulários login / registo ═══════════════════ */

function AuthForms({ kind, onBack }: { kind: AccountKind; onBack: () => void }) {
  const { login, registerCliente, registerVendedor } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  const [mode, setMode] = useState<FormMode>('login');
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    telefone: '',
    role: 'criador' as SellerRoleChoice,
    bio: '',
    area_atuacao: '',
    cidade: '',
    especialidade: '',
    portfolio_url: '',
    /* Fase 9 (agora opcional na Fase 12) */
    bi_number: '',
    birth_date: '',
    ref_code: '',
  });
  /* Fase 12: foto do documento KYC no registo (opcional).
     O upload exige sessão — o ficheiro fica em memória e é enviado
     logo após a criação da conta (upload + submit). */
  const kycFileRef = useRef<HTMLInputElement>(null);
  const [kycFile, setKycFile] = useState<File | null>(null);
  const [kycPreview, setKycPreview] = useState<string | null>(null);
  const [kycRegType, setKycRegType] = useState<KycDocumentType>('bi');
  /* Fase 17: aceitação obrigatória dos Termos de Serviço + Privacidade.
     O botão «Criar conta» fica desativado sem o checkbox — e a API
     devolve 400 se o campo chegar falso (validação dupla). */
  const [aceitarTermos, setAceitarTermos] = useState(false);

  const isClient = kind === 'cliente';
  const selectedRole = SELLER_ROLES.find((r) => r.value === form.role);

  /* Fase 9: medidor de força + bloqueio de senha fraca no registo. */
  const isRegisto = mode === 'registo';
  const forca = passwordStrength(form.password);
  const senhaValida = isRegisto ? validatePassword(form.password).ok : true;
  const idadeInformada = form.birth_date
    ? (() => {
        const d = new Date(`${form.birth_date}T00:00:00Z`);
        if (Number.isNaN(d.getTime())) return null;
        const agora = new Date();
        let idade = agora.getUTCFullYear() - d.getUTCFullYear();
        const m = agora.getUTCMonth() - d.getUTCMonth();
        if (m < 0 || (m === 0 && agora.getUTCDate() < d.getUTCDate())) idade -= 1;
        return idade;
      })()
    : null;

  /* ── Correção «Criar conta» desativado: validação EM TEMPO REAL de todos
     os campos obrigatórios do modo/tipo atual. O botão só fica inativo
     quando algo está em falta — e a lista abaixo do botão diz exatamente
     o quê. A foto do documento (KYC) NÃO entra aqui: é opcional desde a
     Fase 12 e nunca bloqueia a criação da conta. */
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const camposEmFalta: string[] = [];
  if (isRegisto) {
    if (!form.name.trim()) camposEmFalta.push('nome');
    if (!emailOk) camposEmFalta.push('email válido');
    if (!form.telefone.trim()) camposEmFalta.push('telefone');
    if (!senhaValida) camposEmFalta.push('palavra-passe forte');
    if (!isClient) {
      if (form.role === 'criador' && !form.bio.trim()) camposEmFalta.push('biografia');
      if (form.role === 'prestador_domicilio') {
        if (!form.area_atuacao.trim()) camposEmFalta.push('área de atuação');
        if (!form.cidade.trim()) camposEmFalta.push('cidade');
      }
      if (form.role === 'prestador_remoto' && !form.especialidade.trim()) {
        camposEmFalta.push('especialidade');
      }
    }
    /* Fase 17: sem aceitação dos Termos, o registo não avança. */
    if (!aceitarTermos) camposEmFalta.push('aceitação dos Termos');
  }
  /* Evita «gritar» com o formulário ainda virgem — só orienta após o
     utilizador começar a preencher. */
  const algumPreenchido =
    form.name.length > 0 ||
    form.email.length > 0 ||
    form.password.length > 0 ||
    form.telefone.length > 0;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);

    try {
      if (mode === 'login') {
        const user = await login(form.email, form.password);
        toast({
          title: `Olá, ${user.name.split(' ')[0]}!`,
          description: 'Sessão iniciada com sucesso.',
        });
      } else if (isClient) {
        const user = await registerCliente({
          name: form.name,
          email: form.email,
          password: form.password,
          telefone: form.telefone,
          ref_code: form.ref_code.trim() || undefined,
          aceitarTermos,
        });
        toast({
          title: 'Conta criada!',
          description: `Bem-vindo(a) à AngoStart, ${user.name.split(' ')[0]}.`,
        });
      } else {
        const user = await registerVendedor({
          name: form.name,
          email: form.email,
          password: form.password,
          telefone: form.telefone,
          role: form.role,
          bio: form.bio,
          area_atuacao: form.area_atuacao,
          cidade: form.cidade,
          especialidade: form.especialidade,
          portfolio_url: form.portfolio_url,
          bi_number: form.bi_number.trim() || undefined,
          birth_date: form.birth_date || undefined,
          ref_code: form.ref_code.trim() || undefined,
          aceitarTermos,
        });
        /* Fase 12: se o vendedor escolheu foto do documento, enviamos já
           (upload + submit) com o token da nova sessão. Não bloqueia a
           criação da conta — em caso de falha, o cartão KYC do dashboard
           permite reenviar. */
        if (kycFile && user?.id) {
          try {
            // CLIENT-SIDE upload (contorna o limite de 4.5 MB da Vercel)
            const up = await uploadFileSmart({
              file: kycFile,
              pathname: `kyc/${user.id}/${safeFileName(kycFile.name, 'documento.jpg')}`,
              handleUploadUrl: '/api/kyc/upload',
              maxBytes: 5 * 1024 * 1024,
              allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
              acceptExtensions: ['jpg', 'jpeg', 'png', 'webp'],
              makeUrl: (pathname) => `/api/kyc/document/${pathname.replace(/^kyc\//, '')}`,
            });
            if (up.ok) {
              await fetch('/api/kyc/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({
                  kyc_document_url: up.url,
                  kyc_document_type: kycRegType,
                  bi_number: form.bi_number.trim() || undefined,
                  birth_date: form.birth_date || undefined,
                }),
              });
            }
          } catch {
            toast({
              title: 'Conta criada, mas o documento não foi enviado',
              description: 'Envia a foto do documento no Painel de vendas → Verificação de Identidade.',
              variant: 'destructive',
            });
          }
        }
        toast({
          title: 'Conta de vendedor criada!',
          description: kycFile
            ? 'O documento está em análise — podes vender desde já! Personaliza a tua loja no próximo passo.'
            : 'Podes vender desde já — personaliza a tua loja no próximo passo em 30 segundos.',
        });
        /* Fase 17: passo opcional de personalizar a loja APÓS o registo.
           O setUser do contexto já trocou a vista para o SellerProfile —
           a flag em sessionStorage faz o cartão aparecer lá em cima. */
        try {
          sessionStorage.setItem('angostart.loja-setup', String(user.id));
        } catch { /* armazenamento indisponível — passo simplesmente omitido */ }
      }
      router.push('/perfil');
    } catch (error) {
      toast({
        title: 'Não foi possível continuar',
        description:
          error instanceof Error ? error.message : 'Tenta novamente em instantes.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-10 sm:px-6">
      <button
        onClick={onBack}
        className="mb-4 text-sm font-medium text-slate-500 transition-colors hover:text-blue-700"
      >
        ← Voltar às opções
      </button>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="text-center">
          <span
            className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-lg ${
              isClient
                ? 'bg-gradient-to-br from-blue-500 to-purple-600 shadow-blue-500/30'
                : 'bg-gradient-to-br from-purple-400 to-indigo-500 shadow-purple-500/30'
            }`}
          >
            {isClient ? (
              <ShoppingCart className="h-6 w-6" />
            ) : (
              <Briefcase className="h-6 w-6" />
            )}
          </span>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">
            {isClient ? 'Sou Cliente' : 'Quero Vender'}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            {mode === 'login'
              ? 'Entra com o teu email e palavra-passe.'
              : isClient
                ? 'Cria a tua conta de cliente em menos de um minuto.'
                : 'Cria a tua conta de vendedor e começa a publicar.'}
          </p>
        </div>

        {/* Alternância Login / Registo */}
        <div className="mt-6 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1" role="tablist">
          {(['login', 'registo'] as FormMode[]).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`h-9 rounded-lg text-sm font-semibold transition-all ${
                mode === m
                  ? 'bg-white text-slate-900 shadow'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {m === 'login' ? 'Entrar' : 'Criar conta'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
          {mode === 'registo' && (
            <div className="space-y-2">
              <Label htmlFor="auth-nome">Nome completo</Label>
              <Input
                id="auth-nome"
                type="text"
                autoComplete="name"
                placeholder="Ex.: Ana Kiala"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="h-11"
                required
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="auth-email">Email</Label>
            <Input
              id="auth-email"
              type="email"
              autoComplete="email"
              placeholder="ana@exemplo.ao"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="h-11"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="auth-password">Palavra-passe</Label>
            <Input
              id="auth-password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder={mode === 'registo' ? 'Mín. 8 caracteres, A-Z, a-z, 0-9 e símbolo' : 'A tua palavra-passe'}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="h-11"
              required
            />
            {mode === 'registo' && (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="flex h-1.5 flex-1 gap-1">
                    {[1, 2, 3].map((n) => (
                      <span
                        key={n}
                        className={`h-full flex-1 rounded-full ${
                          forca.score >= n ? forca.color : 'bg-slate-200'
                        }`}
                      />
                    ))}
                  </div>
                  {/* Só mostra «média/forte» quando a senha CUMPRE a política —
                      evita o CONTRA-SENTO de «forte» com botão bloqueado
                      (ex.: «AnaKiala2024» era forte sem símbolo). */}
                  <span className="w-12 text-right text-xs font-semibold text-slate-500">
                    {form.password && senhaValida ? forca.label : ''}
                  </span>
                </div>
                {/* Checklist em tempo real: diz QUAL regra falta em vez de
                    uma frase cinzenta que ninguém lia (causa do botão
                    «sempre desativado»). */}
                {!senhaValida && form.password.length > 0 && (
                  <ul className="grid grid-cols-2 gap-x-3 gap-y-1 pt-1 text-xs">
                    {[
                      { ok: form.password.length >= 8, label: '8+ caracteres' },
                      { ok: /[A-Z]/.test(form.password), label: '1 letra maiúscula' },
                      { ok: /[a-z]/.test(form.password), label: '1 letra minúscula' },
                      { ok: /[0-9]/.test(form.password), label: '1 número' },
                      { ok: /[^A-Za-z0-9]/.test(form.password), label: '1 símbolo (!@#$%)' },
                    ].map((regra) => (
                      <li
                        key={regra.label}
                        className={`flex items-center gap-1 font-medium ${
                          regra.ok ? 'text-blue-600' : 'text-slate-400'
                        }`}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                        {regra.label}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {mode === 'login' && (
              <Link
                href="/recuperar-senha"
                className="inline-block text-xs font-medium text-blue-600 transition-colors hover:text-blue-700"
              >
                Esqueci a senha — recuperar por email
              </Link>
            )}
          </div>

          {mode === 'registo' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="auth-telefone">Telefone / WhatsApp</Label>
                <Input
                  id="auth-telefone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="958 176 915"
                  value={form.telefone}
                  onChange={(e) => setForm({ ...form, telefone: e.target.value })}
                  className="h-11"
                  required
                />
              </div>

              {/* Selector de tipo de vendedor */}
              {!isClient && (
                <div className="space-y-2">
                  <Label htmlFor="auth-role">Quero vender como…</Label>
                  <div className="grid gap-2" role="radiogroup" aria-label="Tipo de vendedor">
                    {SELLER_ROLES.map(({ value, label, hint, icon: Icon }) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={form.role === value}
                        onClick={() => setForm({ ...form, role: value })}
                        className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-all ${
                          form.role === value
                            ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                            : 'border-slate-200 bg-white hover:border-blue-300'
                        }`}
                      >
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                            form.role === value
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <span>
                          <span className="block text-sm font-semibold text-slate-900">
                            {label}
                          </span>
                          <span className="block text-xs text-slate-500">{hint}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Campos do vendedor — Fase 12: BI e nascimento OPCIONAIS */}
              {!isClient && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="auth-bi">N.º do BI (opcional)</Label>
                    <Input
                      id="auth-bi"
                      type="text"
                      placeholder="Ex.: 004587896LA038"
                      value={form.bi_number}
                      onChange={(e) => setForm({ ...form, bi_number: e.target.value.toUpperCase() })}
                      className="h-11"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="auth-birth">Data de nascimento (opcional)</Label>
                    <Input
                      id="auth-birth"
                      type="date"
                      value={form.birth_date}
                      onChange={(e) => setForm({ ...form, birth_date: e.target.value })}
                      className="h-11"
                    />
                    {idadeInformada !== null && idadeInformada < 15 && (
                      <p className="text-xs font-semibold text-rose-600">
                        Idade mínima para aderir como vendedor é 15 anos.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Fase 12: foto do documento (opcional) — substitui a obrigatoriedade do BI */}
              {!isClient && (
                <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <Label>Foto do documento (opcional — para o selo azul)</Label>
                  <p className="text-xs text-slate-500">
                    BI, Passaporte ou Cartão de Eleitor (JPG, PNG ou WebP, máx. {KYC_MAX_FILE_MB} MB).
                    Podes vender sem isto — a foto só é vista pela equipa de verificação.
                  </p>
                  <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Tipo de documento">
                    {KYC_DOCUMENT_TYPES.map((t) => (
                      <button
                        key={t}
                        type="button"
                        role="radio"
                        aria-checked={kycRegType === t}
                        onClick={() => setKycRegType(t)}
                        className={`rounded-xl border px-2 py-1.5 text-xs font-semibold transition-all ${
                          kycRegType === t
                            ? 'border-blue-500 bg-blue-50 text-blue-700 ring-1 ring-blue-500'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300'
                        }`}
                      >
                        {KYC_DOCUMENT_TYPE_LABELS[t]}
                      </button>
                    ))}
                  </div>
                  <input
                    ref={kycFileRef}
                    type="file"
                    accept={KYC_FILE_ACCEPT}
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      setKycFile((old) => {
                        if (old && kycPreview) URL.revokeObjectURL(kycPreview);
                        return f;
                      });
                      setKycPreview((old) => {
                        if (old) URL.revokeObjectURL(old);
                        return f ? URL.createObjectURL(f) : null;
                      });
                      e.target.value = '';
                    }}
                  />
                  <div className="flex items-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => kycFileRef.current?.click()}
                      className="gap-2 bg-white"
                    >
                      <Upload className="h-4 w-4" />
                      {kycFile ? 'Trocar foto' : 'Escolher foto do documento'}
                    </Button>
                    {kycPreview && (
                       
                      <img
                        src={kycPreview}
                        alt="Pré-visualização do documento"
                        className="h-12 w-16 rounded-lg border border-slate-200 object-cover"
                      />
                    )}
                  </div>
                </div>
              )}

              {/* Fase 9: código de afiliado (opcional, ambos os tipos) */}
              <div className="space-y-2">
                <Label htmlFor="auth-ref">Código de afiliado (opcional)</Label>
                <Input
                  id="auth-ref"
                  type="text"
                  placeholder="Ex.: AFG-3K9PQX"
                  value={form.ref_code}
                  onChange={(e) => setForm({ ...form, ref_code: e.target.value.toUpperCase() })}
                  className="h-11"
                />
              </div>

              {!isClient && form.role === 'criador' && (
                <div className="space-y-2">
                  <Label htmlFor="auth-bio">Biografia / o que vendes</Label>
                  <textarea
                    id="auth-bio"
                    rows={3}
                    placeholder="Ex.: Sou formador em marketing digital e vendo cursos práticos para pequenas empresas."
                    value={form.bio}
                    onChange={(e) => setForm({ ...form, bio: e.target.value })}
                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    required
                  />
                </div>
              )}

              {!isClient && form.role === 'prestador_domicilio' && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="auth-area">Área de atuação</Label>
                    <Input
                      id="auth-area"
                      type="text"
                      placeholder="Ex.: Limpeza, Electricista…"
                      value={form.area_atuacao}
                      onChange={(e) => setForm({ ...form, area_atuacao: e.target.value })}
                      className="h-11"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="auth-cidade">Cidade</Label>
                    <Input
                      id="auth-cidade"
                      type="text"
                      placeholder="Ex.: Luanda"
                      value={form.cidade}
                      onChange={(e) => setForm({ ...form, cidade: e.target.value })}
                      className="h-11"
                      required
                    />
                  </div>
                </div>
              )}

              {!isClient && form.role === 'prestador_remoto' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="auth-especialidade">Especialidade</Label>
                    <Input
                      id="auth-especialidade"
                      type="text"
                      placeholder="Ex.: Design gráfico, Programação web…"
                      value={form.especialidade}
                      onChange={(e) => setForm({ ...form, especialidade: e.target.value })}
                      className="h-11"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="auth-portfolio">Portfólio (link, opcional)</Label>
                    <Input
                      id="auth-portfolio"
                      type="url"
                      placeholder="https://teu-portfolio.ao"
                      value={form.portfolio_url}
                      onChange={(e) => setForm({ ...form, portfolio_url: e.target.value })}
                      className="h-11"
                    />
                  </div>
                </>
              )}
            </>
          )}

          {/* Fase 17: aceitação OBRIGATÓRIA dos Termos de Serviço e da
              Política de Privacidade — o registo não avança sem ela. */}
          {mode === 'registo' && (
            <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3">
              <label htmlFor="auth-termos" className="flex cursor-pointer items-start gap-3">
                <input
                  id="auth-termos"
                  type="checkbox"
                  checked={aceitarTermos}
                  onChange={(e) => setAceitarTermos(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-blue-600"
                  required
                />
                <span className="text-xs leading-relaxed text-slate-700">
                  Li e aceito os{' '}
                  <Link
                    href="/termos"
                    target="_blank"
                    className="font-semibold text-blue-700 underline decoration-blue-300 hover:text-blue-800"
                  >
                    Termos de Serviço
                  </Link>{' '}
                  e a{' '}
                  <Link
                    href="/privacidade"
                    target="_blank"
                    className="font-semibold text-blue-700 underline decoration-blue-300 hover:text-blue-800"
                  >
                    Política de Privacidade
                  </Link>{' '}
                  da AngoStart.
                </span>
              </label>
            </div>
          )}

          {/* Ativo = MESMA cor vibrante do «Entrar» (gradiente azul→roxo).
              Inativo = cinzento INTENCIONAL (não o antigo branco pálido de
              opacity-50 sobre laranja, que parecia botão partido). */}
          <Button
            type="submit"
            disabled={submitting || (isRegisto && camposEmFalta.length > 0)}
            className={`h-12 w-full text-base font-semibold text-white transition-colors ${
              isClient
                ? 'bg-gradient-to-r from-blue-600 to-purple-600 shadow-lg shadow-blue-600/25 hover:brightness-110'
                : 'bg-blue-600 hover:bg-blue-700'
            } disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:opacity-100`}
            title={
              isRegisto && camposEmFalta.length > 0
                ? 'Completa os campos assinalados para continuar.'
                : undefined
            }
          >
            {submitting ? (
              'A processar…'
            ) : mode === 'login' ? (
              <>
                <LogIn className="mr-2 h-5 w-5" /> Entrar
              </>
            ) : (
              <>
                <UserRoundPlus className="mr-2 h-5 w-5" /> Criar conta
              </>
            )}
          </Button>

          {/* Diz exatamente o que falta — em tempo real. */}
          {isRegisto && camposEmFalta.length > 0 && algumPreenchido && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs font-semibold text-amber-800">
              Para criares a conta falta: {camposEmFalta.join(' · ')}.
            </p>
          )}

          <p className="text-center text-xs text-slate-400">
            {mode === 'login'
              ? 'Ainda não tens conta? Muda para «Criar conta».'
              : 'Já tens conta? Muda para «Entrar».'}
          </p>
        </form>
      </div>
    </div>
  );
}

/* ═══════════════════ Cabeçalho comum do perfil ═══════════════════ */

function ProfileHeader({ user, badge }: { user: AuthUser; badge: string }) {
  return (
    <div className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-blue-950 to-purple-950 px-6 py-8 text-center text-white sm:px-10">
      <PatternWaves />
      <div className="relative mx-auto h-[88px] w-[88px]">
        {/* Anel de gradiente rodante + halo (efeito glow — Fase 18) */}
        <div
          aria-hidden="true"
          className="absolute inset-[-4px] animate-[spin_6s_linear_infinite] rounded-full opacity-90 blur-[1px]"
          style={{ background: 'conic-gradient(from 0deg, #3b82f6, #8b5cf6, #14b8a6, #3b82f6)' }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-[-6px] rounded-full opacity-40 blur-lg"
          style={{ background: 'conic-gradient(from 180deg, #8b5cf6, #3b82f6, #14b8a6, #8b5cf6)' }}
        />
        <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-2xl font-bold text-white shadow-lg shadow-blue-500/30">
          {initialsOf(user.name)}
        </span>
      </div>
      <h1 className="mt-4 text-xl font-bold sm:text-2xl">{user.name}</h1>
      <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-blue-300">
        <BadgeCheck className="h-3.5 w-3.5" /> {badge}
      </p>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: string | null }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3">
      <Icon className="h-4 w-4 shrink-0 text-blue-600" />
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
        <p className="text-sm font-medium text-slate-800">{value || '—'}</p>
      </div>
    </div>
  );
}

/* ═══════════════════ Perfil do CLIENTE ═══════════════════ */

function ClientProfile({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const { toast } = useToast();
  /* Fase 17: updateUser do contexto — propaga a Navbar/menus na hora. */
  const { updateUser } = useAuth();
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  /* ── Disputas (Fase 6, ponto 7) ── */
  const [disputes, setDisputes] = useState<{ id: number; order_id: number; status: string; resolution: string | null }[]>([]);
  const [disputeOrderId, setDisputeOrderId] = useState<number | null>(null);
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeSubmitting, setDisputeSubmitting] = useState(false);

  useEffect(() => {
    fetch('/api/disputes', { headers: authHeaders(), cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { disputes?: typeof disputes } | null) => setDisputes(data?.disputes ?? []))
      .catch(() => setDisputes([]));
  }, []);

  const refreshOrders = useCallback(async () => {
    try {
      const res = await fetch('/api/orders?mine=1', { headers: authHeaders() });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { orders: OrderRecord[] };
      setOrders(data.orders ?? []);
    } catch {
      setOrders([]);
    } finally {
      setOrdersLoaded(true);
    }
  }, []);

  useEffect(() => {
    refreshOrders();
  }, [refreshOrders]);

  function handleLogout() {
    onLogout();
    toast({ title: 'Sessão terminada', description: 'Volta sempre à AngoStart!' });
  }

  /**
   * Download de infoproduto com autenticação Bearer (o token está em
   * localStorage, logo um <a href> simples devolvia sempre 401).
   *
   * Fluxo: GET /api/products/{id}/download → 307 para URL temporário do Blob
   * (expira em 1h) → fetch segue o redirect e devolve o PDF. Se o follow do
   * redirect falhar (CORS), repete em modo stream (same-origin). O URL do
   * Blob nunca é conhecido pelo browser sem autorização prévia.
   */
  async function handleDownload(productId: number, productName: string) {
    if (downloadingId !== null) return;
    setDownloadingId(productId);
    try {
      let res: Response;
      try {
        res = await fetch(`/api/products/${productId}/download`, {
          headers: authHeaders(),
        });
      } catch {
        // Redirect cross-origin bloqueado — força stream autenticado server-side
        res = await fetch(`/api/products/${productId}/download?mode=stream`, {
          headers: authHeaders(),
        });
      }

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({
          title: 'Download indisponível',
          description: data?.error ?? 'Tenta novamente dentro de momentos.',
          variant: 'destructive',
        });
        return;
      }

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `${productName.replace(/[^a-zA-Z0-9._ -]+/g, '').trim() || 'infoproduto'}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      toast({ title: 'Download concluído', description: productName });
    } catch {
      toast({
        title: 'Download indisponível',
        description: 'Não foi possível descarregar agora. Tenta novamente.',
        variant: 'destructive',
      });
    } finally {
      setDownloadingId(null);
    }
  }

  /** Abre uma disputa sobre uma encomenda paga (Fase 6, ponto 7). */
  async function submitDispute(orderId: number) {
    if (disputeSubmitting) return;
    setDisputeSubmitting(true);
    try {
      const res = await fetch('/api/disputes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ order_id: orderId, reason: disputeReason }),
      });
      const data = (await res.json()) as { ok?: boolean; dispute?: { id: number }; error?: string };
      if (!res.ok || !data.ok) {
        toast({ title: 'Não foi possível abrir a disputa', description: data.error });
        return;
      }
      toast({
        title: 'Disputa aberta ✓',
        description: 'A equipa AngoStart vai analisar e responder por email.',
      });
      setDisputes((prev) => [
        { id: data.dispute!.id, order_id: orderId, status: 'aberta', resolution: null },
        ...prev,
      ]);
      setDisputeOrderId(null);
      setDisputeReason('');
    } catch {
      toast({ title: 'Erro de ligação', description: 'Tenta novamente.' });
    } finally {
      setDisputeSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      {/* Fase 9 — segurança: troca de senha obrigatória p/ utilizadores antigos */}
      {user.must_change_password && <MustChangePasswordCard />}
      {/* Fase 16 — foto de perfil (cliente) */}
      <div className="mb-6">
        <ProfilePhotoCard user={user} onUpdated={updateUser} />
      </div>
      {/* Fase 7 — nível, pontos e notificações push */}
      <div className="mb-6">
        <ProfileGamificationCard />
      </div>
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <ProfileHeader user={user} badge={ROLE_BADGE[user.role] ?? 'Cliente'} />

        <div className="space-y-4 px-6 py-8 sm:px-10">
          <InfoRow icon={Mail} label="Email" value={user.email} />
          <InfoRow icon={Phone} label="Telefone" value={user.telefone} />

          <div className="grid gap-3 pt-2 sm:grid-cols-2">
            <Button
              asChild
              className="h-11 bg-blue-600 text-white hover:bg-blue-700"
            >
              <Link href="/produtos">
                <ShoppingCart className="mr-2 h-4 w-4" /> Continuar a comprar
              </Link>
            </Button>
            <Button
              onClick={handleLogout}
              variant="outline"
              className="h-11 border-rose-200 text-rose-600 hover:bg-rose-50"
            >
              <LogOut className="mr-2 h-4 w-4" /> Terminar sessão
            </Button>
          </div>

          {/* Histórico de compras */}
          <div className="mt-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              <History className="h-5 w-5 text-blue-600" /> Histórico de compras
            </h2>

            {!ordersLoaded ? (
              <p className="mt-3 text-sm text-slate-400">A carregar encomendas…</p>
            ) : orders.length === 0 ? (
              <div className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                <Package className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">
                  Ainda não fizeste nenhuma compra. Explora o catálogo e recebe
                  a confirmação no WhatsApp.
                </p>
                <Button
                  asChild
                  size="sm"
                  className="mt-4 bg-blue-600 text-white hover:bg-blue-700"
                >
                  <Link href="/produtos">Ver produtos</Link>
                </Button>
              </div>
            ) : (
              <ul className="mt-3 space-y-3">
                {orders.map((order) => (
                  <li
                    key={order.id}
                    className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900">
                        Encomenda n.º {order.id}
                      </p>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          ORDER_STATUS_BADGES[order.status] ??
                          'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {ORDER_STATUS_LABELS[order.status] ?? order.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      {formatDateTime(order.created_at)} ·{' '}
                      {DELIVERY_TYPE_LABELS[order.delivery_type ?? 'entrega'] ??
                        order.delivery_type}
                    </p>
                    <ul className="mt-2 space-y-1 text-sm text-slate-600">
                      {order.items.map((item, index) => {
                        const canDownload =
                          item.type === 'infoproduto' &&
                          item.file_url &&
                          ['pago', 'entregue'].includes(order.status);
                        return (
                          <li
                            key={`${order.id}-${index}`}
                            className="flex flex-wrap items-center justify-between gap-2"
                          >
                            <span className="truncate">
                              {item.quantity}× {item.name}
                            </span>
                            <span className="flex shrink-0 items-center gap-2">
                              {canDownload && (
                                <button
                                  type="button"
                                  onClick={() => handleDownload(item.id, item.name)}
                                  disabled={downloadingId === item.id}
                                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  <Download className="h-3.5 w-3.5" />
                                  {downloadingId === item.id ? 'A descarregar…' : 'Descarregar'}
                                </button>
                              )}
                              <span className="font-medium">
                                {formatKz(item.price_kz * item.quantity)}
                              </span>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {order.items.some(
                      (i) => i.type === 'infoproduto' && i.file_url
                    ) &&
                      !['pago', 'entregue'].includes(order.status) && (
                        <p className="mt-1 text-[11px] text-slate-400">
                          O download dos teus infoprodutos fica disponível assim que o
                          pagamento for confirmado.
                        </p>
                      )}
                    <p className="mt-2 border-t border-slate-100 pt-2 text-right text-sm font-bold text-slate-900">
                      Total: {formatKz(order.total_kz)}
                    </p>

                    {/* Ponto 4B/5: rastreamento em tempo real + confirmação
                        de conclusão para serviços ao domicílio pagos */}
                    {order.items.some((i) => i.type === 'servico_domicilio') &&
                      ['pago', 'entregue'].includes(order.status) && (
                        <DomicilioServiceCard
                          order={order}
                          onConfirmed={refreshOrders}
                        />
                      )}

                    {/* Disputas (Fase 6, ponto 7) */}
                    {['pago', 'entregue'].includes(order.status) && (
                      <div className="mt-2 border-t border-slate-100 pt-2">
                        {disputes.some((d) => d.order_id === order.id) ? (
                          <p className="text-[11px] font-semibold text-amber-700">
                            ⚖️ Disputa {disputes.find((d) => d.order_id === order.id)?.status === 'aberta'
                              ? 'em análise pela equipa'
                              : disputes.find((d) => d.order_id === order.id)?.status === 'resolvida_cliente'
                                ? 'resolvida a teu favor (reembolso na carteira)'
                                : 'resolvida a favor do vendedor'}
                          </p>
                        ) : disputeOrderId === order.id ? (
                          <div className="rounded-xl bg-slate-50 p-3">
                            <Label htmlFor={`disputa-${order.id}`} className="text-xs font-semibold text-slate-700">
                              Explica o problema (mín. 15 caracteres)
                            </Label>
                            <Textarea
                              id={`disputa-${order.id}`}
                              value={disputeReason}
                              onChange={(e) => setDisputeReason(e.target.value)}
                              maxLength={2000}
                              rows={3}
                              className="mt-1.5 text-sm"
                              placeholder="Ex.: o produto chegou diferente do anunciado…"
                            />
                            <div className="mt-2 flex gap-2">
                              <button
                                type="button"
                                onClick={() => submitDispute(order.id)}
                                disabled={disputeSubmitting || disputeReason.trim().length < 15}
                                className="inline-flex h-8 items-center rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {disputeSubmitting ? 'A enviar…' : 'Enviar disputa'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setDisputeOrderId(null);
                                  setDisputeReason('');
                                }}
                                className="inline-flex h-8 items-center rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDisputeOrderId(order.id)}
                            className="text-[11px] font-semibold text-slate-400 transition-colors hover:text-amber-600"
                          >
                            ⚖️ Abrir disputa
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Fase 7 — propostas enviadas: acompanhar, contrapropor, aceitar */}
          <MyProposals />
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ Perfil do VENDEDOR ═══════════════════ */

function SellerProfile({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const { toast } = useToast();
  /* Fase 17: updateUser do contexto — propaga a Navbar/menus na hora. */
  const { updateUser } = useAuth();
  const router = useRouter();
  /* Fase 17: passo opcional «criar a minha loja» logo após o registo.
     O AuthForms grava a flag em sessionStorage (o setUser do contexto
     troca para esta vista antes do cartão poder aparecer aqui dentro). */
  const [lojaSetup, setLojaSetup] = useState(() => {
    try {
      return sessionStorage.getItem('angostart.loja-setup') === String(user.id);
    } catch {
      return false;
    }
  });

  function finishLojaSetup() {
    try {
      sessionStorage.removeItem('angostart.loja-setup');
    } catch { /* ignore */ }
    setLojaSetup(false);
  }
  const [products, setProducts] = useState<Product[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const loadProducts = useCallback(async () => {
    try {
      const res = await fetch('/api/products?meu=1', { headers: authHeaders() });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { products: Product[] };
      setProducts(data.products ?? []);
    } catch {
      setProducts([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  async function handleDelete(product: Product) {
    if (deletingId !== product.id) {
      setDeletingId(product.id);
      return;
    }
    try {
      const res = await fetch(`/api/products/${product.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error);
      toast({ title: 'Produto eliminado', description: product.name });
      setProducts((prev) => prev.filter((p) => p.id !== product.id));
    } catch (error) {
      toast({
        title: 'Não foi possível eliminar',
        description: error instanceof Error ? error.message : 'Tenta novamente.',
      });
    } finally {
      setDeletingId(null);
    }
  }

  function handleLogout() {
    onLogout();
    toast({ title: 'Sessão terminada', description: 'Volta sempre à AngoStart!' });
  }

  const sellerInfo: { icon: typeof Mail; label: string; value: string | null }[] = [];
  if (user.role === 'criador') {
    sellerInfo.push({ icon: Sparkles, label: 'Bio', value: user.bio });
  }
  if (user.role === 'prestador_domicilio') {
    sellerInfo.push({ icon: Briefcase, label: 'Área de atuação', value: user.area_atuacao });
    sellerInfo.push({ icon: HomeIcon, label: 'Cidade', value: user.cidade });
  }
  if (user.role === 'prestador_remoto') {
    sellerInfo.push({ icon: Briefcase, label: 'Especialidade', value: user.especialidade });
    sellerInfo.push({ icon: Globe, label: 'Portfólio', value: user.portfolio_url });
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      {/* Fase 17 — passo opcional de personalizar a loja após o registo */}
      {lojaSetup && (
        <div className="mb-6">
          <StoreSetupCard user={user} onDone={finishLojaSetup} />
        </div>
      )}
      {/* Fase 12 — KYC flexível: foto do documento, estado e reenvio */}
      {user.must_change_password && <MustChangePasswordCard />}
      <KycVerificationCard user={user} onUpdated={updateUser} />
      {/* Fase 16 — foto de perfil (vendedor) */}
      <div className="mt-6">
        <ProfilePhotoCard user={user} onUpdated={updateUser} />
      </div>
      {/* Fase 18 — «O meu Espaço»: criar/editar estabelecimento (prestadores)
          ou loja virtual (criadores) a partir do perfil, mobile e desktop */}
      <div className="mt-6">
        <MySpaceCard user={user} />
      </div>
      {/* Fase 21 — «Analisar o meu perfil com IA»: nota 0-10 + sugestões */}
      <div className="mt-6">
        <ProfileAiCard user={user} />
      </div>
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <ProfileHeader user={user} badge={ROLE_BADGE[user.role] ?? 'Vendedor'} />

        <div className="space-y-4 px-6 py-8 sm:px-10">
          <InfoRow icon={Mail} label="Email" value={user.email} />
          <InfoRow icon={Phone} label="Telefone" value={user.telefone} />
          {sellerInfo.map(({ icon, label, value }) => (
            <InfoRow key={label} icon={icon} label={label} value={value} />
          ))}

          {/* Ações do vendedor */}
          <div className="grid gap-3 pt-2 sm:grid-cols-2">
            <Button
              onClick={() => router.push('/adicionar-produto')}
              className="h-11 bg-blue-600 text-white hover:bg-blue-700"
            >
              <Plus className="mr-2 h-4 w-4" /> Adicionar Produto
            </Button>
            <Button
              onClick={() => router.push('/dashboard/vendedor')}
              className="h-11 bg-slate-900 text-white hover:bg-slate-800"
            >
              <BarChart3 className="mr-2 h-4 w-4" /> Painel de vendas
            </Button>
            <Button
              onClick={() => router.push('/dashboard/vendedor/portfolio')}
              variant="outline"
              className="h-11 border-blue-500 text-blue-600 hover:bg-blue-50"
            >
              <Pencil className="mr-2 h-4 w-4" /> Editar portfólio
            </Button>
            {user.username && (
              <Button
                onClick={() => router.push(`/portfolio/${user.username}`)}
                variant="outline"
                className="h-11 border-blue-500 text-blue-600 hover:bg-blue-50"
              >
                <ExternalLink className="mr-2 h-4 w-4" /> Ver portfólio público
              </Button>
            )}
            <Button
              onClick={handleLogout}
              variant="outline"
              className="h-11 border-rose-200 text-rose-600 hover:bg-rose-50"
            >
              <LogOut className="mr-2 h-4 w-4" /> Terminar sessão
            </Button>
          </div>

          {/* Lista dos produtos publicados */}
          <div className="mt-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              <Package className="h-5 w-5 text-blue-600" /> Os meus produtos e serviços
            </h2>

            {!loaded ? (
              <p className="mt-3 text-sm text-slate-400">A carregar os teus produtos…</p>
            ) : products.length === 0 ? (
              <div className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                <CircleDollarSign className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">
                  Ainda não publicaste nada. Adiciona o teu primeiro produto ou
                  serviço e aparece no catálogo da AngoStart.
                </p>
                <Button
                  onClick={() => router.push('/adicionar-produto')}
                  size="sm"
                  className="mt-4 bg-blue-600 text-white hover:bg-blue-700"
                >
                  <Plus className="mr-2 h-4 w-4" /> Publicar agora
                </Button>
              </div>
            ) : (
              <ul className="mt-3 space-y-3">
                {products.map((product) => (
                  <li
                    key={product.id}
                    className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {product.name}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">
                        {product.description}
                      </p>
                      <p className="mt-1 text-sm font-bold text-blue-600">
                        {formatKz(product.price_kz)}
                        <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                          {product.type.replace('_', ' ')}
                        </span>
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        onClick={() => router.push(`/adicionar-produto?edit=${product.id}`)}
                        size="sm"
                        variant="outline"
                        className="h-9 border-blue-500 text-blue-600 hover:bg-blue-50"
                        aria-label={`Editar ${product.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                        <span className="ml-1.5">Editar</span>
                      </Button>
                      <Button
                        onClick={() => handleDelete(product)}
                        size="sm"
                        variant="outline"
                        className={`h-9 ${
                          deletingId === product.id
                            ? 'border-rose-500 bg-rose-500 text-white hover:bg-rose-600'
                            : 'border-rose-200 text-rose-600 hover:bg-rose-50'
                        }`}
                        aria-label={`Eliminar ${product.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="ml-1.5">
                          {deletingId === product.id ? 'Confirmar?' : 'Eliminar'}
                        </span>
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Fase 7 — propostas enviadas: acompanhar, contrapropor, aceitar */}
          <MyProposals />
        </div>
      </div>
    </div>
  );
}

/* ═══════════ Serviço ao domicílio: rastreamento + conclusão (pontos 4B/5) ═══════════ */

/**
 * Cartão do serviço ao domicílio pago:
 *  - Polling a cada 3 s contra GET /api/orders/[id]/tracking (Fase 16);
 *  - Mapa Leaflet: prestador (azul) + cliente aproximado (vermelho) + ETA
 *    + linha de trajeto (história das posições entre polls);
 *  - Botão «Confirmar conclusão» — o ESCROW só é libertado APÓS esta
 *    confirmação do cliente (nunca antes).
 */
function DomicilioServiceCard({
  order,
  onConfirmed,
}: {
  order: OrderRecord;
  onConfirmed: () => void;
}) {
  const { toast } = useToast();
  const [tracking, setTracking] = useState<TrackingData | null>(null);
  const [trail, setTrail] = useState<[number, number][]>([]);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(order.status === 'entregue');

  /* ── Polling de rastreamento (a cada 3 s) enquanto o pedido está pago ── */
  useEffect(() => {
    if (confirmed) return;
    let active = true;

    const load = () => {
      fetch(`/api/orders/${order.id}/tracking`, {
        headers: authHeaders(),
        cache: 'no-store',
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { tracking?: TrackingData } | null) => {
          if (active && data?.tracking) {
            const t = data.tracking;
            setTracking(t);
            /* 🧵 Acumula o trajeto do prestador (máx. 60 pontos) — só quando
               a posição é exata (pós-pagamento) para não desenhar ruído. */
            if (t.prestador_lat != null && t.prestador_lng != null && !t.provider_fuzzed) {
              setTrail((prev) => {
                const last = prev[prev.length - 1];
                if (last && last[0] === t.prestador_lat && last[1] === t.prestador_lng) {
                  return prev; // posição repetida — não acumular
                }
                const next = [...prev, [t.prestador_lat as number, t.prestador_lng as number] as [number, number]];
                return next.length > 60 ? next.slice(next.length - 60) : next;
              });
            }
          }
        })
        .catch(() => {});
    };

    load();
    const t = setInterval(load, 3_000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [order.id, confirmed]);

  /* ── Ponto 5: confirmação de conclusão → liberta o escrow ── */
  async function handleConfirm() {
    if (confirming) return;
    setConfirming(true);
    try {
      const res = await fetch(`/api/orders/${order.id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; message?: string };
      if (!res.ok || !data.ok) {
        toast({ title: 'Não foi possível confirmar', description: data.error });
        return;
      }
      setConfirmed(true);
      toast({
        title: 'Serviço concluído ✓',
        description:
          data.message ??
          'Obrigado! O pagamento foi libertado ao prestador da AngoStart.',
      });
      onConfirmed();
    } catch {
      toast({ title: 'Erro de ligação', description: 'Tenta novamente.' });
    } finally {
      setConfirming(false);
    }
  }

  const prestadorEnCaminho =
    !confirmed &&
    (tracking?.tracking_active || tracking?.service_started_at != null);

  return (
    <div className="mt-3 rounded-2xl border border-slate-700/60 bg-slate-900 p-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-white">
        <MapPin className="h-4 w-4 text-sky-400" />
        Serviço ao domicílio — acompanhamento em direto
      </p>

      <div className="mt-3">
        <ServiceTrackingMap tracking={tracking} orderId={order.id} trail={trail} />
      </div>

      {!confirmed && !prestadorEnCaminho && (
        <p className="mt-2 text-xs text-amber-300">
          O prestador ainda não iniciou a deslocação — o mapa ativa-se
          automaticamente quando ele carregar em «Iniciar deslocação».
        </p>
      )}

      <div className="mt-3">
        {confirmed ? (
          <p className="flex items-center gap-1.5 text-xs font-semibold text-blue-300">
            <CheckCircle2 className="h-4 w-4" />
            Serviço concluído e confirmado — pagamento libertado ao prestador.
          </p>
        ) : (
          <>
            <Button
              type="button"
              onClick={handleConfirm}
              disabled={confirming}
              className="h-11 w-full bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              {confirming ? 'A confirmar…' : 'Confirmar conclusão do serviço'}
            </Button>
            <p className="mt-1.5 text-center text-[11px] text-slate-400">
              Só confirma quando o serviço estiver feito — o dinheiro só sai do
              escrow após a tua confirmação.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
