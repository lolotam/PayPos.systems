// io الحقيقي بتاع الحارس: REST على api.github.com بـ GITHUB_TOKEN بتاع الـ workflow.
// منفصل عن قواعد الحارس نفسه عشان كل ملف يفضل صغير، وسبب كل نداء (قراءة، حجز، تحرير)
// يفضل مكتوب جنب الكود اللي بيعمله.

export const SLOT_REF_PREFIX = 'refs/mobile-guard/slot-';

/**
 * io الحقيقي: كل نداء لـ GitHub بيعدي من هنا، فالسكربت نفسه بيفضل قابل للاختبار من غير شبكة.
 *
 * @param {{ token?: string, repository?: string, headSha?: string }} parts
 * @returns {{ listMacosJobs: () => Promise<object[]>, readSlot: (index: number) => Promise<object | null>, createSlot: (index: number, admission: object) => Promise<void>, deleteSlot: (index: number) => Promise<void> }}
 */
export function createGithubIo({ token, repository, headSha }) {
  const [owner, repo] = String(repository ?? '').split('/');

  async function request(path, { method = 'GET', body } = {}) {
    if (!owner || !repo) throw new Error('GITHUB_REPOSITORY is missing');
    return fetch(`https://api.github.com${path}`, {
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

  async function listMacosJobs() {
    const since = `${new Date().toISOString().slice(0, 7)}-01`;
    const runs = [];
    for (let page = 1; page <= 10; page += 1) {
      const response = await request(
        `/repos/${owner}/${repo}/actions/runs?created=>=${since}&per_page=100&page=${page}`,
      );
      if (!response.ok) throw new Error(`the run history answered ${response.status}`);
      const data = await response.json();
      runs.push(...data.workflow_runs);
      if (data.workflow_runs.length < 100) break;
      if (page === 10) throw new Error('the run history of this month is too long to read');
    }
    const jobs = [];
    for (const run of runs) {
      const response = await request(
        `/repos/${owner}/${repo}/actions/runs/${run.id}/jobs?per_page=100`,
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
    }
    return jobs;
  }

  async function readSlot(index) {
    const response = await request(`/repos/${owner}/${repo}/git/ref/${SLOT_REF_PREFIX}${index}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`the slot ${index} answered ${response.status}`);
    const data = await response.json();
    const commit = await request(`/repos/${owner}/${repo}/git/commits/${data.object.sha}`);
    if (!commit.ok) throw new Error(`the admission answered ${commit.status}`);
    const payload = JSON.parse((await commit.json()).message);
    return { slot: index, owner: payload.owner, leaseEnd: payload.leaseEnd };
  }

  async function createSlot(index, admission) {
    if (!headSha) throw new Error('GITHUB_SHA is missing');
    // الحجز بيتخزن في commit message، فالـ ref هو اللي بياخد الذرّية: إنشاؤه بيفشل لو موجود.
    const tree = await request(`/repos/${owner}/${repo}/git/trees`, {
      method: 'POST',
      body: { tree: [] },
    });
    if (!tree.ok) throw new Error(`the tree answered ${tree.status}`);
    const treeSha = (await tree.json()).sha;
    const commit = await request(`/repos/${owner}/${repo}/git/commits`, {
      method: 'POST',
      body: { message: JSON.stringify(admission), tree: treeSha, parents: [headSha] },
    });
    if (!commit.ok) throw new Error(`the admission commit answered ${commit.status}`);
    const sha = (await commit.json()).sha;
    const ref = await request(`/repos/${owner}/${repo}/git/refs`, {
      method: 'POST',
      body: { ref: `${SLOT_REF_PREFIX}${index}`, sha },
    });
    if (ref.status === 422) {
      const error = new Error(`the slot ${index} is taken`);
      error.code = 'conflict';
      throw error;
    }
    if (!ref.ok) throw new Error(`the slot ${index} answered ${ref.status}`);
  }

  async function deleteSlot(index) {
    const response = await request(`/repos/${owner}/${repo}/git/refs/${SLOT_REF_PREFIX}${index}`, {
      method: 'DELETE',
    });
    if (response.status === 404 || response.status === 422) {
      const error = new Error(`the slot ${index} is gone`);
      error.code = 'not-found';
      throw error;
    }
    if (!response.ok) throw new Error(`the slot ${index} answered ${response.status}`);
  }

  return { listMacosJobs, readSlot, createSlot, deleteSlot };
}
