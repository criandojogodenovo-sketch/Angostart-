'use client';

/**
 * AngoStart — Cartão «Verificação de Identidade» (Fase 12).
 *
 * KYC flexível orientado a FOTOS:
 *  - not_submitted → CTA de upload («Verifica a tua identidade…»); pode vender.
 *  - pending       → documento em análise; pode vender; selo após aprovação.
 *  - verified      → selo azul ativo.
 *  - rejected      → motivo + upload obrigatório de NOVO documento
 *                    (publicação de novos produtos bloqueada até reenvio).
 *
 * Upload: tipo de documento (BI / Passaporte / Cartão de Eleitor) + foto
 * (JPG/PNG/WebP, 5 MB) → POST /api/kyc/upload → POST /api/kyc/submit.
 * BI e data de nascimento são opcionais — completam o perfil.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { BadgeCheck, Clock, Info, Loader2, ShieldAlert, Upload, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { authHeaders, type AuthUser } from '@/context/AuthContext';
import SecureImage from '@/components/SecureImage';
import { calcularIdade } from '@/lib/password';
import {
  KYC_DOCUMENT_TYPES,
  KYC_DOCUMENT_TYPE_LABELS,
  KYC_FILE_ACCEPT,
  KYC_MAX_FILE_MB,
  type KycDocumentType,
} from '@/lib/kyc';

interface KycState {
  tem_bi: boolean;
  bi_number: string | null;
  kyc_status: string;
  is_verified_bi: boolean;
  kyc_document_url: string | null;
  kyc_document_type: string | null;
  kyc_rejection_reason: string | null;
  kyc_submitted_at: string | null;
}

export default function KycVerificationCard({
  user,
  onUpdated,
  compact = false,
}: {
  user: AuthUser;
  /** Atualiza o utilizador no contexto após submissão bem-sucedida. */
  onUpdated?: (patch: Partial<AuthUser>) => void;
  /** Versão compacta para embutir no dashboard (sem margem inferior). */
  compact?: boolean;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [docType, setDocType] = useState<KycDocumentType>('bi');
  const [biNumber, setBiNumber] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [kyc, setKyc] = useState<Partial<KycState>>({
    kyc_status: user.kyc_status ?? 'not_submitted',
    is_verified_bi: user.is_verified_bi ?? false,
  });

  const loadKyc = useCallback(async () => {
    try {
      const res = await fetch('/api/perfil/kyc', { headers: authHeaders(), cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as KycState;
        setKyc(data);
        onUpdated?.({
          kyc_status: data.kyc_status,
          is_verified_bi: data.is_verified_bi,
        });
      }
    } catch {
      /* silencioso */
    }
     
  }, []);

  useEffect(() => {
    loadKyc();
  }, [loadKyc]);

  async function pickPhoto(file: File) {
    if (file.size > KYC_MAX_FILE_MB * 1024 * 1024) {
      toast({
        title: 'Ficheiro demasiado grande',
        description: `A foto do documento deve ter no máximo ${KYC_MAX_FILE_MB} MB.`,
        variant: 'destructive',
      });
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/kyc/upload', {
        method: 'POST',
        headers: authHeaders(),
        body: fd,
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        toast({
          title: 'Upload falhou',
          description: data.error ?? 'Tenta outra imagem.',
          variant: 'destructive',
        });
        return;
      }
      setPhotoUrl(data.url);
      setPreviewUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(file);
      });
      toast({ title: 'Foto carregada ✓', description: 'Agora submete para verificação.' });
    } catch {
      toast({ title: 'Erro de rede no upload', variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (!photoUrl) return;
    if (birthDate) {
      const idade = calcularIdade(birthDate);
      if (idade >= 0 && idade < 15) {
        toast({
          title: 'Idade mínima é 15 anos',
          description: 'Verifica a data de nascimento indicada.',
          variant: 'destructive',
        });
        return;
      }
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/kyc/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          kyc_document_url: photoUrl,
          kyc_document_type: docType,
          bi_number: biNumber.trim() || undefined,
          birth_date: birthDate || undefined,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; message?: string };
      if (!res.ok || !data.ok) {
        toast({ title: 'Não foi possível submeter', description: data.error, variant: 'destructive' });
        return;
      }
      toast({
        title: 'Documento enviado!',
        description: data.message ?? 'A equipa vai analisar e avisamos-te.',
      });
      setPhotoUrl(null);
      setPreviewUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return null;
      });
      setBiNumber('');
      setBirthDate('');
      await loadKyc();
    } catch {
      toast({ title: 'Erro de rede', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  }

  /* ── Estados ── */
  const status = kyc.kyc_status ?? user.kyc_status ?? 'not_submitted';
  const verified = status === 'verified' || kyc.is_verified_bi === true;
  const rejected = status === 'rejected';
  const pending = !verified && !rejected && status === 'pending';
  /* not_submitted (ou estado desconhecido) → pode submeter documento */
  const podeSubmeter = !verified && !pending;

  return (
    <div
      className={`${compact ? '' : 'mb-6'} rounded-3xl border border-slate-200 bg-white p-5 shadow-sm`}
      aria-label="Verificação de identidade"
    >
      <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
        <BadgeCheck className="h-5 w-5 text-sky-500" /> Verificação de Identidade
      </h2>

      {verified ? (
        <p className="mt-2 flex items-center gap-2 rounded-xl bg-sky-50 px-3 py-2.5 text-sm font-semibold text-sky-700">
          <BadgeCheck className="h-4 w-4" /> Identidade verificada — tens o selo azul no perfil, loja
          e produtos!
        </p>
      ) : rejected ? (
        <div className="mt-2 rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
          <p className="flex items-center gap-2 font-semibold">
            <XCircle className="h-4 w-4" /> Documento recusado — publicação de novos produtos
            bloqueada.
          </p>
          {kyc.kyc_rejection_reason && (
            <p className="mt-1 text-rose-600">
              <span className="font-semibold">Motivo:</span> {kyc.kyc_rejection_reason}
            </p>
          )}
          <p className="mt-1 text-xs text-rose-500">
            Envia um novo documento abaixo para desbloquear a publicação.
          </p>
        </div>
      ) : pending ? (
        <p className="mt-2 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-700">
          <Clock className="h-4 w-4" /> Documento em análise pela equipa — podes continuar a vender
          normalmente; o selo azul chega após a aprovação.
        </p>
      ) : (
        <p className="mt-2 flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="font-semibold">Verifica a tua identidade para ganhares mais
            confiança.</span> Podes vender já sem verificação, mas o selo azul só aparece depois de
            aprovarmos a foto do teu documento (BI, Passaporte ou Cartão de Eleitor).
          </span>
        </p>
      )}

      {/* Documento atual (dono vê a própria foto via rota autorizada) */}
      {kyc.kyc_document_url && !podeSubmeter && (
        <div className="mt-4 flex items-center gap-3">
          <SecureImage
            src={kyc.kyc_document_url}
            alt="Documento submetido"
            className="h-16 w-24 rounded-lg border border-slate-200 object-cover"
          />
          <div className="text-xs text-slate-500">
            <p className="font-semibold text-slate-700">
              {kyc.kyc_document_type
                ? KYC_DOCUMENT_TYPE_LABELS[kyc.kyc_document_type as KycDocumentType] ?? 'Documento'
                : 'Documento'}
            </p>
            <p>Submetido para revisão da equipa AngoStart.</p>
          </div>
        </div>
      )}

      {podeSubmeter && (
        <div className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="kyc-doc-type">Tipo de documento</Label>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Tipo de documento">
              {KYC_DOCUMENT_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={docType === t}
                  onClick={() => setDocType(t)}
                  className={`rounded-xl border px-2 py-2 text-xs font-semibold transition-all ${
                    docType === t
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700 ring-1 ring-emerald-500'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-300'
                  }`}
                >
                  {KYC_DOCUMENT_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept={KYC_FILE_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pickPhoto(f);
              e.target.value = '';
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="gap-2"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {photoUrl ? 'Trocar foto' : `Foto do documento (máx. ${KYC_MAX_FILE_MB} MB)`}
            </Button>
            {photoUrl && previewUrl && (
              /* Pré-visualização local (objectURL do ficheiro escolhido) */
               
              <img
                src={previewUrl}
                alt="Pré-visualização do documento"
                className="h-12 w-16 rounded-lg border border-slate-200 object-cover"
              />
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="kyc-bi-optional">N.º do BI (opcional)</Label>
              <Input
                id="kyc-bi-optional"
                type="text"
                placeholder="Ex.: 004587896LA038"
                value={biNumber}
                onChange={(e) => setBiNumber(e.target.value.toUpperCase())}
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kyc-birth-optional">Data de nascimento (opcional)</Label>
              <Input
                id="kyc-birth-optional"
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                className="h-10"
              />
            </div>
          </div>

          <Button
            type="button"
            onClick={submit}
            disabled={submitting || uploading || !photoUrl}
            className="h-10 w-full bg-emerald-500 font-semibold text-white hover:bg-emerald-600 disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> A enviar…
              </>
            ) : rejected ? (
              'Reenviar documento'
            ) : (
              'Enviar para verificação'
            )}
          </Button>
          <p className="flex items-start gap-1.5 text-xs text-slate-400">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            A foto é guardada em armazenamento privado e só é vista pela equipa de verificação
            AngoStart — nunca fica pública.
          </p>
        </div>
      )}
    </div>
  );
}
