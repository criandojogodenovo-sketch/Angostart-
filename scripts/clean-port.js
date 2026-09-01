#!/usr/bin/env node
/**
 * AngoStart — Limpeza definitiva de portas (anti «servidor zombie»).
 *
 * PROBLEMA: um next-server antigo morre «a meio» mas fica preso na porta
 * (ex.: 3000) → EADDRINUSE no próximo dev/start/test, e testes E2E batem no
 * servidor ERRADO (aconteceu na Fase 19b: um zombie respondia com o build
 * antigo e falsificou resultados).
 *
 * SOLUÇÃO: correr automaticamente antes de `npm run dev`, `npm start` e
 * `npm test` (hooks predev/prestart/pretest no package.json):
 *   1. Tenta a ferramenta `port-kill` (devDependency) via child process
 *      — isolado, porque o port-kill chama process.exit() no chamador
 *      quando a porta está livre e só mata o 1.º PID.
 *   2. Fallback NATIVO multi-plataforma (lsof/ss + kill -9 em unix;
 *      netstat + taskkill em Windows) — mata TODOS os PIDs da porta.
 *   3. VERIFICAÇÃO final por sonda TCP — só reporta ✅ quando a porta
 *      responde com conexão recusada (= livre).
 *
 * Uso:  node scripts/clean-port.js [porta...]     (default: 3000)
 * Saida: «✅ Porta 3000 limpa antes dos testes» — exit 0 SEMPRE (a limpeza
 * nunca bloqueia o arranque; se falhar, o erro real de bind aparece depois).
 */

const { spawn, spawnSync } = require('child_process');
const net = require('net');

/* ───────────────────────────── configuração ───────────────────────────── */

const args = process.argv.slice(2).filter((a) => /^\d+$/.test(a));
const PORTS = args.length ? [...new Set(args)] : ['3000'];
const PROBE_TIMEOUT_MS = 400;
const SETTLE_ATTEMPTS = 6;

/* ─────────────────────────────── utilitários ──────────────────────────── */

/** A porta está ocupada? (conexão TCP bem-sucedida = ocupada) */
function portBusy(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    const done = (busy) => {
      sock.destroy();
      resolve(busy);
    };
    sock.setTimeout(PROBE_TIMEOUT_MS);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

/** Espera a porta ficar livre (sonda repetida). */
async function waitFree(port, attempts = SETTLE_ATTEMPTS) {
  for (let i = 0; i < attempts; i++) {
    if (!(await portBusy(port))) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return !(await portBusy(port));
}

/** 1.ª linha de defesa: port-kill em child process isolado (com timeout). */
function killViaPortKill(port) {
  return new Promise((resolve) => {
    const code = `require('port-kill/port-logic')(${port}, 'SIGKILL')`;
    const child = spawn(process.execPath, ['-e', code], {
      stdio: 'ignore',
      detached: false,
    });
    const t = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(false);
    }, 5000);
    child.once('exit', () => {
      clearTimeout(t);
      resolve(true);
    });
    child.once('error', () => {
      clearTimeout(t);
      resolve(false);
    });
  });
}

/** 2.ª linha: kill NATIVO de TODOS os PIDs na porta. */
function killNative(port) {
  const killed = new Set();
  if (process.platform === 'win32') {
    const out =
      spawnSync('cmd.exe', ['/c', `netstat -ano | findstr :${port}`], {
        encoding: 'utf8',
      }).stdout || '';
    for (const line of out.split(/\r?\n/)) {
      const pid = line.trim().split(/\s+/).pop();
      if (/^\d+$/.test(pid || '') && pid !== '0') {
        spawnSync('taskkill', ['/F', '/PID', pid], { shell: true });
        killed.add(pid);
      }
    }
    return killed;
  }
  // unix — lsof primeiro; se indisponível, parse do ss
  let pids = (spawnSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf8' }).stdout || '')
    .split('\n')
    .map((s) => s.trim())
    .filter((p) => /^\d+$/.test(p));
  if (!pids.length) {
    const out =
      spawnSync(
        'sh',
        ['-c', `ss -tlnp 2>/dev/null | grep ":${port} " || true`],
        { encoding: 'utf8' }
      ).stdout || '';
    pids = [...out.matchAll(/pid=(\d+)/g)].map((m) => m[1]);
  }
  for (const pid of [...new Set(pids)]) {
    try {
      process.kill(Number(pid), 'SIGKILL');
      killed.add(pid);
    } catch {
      /* pid já morreu ou sem permissão — ignora */
    }
  }
  return killed;
}

/* ─────────────────────────────── rotina ────────────────────────────────── */

(async () => {
  for (const port of PORTS) {
    const busy = await portBusy(port);
    if (!busy) {
      console.log(`✓ Porta ${port} já estava livre.`);
      continue;
    }

    /* 1) ferramenta dedicada; 2) fallback nativo; 3) verificação */
    await killViaPortKill(port);
    if (await portBusy(port)) {
      const pids = killNative(port);
      if (pids.size) console.log(`  ↳ fallback nativo matou PID(s): ${[...pids].join(', ')}`);
    }
    const free = await waitFree(port);

    if (free) {
      console.log(`✅ Porta ${port} limpa antes dos testes`);
    } else {
      console.warn(
        `⚠️  Porta ${port} AINDA OCUPADA após limpeza — o próximo bind pode falhar com EADDRINUSE.`
      );
    }
  }
  process.exit(0);
})();
