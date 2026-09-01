/**
 * Proxy de teste Fase 19b — stub de /api/auth/me à frente do Next standalone.
 * Uso: bun scripts/test-auth-proxy.mjs <porta-proxy> <porta-next> <user-JSON-file>
 * Todas as rotas passam para o Next; /api/auth/me devolve o user do ficheiro.
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';

const [proxyPort, nextPort, userFile] = process.argv.slice(2);
const USER = readFileSync(userFile, 'utf8');

http
  .createServer((req, res) => {
    if (req.url.split('?')[0] === '/api/auth/me') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(USER);
      return;
    }
    const up = http.request(
      {
        host: 'localhost',
        port: Number(nextPort),
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `localhost:${nextPort}` },
      },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      }
    );
    up.on('error', () => {
      res.writeHead(502);
      res.end('proxy upstream error');
    });
    req.pipe(up);
  })
  .listen(Number(proxyPort), () => console.log(`proxy :${proxyPort} → :${nextPort}`));
