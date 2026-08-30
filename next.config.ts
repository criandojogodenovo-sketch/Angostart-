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
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      // Blob privado é servido pela própria origem (/api/media/…)
      "connect-src 'self' https:",
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
