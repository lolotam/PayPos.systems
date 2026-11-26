import { useEffect, useState } from 'react';

import { isNativeShell } from '@/shared/platform/native-shell';

import { fetchMinVersionStatus, onAppStateChange, type MinVersionStatus } from './version-fetch';

/** فاصل الفحص الدوري: ربع ساعة (FR-001). */
const CHECK_INTERVAL_MS = 15 * 60_000;
/** أقصى انتظار في بداية التشغيل قبل ما التطبيق يفتح عادي (FR-001a). */
const COLD_START_GRACE_MS = 3_000;
/** أقصى وقت للقراءة الواحدة؛ بعدها الجواب بيتهمل والقراءة تُعد فاشلة (FR-001a). */
const READ_DEADLINE_MS = 10_000;

/** حالة الفحص المعروضة: بنتحقق، ولا التطبيق مقفول، ولا عادي. */
export interface MinAppVersionState {
  readonly checking: boolean;
  readonly blocked: boolean;
  readonly storeUrl: string | null;
}

/** الحالة الساكنة: مفيش تحقق، ومفيش قفل. */
const IDLE: MinAppVersionState = { checking: false, blocked: false, storeUrl: null };

/** أول حالة في نسخة التطبيق: بنتحقق قبل ما التطبيق يفتح (FR-001a). */
const STARTING: MinAppVersionState = { checking: true, blocked: false, storeUrl: null };

/** سبب القراءة: بيحدد هل الشاشة بتستنى المستخدم ولا القراءة بتشتغل في الخلفية. */
type ReadTrigger = 'cold-start' | 'foreground' | 'timer' | 'online';

/** القرار اللي في الذاكرة: قرار ناجح لسه شغّال لحد ما قراءة تانية تنجح (FR-007). */
interface Decision {
  readonly blocked: boolean;
  readonly storeUrl: string | null;
}

type Timeout = ReturnType<typeof setTimeout>;

/** كل الحالة اللي الفحص محتاجها؛ الـ refs جوه بتخلص إعادة الكتابة. */
interface Engine {
  readCounter: number;
  currentReadId: number | null;
  pendingTrigger: boolean;
  decision: Decision | null;
  lastSuccessfulAt: number | null;
  foreground: boolean;
  disposed: boolean;
  graceTimer: Timeout | null;
  deadlineTimer: Timeout | null;
  intervalTimer: Timeout | null;
  view: (patch: Partial<MinAppVersionState>) => void;
}

/**
 * فحص النسخة الدنيا: هل التطبيق المثبّت أقل من الحد الأدنى المطلوب؟
 *
 * القواعد (spec 066):
 * - تشغيل بارد: قراءة دايماً، والتطبيق بيستنى 3 ثواني على الأكثر.
 * - رجوع للقدام: القرار بينمسح والتطبيق بيتعامل زي تشغيل بارد (#582).
 * - إشعار التحميل: في **البداية البارد بس**؛ أي فحص بعده بيشتغل في الخلفية من غير ما
 *   يفصل الشاشة، عشان حالة المستخدم (كود أو كاميرا) ما تضيعش (FR-001a).
 * - قراءة واحدة بس في نفس الوقت، وكل قراءة ليها رقم متزايد؛ غير أحدث جواب هو اللي بيأثر.
 * - المؤقت الدوري: ربع ساعة بعد **كل** قراءة (ناجحة أو فاشلة)، والتطبيق في القدام ومتصل بالنت.
 *
 * @returns حالة الفحص المعروضة
 */
export function useMinAppVersion(): MinAppVersionState {
  const native = isNativeShell();
  const [state, setState] = useState<MinAppVersionState>(native ? STARTING : IDLE);
  useEffect(() => {
    if (!native) return;
    const engine = createEngine((patch) => {
      setState((current) => ({ ...current, ...patch }));
    });
    const removeStateListener = onAppStateChange((isActive) => {
      if (isActive) handleForeground(engine);
      else handleBackground(engine);
    });
    const onOnline = (): void => handleOnline(engine);
    const onOffline = (): void => clearTimer(engine, 'intervalTimer');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    void runRead(engine, 'cold-start');
    return () => {
      engine.disposed = true;
      removeStateListener();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      clearTimer(engine, 'graceTimer');
      clearTimer(engine, 'deadlineTimer');
      clearTimer(engine, 'intervalTimer');
    };
  }, [native]);
  return native ? state : IDLE;
}

function createEngine(view: (patch: Partial<MinAppVersionState>) => void): Engine {
  return {
    readCounter: 0,
    currentReadId: null,
    pendingTrigger: false,
    decision: null,
    lastSuccessfulAt: null,
    foreground: true,
    disposed: false,
    graceTimer: null,
    deadlineTimer: null,
    intervalTimer: null,
    view,
  };
}

function clearTimer(engine: Engine, key: 'graceTimer' | 'deadlineTimer' | 'intervalTimer'): void {
  if (engine[key] === null) return;
  clearTimeout(engine[key]);
  engine[key] = null;
}

/** ينهي مهلة الانتظار: التطبيق بيفتح عادي من غير ما يستنى (FR-001a). */
function endGrace(engine: Engine): void {
  clearTimer(engine, 'graceTimer');
  engine.view({ checking: false });
}

/**
 * مهلة البداية البارد: التطبيق بيفتح عادي بعد 3 ثواني على الأكثر (FR-001a).
 *
 * المهلة بتتسلّح مرة واحدة بس، في البداية البارد؛ بعد كده الفحص بيشتغل في الخلفية
 * من غير إشعار تحميل، عشان الشاشة ما تفصلش وحالة المستخدم ما تضيعش.
 */
function armGrace(engine: Engine): void {
  clearTimer(engine, 'graceTimer');
  engine.graceTimer = setTimeout(() => {
    engine.graceTimer = null;
    engine.view({ checking: false });
  }, COLD_START_GRACE_MS);
}

/**
 * يمسح القرار الحالي ويلغي أي قراءة شغالة.
 *
 * المسح ده بيحصل لما التطبيق يرجع للقدام، فالتطبيق بيتعامل زي تشغيل بارد (#582).
 * مهلة البداية البارد ما بتتلمسش هنا: الرجوع للقدام أثناء الفحص الأول لازم يفضل
 * مفتوح 3 ثواني على الأكثر (FR-001a).
 */
function clearDecision(engine: Engine): void {
  engine.decision = null;
  engine.currentReadId = null;
  engine.pendingTrigger = false;
  clearTimer(engine, 'deadlineTimer');
}

/**
 * يشغّل المؤقت الدوري: ربع ساعة من آخر قراءة، والتطبيق في القدام ومتصل بالنت.
 *
 * المؤقت بيتشغّل بعد **كل** قراءة، حتى الفاشلة (#582)، عشان الملف اللي مش مقروء
 * ما يفضلش بلا فحص لحد ما التطبيق يقفل.
 *
 * @param engine حالة الفحص
 * @param delayMs الوقت المتبقي قبل الفحص، وبيبقى ربع ساعة لو مش محدد
 */
function armInterval(engine: Engine, delayMs: number = CHECK_INTERVAL_MS): void {
  clearTimer(engine, 'intervalTimer');
  if (!engine.foreground || !navigator.onLine) return;
  engine.intervalTimer = setTimeout(() => {
    engine.intervalTimer = null;
    void runRead(engine, 'timer');
  }, delayMs);
}

/**
 * بيشغّل قراءة واحدة.
 *
 * @param engine حالة الفحص
 * @param trigger سبب القراءة
 */
async function runRead(engine: Engine, trigger: ReadTrigger): Promise<void> {
  if (engine.disposed) return;
  if (engine.currentReadId !== null) {
    // قراءة شغالة: بنحتفظ بسبب واحد مدموج، والقراءة النشطة لو فشلت تشغّل متابعة (#582).
    engine.pendingTrigger = true;
    return;
  }
  if (!navigator.onLine) {
    // من غير نت مفيش حاجة نقرأها، والتطبيق يفتح عادي (FR-007).
    endGrace(engine);
    return;
  }
  engine.readCounter += 1;
  const readId = engine.readCounter;
  engine.currentReadId = readId;
  if (trigger === 'cold-start') {
    // إشعار التحميل في البداية البارد بس؛ أي فحص بعده في الخلفية (FR-001a).
    engine.view({ checking: true });
    armGrace(engine);
  }
  clearTimer(engine, 'deadlineTimer');
  engine.deadlineTimer = setTimeout(() => {
    engine.deadlineTimer = null;
    // القراءة عدّت 10 ثواني: بنعتبرها فاشلة، وأي جواب بعد كده بيتهمل (FR-001a).
    settle(engine, readId, null);
  }, READ_DEADLINE_MS);
  const status = await fetchMinVersionStatus();
  settle(engine, readId, status);
}

/**
 * بيقفل القراءة دي: جوابها ينطبق بس لو هي أحدث قراءة لسه شغالة.
 *
 * @param engine حالة الفحص
 * @param readId رقم القراءة
 * @param status نتيجة القراءة، أو null لو فشلت
 */
function settle(engine: Engine, readId: number, status: MinVersionStatus | null): void {
  // القراءة دي مش الأحدث، أو خلصت قبل كده: جوابها بيتهمل (FR-001b).
  if (engine.currentReadId !== readId) return;
  engine.currentReadId = null;
  clearTimer(engine, 'deadlineTimer');
  if (status === null) {
    // قراءة فاشلة: القرار القايم بيفضل زي ما هو (FR-007).
    endGrace(engine);
    armInterval(engine);
    if (engine.pendingTrigger) {
      engine.pendingTrigger = false;
      void runRead(engine, 'timer');
    }
    return;
  }
  engine.decision =
    status.outcome === 'blocked'
      ? { blocked: true, storeUrl: status.storeUrl }
      : { blocked: false, storeUrl: null };
  engine.lastSuccessfulAt = Date.now();
  engine.pendingTrigger = false;
  endGrace(engine);
  engine.view({
    blocked: engine.decision.blocked,
    storeUrl: engine.decision.storeUrl,
    checking: false,
  });
  armInterval(engine);
}

/**
 * رجوع التطبيق للقدام: القرار بينمسح والتطبيق بيتعامل زي تشغيل بارد (#582).
 *
 * الفحص ده بيشتغل في الخلفية من غير إشعار تحميل، عشان الشاشة ما تفصلش وحالة
 * المستخدم ما تضيعش (FR-001a).
 */
function handleForeground(engine: Engine): void {
  engine.foreground = true;
  clearDecision(engine);
  engine.view({ blocked: false, storeUrl: null });
  void runRead(engine, 'foreground');
}

/**
 * التطبيق ورا: القراءة الشغالة بتتلغي، والمؤقتات بتتقفل (FR-007).
 *
 * إشعار التحميل بيقفل هنا كمان: الرجوع للقدام بعد كده بيفحص في الخلفية (FR-001a).
 */
function handleBackground(engine: Engine): void {
  engine.foreground = false;
  engine.currentReadId = null;
  engine.pendingTrigger = false;
  clearTimer(engine, 'graceTimer');
  clearTimer(engine, 'deadlineTimer');
  clearTimer(engine, 'intervalTimer');
  engine.view({ checking: false });
}

/**
 * رجوع النت: بنفحص على طول لو مفيش قراءة ناجحة سارية، أو آخر واحدة قديمة.
 *
 * @param engine حالة الفحص
 */
function handleOnline(engine: Engine): void {
  if (engine.decision !== null && engine.lastSuccessfulAt !== null) {
    const age = Date.now() - engine.lastSuccessfulAt;
    if (age < CHECK_INTERVAL_MS) {
      // القراءة الأخيرة لسه سارية: بنعيد جدولة المؤقت بالوقت المتبقي، وإلا الفحص
      // الدوري وقف مع حدث عدم الاتصال.
      armInterval(engine, CHECK_INTERVAL_MS - age);
      return;
    }
  }
  void runRead(engine, 'online');
}
