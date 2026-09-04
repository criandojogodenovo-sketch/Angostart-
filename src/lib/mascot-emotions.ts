/**
 * AngoStart — Sistema de reações da mascote do chat (Fase 23).
 *
 * `detectEmotion(texto)` analisa UMA string (resposta da IA ou mensagem do
 * utilizador) e devolve a emoção que a mascote 3D deve exprimir:
 *
 *   'preocupado' → desculpa / erro / problema … (empatia perante falhas)
 *   'feliz'      → obrigado / piada / parabéns … (sorriso + aceno)
 *   'pensativo'  → «vou verificar» … OU resposta longa (bolha de pensamento)
 *   'neutro'     → tudo o resto (sorriso suave de descanso)
 *
 * Regras do CTO:
 *  - Puramente LOCAL: listas de palavras-chave + includes — ZERO chamadas
 *    de API, ZERO latência extra (µs por mensagem);
 *  - Preocupação TEM PRIORIDADE: se a IA mistura «parabéns» com «houve um
 *    erro», a empatia com o problema vence (é o que o utilizador sente);
 *  - Normaliza apenas lowercase — funciona com pt-PT (com acentos) e
 *    escrita sem acentos (telemóveis AO).

 * Exportado também em `/lib` para reutilização em testes futuros.
 */

export type MascotEmotion = 'feliz' | 'preocupado' | 'neutro' | 'pensativo';

/** Sinais negativos → expressão de preocupação (sobrancelhas franzidas). */
const PALAVRAS_PREOCUPADO: readonly string[] = [
  'desculpa',
  'desculpe',
  'erro',
  'erros',
  'problema',
  'problemas',
  'falhou',
  'falha',
  'falhar',
  'infelizmente',
  'não consegui',
  'nao consegui',
  'não foi possível',
  'nao foi possivel',
  'impossível',
  'impossivel',
  'expirou',
  'negado',
  'bloqueado',
  'inválido',
  'invalido',
  'incorreto',
  'incorrecto',
  'lamento',
  'lamentamos',
  'aviso',
  'atenção',
  'atencao',
  'cuidado',
  'sem sucesso',
  'avaria',
];

/** Sinais positivos → sorriso largo + aceno. */
const PALAVRAS_FELIZ: readonly string[] = [
  'obrigado',
  'obrigada',
  'riso',
  'piada',
  'haha',
  'rsrs',
  'parabéns',
  'parabens',
  'felicidades',
  'excelente',
  'ótimo',
  'otimo',
  'sucesso',
  'consegui',
  'conseguido',
  'perfeito',
  'fantástico',
  'fantastico',
  'maravilhoso',
  'maravilhosa',
  'bom trabalho',
  'bem feito',
  'wow',
];

/** Sinais de raciocínio → pose pensativa. */
const PALAVRAS_PENSATIVO: readonly string[] = [
  'deixa-me',
  'deixame',
  'vou verificar',
  'vou analisar',
  'talvez',
  'provavelmente',
  'analisar',
  'verificar',
  'considerar',
  'por outro lado',
  'depende',
  'dependendo',
  'refletir',
  'reflectir',
];

/** Acima deste nº de caracteres → resposta «longa» → pensativo. */
const LIMITE_PENSATIVO = 420;

/**
 * Detecta a emoção de um texto (resposta da IA OU mensagem do utilizador).
 * Simples, síncrona e sem custo — ver regras no topo do ficheiro.
 */
export function detectEmotion(texto: string): MascotEmotion {
  if (!texto) return 'neutro';
  const t = texto.toLowerCase();

  // 1) Empatia primeiro: sinais negativos vencem sempre.
  if (PALAVRAS_PREOCUPADO.some((p) => t.includes(p))) return 'preocupado';

  // 2) Alegria explícita.
  if (PALAVRAS_FELIZ.some((p) => t.includes(p))) return 'feliz';

  // 3) Raciocínio — palavra-chave OU resposta longa (spec do CTO).
  if (PALAVRAS_PENSATIVO.some((p) => t.includes(p))) return 'pensativo';
  if (texto.trim().length > LIMITE_PENSATIVO) return 'pensativo';

  // 4) Descanso.
  return 'neutro';
}
