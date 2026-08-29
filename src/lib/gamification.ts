/**
 * AngoStart — Gamificação (Fase 7) — lógica pura PARTILHADA cliente/servidor.
 *
 * Níveis de vendedor por pontos:
 *   bronze 0–499 · prata 500–1999 · ouro 2000–4999 · platina 5000+
 *
 * Pontos: +1 por venda concluída · +5 por avaliação 5 estrelas ·
 *         +10 por resposta ao chat em menos de 1 hora.
 */

export const SELLER_LEVELS = [
  { key: 'bronze', label: 'Bronze', min: 0, max: 499, color: '#b45309', emoji: '🥉' },
  { key: 'prata', label: 'Prata', min: 500, max: 1999, color: '#64748b', emoji: '🥈' },
  { key: 'ouro', label: 'Ouro', min: 2000, max: 4999, color: '#d97706', emoji: '🥇' },
  { key: 'platina', label: 'Platina', min: 5000, max: Infinity, color: '#059669', emoji: '💎' },
] as const;

export type SellerLevelKey = (typeof SELLER_LEVELS)[number]['key'];

/** Nível atual para um total de pontos. */
export function levelFor(points: number): (typeof SELLER_LEVELS)[number] {
  const p = Number.isFinite(points) && points > 0 ? Math.floor(points) : 0;
  return SELLER_LEVELS.find((l) => p >= l.min && p <= l.max) ?? SELLER_LEVELS[0];
}

/** Próximo nível + pontos em falta (null quando já é platina). */
export function nextLevel(points: number): {
  next: (typeof SELLER_LEVELS)[number] | null;
  missing: number;
  progress: number; // 0–1 dentro do nível atual
} {
  const p = Number.isFinite(points) && points > 0 ? Math.floor(points) : 0;
  const current = levelFor(p);
  const next = SELLER_LEVELS[SELLER_LEVELS.indexOf(current) + 1] ?? null;
  if (!next) return { next: null, missing: 0, progress: 1 };
  const span = next.min - current.min;
  const progress = Math.min(Math.max((p - current.min) / span, 0), 1);
  return { next, missing: next.min - p, progress };
}

/** Metadados dos selos (icon → nome do ícone lucide no frontend). */
export const BADGE_META: Record<string, { name: string; description: string; icon: string }> = {
  primeira_venda: {
    name: 'Primeira Venda',
    description: 'Concluíste a tua primeira venda na AngoStart.',
    icon: 'trophy',
  },
  top_vendedor_mes: {
    name: 'Top Vendedor do Mês',
    description: 'Melhor vendedor do mês por receita líquida.',
    icon: 'crown',
  },
  avaliacao_5: {
    name: 'Excelência 5 Estrelas',
    description: 'Média ≥ 4,8 com pelo menos 10 avaliações.',
    icon: 'star',
  },
  vendas_100: {
    name: '100 Vendas',
    description: 'Alcançaste 100 vendas concluídas.',
    icon: 'medal',
  },
  resposta_rapida: {
    name: 'Resposta Rápida',
    description: 'Respondes ao chat em menos de 1 hora (média).',
    icon: 'zap',
  },
  criador_infoprodutos: {
    name: 'Criador de Infoprodutos',
    description: 'Publicou 5 ou mais infoprodutos.',
    icon: 'book',
  },
  prestador_domicilio: {
    name: 'Prestador de Confiança',
    description: 'Concluiu 20 ou mais serviços ao domicílio.',
    icon: 'home',
  },
  freelancer_top: {
    name: 'Freelancer Top',
    description: 'Concluiu 10 ou mais projetos remotos.',
    icon: 'laptop',
  },
};

export const POINTS_RULES = {
  venda: 1,
  avaliacao5: 5,
  respostaRapida: 10,
} as const;
