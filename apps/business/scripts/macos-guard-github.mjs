// io الحقيقي بتاع الحارس: REST على api.github.com بـ GITHUB_TOKEN بتاع الـ workflow.
// كل نداء GitHub عملية لوحدها في function على مستوى الملف، وبتاخد نفس الـ context،
// عشان createGithubIo يفضل مجرد تجميع (ADR-0055 قرار 6). و`fetch` متحقن فيه عشان
// الاختبار يقوده من غير شبكة.

export const SLOT_REF_PREFIX = 'refs/mobile-guard/slot-';
export const SLOT_PATH_PREFIX = 'mobile-guard/slot-';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const MAX_PAGES = 10;
const RE_RUN_WINDOW_DAYS = 30;

function monthStartMs() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
}

async function bodyOf(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

/**
 * التشغيلات الجديدة بتتنشأ من غير ما تتعدى 30 يوم من تاريخ إنشائها (قاعدة GitHub)، فكل
 * تشغيل لدقايق macOS الشهر ده اتعمل بعد (أول الشهر − 30 يوم). عشان كده بنقفل عند حدّ
 * الإنشاء، مش عند آخر تعديل — تشغيل قديم اتعاد تشغيله الشهر ده بينحسب ✓.
 */
async function listRecentRuns({ request, owner, repo }) {
  const bound = monthStartMs() - RE_RUN_WINDOW_DAYS * DAY_MS;
  const runs = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await request(
      `/repos/${owner}/${repo}/actions/workflows/mobile.yml/runs?per_page=100&page=${page}`,
    );
    if (!response.ok) throw new Error(`the run history answered ${response.status}`);
    const data = await response.json();
    runs.push(...data.workflow_runs);
    if (data.workflow_runs.length < 100) return runs;
    const last = data.workflow_runs[data.workflow_runs.length - 1];
    if (Date.parse(last.created_at) < bound) return runs;
  }
  throw new Error('the run history is too long to read');
}

async function listRunJobs({ request, owner, repo }, run) {
  const jobs = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    // filter=all: محاولات الـ run القديمة ساعاتها بتتحسب زي ما هي (Re-run all jobs).
    const response = await request(
      `/repos/${owner}/${repo}/actions/runs/${run.id}/jobs?filter=all&per_page=100&page=${page}`,
    );
    if (!response.ok) throw new Error(`the job history answered ${response.status}`);
    const data = await response.json();
    for (const job of data.jobs) {
      jobs.push({
        runId: String(run.id),
        runAttempt: String(run.run_attempt ?? 1),
        labels: job.labels ?? [],
        conclusion: job.conclusion ?? null,
        startedAt: job.started_at === null ? null : Date.parse(job.started_at),
        completedAt: job.completed_at === null ? null : Date.parse(job.completed_at),
      });
    }
    if (data.jobs.length < 100) break;
    if (page === MAX_PAGES) throw new Error(`the job history of the run ${run.id} is too long`);
  }
  return jobs;
}

async function listMacosJobs(context) {
  const runs = await listRecentRuns(context);
  const jobs = [];
  for (const run of runs) jobs.push(...(await listRunJobs(context, run)));
  return jobs;
}

/** حالة الخانة من الـ ref: الـ sha والـ owner والـ lease، وهل هي محرَّرة (tombstone) ولا لأ. */
async function readSlotState({ request, owner, repo }, index) {
  const response = await request(`/repos/${owner}/${repo}/git/ref/${SLOT_PATH_PREFIX}${index}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`the slot ${index} answered ${response.status}`);
  const data = await response.json();
  const sha = data.object.sha;
  const commit = await request(`/repos/${owner}/${repo}/git/commits/${sha}`);
  if (!commit.ok) throw new Error(`the admission answered ${commit.status}`);
  const payload = JSON.parse((await commit.json()).message);
  return {
    sha,
    owner: payload.owner,
    leaseEnd: payload.leaseEnd,
    released: payload.released === true,
  };
}

async function readSlot(context, index) {
  const state = await readSlotState(context, index);
  // خانة محرَّرة مش خانة محجوزة: بترجع null عشان ما تتحسبش وما تحبسش حد تاني.
  if (state === null || state.released) return null;
  return { slot: index, owner: state.owner, leaseEnd: state.leaseEnd, sha: state.sha };
}

async function createCommit({ request, owner, repo, headSha }, payload, parentSha) {
  if (!headSha) throw new Error('GITHUB_SHA is missing');
  const tree = await request(`/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: { tree: [] },
  });
  if (!tree.ok) throw new Error(`the tree answered ${tree.status}`);
  const treeSha = (await tree.json()).sha;
  const commit = await request(`/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: {
      message: JSON.stringify(payload),
      tree: treeSha,
      parents: [parentSha ?? headSha],
    },
  });
  if (!commit.ok) throw new Error(`the admission commit answered ${commit.status}`);
  return (await commit.json()).sha;
}

async function createSlot({ request, owner, repo }, index, sha) {
  // إنشاء الـ ref هو اللي بياخد الذرّية: بيفشل لو الخانة موجودة. وPOST بيتستخدم بس
  // لما الـ ref مش موجود — الخانة اللي موجودة بتاخد الـ compare-and-swap بتاعها.
  const response = await request(`/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    body: { ref: `${SLOT_REF_PREFIX}${index}`, sha },
  });
  if (response.status === 422) {
    const body = await bodyOf(response);
    const message = String(body.message ?? '');
    // الـ 422 الوحيد اللي معناه «الخانة موجودة» هو اللي GitHub بيقول فيه إن الـ reference
    // موجود فعلاً — أي 422 تاني خطأ عادي، مش تزاحم.
    if (/already exists/i.test(message)) {
      const state = await readSlotState({ request, owner, repo }, index);
      const error = new Error(`the slot ${index} is taken: ${message}`);
      error.code = 'conflict';
      error.currentSha = state?.sha;
      error.released = state?.released === true;
      throw error;
    }
    throw new Error(`the slot ${index} answered 422: ${message}`);
  }
  if (!response.ok) throw new Error(`the slot ${index} answered ${response.status}`);
}

async function moveSlot({ request, owner, repo }, index, sha) {
  // force: false: الـ commit الجديد ابن الـ commit القديم، فلو حد تاني نقل الـ ref في
  // نفس اللحظة التحديث بيرفض — وده هو الـ compare-and-swap بتاع الخانة.
  const response = await request(`/repos/${owner}/${repo}/git/refs/${SLOT_PATH_PREFIX}${index}`, {
    method: 'PATCH',
    body: { sha, force: false },
  });
  if (response.status === 422 || response.status === 409) {
    const error = new Error(`the slot ${index} moved to another commit`);
    error.code = 'conflict';
    throw error;
  }
  if (!response.ok) throw new Error(`the slot ${index} answered ${response.status}`);
}

/**
 * io الحقيقي: كل نداء لـ GitHub بيعدي من هنا، فالسكربت نفسه بيفضل قابل للاختبار من غير شبكة.
 *
 * @param {{ token?: string, repository?: string, headSha?: string, fetch?: typeof fetch }} parts
 * @returns {{ listMacosJobs: () => Promise<object[]>, readSlot: (index: number) => Promise<object | null>, createCommit: (payload: object, parentSha: string | null) => Promise<string>, createSlot: (index: number, sha: string) => Promise<void>, moveSlot: (index: number, sha: string) => Promise<void> }}
 */
export function createGithubIo({
  token,
  repository,
  headSha,
  fetch: fetchImpl = globalThis.fetch,
}) {
  const [owner, repo] = String(repository ?? '').split('/');

  const request = async (path, { method = 'GET', body } = {}) => {
    if (!owner || !repo) throw new Error('GITHUB_REPOSITORY is missing');
    return fetchImpl(`https://api.github.com${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token ?? ''}`,
        'x-github-api-version': '2022-11-28',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };

  const context = { request, owner, repo, headSha };

  return {
    listMacosJobs: () => listMacosJobs(context),
    readSlot: (index) => readSlot(context, index),
    createCommit: (payload, parentSha) => createCommit(context, payload, parentSha),
    createSlot: (index, sha) => createSlot(context, index, sha),
    moveSlot: (index, sha) => moveSlot(context, index, sha),
  };
}
