'use client';

/**
 * AngoStart — Cartão «Foto de Perfil» (Fase 16).
 *
 * Upload CLIENT-SIDE (Vercel Blob via /api/upload/image, namespace
 * `perfil/<userId>/…`) + gravação em users.profile_image via
 * POST /api/perfil/avatar. Visível para clientes e vendedores.
 *
 * 📈 Nota de confiança: fotos reais aumentam a confiança dos clientes.
 */

import { useRef, useState } from 'react';
import { Camera, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { authHeaders, type AuthUser } from '@/context/AuthContext';
import { uploadFileSmart, safeFileName } from '@/lib/upload-client';

export default function ProfilePhotoCard({
  user,
  onUpdated,
}: {
  user: AuthUser;
  /** Atualiza o utilizador no contexto após guardar. */
  onUpdated?: (patch: Partial<AuthUser>) => void;
}) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [photo, setPhoto] = useState<string | null>(user.profile_image ?? null);

  const initials = (user.name || 'U')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  async function pickPhoto(file: File) {
    if (!user.id) return;
    setUploading(true);
    const result = await uploadFileSmart({
      file,
      pathname: `perfil/${user.id}/${safeFileName(file.name, 'perfil.jpg')}`,
      handleUploadUrl: '/api/upload/image',
      maxBytes: 5 * 1024 * 1024,
      allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
      acceptExtensions: ['jpg', 'jpeg', 'png', 'webp'],
      makeUrl: (pathname) => `/api/media/${pathname}`,
    });
    if (!result.ok) {
      setUploading(false);
      toast({
        title:
          result.kind === 'too-large'
            ? 'Foto demasiado grande'
            : result.kind === 'network'
              ? 'Sem ligação'
              : 'Upload falhou',
        description: result.error,
        variant: 'destructive',
      });
      return;
    }

    // Grava na BD
    try {
      const res = await fetch('/api/perfil/avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ profile_image: result.url }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast({ title: 'Não foi possível guardar', description: data.error, variant: 'destructive' });
        return;
      }
      setPhoto(result.url);
      onUpdated?.({ profile_image: result.url });
      toast({
        title: 'Foto de perfil guardada ✓',
        description: 'Ficas mais reconhecível para clientes e prestadores.',
      });
    } catch {
      toast({
        title: 'Sem ligação',
        description: 'A foto foi enviada, mas não foi guardada — tenta de novo.',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  }

  async function removePhoto() {
    setRemoving(true);
    try {
      const res = await fetch('/api/perfil/avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ clear: true }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        setPhoto(null);
        onUpdated?.({ profile_image: null });
        toast({ title: 'Foto removida' });
      } else {
        toast({ title: 'Não foi possível remover', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Sem ligação', description: 'Tenta novamente.', variant: 'destructive' });
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
        <Camera className="h-5 w-5 text-blue-600" /> Foto de Perfil
      </h2>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        {photo ? (
          <img
            src={photo}
            alt={`Foto de ${user.name}`}
            className="h-20 w-20 rounded-full border-2 border-blue-200 object-cover"
          />
        ) : (
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-xl font-bold text-white">
            {initials}
          </span>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <label
              htmlFor="perfil-foto-upload"
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              {photo ? 'Trocar foto' : 'Escolher foto'}
            </label>
            {photo && (
              <Button
                variant="outline"
                size="sm"
                disabled={removing}
                onClick={removePhoto}
                className="h-10 border-rose-200 text-rose-600 hover:bg-rose-50"
              >
                {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Remover
              </Button>
            )}
          </div>
          <input
            ref={inputRef}
            id="perfil-foto-upload"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) pickPhoto(file);
              e.target.value = '';
            }}
          />
          <p className="max-w-xs text-xs text-slate-500">
            JPG, PNG ou WebP — máx. 5 MB.
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-xl border border-teal-200 bg-teal-50/60 p-3">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
        <p className="text-xs text-teal-900">
          <span className="font-semibold">Usa uma foto real e de qualidade.</span> Fotos
          polidas aumentam a confiança dos clientes em 40% — rosto visível, boa luz e
          fundo simples.
        </p>
      </div>
    </div>
  );
}
