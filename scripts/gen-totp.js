// Gera um código TOTP a partir de uma URL otpauth:// (ficheiro)
// Uso: node scripts/gen-totp.js <ficheiro_com_url_otpauth>
const fs = require('fs');
const { TOTP, NobleCryptoPlugin, ScureBase32Plugin } = require('otplib');

const file = process.argv[2];
const raw = fs.readFileSync(file, 'utf8');
const match = raw.match(/secret=([A-Z2-7]+)/);
if (!match) {
  console.error('secret não encontrado');
  process.exit(1);
}
const totp = new TOTP({
  secret: match[1],
  crypto: new NobleCryptoPlugin(),
  base32: new ScureBase32Plugin(),
});
totp.generate().then((code) => console.log(code));
