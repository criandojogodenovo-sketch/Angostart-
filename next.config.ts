import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), payment=(), geolocation=(self)",
  },
  // HSTS — força HTTPS no browser durante 2 anos (inclui subdomínios)
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js injeta scripts inline para hidratação; sem nonce (estático)
      "script-src 'self' 'unsafe-inline'",
      // Tailwind/Leaflet aplicam estilos inline
      "style-src 'self' 'unsafe-inline'",
      // Tiles dos mapas (Esri/OSMI) + data/blob para imagens locais
      // + thumbnails do Mux (image.mux.com) na grelha Busbt
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      // Blob privado é servido pela própria origem (/api/media/…)
      // + Direct Upload do Mux (PUT storage.googleapis.com) e HLS fetch
      "connect-src 'self' https:",
      // Player Mux: HLS nativo no Safari/iOS usa <video src=stream.mux.com>
      // (sem media-src caía no default-src 'self' e o vídeo não tocava)
      "media-src 'self' blob: https:",
      // hls.js (usado pelo Mux Player) carrega workers de blob:
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  // Permite build de verificação em diretório separado (dev server ativo)
  // sem tocar no .next do servidor de desenvolvimento.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
