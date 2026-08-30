/**
 * AngoStart — Utilitários de geolocalização (serviços ao domicílio).
 *
 * Partilhado entre rotas do servidor: validação de coordenadas (Angola),
 * distância de Haversine, tempo estimado de chegada (ETA) e — crítico
 * para privacidade — FUZZING da localização do cliente.
 *
 * 🔒 PRIVACIDADE (regra do produto): a localização EXATA do cliente
 * NUNCA sai do servidor. O prestador vê apenas um ponto aproximado
 * (jitter determinístico dentro de um raio de 500 m), suficiente para
 * chegar ao bairro sem expor a porta de casa.
 */

/** Limites geográficos de Angola (contorno nacional). */
export const ANGOLA_LAT = [-18.5, -4.5] as const;
export const ANGOLA_LNG = [11.0, 25.0] as const;

/** Raio máximo de exposição do cliente ao prestador (metros). */
export const CLIENT_FUZZ_RADIUS_M = 500;

/** Velocidade média de deslocação em Luanda (km/h) para o cálculo da ETA. */
export const AVG_SPEED_KMH = 20;

export function parseCoord(
  value: unknown,
  range: readonly [number, number]
): number | null {
  const num = Number(value);
  if (!Number.isFinite(num) || num < range[0] || num > range[1]) return null;
  return Math.round(num * 1e6) / 1e6;
}

/** Distância em metros entre dois pontos (fórmula de Haversine). */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6_371_000; // raio médio da Terra (m)
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * ETA em minutos com base na distância e velocidade média (ex.: 15 min).
 * Mínimo prático de 1 min; arredondado a múltiplos de 1 min.
 */
export function estimateEtaMinutes(
  meters: number,
  avgKmh: number = AVG_SPEED_KMH
): number {
  if (!Number.isFinite(meters) || meters <= 0) return 0;
  const hours = meters / 1000 / avgKmh;
  return Math.max(1, Math.round(hours * 60));
}

/**
 * Desloca uma coordenada por um offset determinístico (a partir de um
 * seed — tipicamente o id da encomenda) dentro do raio indicado.
 * Mesma encomenda → sempre o mesmo ponto aproximado (não "salta"
 * entre polls); prestadores diferentes de encomendas diferentes →
 * pontos diferentes (não dá para triangular a posição real).
 */
export function fuzzCoordinate(
  lat: number,
  lng: number,
  seed: number,
  maxMeters: number = CLIENT_FUZZ_RADIUS_M
): { lat: number; lng: number } {
  // PRNG determinístico (mulberry32) semeado com o id da encomenda
  let a = (Math.floor(seed) + 0x9e3779b9) >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Direção uniforme + raio com densidade uniforme (sqrt)
  const angle = next() * 2 * Math.PI;
  const radius = Math.sqrt(next()) * maxMeters;

  const dLat = (radius * Math.cos(angle)) / 111_320; // ~m → graus
  const dLng =
    (radius * Math.sin(angle)) /
    (111_320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));

  return {
    lat: Math.round((lat + dLat) * 1e5) / 1e5,
    lng: Math.round((lng + dLng) * 1e5) / 1e5,
  };
}
