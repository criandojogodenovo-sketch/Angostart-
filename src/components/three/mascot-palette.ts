/**
 * AngoStart — Paleta da mascote (Fase 22/23/24).
 *
 * Constantes partilhadas entre a mascote 3D da HOME (Avatar3D), a do CHAT
 * (ChatMascot), a do PAINEL de vendas (DashboardMascot) e os fallbacks 2D
 * (Mascot2D): garantir que são visualmente O MESMO personagem — mesma pele,
 * mesmo cabelo, mesma barba, mesma camisa — sem duplicar strings nem
 * arrastar o chunk WebGL entre contextos (este ficheiro pesa ~0).
 *
 * Fase 24 («cartoon 3D premium», refs: rapaz de óculos + barba, camisa
 * cinza/roxa): camisa INDIGO-VIOLET (a «roxa» premium da ref. 2, sintonizada
 * com o gradiente de marca blue-600→purple-600), barba escura definida,
 * óculos de vidro (transmission) e smartwatch.
 */

/* ── Pele (continuidade de marca — tom angolano) ── */
export const SKIN = '#f2b380';
export const SKIN_DARK = '#e09a66';
export const SKIN_NOSE = '#e6a271';

/* ── Camisa «roxa premium» com botões (ref. imagem 2) ── */
export const SHIRT = '#5a4fd6';
export const SHIRT_DARK = '#473db3';
export const BUTTON = '#2a2450';

/* ── Cabelo escuro + barba definida (ref. imagens 1 e 2) ── */
export const HAIR = '#2b2742';
export const BEARD = '#332e4e';
export const EYES_IRIS = '#4a3525';

/* ── Óculos / smartwatch / boca ── */
export const DARK = '#1e293b';
export const FRAME = '#1f2430';
export const WATCH_SCREEN = '#2dd4bf';
export const TEETH = '#f8fafc';
export const LIPS = '#a04a38';
export const INNER_MOUTH = '#5b1f2a';
