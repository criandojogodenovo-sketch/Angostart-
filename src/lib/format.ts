/**
 * AngoStart — Utilitários de formatação (valores em Kwanza).
 */

/** Formata um inteiro como "12.500 Kz" (formato usado em Angola). */
export function formatKz(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  const grouped = safe.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${grouped} Kz`;
}

/** Formata a data no padrão de Angola (dd/mm/aaaa hh:mm). */
export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
