// ضبط Redis لقياس الأداء: إيقاف الحفظ أثناء القياس، التحقق من الحاوية، واسترجاع الإعدادات بعده.
import { execFileSync } from 'node:child_process';
import { cpus, loadavg } from 'node:os';
import { expect } from 'vitest';

import type { validationHarness } from './rating-claim-state-harness.fixture.ts';

type PerfRedis = ReturnType<typeof validationHarness>['redis'];

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1'];
const QUIET = { appendonly: 'no', save: '', 'latency-monitor-threshold': '20' };
const BUSY_FIELDS = ['aof_rewrite_in_progress', 'aof_rewrite_scheduled', 'rdb_bgsave_in_progress'];
const IDLE_TIMEOUT_MS = 30_000;

function docker(args: readonly string[]) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** قراءة قيمة إعداد Redis كنص، عشان نرجّعها زي ما كانت بعد الاختبار. */
async function configValue(redis: PerfRedis, name: string) {
  const reply = (await redis.call('CONFIG', 'GET', name)) as string[];
  return reply[1] ?? '';
}

/**
 * `CONFIG SET appendonly yes` بيبدأ AOF rewrite في الخلفية، وbgsave ممكن يكون شغّال من سياسة save؛
 * لو القياس اللي بعده بدأ والكتابة دي لسه شغّالة، توقفات القرص بترجع تضرب p99. فبنستنى لحد ما
 * Redis يقول إن مفيش حفظ شغّال، ولو ما خلصش في المهلة بنفشل بدل ما نقيس على جهاز مشغول.
 */
async function waitPersistenceIdle(redis: PerfRedis) {
  const deadline = Date.now() + IDLE_TIMEOUT_MS;
  for (;;) {
    const info = await redis.info('persistence');
    const busy = BUSY_FIELDS.filter((field) => !new RegExp(`^${field}:0\\r?$`, 'm').test(info));
    if (busy.length === 0) return;
    if (Date.now() >= deadline) throw new Error(`REDIS_PERSISTENCE_BUSY ${busy.join(',')}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * (الاستعادة بتمسح كل إعداد بعد نجاح ضبطه بس، فلو فشلت تفضل الأصول محفوظة وquietRedis ما بيكتبش فوقها.)
 * Redis الـCI شغّال بـAOF وكل عينة near-cap بتكتب ~2MB فيه (SET العميل + SET السكربت)، فتوقفات
 * القرص (150–200ms) بتضرب النسختين بنفس الاحتمال لكن p99 من 500 عينة هي السادسة من الأكبر
 * فبتقع على نسخة بالصدفة. بنوقف الحفظ أثناء القياس ونرجّعه بعده (الحفظ مش موضوع الاختبار).
 */
export async function quietRedis(redis: PerfRedis, saved: Map<string, string>) {
  for (const [name, value] of Object.entries(QUIET)) {
    if (!saved.has(name)) saved.set(name, await configValue(redis, name));
    await redis.call('CONFIG', 'SET', name, value);
  }
  await waitPersistenceIdle(redis);
}

/** بيرجّع إعدادات الحفظ الأصلية ويستنى الـrewrite اللي بتبدأه، عشان ما يتداخلش مع القياس الجاي. */
export async function restoreRedis(redis: PerfRedis, saved: Map<string, string>) {
  for (const [name, value] of [...saved]) {
    await redis.call('CONFIG', 'SET', name, value);
    saved.delete(name);
  }
  await waitPersistenceIdle(redis);
}

/**
 * حاوية Redis الوحيدة بالمنفذ والوسم المتوقعين؛ والمضيف لازم يكون محلي؛ بنفشل قبل أي تعديل إعدادات
 * على URL مش متحقق منه. ولأن الضبط بيغيّر إعدادات السيرفر كله، بيشتغل على runner الـGitHub Actions
 * بس (Redis بتاعه بيتعمل بـinfra:up على جهاز بيتمسح بعد الـjob)؛ تشغيل محلي بـCI=true بيفشل هنا
 * قبل ما يلمس Redis التطوير المشترك على 6379، فمقاطعة التشغيل ما تسيبش Redis مشترك من غير حفظ.
 */
export function verifiedContainer(redis: PerfRedis) {
  expect(process.env['GITHUB_ACTIONS']).toBe('true');
  expect(LOCAL_HOSTS).toContain(redis.options.host);
  const port = String(redis.options.port);
  const filters = [`publish=${port}`, 'label=com.docker.compose.service=redis'];
  const flags = filters.flatMap((filter) => ['--filter', filter]);
  const container = docker(['ps', '-q', ...flags]).trim();
  expect(container.split('\n')).toHaveLength(1);
  expect(container).not.toBe('');
  return container;
}

/** هوية حاوية Redis ونسختها للسجل. */
export async function redisIdentity(redis: PerfRedis) {
  const container = verifiedContainer(redis);
  const format = '{{.Image}} {{.Config.Image}}';
  const image = docker(['inspect', '--format', format, container]).trim();
  return { image, server: await redis.info('server'), cpus: cpus().length, load: loadavg() };
}
