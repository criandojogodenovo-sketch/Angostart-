/**
 * AngoStart — Coordenadas das principais cidades angolanas (client-safe).
 * Usado pelo mapa escuro de serviços ao domicílio (Leaflet/CARTO).
 */

export const CIDADES_ANGOLA: Record<string, [number, number]> = {
  luanda: [-8.839, 13.2894],
  talatona: [-8.9187, 13.184],
  viana: [-8.9028, 13.3633],
  cacuaco: [-8.7772, 13.3661],
  benguela: [-12.5763, 13.4055],
  lobito: [-12.3644, 13.5456],
  huambo: [-12.7761, 15.7391],
  lubango: [-14.9177, 13.4925],
  malanje: [-9.5402, 16.341],
  cabinda: [-5.55, 12.2],
  namibe: [-15.1961, 12.1522],
  soyo: [-6.1349, 12.3689],
  sumbe: [-11.2061, 13.8437],
  uige: [-7.6087, 15.0613],
  saurimo: [-9.6608, 20.3911],
  menongue: [-14.6585, 17.691],
  cuito: [-12.3833, 16.9333],
  ndalatando: [-9.2978, 14.9117],
};

/** Resolve o centro inicial a partir da cidade (fallback Luanda). */
export function centerForCity(cidade?: string | null): [number, number] {
  if (!cidade) return CIDADES_ANGOLA.luanda;
  const key = cidade
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  return CIDADES_ANGOLA[key] ?? CIDADES_ANGOLA.luanda;
}
