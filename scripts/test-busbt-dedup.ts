/**
 * AngoStart — Teste da lógica anti-duplicação de cartões (aba Busbt).
 *
 * Corre com bun (corre TypeScript nativamente):
 *   bun scripts/test-busbt-dedup.ts
 *
 * Valida os utilitários puros de src/lib/video-list.ts que garantem
 * estado ÚNICO e ESTÁVEL por vídeo:
 *  - mergeVideosById: polling atualiza o cartão existente (mesmo id),
 *    nunca cria cartão novo; ids duplicados colapsam; pendentes com
 *    lag de leitura são preservados; eliminados no servidor somem;
 *  - dedupeVideosById: grelha pública nunca mostra o mesmo vídeo 2×;
 *  - isPendingStatus: uploading/processing são pendentes.
 */
import {
  dedupeVideosById,
  isPendingStatus,
  mergeVideosById,
  type VideoLike,
} from '../src/lib/video-list';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}`);
  }
}

function video(
  id: string,
  status: VideoLike['status'],
  extra: Record<string, unknown> = {}
): VideoLike & Record<string, unknown> {
  return { id, status, ...extra };
}

function run() {
  console.log('— mergeVideosById: polling atualiza o cartão EXISTENTE —');
  const prev = [
    video('a', 'uploading', { title: 'Pão' }),
    video('b', 'ready', { title: 'Bolo' }),
  ];
  /* O servidor devolve o MESMO id 'a' agora 'processing' + um novo 'c'. */
  const incoming = [
    video('c', 'uploading', { title: 'Novo' }),
    video('a', 'processing', { title: 'Pão' }),
    video('b', 'ready', { title: 'Bolo' }),
  ];
  const merged = mergeVideosById(prev, incoming);
  check('sem duplicação de ids', merged.length === 3);
  check(
    'estado do cartão "a" foi ATUALIZADO no lugar (uploading → processing)',
    merged.find((v) => v.id === 'a')?.status === 'processing'
  );
  check(
    'ordem do servidor preservada (c primeiro, created_at DESC)',
    merged.map((v) => v.id).join(',') === 'c,a,b'
  );

  console.log('— mergeVideosById: ids duplicados na resposta colapsam —');
  const dupIncoming = [
    video('x', 'uploading'),
    video('x', 'uploading'),
    video('x', 'uploading'),
  ];
  const mergedDup = mergeVideosById([], dupIncoming);
  check('3 entradas com o mesmo id → 1 único cartão', mergedDup.length === 1);

  console.log('— mergeVideosById: duplo clique (2 linhas na BD) mostra 2, nunca 4 —');
  /* Cenário do bug: resposta do polling contém as 2 linhas criadas
     por um duplo clique (antes da correção) — renderiza 2, não mais. */
  const twoRows = [video('r1', 'uploading'), video('r2', 'uploading')];
  const mergedRace = mergeVideosById(
    [video('r1', 'uploading'), video('r2', 'uploading'), video('r1', 'uploading')],
    twoRows
  );
  check('mesmo com prev duplicado → 2 cartões únicos', mergedRace.length === 2);

  console.log('— mergeVideosById: pendentes com lag de leitura são preservados —');
  const prevPending = [video('pend', 'uploading')];
  const serverLag: VideoLike[] = []; /* servidor ainda não devolve */
  const mergedLag = mergeVideosById(prevPending, serverLag);
  check(
    'cartão uploading mantido (não some/pisca durante o polling)',
    mergedLag.length === 1 && mergedLag[0].id === 'pend'
  );

  console.log('— mergeVideosById: eliminado no servidor desaparece —');
  const prevDeleted = [video('del', 'ready'), video('fica', 'ready')];
  const mergedDel = mergeVideosById(prevDeleted, [video('fica', 'ready')]);
  check(
    'cartão ready ausente do servidor é removido (servidor é a verdade)',
    mergedDel.length === 1 && mergedDel[0].id === 'fica'
  );
  check(
    'cartão processing ausente do servidor é preservado (lag)',
    mergeVideosById([video('del', 'processing')], []).length === 1
  );

  console.log('— mergeVideosById: mutação sem tocar as entradas originais —');
  const original = video('a', 'uploading');
  const mergedRef = mergeVideosById([original], [video('a', 'processing')]);
  check(
    'entrada do servidor substitui a referência (estado fresco renderiza)',
    mergedRef[0] !== original && mergedRef[0].status === 'processing'
  );

  console.log('— dedupeVideosById: grelha pública sem duplicados —');
  const publicList = [
    video('p1', 'ready'),
    video('p2', 'ready'),
    video('p1', 'ready'),
  ];
  const deduped = dedupeVideosById(publicList);
  check('p1 duplicado → 2 cartões', deduped.length === 2);
  check(
    'primeira ocorrência ganha (ordem preservada)',
    deduped.map((v) => v.id).join(',') === 'p1,p2'
  );
  check('lista vazia → vazia', dedupeVideosById([]).length === 0);

  console.log('— isPendingStatus —');
  check('uploading é pendente', isPendingStatus('uploading'));
  check('processing é pendente', isPendingStatus('processing'));
  check('ready não é pendente', !isPendingStatus('ready'));
  check('errored não é pendente', !isPendingStatus('errored'));
  check('null/undefined não é pendente', !isPendingStatus(null));

  console.log(`\n${passed} passarão | ${failed} falharam`);
  process.exit(failed > 0 ? 1 : 0);
}

try {
  run();
} catch (e) {
  console.error('Erro fatal no teste:', e);
  process.exit(1);
}
