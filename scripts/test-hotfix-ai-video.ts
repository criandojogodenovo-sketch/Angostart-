/**
 * AngoStart — Teste do hotfix "IA timeout/rate limit e vídeo": verifica
 * os valores de timeout (45s/30s), o Gemini na cadeia de fallback, o
 * orçamento de tempo (deadline) e as mensagens de erro do microfone.
 *
 * Corre com bun:
 *   bun scripts/test-hotfix-ai-video.ts
 */

import { mock } from 'bun:test';

/* `server-only` lança fora de RSC — stub para o teste importar o módulo. */
mock.module('server-only', () => ({}));

/* db.ts valida a connection string no import (ligação é lazy — sem rede). */
process.env.DATABASE_URL = 'postgres://dummy:dummy@localhost:5432/dummy';

const { PROVIDERS, runFallbackChain, callProvider } = await import(
  '../src/lib/ai/providers'
);

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.error(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

console.log('— Timeouts (hotfix 45s/30s) e cadeia —');
const bai = PROVIDERS.find((p) => p.name === 'bai')!;
const or = PROVIDERS.find((p) => p.name === 'openrouter')!;
const gemini = PROVIDERS.find((p) => p.name === 'gemini')!;
const groq = PROVIDERS.find((p) => p.name === 'groq')!;

check('B.AI timeout = 45 000 ms (era 15 000)', bai.timeoutMs === 45_000, `${bai.timeoutMs}`);
check('OpenRouter timeout = 30 000 ms (era 8 000)', or.timeoutMs === 30_000, `${or.timeoutMs}`);
check('Gemini timeout = 30 000 ms', gemini.timeoutMs === 30_000, `${gemini.timeoutMs}`);
check('B.AI na cadeia', bai.inChain === true);
check('OpenRouter na cadeia', or.inChain === true);
check('Gemini ATIVADO na cadeia (3.º fallback)', gemini.inChain === true);
check('Groq continua como reserva (fora da cadeia)', groq.inChain === false);

console.log('— Override por env (tuning sem deploy, resolvido na chamada) —');
const baiOverride = PROVIDERS.find((p) => p.name === 'bai')!;
check('default estático do B.AI = 45 000 ms', baiOverride.timeoutMs === 45_000, `${baiOverride.timeoutMs}`);

/* O override é dinâmico (lido dentro do callProvider): com env=1200 ms e
   um fetch que nunca responde, a chamada tem de abortar em ~1,2 s — não
   nos 45 s do default. */
const realFetch2 = globalThis.fetch;
(globalThis as Record<string, unknown>).fetch = (async (
  _url: unknown,
  init?: { signal?: AbortSignal }
) => {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () =>
      reject(new Error('aborted'))
    );
  });
}) as typeof fetch;
process.env.B_AI_API_KEY = 'test-key';
process.env.AI_TIMEOUT_BAI_MS = '1200';
const tOv = Date.now();
let abortou = false;
try {
  await callProvider(baiOverride, 'm', [{ role: 'user', content: 'x' }], {}, null);
} catch {
  abortou = true;
}
const msOv = Date.now() - tOv;
check(
  `AI_TIMEOUT_BAI_MS=1200 aborta a chamada em ~1,2 s (demorou ${msOv} ms)`,
  abortou && msOv >= 1_100 && msOv < 3_000
);
delete process.env.AI_TIMEOUT_BAI_MS;
delete process.env.B_AI_API_KEY;
(globalThis as Record<string, unknown>).fetch = realFetch2;

console.log('— Orçamento de tempo (deadline) —');
/* Provider fake que nunca responde dentro do timeout: usa a rede real? NÃO —
   injetamos um fetch fake global que demora "para sempre" até o abort. */
const realFetch = globalThis.fetch;
let chamadas = 0;
(globalThis as Record<string, unknown>).fetch = (async (
  _url: unknown,
  init?: { signal?: AbortSignal }
) => {
  chamadas++;
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () =>
      reject(new Error('aborted'))
    );
  });
}) as typeof fetch;

/* Chave mínima para a cadeia tentar o provider. */
process.env.B_AI_API_KEY = 'test-key';

const t0 = Date.now();
const resultado = await runFallbackChain(
  [{ role: 'user', content: 'ping' }],
  'text',
  { maxTokens: 10 },
  'chat',
  Date.now() + 4_000 /* deadline 4 s no futuro */
);
const decorrido = Date.now() - t0;
check('deadline interrompe a cadeia (retorna null)', resultado === null);
check(
  'respeitou o orçamento de ~4 s (foi de 3,0 a 6,5 s)',
  decorrido >= 3_000 && decorrido < 6_500,
  `${decorrido} ms`
);
check('só 1 tentativa de rede (não entrou noutros providers)', chamadas === 1, `${chamadas}`);

/* Com orçamento apertado, o 2.º provider NEM é chamado (< 3 s úteis). */
chamadas = 0;
process.env.OPENROUTER_API_KEY = 'test-key-or';
const t1 = Date.now();
await runFallbackChain(
  [{ role: 'user', content: 'ping' }],
  'text',
  { maxTokens: 10 },
  'chat',
  Date.now() + 2_000
);
const decorrido2 = Date.now() - t1;
check('deadline < 3 s corta a cadeia antes de esgotar providers', chamadas === 1, `${chamadas}`);
check('corte imediato (< 2,5 s)', decorrido2 < 2_500, `${decorrido2} ms`);

(globalThis as Record<string, unknown>).fetch = realFetch;
delete process.env.B_AI_API_KEY;
delete process.env.OPENROUTER_API_KEY;

console.log('— callProvider: sinal de abort com override mínimo —');
try {
  await callProvider(
    { ...bai, timeoutMs: 60_000 },
    'modelo-teste',
    [{ role: 'user', content: 'x' }],
    {},
    null,
    1_500 /* override < min permitido → clamp a 1 000 ms */
  );
  check('override 1,5 s aborta chamada pendente', false, 'não lançou');
} catch {
  check('override 1,5 s aborta chamada pendente', true);
}

console.log('— Mensagens do microfone (SupportChatWidget.micErrorMessage) —');
const widget = await import('../src/components/SupportChatWidget');
/* micErrorMessage não é exportado — valida indiretamente os nomes DOM
   cobertos: verificamos via fonte. */
const { readFileSync } = await import('node:fs');
const fonte = readFileSync('src/components/SupportChatWidget.tsx', 'utf8');
check('NotAllowedError → mensagem de permissão com cadeado', fonte.includes("'NotAllowedError'") && fonte.includes('cadeado'));
check('NotFoundError → mensagem sem microfone', fonte.includes("'NotFoundError'") && fonte.includes('Nenhum microfone'));
check('NotReadableError → mensagem micro ocupado', fonte.includes("'NotReadableError'") && fonte.includes('outra aplicação'));
check('SecurityError → mensagem HTTPS', fonte.includes("'SecurityError'") && fonte.includes('HTTPS'));
check('guarda para navegador sem mediaDevices (HTTP antigo)', fonte.includes('!navigator.mediaDevices?.getUserMedia'));
check('timeout do cliente = 70 s (CHAT_TIMEOUT_MS)', fonte.includes('CHAT_TIMEOUT_MS = 70_000'));

console.log('— Upload: callback de retry para a UI —');
const muxClientFonte = readFileSync('src/lib/mux-upload-client.ts', 'utf8');
check('putFileToMux aceita onRetryAttempt', muxClientFonte.includes('onRetryAttempt?'));
check('notifica tentativa 2..4 com máximo correto', muxClientFonte.includes('attempt + 2, RETRY_DELAYS_MS.length + 1'));

console.log('— Webhook: logs de diagnóstico —');
const webhookFonte = readFileSync('src/app/api/mux/webhook/route.ts', 'utf8');
check('401 de assinatura loga causas (MUX_WEBHOOK_SECRET)', webhookFonte.includes('MUX_WEBHOOK_SECRET não definido'));
check('evento recebido loga tipo+asset+passthrough', webhookFonte.includes('evento ${type'));
check('transição READY loga playback+duração', webhookFonte.includes('→ READY'));

console.log(`\n═══ Resultado: ${pass} passaram, ${fail} falharam ═══`);
process.exit(fail > 0 ? 1 : 0);
