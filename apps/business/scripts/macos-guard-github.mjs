// io الحقيقي بتاع الحارس: REST على api.github.com بـ GITHUB_TOKEN بتاع الـ workflow.
// منفصل عن قواعد الحارس نفسه عشان كل ملف يفضل صغير، وسبب كل نداء (قراءة، حجز، تحرير)
// يفضل مكتوب جنب الكود اللي بيعمله. و`fetch` متحقن فيه عشان الاختبار يقوده من غير شبكة.

export const SLOT_REF_PREFIX = 'refs/mobile-guard/slot-';
export const SLOT_PATH_PREFIX = 'mobile-guard/slot-';

/**
 * io الحقيقي: كل نداء لـ GitHub بيعدي من هنا، فالسكربت نفسه بيفضل قابل للاختبار من غير شبكة.
 *
 * @param {{ token?: string, repository?: string, headSha?: string, fetch?: typeof fetch }} parts
 * @returns {{ listMacosJobs: () => Promise<object[]>, readSlot: (index: number) => Promise<object | null>, createAdmissionCommit: (admission: object, parentSha: string | null) => Promise<string>, createSlot: (index: number, sha: string) => Promise<void>, moveSlot: (index: number, sha: string) => Promise<void>, deleteSlot: (index: number, expectedSha: string) => Promise<void> }}
 */
export function createGithubIo({
  token,
  repository,
  headSha,
  fetch: fetchImpl = globalThis.fetch,
}) {
  const [owner, repo] = String(repository ?? '').split('/');

  async function request(path, { method = 'GET', body } = {}) {
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
  }

  async function bodyOf(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  async function listMacosJobs() {
    // العدّ بيقفل على شغلانة الـ workflow دي بس (وظيفة الموبايل)، ومن غير ما يقرأ شغلانة
    // الـ workflowات التانية — كده ما بيستهلكش rate limit المستودع كله.
    const now = new Date();
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const runs = [];
    for (let page = 1; page <= 10; page += 1) {
      const response = await request(
        `/repos/${owner}/${repo}/actions/workflows/mobile.yml/runs?per_page=100&page=${page}`,
      );
      if (!response.ok) throw new Error(`the run history answered ${response.status}`);
      const data = await response.json();
      runs.push(...data.workflow_runs);
      if (data.workflow_runs.length < 100) break;
      if (page === 10) throw new Error('the run history is too long to read');
    }
    // newest first: أول تشغيل مش متحدّث الشهر ده معناها إن الباقي أقدم، فبيقفل.
    const recent = [];
    for (const run of runs) {
      if (Date.parse(run.updated_at) < monthStart) break;
      recent.push(run);
    }
    const jobs = [];
    for (const run of recent) {
      for (let page = 1; page <= 10; page += 1) {
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
        if (page === 10) throw new Error(`the job history of the run ${run.id} is too long`);
      }
    }
    return jobs;
  }

  async function readSlot(index) {
    // مسار الـ ref من غير بادئة refs/: الـ GET بياخد الاسم بعد refs/ بس.
    const response = await request(`/repos/${owner}/${repo}/git/ref/${SLOT_PATH_PREFIX}${index}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`the slot ${index} answered ${response.status}`);
    const data = await response.json();
    const sha = data.object.sha;
    const commit = await request(`/repos/${owner}/${repo}/git/commits/${sha}`);
    if (!commit.ok) throw new Error(`the admission answered ${commit.status}`);
    const payload = JSON.parse((await commit.json()).message);
    return { slot: index, owner: payload.owner, leaseEnd: payload.leaseEnd, sha };
  }

  async function createAdmissionCommit(admission, parentSha) {
    if (!headSha) throw new Error('GITHUB_SHA is missing');
    // الحجز بيتخزن في commit message. الـ parent هو الـ commit القديم بتاع الخانة، فالـ
    // commit الجديد بيعمل fast-forward — وبكده الـ ref مش بيتنقل غير لو لسه واقف عليه.
    const tree = await request(`/repos/${owner}/${repo}/git/trees`, {
      method: 'POST',
      body: { tree: [] },
    });
    if (!tree.ok) throw new Error(`the tree answered ${tree.status}`);
    const treeSha = (await tree.json()).sha;
    const commit = await request(`/repos/${owner}/${repo}/git/commits`, {
      method: 'POST',
      body: {
        message: JSON.stringify(admission),
        tree: treeSha,
        parents: [parentSha ?? headSha],
      },
    });
    if (!commit.ok) throw new Error(`the admission commit answered ${commit.status}`);
    return (await commit.json()).sha;
  }

  async function createSlot(index, sha) {
    // إنشاء الـ ref هو اللي بياخد الذرّية: بيفشل لو الخانة موجودة.
    const response = await request(`/repos/${owner}/${repo}/git/refs`, {
      method: 'POST',
      body: { ref: `${SLOT_REF_PREFIX}${index}`, sha },
    });
    if (response.status === 422) {
      const body = await bodyOf(response);
      const message = String(body.message ?? '');
      if (message.includes('already exists')) {
        const error = new Error(`the slot ${index} is taken`);
        error.code = 'conflict';
        throw error;
      }
      throw new Error(`the slot ${index} answered 422: ${message}`);
    }
    if (!response.ok) throw new Error(`the slot ${index} answered ${response.status}`);
  }

  async function moveSlot(index, sha) {
    // force: false: الـ commit الجديد ابن الـ commit القديم، فلو حد تاني نقل الـ ref في
    // نفس اللحظة التحديث بيرفض — وده هو الـ compare-and-swap بتاع استرجاع الخانة.
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

  async function deleteSlot(index, expectedSha) {
    // الحذف بيقفل على نفس الـ commit اللي اتقرا: لو الـ ref اتنقل بعد القراءة، الخانة دي
    // مش بتاعتنا ومش بنمسّها.
    const current = await request(`/repos/${owner}/${repo}/git/ref/${SLOT_PATH_PREFIX}${index}`);
    if (current.status === 404) {
      const error = new Error(`the slot ${index} is gone`);
      error.code = 'not-found';
      throw error;
    }
    if (!current.ok) throw new Error(`the slot ${index} answered ${current.status}`);
    const data = await current.json();
    if (data.object.sha !== expectedSha) {
      const error = new Error(`the slot ${index} moved to another commit`);
      error.code = 'conflict';
      throw error;
    }
    const response = await request(`/repos/${owner}/${repo}/git/refs/${SLOT_PATH_PREFIX}${index}`, {
      method: 'DELETE',
    });
    if (response.status === 404 || response.status === 422) {
      const error = new Error(`the slot ${index} is gone`);
      error.code = 'not-found';
      throw error;
    }
    if (!response.ok) throw new Error(`the slot ${index} answered ${response.status}`);
  }

  return {
    listMacosJobs,
    readSlot,
    createAdmissionCommit,
    createSlot,
    moveSlot,
    deleteSlot,
  };
}
