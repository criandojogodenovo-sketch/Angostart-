/**
 * AngoStart — Fase 14b: segurança de prompts (anti-injeção).
 *
 * Movido do antigo lib/groq.ts — é independente de provider e aplica-se a
 * TODO o texto de utilizador que entra no modelo (chat de suporte, bios de
 * vendedor, etc.), seja qual for o provider da vez na cadeia.
 */

/**
 * Deteta tentativas clássicas de jailbreak/prompt-injection em texto de
 * utilizador ANTES de chegar a qualquer modelo. Não é exaustivo — é a
 * primeira linha de defesa; o system prompt reforça o comportamento e a
 * resposta é sempre pós-validada.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/i,
  /ignore\s+(as\s+)?(todas\s+)?(as\s+)?(instru[çc][õo]es|regras|prompts?)/i,
  /desconsider(e|a|ar)\s+(as\s+)?(instru[çc][õo]es|regras)/i,
  /(reveal|show|print|dump|repeat)\s+(your|the)\s+(system\s+)?(prompt|instructions)/i,
  /(revela|mostra|imprime|repete|diz[- ]me)\s+(o\s+)?(teu|seu|o)\s*(system\s+)?(prompt|instru[çc][õo]es)/i,
  /you\s+are\s+now\s+(a|an)\s+(?!helpful)/i,
  /(act|behave)\s+as\s+(if\s+you\s+(are|were)\s+)?(a\s+)?(danm?n|jailbreak|dan|unfiltered|uncensored)/i,
  /system\s*[:=]\s*/i,
  /<\/?system>|<\/?instructions?>/i,
  /\bdeveloper\s+mode\b/i,
];

export function containsPromptInjection(text: string): boolean {
  if (!text) return false;
  const normalized = text
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060]/g, ''); // zero-width chars usados para ofuscar
  return INJECTION_PATTERNS.some((re) => re.test(normalized));
}
