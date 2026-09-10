'use client';

/**
 * GOMBUONE — Modal «Criar Publicação» (feed social).
 *
 * Vendedor escreve título + conteúdo, anexa UMA imagem opcional
 * (upload directo ao Vercel Blob, namespace publicacoes/<id>/) e
 * confirma/personaliza o seu CÓDIGO DE CONTACTO (CONTATO-XXXXXX) —
 * pré-preenchido a partir de GET /api/users/me/contact-code.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { authHeaders, useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  safeFileName,
  uploadFileSmart,
} from '@/lib/upload-client';

const MAX_TITLE = 200;
const MAX_CONTENT = 2000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp'] as const;
const CODE_RE = /^CONTATO-[A-Z0-9]{4,12}$/;

export interface CreatedPost {
  id: number;
  title: string;
  content: string;
  image_url: string | null;
  contact_code: string | null;
  created_at: string;
}

export default function CreatePostDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (post: CreatedPost) => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [contactCode, setContactCode] = useState('');
  const [codeLoaded, setCodeLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const previewUrl = useRef<string | null>(null);

  /* Pré-preenche o código de contacto do vendedor */
  const loadCode = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/users/me/contact-code', {
        headers: authHeaders(),
        cache: 'no-store',
      });
      const data = (await res.json()) as { contact_code?: string; error?: string };
      if (res.ok && data.contact_code) {
        setContactCode(data.contact_code);
      }
    } catch {
      /* deixa vazio — a API gera na publicação */
    } finally {
      setCodeLoaded(true);
    }
  }, [user]);

  useEffect(() => {
    if (open) {
      loadCode();
    } else {
      // reset ao fechar
      setTitle('');
      setContent('');
      setFile(null);
      setUploadPct(null);
      setCodeLoaded(false);
      if (previewUrl.current) {
        URL.revokeObjectURL(previewUrl.current);
        previewUrl.current = null;
      }
      setPreview(null);
    }
  }, [open, loadCode]);

  /* Preview local + limpeza do objectURL */
  useEffect(
    () => () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    },
    []
  );

  function pickImage(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null;
    if (!picked) return;
    if (!IMAGE_TYPES.includes(picked.type as (typeof IMAGE_TYPES)[number])) {
      toast({
        title: 'Formato inválido',
        description: 'Usa JPG, PNG ou WebP.',
      });
      return;
    }
    if (picked.size > MAX_IMAGE_BYTES) {
      toast({
        title: 'Imagem demasiado grande',
        description: 'O limite é 5 MB.',
      });
      return;
    }
    setFile(picked);
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = URL.createObjectURL(picked);
    setPreview(previewUrl.current);
  }

  function clearImage() {
    setFile(null);
    if (previewUrl.current) {
      URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = null;
    }
    setPreview(null);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    if (title.trim().length < 3 || content.trim().length < 3) {
      toast({
        title: 'Falta conteúdo',
        description: 'O título e o conteúdo precisam de pelo menos 3 caracteres.',
      });
      return;
    }
    if (contactCode && !CODE_RE.test(contactCode.trim().toUpperCase())) {
      toast({
        title: 'Código inválido',
        description: 'Formato: CONTATO-LETRAS/NÚMEROS (ex.: CONTATO-ANGOLA).',
      });
      return;
    }

    setSubmitting(true);
    try {
      /* 1. Upload da imagem (se houver) — directo ao Blob */
      let imageUrl: string | null = null;
      if (file && user) {
        setUploadPct(1);
        const result = await uploadFileSmart({
          file,
          pathname: `publicacoes/${user.id}/${safeFileName(file.name, 'foto.jpg')}`,
          handleUploadUrl: '/api/upload/image',
          maxBytes: MAX_IMAGE_BYTES,
          allowedTypes: [...IMAGE_TYPES],
          acceptExtensions: [...IMAGE_EXTS],
          makeUrl: (pathname) => `/api/media/${pathname}`,
          onProgress: (pct) => setUploadPct(pct),
        });
        setUploadPct(null);
        if (!result.ok) {
          toast({
            title: 'Falha no envio da imagem',
            description: result.error ?? 'Tenta novamente.',
          });
          return;
        }
        imageUrl = result.url;
      }

      /* 2. Publicar */
      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          title: title.trim(),
          content: content.trim(),
          image_url: imageUrl,
          contact_code: contactCode.trim().toUpperCase() || undefined,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        post?: CreatedPost;
        contact_code?: string;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.post) {
        if (res.status === 409 && data.contact_code) {
          setContactCode(data.contact_code);
        }
        toast({
          title: 'Não foi possível publicar',
          description: data.error ?? 'Tenta novamente em instantes.',
        });
        return;
      }

      toast({
        title: 'Publicação no ar! 🎉',
        description: 'A tua novidade já está no feed da comunidade.',
      });
      onCreated(data.post);
      onOpenChange(false);
    } catch {
      toast({
        title: 'Erro de ligação',
        description: 'Tenta novamente em instantes.',
      });
    } finally {
      setSubmitting(false);
      setUploadPct(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[92dvh] overflow-y-auto rounded-2xl border-slate-200 bg-white p-0 dark:border-slate-800 dark:bg-slate-950 sm:max-w-lg"
        aria-describedby={undefined}
      >
        <DialogHeader className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <DialogTitle className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
            <Plus className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            Criar Publicação
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-500 dark:text-slate-400">
            Partilha uma novidade dos teus produtos ou serviços com a comunidade.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5">
          {/* Título */}
          <div className="space-y-1.5">
            <Label htmlFor="pub-titulo" className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Título
            </Label>
            <Input
              id="pub-titulo"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={MAX_TITLE}
              placeholder="Ex.: Novo stock de headphones Bluetooth"
              className="dark:bg-slate-900"
            />
          </div>

          {/* Conteúdo */}
          <div className="space-y-1.5">
            <Label htmlFor="pub-conteudo" className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Conteúdo
            </Label>
            <Textarea
              id="pub-conteudo"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={MAX_CONTENT}
              rows={5}
              placeholder="Conta à comunidade o que há de novo…"
              className="min-h-28 dark:bg-slate-900"
            />
            <p className="text-right text-xs text-slate-400">
              {content.length}/{MAX_CONTENT}
            </p>
          </div>

          {/* Imagem */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Imagem (opcional)
            </Label>
            <input
              ref={fileInput}
              type="file"
              accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
              onChange={pickImage}
              className="hidden"
              aria-label="Escolher imagem da publicação"
            />
            {preview ? (
              <div className="relative overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={preview}
                  alt="Pré-visualização da imagem da publicação"
                  className="max-h-72 w-full object-contain bg-slate-50 dark:bg-slate-900"
                />
                <button
                  type="button"
                  onClick={clearImage}
                  aria-label="Remover imagem"
                  className="absolute right-2 top-2 rounded-full bg-slate-900/70 p-2 text-white backdrop-blur transition hover:bg-rose-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-slate-500 transition hover:border-blue-400 hover:text-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-blue-500"
              >
                <ImagePlus className="h-8 w-8" />
                <span className="text-sm font-medium">
                  Toque para escolher uma foto (JPG/PNG/WebP, até 5 MB)
                </span>
              </button>
            )}
            {uploadPct !== null && (
              <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                A enviar imagem… {uploadPct}%
              </div>
            )}
          </div>

          {/* Código de contacto */}
          <div className="space-y-1.5">
            <Label htmlFor="pub-codigo" className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Código de contacto
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="pub-codigo"
                value={contactCode}
                onChange={(e) =>
                  setContactCode(e.target.value.toUpperCase().slice(0, 20))
                }
                placeholder={codeLoaded ? 'CONTATO-XXXXXX' : 'A obter…'}
                className="font-mono dark:bg-slate-900"
              />
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Quem vir o teu post usa este código para chegar ao teu perfil —
              nunca aparece o teu telefone. Podes personalizar (ex.:
              CONTATO-ANGOLA) ou deixar o gerado.
            </p>
          </div>

          {/* Acções */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="h-11 px-5 text-slate-600 dark:text-slate-300"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={submitting}
              className="h-11 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 px-6 font-semibold text-white shadow-md hover:from-blue-700 hover:to-purple-700"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {uploadPct !== null ? 'A enviar…' : 'A publicar…'}
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Publicar
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
