import type { MetadataRoute } from 'next';

/**
 * GOMBUONE (evolução da AngoStart) — Manifest PWA (Fase 6, ponto 10).
 * Permite instalar a GOMBUONE no telemóvel como app — sem custos.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'GOMBUONE — Infoprodutos, Produtos, Serviços e Campanhas em Angola',
    short_name: 'GOMBUONE',
    description:
      'A tua plataforma angolana de confiança: marketplace, campanhas e oportunidades. Preços em Kwanzas.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0F172A',
    theme_color: '#0F172A',
    lang: 'pt-AO',
    orientation: 'portrait',
    categories: ['shopping', 'business'],
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
