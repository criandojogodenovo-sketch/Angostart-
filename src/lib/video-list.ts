/**
 * AngoStart — utilitários puros para listas de vídeos (aba Busbt).
 *
 * Garante que o estado de cada vídeo é ÚNICO e ESTÁVEL:
 *  - as listas são guardadas por id (Map) — o polling atualiza o
 *    cartão existente em vez de criar um cartão novo;
 *  - ids duplicados (duplo clique, resposta lenta que chega tarde)
 *    nunca produzem cartões duplicados;
 *  - cartões pendentes (uploading/processing) que ainda não chegaram
 *    à resposta do servidor são preservados — evita piscar/resíduos
 *    durante o polling (lag de leitura do pooler).
 *
 * Funções puras e client-safe (sem dependências) — testáveis com bun.
 */

/** Forma estrutural mínima necessária para deduplicar e ordenar. */
export interface VideoLike {
  id: string;
  status?: string | null;
}

/**
 * Funde a lista do servidor (`incoming`) com a lista atual (`prev`),
 * devolvendo uma lista SEM ids duplicados:
 *
 *  - `incoming` manda: o estado fresco do servidor (uploading →
 *    processing → ready) substitui o cartão existente com o MESMO id
 *    — o React reconcilia por `key={v.id}` e atualiza no lugar;
 *  - cartões pendentes de `prev` que o servidor ainda não devolve
 *    (lag de leitura) são mantidos no fim, sem criar duplicados;
 *  - cartões não pendentes de `prev` que o servidor já não devolve
 *    (eliminado pelo dono/admin) desaparecem — o servidor é a verdade.
 *
 * A ordem de `incoming` (created_at DESC no servidor) é preservada.
 */
export function mergeVideosById<T extends VideoLike>(
  prev: readonly T[],
  incoming: readonly T[]
): T[] {
  const byId = new Map<string, T>();

  /* Estado fresco do servidor — fonte da verdade. */
  for (const v of incoming) {
    byId.set(v.id, v);
  }

  /* Pendentes ainda não visíveis no servidor: preserva o cartão
     (sem duplicar — Map ignora ids repetidos). */
  for (const v of prev) {
    if (!byId.has(v.id) && isPendingStatus(v.status)) {
      byId.set(v.id, v);
    }
  }

  return Array.from(byId.values());
}

/** Remove ids duplicados de uma lista (primeira ocorrência ganha). */
export function dedupeVideosById<T extends VideoLike>(
  list: readonly T[]
): T[] {
  const byId = new Map<string, T>();
  for (const v of list) {
    byId.set(v.id, v);
  }
  return Array.from(byId.values());
}

/** Estados que representam um upload ainda em curso. */
export function isPendingStatus(status: VideoLike['status']): boolean {
  return status === 'uploading' || status === 'processing';
}
