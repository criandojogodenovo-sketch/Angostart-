/**
 * AngoStart — Níveis de vendedor por volume de vendas (Fase 9).
 *
 * ⚡ Client-safe: usado no servidor (APIs) e no cliente (badges de perfil).
 * Bronze → Prata → Ouro → Platina, pelo número de vendas concluídas
 * (encomendas com status `pago` em que o vendedor participou).
 */

export type SellerLevel = 'Bronze' | 'Prata' | 'Ouro' | 'Platina';

export interface LevelInfo {
  level: SellerLevel;
  /** Vendas concluídas. */
  sales: number;
  /** Vendas que faltam para o nível seguinte (null no topo). */
  next: number | null;
  /** Cor Tailwind do badge. */
  color: string;
}

const THRESHOLDS: { level: SellerLevel; min: number }[] = [
  { level: 'Platina', min: 50 },
  { level: 'Ouro', min: 25 },
  { level: 'Prata', min: 10 },
  { level: 'Bronze', min: 0 },
];

/** Nível a partir do número de vendas. */
export function levelFromSales(sales: number): LevelInfo {
  const s = Math.max(0, Math.floor(sales));
  for (const t of THRESHOLDS) {
    if (s >= t.min) {
      const upper = THRESHOLDS[THRESHOLDS.indexOf(t) - 1];
      const color =
        t.level === 'Platina'
          ? 'bg-slate-200 text-slate-800'
          : t.level === 'Ouro'
            ? 'bg-amber-100 text-amber-800'
            : t.level === 'Prata'
              ? 'bg-sky-100 text-sky-800'
              : 'bg-orange-100 text-orange-800';
      return { level: t.level, sales: s, next: upper ? upper.min - s : null, color };
    }
  }
  return { level: 'Bronze', sales: s, next: 10 - s, color: 'bg-orange-100 text-orange-800' };
}
