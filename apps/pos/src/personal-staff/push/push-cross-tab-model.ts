import { vi } from 'vitest';

import type { PushSubscriptionInput } from '@pospay/contracts';

import type { PushRecord, PushSuspension, PushWriteOptions } from './push-record';

/** سطر على السيرفر: توكن التسليم والاشتراك اللي اتعمل بيه والشخص اللي سجّل من جلسته. */
export interface ServerRow {
  token: string;
  endpoint: string;
  subscriber: string;
}

/** اشتراك المتصفح: الموبايل ماسك اشتراك واحد بس والتبويبات بتتقاسمه. */
export interface BrowserSlot {
  endpoint: string;
}

/** تسجيل محجوز: وصل الـ API، لسه ما وصلش السيرفر، ولحد ما يوصل. */
export interface HeldRegister {
  body: PushSubscriptionInput | null;
  /** بيحل لما التسجيل يوصل للـ API. */
  arrived: Promise<void>;
  /** بيحل لما التسجيل يوصل السيرفر فعلاً. */
  promise: Promise<void>;
  arrive(): void;
  land(): void;
  release(): void;
}

/** نموذج التبويبات: السجل المحلي والاشتراك في المتصفح والسطر على السيرفر. */
export interface CrossTabModel {
  record: PushRecord | null;
  generation: number;
  readThrows: boolean;
  failReadAfterWrite: boolean;
  slot: BrowserSlot | null;
  subscribes: number;
  unsubscribes: number;
  rows: Map<string, ServerRow>;
  caller: string;
  /** مرجع المشترك بتاع الجلسة اللي بتسجّل على السيرفر دلوقتي. */
  callerRef: string;
  /** المفتاح الساري على السيرفر: null يعني إن أي مفتاح مقبول. */
  currentVapid: string | null;
  /** طوابير القفل في الذاكرة: كل اسم قفل له طابور مستقل. */
  lockChains: Map<string, Promise<unknown>>;
  permissionRequests: number;
  revokes: string[];
  holds: HeldRegister[];
}

export function createCrossTabModel(): CrossTabModel {
  return {
    record: null,
    generation: 0,
    readThrows: false,
    failReadAfterWrite: false,
    slot: null,
    subscribes: 0,
    unsubscribes: 0,
    rows: new Map<string, ServerRow>(),
    caller: '',
    callerRef: 'subscriber-ref',
    currentVapid: null,
    lockChains: new Map<string, Promise<unknown>>(),
    permissionRequests: 0,
    revokes: [],
    holds: [],
  };
}

/**
 * قفل Web Locks حقيقي في الذاكرة: كل اسم قفل له طابور، والطلب بيستنى اللي قبله يخلص،
 * وفشل طلب ما بيقفش اللي بعده.
 */
export function stubWebLocks(model: CrossTabModel): void {
  vi.stubGlobal('navigator', {
    locks: {
      request: (name: string, work: () => Promise<unknown>) => {
        const previous = model.lockChains.get(name) ?? Promise.resolve();
        const run = previous.then(work, work);
        model.lockChains.set(
          name,
          run.then(
            () => undefined,
            () => undefined,
          ),
        );
        return run;
      },
    },
  });
}

/** متصفح من غير Web Locks: مفيش قفل حقيقي بين التبويبات. */
export function stubNoWebLocks(): void {
  vi.stubGlobal('navigator', {});
}

export async function readRecord(model: CrossTabModel): Promise<PushRecord | null> {
  if (model.readThrows) throw new Error('PUSH_STORE_UNAVAILABLE');
  const stored = model.record;
  return stored === null ? null : { ...stored };
}

export async function writeRecord(model: CrossTabModel, record: PushRecord): Promise<void> {
  model.record = record;
}

export async function removeRecord(model: CrossTabModel): Promise<void> {
  model.record = null;
}

export async function removeIfMatches(
  model: CrossTabModel,
  expected: { token: string | null; revision: number },
): Promise<boolean> {
  const stored = model.record;
  if (
    stored === null ||
    stored.token !== expected.token ||
    (stored.revision ?? 0) !== expected.revision
  ) {
    return false;
  }
  model.record = null;
  return true;
}

export async function suspendRecord(model: CrossTabModel): Promise<PushSuspension | null> {
  const stored = model.record;
  if (stored === null) return null;
  const suspended = { ...stored, suspended: true, revision: (stored.revision ?? 0) + 1 };
  model.record = suspended;
  return { record: suspended, generation: model.generation };
}

export async function generation(model: CrossTabModel): Promise<number> {
  return model.generation;
}

export async function bumpGeneration(model: CrossTabModel): Promise<number> {
  model.generation += 1;
  return model.generation;
}

/** الكتابة المحروسة: نفس قواعد المخزن الحقيقي (الجيل والمراجعة والتوكن). */
export async function writeIfGeneration(
  model: CrossTabModel,
  record: PushRecord,
  expected: number,
  options?: PushWriteOptions,
): Promise<boolean> {
  const written = guardWrite(model, record, expected, options);
  // القراءة بتتأثر بالكتابة الفاشلة بس في الاختبار ده: عشان نتأكد إن عدم معرفة
  // الملكية ما بتعملش تنظيف مدمر.
  if (!written && model.failReadAfterWrite) model.readThrows = true;
  return written;
}

function guardWrite(
  model: CrossTabModel,
  record: PushRecord,
  expected: number,
  options?: PushWriteOptions,
): boolean {
  if (model.generation !== expected) return false;
  const stored = model.record;
  if (options?.expectRevision !== undefined && (stored?.revision ?? 0) !== options.expectRevision) {
    return false;
  }
  if (options?.expectToken !== undefined && (stored?.token ?? null) !== options.expectToken) {
    return false;
  }
  const clear = options?.clearSuspension === true;
  const suspended = stored?.suspended === true && !clear;
  model.record = suspended ? { ...record, suspended: true } : record;
  return true;
}

export async function currentSubscription(model: CrossTabModel): Promise<BrowserSlot | null> {
  return model.slot;
}

export async function subscribeWithDeadline(model: CrossTabModel): Promise<BrowserSlot> {
  model.subscribes += 1;
  model.slot = { endpoint: `https://fcm.googleapis.com/fcm/send/ep-${model.subscribes}` };
  return model.slot;
}

export async function unsubscribePush(model: CrossTabModel): Promise<boolean> {
  model.unsubscribes += 1;
  model.slot = null;
  return true;
}

export function pushSubscriptionBody(subscription: BrowserSlot): {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
} {
  return {
    endpoint: subscription.endpoint,
    expirationTime: null,
    keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
  };
}

/** السطر على السيرفر بينكتب باسم الشركة والشخص اللي بتطلب التسجيل دلوقتي. */
export function registerOnServer(model: CrossTabModel, body: PushSubscriptionInput): void {
  // السيرفر بيرفض أي تسجيل بمفتاح قديم: التوكن الجديد لازم يتعمل بمفتاح ساري.
  if (model.currentVapid !== null && body.vapid_key_id !== model.currentVapid) {
    throw new Error('PUSH_KEY_STALE');
  }
  model.rows.set(`${model.caller}:${body.installation_id}`, {
    token: body.delivery_token,
    endpoint: body.subscription.endpoint,
    subscriber: model.callerRef,
  });
}

export function revokeOnServer(model: CrossTabModel, installationId: string): void {
  model.revokes.push(installationId);
  model.rows.delete(`${model.caller}:${installationId}`);
}

/** حجز تسجيل: الاختبار هو اللي يقرر يوصل السيرفر امتى ويكمّل التبويب امتى. */
export function createHold(model: CrossTabModel): HeldRegister {
  let arrive!: () => void;
  let release!: () => void;
  const arrived = new Promise<void>((done) => {
    arrive = done;
  });
  const promise = new Promise<void>((done) => {
    release = done;
  });
  const hold: HeldRegister = {
    body: null,
    arrived,
    promise,
    arrive,
    land: () => {
      const body = hold.body;
      if (body === null) throw new Error('REGISTER_NOT_ARRIVED');
      registerOnServer(model, body);
    },
    release,
  };
  model.holds.push(hold);
  return hold;
}
