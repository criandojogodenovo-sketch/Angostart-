/**
 * AngoStart — Fase 21: roteamento de tarefas de IA por modelo/chave.
 *
 * Client-safe (sem 'server-only') para poder ser testado com bun e
 * reutilizado pela UI admin — NUNCA contém chaves, apenas os NOMES das
 * env vars (os valores vivem só na Vercel).
 *
 * Distribuição de tarefas (decisão CTO):
 *   chat    → B_AI_API_KEY          → MiMo-V2.5      (chatbot de utilizadores)
 *   vision  → B_AI_API_KEY_VISION   → GLM-5.3-Flash  (comprovativos — admin)
 *   monitor → B_AI_API_KEY_MONITOR  → Qwen3.8-Flash  (monitorização — admin)
 *
 * Fallback de emergência: se a chave DEDICADA da tarefa não estiver
 * definida (ou o modelo falhar a montante), a cadeia usa as outras chaves
 * B_AI como precaução — a lógica principal é sempre «cada modelo na sua
 * área»; o fallback só entra quando é necessário.
 */

export type AiTask = 'chat' | 'vision' | 'monitor';

export interface AiTaskRoute {
  /** Env var da chave DEDICADA da tarefa. */
  apiKeyEnv: string;
  /** Envs de emergência (por ordem) se a dedicada não existir. */
  fallbackKeyEnvs: string[];
  /** Modelo default da tarefa (o ID real do catálogo B.AI é overridável). */
  defaultModel: string;
  /** Env var que sobrepõe o modelo da tarefa (sem novo deploy). */
  modelEnv: string;
  /** Rótulo curto (UI admin — só o admin vê este detalhe técnico). */
  label: string;
  /** Quem usa a tarefa (visibilidade por perfil). */
  audience: 'utilizadores' | 'admin';
  description: string;
}

export const AI_TASK_ROUTES: Record<AiTask, AiTaskRoute> = {
  chat: {
    apiKeyEnv: 'B_AI_API_KEY',
    fallbackKeyEnvs: ['B_AI_API_KEY_VISION', 'B_AI_API_KEY_MONITOR'],
    defaultModel: 'MiMo-V2.5',
    modelEnv: 'B_AI_MODEL_CHAT',
    label: 'Chatbot',
    audience: 'utilizadores',
    description:
      'Suporte e dúvidas dos utilizadores, com análise de imagem e transcrição de áudio.',
  },
  vision: {
    apiKeyEnv: 'B_AI_API_KEY_VISION',
    fallbackKeyEnvs: ['B_AI_API_KEY'],
    defaultModel: 'GLM-5.3-Flash',
    modelEnv: 'B_AI_MODEL_VISION',
    label: 'Análise de comprovativos',
    audience: 'admin',
    description:
      'Extrai valor, data, referência e confiança dos comprovativos de pagamento.',
  },
  monitor: {
    apiKeyEnv: 'B_AI_API_KEY_MONITOR',
    fallbackKeyEnvs: ['B_AI_API_KEY'],
    defaultModel: 'Qwen3.8-Flash',
    modelEnv: 'B_AI_MODEL_MONITOR',
    label: 'Monitorização',
    audience: 'admin',
    description:
      'Lote diário: produtos duplicados, linguagem ofensiva e spam.',
  },
};

/** Lista estável das tarefas (ordem para a UI admin). */
export const AI_TASKS: AiTask[] = ['chat', 'vision', 'monitor'];

/**
 * Modelo efetivo da tarefa — lê a env de override no momento da chamada
 * (permite trocar de modelo na Vercel sem novo deploy).
 */
export function taskModel(task: AiTask): string {
  const route = AI_TASK_ROUTES[task];
  return process.env[route.modelEnv]?.trim() || route.defaultModel;
}

/**
 * Env var da chave a USAR na tarefa: a dedicada se existir; senão as de
 * emergência (fallback de chave); `null` se nenhuma estiver configurada.
 */
export function resolveTaskKeyEnv(task: AiTask): string | null {
  const route = AI_TASK_ROUTES[task];
  for (const env of [route.apiKeyEnv, ...route.fallbackKeyEnvs]) {
    if (process.env[env]?.trim()) return env;
  }
  return null;
}

/** A tarefa tem alguma chave B.AI disponível (dedicada ou emergência)? */
export function taskKeyConfigured(task: AiTask): boolean {
  return resolveTaskKeyEnv(task) !== null;
}

/** Nome da env DEDICADA (para a UI mostrar «configurada/ausente»). */
export function taskDedicatedKeyEnv(task: AiTask): string {
  return AI_TASK_ROUTES[task].apiKeyEnv;
}
