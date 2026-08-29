/**
 * AngoStart — Gerador do FAVICON (Fase 4-N)
 *
 * Cria `src/app/icon.png` (128×128) com o logo AngoStart: quadrado
 * arredondado em gradiente verde esmeralda + foguete branco (o mesmo
 * ícone da navbar). O Next.js App Router deteta `src/app/icon.png`
 * automaticamente e injeta as tags <link rel="icon"> no HTML.
 *
 * Executar:  node scripts/generate-icon.js
 * Requisito: sharp (já instalado)
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT = path.join(__dirname, '..', 'src', 'app', 'icon.png');

/* Foguete Lucide (paths de traço, viewBox 24×24) */
const ROCKET_PATHS = [
  'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z',
  'm12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z',
  'M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0',
  'M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5',
];

const SIZE = 512; // canvas SVG (depois reduz para 128)
const ICON = 272; // tamanho do foguete desenhado
const OFFSET = (SIZE - ICON) / 2;
const SCALE = ICON / 24;

const rocketSvg = ROCKET_PATHS.map(
  (d) => `<path d="${d}" fill="none" stroke="#ffffff" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round"/>`
).join('\n  ');

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <linearGradient id="grad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#34d399"/>
      <stop offset="55%" stop-color="#10b981"/>
      <stop offset="100%" stop-color="#047857"/>
    </linearGradient>
  </defs>
  <!-- Quadrado arredondado verde esmeralda -->
  <rect x="16" y="16" width="${SIZE - 32}" height="${SIZE - 32}" rx="104" ry="104" fill="url(#grad)"/>
  <!-- Brilho suave no topo -->
  <ellipse cx="${SIZE / 2}" cy="96" rx="150" ry="70" fill="#ffffff" opacity="0.12"/>
  <!-- Foguete (ícone da marca) -->
  <g transform="translate(${OFFSET}, ${OFFSET + 8}) scale(${SCALE})">
    ${rocketSvg}
  </g>
</svg>`;

async function main() {
  const buffer = await sharp(Buffer.from(svg))
    .resize(128, 128, { kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toBuffer();

  fs.writeFileSync(OUT, buffer);
  const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
  console.log(`✓ Favicon gerado: ${OUT} (${kb} KB, 128×128)`);
}

main().catch((error) => {
  console.error('✗ Falha ao gerar o favicon:', error);
  process.exit(1);
});
