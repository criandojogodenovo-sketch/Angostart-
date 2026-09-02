/**
 * AngoStart — Limpeza de vídeos presos (Busbt / Mux).
 *
 * Remove os registos órfãos que apareciam como "A finalizar envio…"
 * infinito no frontend:
 *
 *  1. status='uploading' com mais de --uploading-minutes (default 60):
 *     - COM credenciais Mux (MUX_TOKEN_ID + MUX_TOKEN_SECRET): pergunta
 *       ao Mux o estado REAL antes de decidir (self-healing):
 *         asset ready      → status='ready'   (+ playback_id)
 *         asset processing → status='processing'
 *         asset errored / upload errored|cancelled|timed_out|waiting →
 *                           status='errored' (+ mensagem)
 *     - SEM credenciais (ou --no-verify): marca 'errored' diretamente.
 *  2. status='processing' com mais de 1 hora (só COM Mux): verifica o
 *     asset — ready → 'ready', errored → 'errored'. NUNCA falha às
 *     cegas: processing ativo (< 1h) não é tocado.
 *  3. status='errored' há mais de --errored-hours (default 24): APAGA a
 *     linha (e o asset no Mux, melhor-esforço) — o histórico não
 *     acumula resíduos.
 *
 * Uso:
 *   node scripts/cleanup-stale-videos.js --dry-run   # só mostra o que faria
 *   node scripts/cleanup-stale-videos.js             # executa
 *   node scripts/cleanup-stale-videos.js --no-verify # sem chamadas ao Mux
 *   node scripts/cleanup-stale-videos.js --uploading-minutes=60 --errored-hours=24
 *
 * Lê DATABASE_URL (ou NEON_DATABASE_URL) do ambiente / .env.
 * Agendável 1× por hora (Vercel Cron ou crontab externo).
 */
const { neon } = require('@neondatabase/serverless');

// Carrega .env simples (sem dependência externa). Valores do ambiente
// só valem se forem postgres — em sandboxes o DATABASE_URL pode apontar
// para um ficheiro SQLite local, e nesse caso o .env (Neon) ganha.
const envFile = {};
try {
  require('fs')
    .readFileSync(require('path').join(__dirname, '..', '.env'), 'utf8')
    .split('\n')
    .forEach((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in envFile)) {
        envFile[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    });
} catch {
  /* .env opcional */
}
const pickDbUrl = (...candidates) =>
  candidates.find((v) => typeof v === 'string' && v.startsWith('postgres'));

/* ────────────────────────── Argumentos CLI ────────────────────────── */

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const noVerify = args.includes('--no-verify');
const getNum = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  const n = a ? Number(a.split('=')[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : def;
};
const UPLOADING_MINUTES = getNum('uploading-minutes', 60);
const ERRORED_HOURS = getNum('errored-hours', 24);
const PROCESSING_MINUTES = getNum('processing-minutes', 60);

const databaseUrl = pickDbUrl(
  process.env.NEON_DATABASE_URL,
  process.env.DATABASE_URL,
  envFile.NEON_DATABASE_URL,
  envFile.DATABASE_URL
);

if (!databaseUrl || !databaseUrl.startsWith('postgres')) {
  console.error(
    '❌ Define DATABASE_URL (postgresql://…) antes de correr este script.'
  );
  process.exit(1);
}

const hasMuxCreds = Boolean(
  !noVerify && process.env.MUX_TOKEN_ID && process.env.MUX_TOKEN_SECRET
);

const sql = neon(databaseUrl);

/* ───────────────────────────── API do Mux ─────────────────────────── */

function muxAuthHeader() {
  const raw = `${process.env.MUX_TOKEN_ID}:${process.env.MUX_TOKEN_SECRET}`;
  return `Basic ${Buffer.from(raw).toString('base64')}`;
}

async function muxRequest(method, path) {
  const res = await fetch(`https://api.mux.com${path}`, {
    method,
    headers: {
      Authorization: muxAuthHeader(),
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Mux ${method} ${path} → HTTP ${res.status}`);
  }
  return { ok: res.ok, status: res.status, data: res.ok ? await res.json() : null };
}

async function getUpload(uploadId) {
  const r = await muxRequest('GET', `/video/v1/uploads/${uploadId}`);
  return r.ok ? r.data?.data ?? null : null;
}

async function getAsset(assetId) {
  const r = await muxRequest('GET', `/video/v1/assets/${assetId}`);
  return r.ok ? r.data?.data ?? null : null;
}

async function deleteAsset(assetId) {
  const r = await muxRequest('DELETE', `/video/v1/assets/${assetId}`);
  return r.ok || r.status === 404;
}

/* ─────────────────────────────── Main ─────────────────────────────── */

async function main() {
  console.log('— Limpeza de vídeos presos (Busbt) —');
  console.log(
    `   modo: ${dryRun ? 'DRY-RUN (nada é escrito)' : 'EXECUÇÃO'} | ` +
      `Mux: ${hasMuxCreds ? 'verificação ativa' : 'sem verificação'} | ` +
      `uploading > ${UPLOADING_MINUTES}min | errored > ${ERRORED_HOURS}h`
  );

  const stats = {
    readyRecovered: 0,
    processingRecovered: 0,
    markedErrored: 0,
    deleted: 0,
    errors: 0,
  };

  /* ── 1. uploads presos ('uploading' antigos) ── */
  const staleUploads = (await sql`
    SELECT id, user_id, title, mux_upload_id, mux_asset_id, created_at
    FROM videos
    WHERE status = 'uploading'
      AND created_at < now() - (${UPLOADING_MINUTES} * interval '1 minute')
    ORDER BY created_at ASC
  `) ?? [];
  console.log(`\n[1] 'uploading' > ${UPLOADING_MINUTES} min: ${staleUploads.length} registo(s)`);

  for (const v of staleUploads) {
    try {
      let decision = { status: 'errored', message: 'Envio expirado — o vídeo não foi concluído a tempo.' };
      let assetId = v.mux_asset_id;

      if (hasMuxCreds && v.mux_upload_id) {
        const upload = await getUpload(v.mux_upload_id);
        if (upload?.asset_id) assetId = upload.asset_id;
        if (assetId) {
          const asset = await getAsset(assetId);
          if (asset?.status === 'ready') {
            decision = {
              status: 'ready',
              message: null,
              playbackId: asset.playback_ids?.[0]?.id ?? null,
              duration: typeof asset.duration === 'number'
                ? Math.round(asset.duration * 100) / 100
                : null,
              resolution: asset.max_stored_resolution ?? null,
            };
          } else if (asset?.status === 'processing' || asset?.status === 'creating') {
            decision = { status: 'processing', message: null };
          } else if (asset?.status === 'errored') {
            decision = {
              status: 'errored',
              message: asset.errors?.messages?.[0] ?? 'Processamento falhou no Mux.',
            };
          }
        } else if (upload && !['errored', 'cancelled', 'timed_out'].includes(upload.status ?? '')) {
          /* upload ainda 'waiting' sem asset — mantém decisão de expirado */
        }
      }

      console.log(
        `   · ${v.id} «${v.title || 'sem título'}» → ${decision.status}` +
          (decision.message ? ` (${decision.message})` : '')
      );

      if (dryRun) continue;

      if (decision.status === 'ready') {
        await sql`
          UPDATE videos
          SET status = 'ready',
              mux_asset_id = COALESCE(${assetId}, mux_asset_id),
              playback_id = COALESCE(${decision.playbackId}, playback_id),
              duration_seconds = ${decision.duration ?? null},
              max_stored_resolution = COALESCE(${decision.resolution ?? null}, max_stored_resolution),
              error_message = NULL,
              updated_at = now()
          WHERE id = ${v.id}
        `;
        stats.readyRecovered++;
      } else if (decision.status === 'processing') {
        await sql`
          UPDATE videos
          SET status = 'processing',
              mux_asset_id = COALESCE(${assetId}, mux_asset_id),
              error_message = NULL,
              updated_at = now()
          WHERE id = ${v.id}
        `;
        stats.processingRecovered++;
      } else {
        await sql`
          UPDATE videos
          SET status = 'errored',
              error_message = COALESCE(error_message, ${decision.message}),
              updated_at = now()
          WHERE id = ${v.id}
        `;
        stats.markedErrored++;
      }
    } catch (e) {
      stats.errors++;
      console.warn(`   ⚠ falha em ${v.id}:`, e.message ?? e);
    }
  }

  /* ── 2. processing antigos (só com Mux — verifica, nunca falha às cegas) ── */
  if (hasMuxCreds) {
    const staleProcessing = (await sql`
      SELECT id, title, mux_asset_id, created_at
      FROM videos
      WHERE status = 'processing'
        AND mux_asset_id IS NOT NULL
        AND created_at < now() - (${PROCESSING_MINUTES} * interval '1 minute')
      ORDER BY created_at ASC
    `) ?? [];
    console.log(`\n[2] 'processing' > ${PROCESSING_MINUTES} min (verificação Mux): ${staleProcessing.length} registo(s)`);

    for (const v of staleProcessing) {
      try {
        const asset = await getAsset(v.mux_asset_id);
        if (!asset) continue;
        let to = null;
        if (asset.status === 'ready') to = 'ready';
        else if (asset.status === 'errored') to = 'errored';
        if (!to) continue;

        console.log(`   · ${v.id} «${v.title || 'sem título'}» → ${to}`);
        if (dryRun) continue;

        if (to === 'ready') {
          await sql`
            UPDATE videos
            SET status = 'ready',
                playback_id = COALESCE(${asset.playback_ids?.[0]?.id ?? null}, playback_id),
                duration_seconds = ${typeof asset.duration === 'number' ? Math.round(asset.duration * 100) / 100 : null},
                error_message = NULL,
                updated_at = now()
            WHERE id = ${v.id}
          `;
          stats.readyRecovered++;
        } else {
          await sql`
            UPDATE videos
            SET status = 'errored',
                error_message = COALESCE(${asset.errors?.messages?.[0] ?? null}, 'Processamento falhou no Mux.'),
                updated_at = now()
            WHERE id = ${v.id}
          `;
          stats.markedErrored++;
        }
      } catch (e) {
        stats.errors++;
        console.warn(`   ⚠ falha em ${v.id}:`, e.message ?? e);
      }
    }
  }

  /* ── 3. 'errored' antigos → apagar (e asset no Mux, melhor-esforço) ── */
  const oldErrored = (await sql`
    SELECT id, title, mux_asset_id
    FROM videos
    WHERE status = 'errored'
      AND updated_at < now() - (${ERRORED_HOURS} * interval '1 hour')
    ORDER BY updated_at ASC
  `) ?? [];
  console.log(`\n[3] 'errored' > ${ERRORED_HOURS}h → apagar: ${oldErrored.length} registo(s)`);

  for (const v of oldErrored) {
    try {
      console.log(`   · ${v.id} «${v.title || 'sem título'}» → DELETE`);
      if (dryRun) continue;
      if (hasMuxCreds && v.mux_asset_id) {
        try {
          await deleteAsset(v.mux_asset_id);
        } catch {
          /* best-effort — a linha local é apagada na mesma */
        }
      }
      await sql`DELETE FROM videos WHERE id = ${v.id}`;
      stats.deleted++;
    } catch (e) {
      stats.errors++;
      console.warn(`   ⚠ falha em ${v.id}:`, e.message ?? e);
    }
  }

  console.log('\n— Resumo —');
  if (dryRun) {
    console.log('   (dry-run: nenhuma alteração foi escrita)');
  } else {
    console.log(`   recuperados ready      : ${stats.readyRecovered}`);
    console.log(`   recuperados processing : ${stats.processingRecovered}`);
    console.log(`   marcados errored       : ${stats.markedErrored}`);
    console.log(`   apagados               : ${stats.deleted}`);
  }
  console.log(`   erros                  : ${stats.errors}`);
  process.exit(stats.errors > 0 && !dryRun ? 1 : 0);
}

main().catch((e) => {
  console.error('❌ Erro fatal:', e);
  process.exit(1);
});
