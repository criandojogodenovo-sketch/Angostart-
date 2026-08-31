/**
 * Prova de correção — URL que o groq-sdk constrói, com e sem o override.
 * Intercepta fetch e captura o URL real da chamada (sem rede).
 *
 *   node scripts/verify-groq-url.mjs
 */
import Groq from 'groq-sdk';

const captured = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  captured.push(String(url));
  return new Response(
    JSON.stringify({ error: { message: 'captured', type: 'test' } }),
    { status: 401, headers: { 'content-type': 'application/json' } }
  );
};

async function probe(label, opts) {
  captured.length = 0;
  const client = new Groq({ apiKey: 'gsk_dummy_para_teste', maxRetries: 0, ...opts });
  try {
    await client.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 5,
    });
  } catch {
    /* resposta fake 401 — só interessa o URL */
  }
  console.log(`${label}\n  → ${captured[0] ?? '(nenhum fetch)\n'}`);
}

await probe('ANTES (com baseURL override — o bug da Vercel):', {
  baseURL: 'https://api.groq.com/openai/v1',
});
await probe('AGORA  (sem baseURL — fix, igual a src/lib/groq.ts):', {});

globalThis.fetch = realFetch;
