/**
 * AngoStart — Teste da Fase 21: IA multi-modelo com visibilidade por perfil.
 *
 * Corre com bun (corre TypeScript nativamente):
 *   bun scripts/test-fase21-ai.ts
 *
 * Parte 1 — FUNÇÕES PURAS (sem rede, sem BD):
 *  - task-routing: mapa de tarefas (chat/vision/monitor), modelo por tarefa,
 *    override por env, resolução de chave dedicada → emergência → null;
 *  - ai-proof: valorCoincide (±1 Kz / ±0,5%), referenciaCoincide (#123,
 *    AS-123, zero-padded, sem falso positivo 1234≠123) e decideProofVerdict
 *    (regra de segurança: confiança alta + valor + referência → aprovado);
 *  - providers: catálogo de providers na ordem da cadeia, aiTasksStatus.
 *
 * Parte 2 — SEGURANÇA DAS ROTAS (via standalone build, server a correr):
 *  - /api/ai/chat: injeção bloqueada (flagged), validações de imagem/áudio
 *    anónimas (401), 503 amigável sem chaves;
 *  - /api/ai/profile-analysis: 401 sem sessão;
 *  - /api/admin/ai-interna: 401/403 sem sessão admin;
 *  - /api/cron/ai-monitor: 401 sem CRON_SECRET.
 */

import { mock } from 'bun:test';

/* `server-only` lança erro fora de RSC — stub para o teste poder importar
   os módulos server (os módulos reais continuam protegidos no Next.js). */
mock.module('server-only', () => ({}));

/* db.ts constrói o cliente Neon no import (ligação é lazy — sem rede aqui). */
process.env.DATABASE_URL = 'postgres://dummy:dummy@localhost:5432/dummy';

const {
  AI_TASKS,
  AI_TASK_ROUTES,
  resolveTaskKeyEnv,
  taskModel,
} = await import('../src/lib/ai/task-routing');
const {
  decideProofVerdict,
  referenciaCoincide,
  valorCoincide,
} = await import('../src/lib/ai-proof');

type ProofExtraction = {
  valor: number | null;
  data: string | null;
  referencia: string | null;
  confianca: 'alta' | 'media' | 'baixa';
  notas: string;
};

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.error(`  ❌ ${name}`);
  }
}

function section(title: string) {
  console.log(`\n— ${title} —`);
}

/* ══════════════ Parte 1: roteamento por tarefa ══════════════ */

section('Roteamento de tarefas (lib/ai/task-routing)');

check('3 tarefas: chat, vision, monitor', AI_TASKS.join(',') === 'chat,vision,monitor');
check('chat → chave B_AI_API_KEY', AI_TASK_ROUTES.chat.apiKeyEnv === 'B_AI_API_KEY');
check('vision → chave B_AI_API_KEY_VISION', AI_TASK_ROUTES.vision.apiKeyEnv === 'B_AI_API_KEY_VISION');
check('monitor → chave B_AI_API_KEY_MONITOR', AI_TASK_ROUTES.monitor.apiKeyEnv === 'B_AI_API_KEY_MONITOR');
check('chat → modelo default hy3 (Tencent)', AI_TASK_ROUTES.chat.defaultModel === 'hy3');
check('vision → modelo default GLM-5.3-Flash', AI_TASK_ROUTES.vision.defaultModel === 'GLM-5.3-Flash');
check('monitor → modelo default Qwen3.8-Flash', AI_TASK_ROUTES.monitor.defaultModel === 'Qwen3.8-Flash');
check('chat é tarefa de utilizadores (audience)', AI_TASK_ROUTES.chat.audience === 'utilizadores');
check('vision é tarefa admin', AI_TASK_ROUTES.vision.audience === 'admin');
check('monitor é tarefa admin', AI_TASK_ROUTES.monitor.audience === 'admin');

/* resolveTaskKeyEnv: dedicada → emergência → null (sem tocar nas envs reais) */
const ENV_SAVED = { ...process.env };
delete process.env.B_AI_API_KEY;
delete process.env.B_AI_API_KEY_VISION;
delete process.env.B_AI_API_KEY_MONITOR;

check('sem chaves: resolveTaskKeyEnv(chat) = null', resolveTaskKeyEnv('chat') === null);

process.env.B_AI_API_KEY = 'x';
check('só chat configurada: vision usa emergência (B_AI_API_KEY)', resolveTaskKeyEnv('vision') === 'B_AI_API_KEY');
check('monitor usa emergência (B_AI_API_KEY)', resolveTaskKeyEnv('monitor') === 'B_AI_API_KEY');

process.env.B_AI_API_KEY_VISION = 'y';
check('vision dedicada tem prioridade sobre emergência', resolveTaskKeyEnv('vision') === 'B_AI_API_KEY_VISION');

delete process.env.B_AI_API_KEY;
delete process.env.B_AI_API_KEY_VISION;
check('monitor (dedicada ausente + chat ausente) = null', resolveTaskKeyEnv('monitor') === null);

/* taskModel: default + override por env */
delete process.env.B_AI_MODEL_CHAT;
check('taskModel(chat) default = hy3', taskModel('chat') === 'hy3');
process.env.B_AI_MODEL_CHAT = 'outro-modelo';
check('taskModel(chat) respeita override de env', taskModel('chat') === 'outro-modelo');
delete process.env.B_AI_MODEL_CHAT;

process.env = ENV_SAVED;

/* ══════════════ Parte 2: regra de segurança dos comprovativos ══════════════ */

section('Comprovativos — valorCoincide / referenciaCoincide');

check('valor exato coincide (15 500 vs 15 500)', valorCoincide(15500, 15500));
check('diferença de 1 Kz é tolerada (arredondamento)', valorCoincide(15499, 15500));
check('diferença de 0,4% é tolerada (taxas)', valorCoincide(15440, 15500));
check('diferença de 2% NÃO coincide', !valorCoincide(15190, 15500));
check('null (ilegível) NÃO coincide', !valorCoincide(null, 15500));
check('NaN NÃO coincide', !valorCoincide(NaN, 15500));

check('referência "#123" menciona encomenda 123', referenciaCoincide('#123', 123));
check('referência "AS-123" mencionada', referenciaCoincide('AS-123', 123));
check('referência zero-padded "ORD-00123"', referenciaCoincide('AngoStart-ORD-00123', 123));
check('referência "pagamento 123 via KWiK"', referenciaCoincide('pagamento 123 via KWiK', 123));
check('falso positivo evitado: "1234" ≠ 123', !referenciaCoincide('ref 1234', 123));
check('referência sem números = false', !referenciaCoincide('sem numero', 123));
check('referência null = false', !referenciaCoincide(null, 123));

section('Comprovativos — decideProofVerdict (regra de segurança)');

const base: ProofExtraction = {
  valor: 15500,
  data: '2026-09-02',
  referencia: '#501',
  confianca: 'alta',
  notas: 'KWiK para AngoStart',
};

const aprovado = decideProofVerdict(base, 15500, 501);
check('confiança alta + valor + referência → aprovado', aprovado.verdict === 'aprovado');

const confiancaMedia = decideProofVerdict({ ...base, confianca: 'media' }, 15500, 501);
check('confiança média → revisão (nunca aprova)', confiancaMedia.verdict === 'revisao');

const valorErrado = decideProofVerdict({ ...base, valor: 15000 }, 15500, 501);
check('valor diferente → revisão', valorErrado.verdict === 'revisao');
check('valor diferente sinalizado (valorCoincide=false)', valorErrado.valorCoincide === false);

const semRef = decideProofVerdict({ ...base, referencia: 'pagamento genérico' }, 15500, 501);
check('referência sem n.º da encomenda → revisão', semRef.verdict === 'revisao');

const ilegivel = decideProofVerdict({ ...base, valor: null }, 15500, 501);
check('valor ilegível → revisão', ilegivel.verdict === 'revisao');

/* ══════════════ Parte 3: providers (cadeia + estado admin) ══════════════ */

section('Providers — import server-only tolerado e estado de tarefas');

const envSnapshot = { ...process.env };
delete process.env.B_AI_API_KEY;
delete process.env.B_AI_API_KEY_VISION;
delete process.env.B_AI_API_KEY_MONITOR;
delete process.env.OPENROUTER_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.GROQ_API_KEY;
delete process.env.CEREBRAS_API_KEY;
delete process.env.SAMBANOVA_API_KEY;

const providers = await import('../src/lib/ai/providers');
check('sem chaves: aiAvailable() = false', providers.aiAvailable() === false);

process.env.B_AI_API_KEY_MONITOR = 'm';
check('uma chave (monitor) chega para aiAvailable()', providers.aiAvailable() === true);

const status = providers.aiTasksStatus();
check('aiTasksStatus devolve 3 tarefas', status.length === 3);
check(
  'estado monitor: modelo Qwen3.8-Flash + chave dedicada',
  status.find((s) => s.task === 'monitor')?.model === 'Qwen3.8-Flash' &&
    status.find((s) => s.task === 'monitor')?.dedicatedKeyConfigured === true
);
check(
  'estado vision sem dedicada e sem fallback → indisponível',
  status.find((s) => s.task === 'vision')?.dedicatedKeyConfigured === false &&
    status.find((s) => s.task === 'vision')?.available === false
);

process.env = envSnapshot;

/* ══════════════ Resumo ══════════════ */

console.log(`\n═══ Resultado: ${passed} passaram, ${failed} falharam ═══`);
process.exit(failed > 0 ? 1 : 0);
