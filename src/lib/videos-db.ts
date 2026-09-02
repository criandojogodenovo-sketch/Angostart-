import 'server-only';
import { sql } from '@/lib/db';

/**
 * AngoStart — Helper da tabela `videos` (Busbt / Mux).
 *
 * Segue o padrão de keywords-db: se o deploy chegar à Vercel ANTES de
 * `node scripts/migrate-fase20-busbt.js` correr no Neon, o site NÃO
 * parte — as rotas detectam a tabela em falta (erro 42P01) e respondem
 * com degradação graciosa (lista vazia / erro claro ao publicar).
 */

export type VideoStatus = 'uploading' | 'processing' | 'ready' | 'errored';

export interface VideoRow {
  id: string;
  user_id: number;
  title: string;
  description: string | null;
  status: VideoStatus;
  mux_upload_id: string | null;
  mux_asset_id: string | null;
  playback_id: string | null;
  duration_seconds: number | null;
  error_message: string | null;
  created_at: string;
}

/** TRUE quando o erro é "tabela videos não existe" (migração pendente). */
export function isUndefinedTableError(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
  if (code === '42P01') return true;
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes('does not exist') && msg.includes('videos');
}

/* Memo por processo: depois da 1.ª falha evita repetir o SELECT. */
const globalForVideos = globalThis as unknown as {
  angostartVideosUnavailable: boolean | undefined;
};

export function markVideosUnavailable(): void {
  globalForVideos.angostartVideosUnavailable = true;
}

export function videosUnavailable(): boolean {
  return globalForVideos.angostartVideosUnavailable === true;
}

/** Verifica (uma vez por processo) se a tabela videos já existe. */
export async function videosReady(): Promise<boolean> {
  if (videosUnavailable()) return false;
  try {
    await sql`SELECT 1 FROM videos LIMIT 1`;
    return true;
  } catch (error) {
    if (isUndefinedTableError(error)) {
      markVideosUnavailable();
      return false;
    }
    throw error;
  }
}

/** Metadados públicos do autor de um vídeo (JOIN users). */
export const VIDEO_AUTHOR_COLUMNS = sql`u.name AS author_name, u.username AS author_username, u.role AS author_role, u.is_verified_bi::boolean AS author_verified`;
