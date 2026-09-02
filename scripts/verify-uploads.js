#!/usr/bin/env node
/**
 * verify-uploads.js — Guard de integridade do workspace (AngoStart)
 *
 * CAUSA RAIZ DOCUMENTADA (2026-09-02):
 * O ambiente de execução é um contentor efémero. Em cada arranque, o /start.sh
 * da plataforma APAGA todo o projeto (exceto upload/) e re-extrai o snapshot
 * /home/sync/repo.tar (tmpfs+ossfs). Se essa extração falhar ou vier de um
 * snapshot antigo, ficheiros rastreados (rotas de upload, libs) ficam em falta
 * no disco — sem que o Git tenha sido tocado (reflog limpo). O .env é sempre
 * sobrescrito com um stub (DATABASE_URL=file:...). Este script deteta e
 * repara esse estado ANTES de o dev server arrancar.
 *
 * Uso:
 *   node scripts/verify-uploads.js          # verifica + auto-repara o que for seguro
 *   node scripts/verify-uploads.js --check  # só verifica (exit 1 se houver faltas)
 *   node scripts/verify-uploads.js --fix    # força reparação agressiva (inclui pull)
 *
 * Integrado em: npm run predev / pretest (corre automaticamente no boot).
 */

const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ARGS = new Set(process.argv.slice(2));
const CHECK_ONLY = ARGS.has('--check');
const FORCE_FIX = ARGS.has('--fix');

// Rotas/libs críticas cuja ausência parte o sistema de uploads e auth.
// (Hardcoded de propósito: se o .git também vier de um snapshot antigo,
//  `git ls-files` pode não conhecer os ficheiros mais recentes.)
const CRITICAL_FILES = [
  'src/app/api/upload/image/route.ts',
  'src/app/api/products/upload/route.ts',
  'src/app/api/kyc/upload/route.ts',
  'src/app/api/media/[...path]/route.ts',
  'src/app/api/perfil/avatar/route.ts',
  'src/app/api/kyc/document/[...path]/route.ts',
  'src/app/api/kyc/submit/route.ts',
  'src/lib/upload-client.ts',
  'src/lib/auth.ts',
  'src/lib/db.ts',
  'src/lib/payments-manual.ts',
  'src/components/ProfilePhotoCard.tsx',
];

const ENV_BACKUP_CANDIDATES = [
  '/tmp/my-project/angostart-env-backup/.env',
  path.join(ROOT, '..', 'angostart-env-backup', '.env'),
];

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', ...opts }).trim();
}

const problems = [];
const fixes = [];
const infos = [];

function report() {
  console.log('\n\u001b[36m\u2554\u2550\u2550\u2550 VERIFY-UPLOADS: guard de integridade do workspace (AngoStart) \u2550\u2550\u2550\u001b[0m');
  if (infos.length) infos.forEach((m) => console.log(`  [i] ${m}`));
  fixes.forEach((m) => console.log(`  \u001b[32m[FIXED]\u001b[0m ${m}`));
  problems.forEach((m) => console.log(`  \u001b[31m[PROBLEMA]\u001b[0m ${m}`));
  if (!problems.length && !fixes.length) {
    console.log('  \u001b[32m[OK]\u001b[0m Todas as rotas críticas presentes; índice git consistente.');
  }
  console.log('\u001b[36m\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u001b[0m\n');
}

function isStubEnv(content) {
  return !content || /DATABASE_URL\s*=\s*["']?file:/i.test(content);
}

function tryRestoreEnv() {
  for (const cand of ENV_BACKUP_CANDIDATES) {
    try {
      if (fs.existsSync(cand) && !isStubEnv(fs.readFileSync(cand, 'utf8'))) {
        fs.copyFileSync(cand, path.join(ROOT, '.env'));
        return cand;
      }
    } catch { /* ignore */ }
  }
  return null;
}

function main() {
  if (!fs.existsSync(path.join(ROOT, '.git'))) {
    problems.push('.git ausente — workspace sem repositório (restore falhou totalmente). Faz clone de origin e corre --fix.');
    report();
    process.exit(1);
  }

  let head = '';
  try { head = git(['rev-parse', 'HEAD']); } catch { /* ignore */ }
  if (!head) {
    problems.push('HEAD ilegível — integridade do .git comprometida.');
    report();
    process.exit(1);
  }

  // 1) Rotas críticas hardcoded
  const missingCritical = CRITICAL_FILES.filter((f) => !fs.existsSync(path.join(ROOT, f)));

  // 2) Ficheiros rastreados apagados do disco (qualquer um, não só críticos)
  let deletedTracked = [];
  try {
    deletedTracked = git(['ls-files', '--deleted']).split('\n').filter(Boolean);
  } catch { /* ignore */ }

  // 3) .env
  let envState = 'ok';
  const envPath = path.join(ROOT, '.env');
  let envContent = '';
  try { envContent = fs.readFileSync(envPath, 'utf8'); } catch { envState = 'missing'; }
  if (envState === 'ok' && isStubEnv(envContent)) envState = 'stub';
  if (!envContent.includes('JWT_SECRET') && envState === 'ok') envState = 'sem-jwt';

  const hasProblems = missingCritical.length > 0 || deletedTracked.length > 0 || envState !== 'ok';

  if (!hasProblems) {
    infos.push(`HEAD @ ${head.slice(0, 7)} — working tree íntegra.`);
    report();
    if (CHECK_ONLY) process.exit(0);
    return;
  }

  if (CHECK_ONLY) {
    if (missingCritical.length) problems.push(`Rotas críticas EM FALTA (${missingCritical.length}): ${missingCritical.join(', ')}`);
    if (deletedTracked.length) problems.push(`Ficheiros rastreados apagados (${deletedTracked.length}): ${deletedTracked.slice(0, 10).join(', ')}${deletedTracked.length > 10 ? ' …' : ''}`);
    if (envState === 'stub') problems.push('.env contém o stub da plataforma (DATABASE_URL=file:) — segredos perdidos no restore.');
    if (envState === 'missing') problems.push('.env ausente.');
    if (envState === 'sem-jwt') problems.push('.env sem JWT_SECRET.');
    report();
    process.exit(1);
  }

  // ---- Modo auto-reparação (default e --fix) ----

  // a) Restaurar ficheiros rastreados apagados a partir do HEAD
  if (deletedTracked.length) {
    try {
      git(['checkout', '--', ...deletedTracked]);
      fixes.push(`${deletedTracked.length} ficheiro(s) rastreados restaurados do HEAD (${deletedTracked.slice(0, 5).join(', ')}${deletedTracked.length > 5 ? ' …' : ''}).`);
    } catch (e) {
      problems.push(`Falhou git checkout para restaurar apagados: ${e.message}`);
    }
  }

  // b) Rotas críticas em falta que NÃO estejam no HEAD atual → tentar origin/main
  const stillMissing = CRITICAL_FILES.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  if (stillMissing.length) {
    try {
      const inHead = git(['cat-file', '-e', `HEAD:${stillMissing[0]}`, '--'], { stdio: ['ignore', 'ignore', 'pipe'] });
      void inHead;
    } catch {
      // não está no HEAD — pode estar no origin/main (snapshot do .git ficou atrás)
      if (FORCE_FIX) {
        try {
          git(['fetch', 'origin', 'main']);
          git(['restore', '--source=origin/main', '--', ...stillMissing]);
          fixes.push(`${stillMissing.length} rotas críticas restauradas de origin/main.`);
        } catch (e) {
          problems.push(`Falhou restauro de origin/main: ${e.message}`);
        }
      } else {
        problems.push(`Rotas críticas em falta e AUSENTES do HEAD local: ${stillMissing.join(', ')}. O .git pode ter vindo de um snapshot antigo — corre "node scripts/verify-uploads.js --fix" ou "git pull".`);
      }
    }
  }

  // c) .env stub/ausente → restaurar de backup local (fora do git, sem segredos no repo)
  if (envState !== 'ok') {
    const src = tryRestoreEnv();
    if (src) {
      fixes.push(`.env reconstruído a partir de ${src}.`);
    } else {
      problems.push(`.env em estado "${envState}" e sem backup em ${ENV_BACKUP_CANDIDATES.join(' | ')}. A app não liga à BD Neon até o .env ser reposto (DATABASE_URL/JWT_SECRET reais).`);
    }
  }

  report();
  process.exit(problems.length ? 1 : 0);
}

main();
