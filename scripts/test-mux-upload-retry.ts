/**
 * AngoStart — Teste da lógica de upload Mux (retry, backoff, MIME, erros).
 *
 * Corre com bun (corre TypeScript nativamente):
 *   bun scripts/test-mux-upload-retry.ts
 *
 * Mocka XMLHttpRequest global para simular:
 *  - falha de rede 2× e sucesso na 3.ª tentativa (retry com backoff);
 *  - HTTP 400 → sem retry (rejeição definitiva);
 *  - HTTP 503 → retry até esgotar;
 *  - timeout → mensagem específica;
 *  - resolveVideoMime por extensão (File.type vazio nos WebViews).
 */
import {
  MuxUploadError,
  isAcceptableVideoFile,
  putFileToMux,
  resolveVideoMime,
  safeOrigin,
} from '../src/lib/mux-upload-client';

/* ─────────────────────────── Mock de XHR ─────────────────────────── */

interface MockScenario {
  /** Respostas em sequência: 'network' | 'timeout' | número (status HTTP). */
  sequence: Array<'network' | 'timeout' | number>;
}

let currentScenario: MockScenario = { sequence: [] };
let attemptCount = 0;
const realTimers = { setTimeout: globalThis.setTimeout };

// Backoff real (1s/2s/4s) tornaria o teste lento — aceleramos 20×,
// mantendo a PROPORÇÃO exponencial 1→2→4 para validar a sequência.
(globalThis as Record<string, unknown>).setTimeout = ((fn: () => void, ms: number) =>
  realTimers.setTimeout(fn, Math.min(ms / 20, 400))) as typeof setTimeout;

class MockXMLHttpRequest {
  static lastInstance: MockXMLHttpRequest | null = null;
  status = 0;
  responseText = '';
  timeout = 0;
  upload = { onprogress: null as ((e: ProgressEvent) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor() {
    MockXMLHttpRequest.lastInstance = this;
  }

  open(_method: string, url: string) {
    if (!url.startsWith('https://')) throw new Error('URL deve ser https');
  }
  setRequestHeader(_k: string, _v: string) {}

  send() {
    const step = currentScenario.sequence[attemptCount] ?? 200;
    attemptCount += 1;
    realTimers.setTimeout(() => {
      if (step === 'network') this.onerror?.();
      else if (step === 'timeout') this.ontimeout?.();
      else {
        this.status = step as number;
        this.responseText = `corpo ${step}`;
        this.onload?.();
      }
    }, 0);
  }
}

(globalThis as Record<string, unknown>).XMLHttpRequest = MockXMLHttpRequest;
(globalThis as Record<string, unknown>).window = { location: { origin: 'https://angostart.vercel.app' } };

/* Silencia os logs de diagnóstico (mantém a saída do teste limpa). */
(console as unknown as { info: () => void; warn: () => void }).info = () => {};
(console as unknown as { warn: () => void }).warn = () => {};
const consoleErrors: unknown[] = [];
(console as unknown as { error: (msg: unknown, ...rest: unknown[]) => void }).error = (
  msg: unknown,
  ...rest: unknown[]
) => consoleErrors.push({ msg, rest });

function makeFile(sizeBytes: number, name: string, type = ''): File {
  return { name, type, size: sizeBytes } as unknown as File;
}

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}`);
  }
}

/* ───────────────────────────── Testes ───────────────────────────── */

async function run() {
  const onProgress = () => {};

  console.log('— resolveVideoMime (File.type vazio nos WebViews) —');
  check('mp4 por extensão', resolveVideoMime(makeFile(1, 'a.MP4')) === 'video/mp4');
  check('mov → video/quicktime', resolveVideoMime(makeFile(1, 'clip.mov')) === 'video/quicktime');
  check('webm', resolveVideoMime(makeFile(1, 'x.webm')) === 'video/webm');
  check('tipo explícito tem prioridade', resolveVideoMime(makeFile(1, 'a.bin', 'video/quicktime')) === 'video/quicktime');
  check('desconhecido → video/mp4 (default)', resolveVideoMime(makeFile(1, 'a.bin')) === 'video/mp4');

  console.log('— isAcceptableVideoFile —');
  check('mp4 vazio aceitável', isAcceptableVideoFile(makeFile(1, 'v.mp4', '')));
  check('mov vazio aceitável', isAcceptableVideoFile(makeFile(1, 'v.mov', '')));
  check('zip rejeitado', !isAcceptableVideoFile(makeFile(1, 'f.zip', 'application/zip')));

  console.log('— safeOrigin —');
  check('origem extraída', safeOrigin('https://storage.googleapis.com/x?sig=a') === 'https://storage.googleapis.com');
  check('inválido → marcador', safeOrigin('não-é-url') === 'origem-inválida');

  console.log('— putFileToMux: rede falha 2× e sucesso na 3.ª —');
  attemptCount = 0;
  currentScenario = { sequence: ['network', 'network', 200] };
  const progressValues: number[] = [];
  let ok = false;
  try {
    await putFileToMux(
      'https://storage.googleapis.com/upload?sig=abc',
      makeFile(838_860, 'teste.mp4', 'video/mp4'),
      (p) => progressValues.push(p)
    );
    ok = true;
  } catch {
    ok = false;
  }
  check('conclui após retries', ok);
  check('3 tentativas XHR', attemptCount === 3);
  check('progress reiniciado entre tentativas', progressValues[0] === 0);

  console.log('— putFileToMux: HTTP 400 → sem retry —');
  attemptCount = 0;
  currentScenario = { sequence: [400] };
  let http400: MuxUploadError | null = null;
  try {
    await putFileToMux('https://storage.googleapis.com/u?sig=x', makeFile(1, 'v.mp4', 'video/mp4'), onProgress);
  } catch (e) {
    http400 = e as MuxUploadError;
  }
  check('lança MuxUploadError', http400 instanceof MuxUploadError);
  check('kind http + status 400', http400?.kind === 'http' && http400?.status === 400);
  check('mensagem fala em expiração', /expirado/.test(http400?.message ?? ''));
  check('sem retry em 4xx', attemptCount === 1);

  console.log('— putFileToMux: HTTP 503 → retry até esgotar (4 tentativas) —');
  attemptCount = 0;
  currentScenario = { sequence: [503, 503, 503, 503, 503] };
  let http503: MuxUploadError | null = null;
  try {
    await putFileToMux('https://storage.googleapis.com/u?sig=x', makeFile(1, 'v.mp4', 'video/mp4'), onProgress);
  } catch (e) {
    http503 = e as MuxUploadError;
  }
  check('esgota as 4 tentativas', attemptCount === 4);
  check('falha final http 503', http503?.status === 503);

  console.log('— putFileToMux: timeout → mensagem de 2 minutos —');
  attemptCount = 0;
  /* 5 tentativas em timeout (1 inicial + 3 retries + margem). */
  currentScenario = { sequence: ['timeout', 'timeout', 'timeout', 'timeout', 'timeout'] };
  let timeoutErr: MuxUploadError | null = null;
  try {
    await putFileToMux('https://storage.googleapis.com/u?sig=x', makeFile(1, 'v.mp4', 'video/mp4'), onProgress);
  } catch (e) {
    timeoutErr = e as MuxUploadError;
  }
  check('kind timeout', timeoutErr?.kind === 'timeout');
  check('mensagem menciona 2 minutos', /2 minutos/.test(timeoutErr?.message ?? ''));

  console.log('— logs de diagnóstico —');
  check(
    'console.error registou falhas com contexto',
    consoleErrors.length > 0 &&
      JSON.stringify(consoleErrors[0]).includes('network')
  );

  console.log(`\n${passed} passarão | ${failed} falharam`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error('Erro fatal no teste:', e);
  process.exit(1);
});
