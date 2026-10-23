import { createECDH } from 'node:crypto';

import { readPushApiConfiguration } from './configuration.ts';

/** إعداد الدفع اللي الـ worker بيقرأه: المفتاحين وجهة الاتصال ومعرّف المفتاح. */
export interface PushWorkerConfiguration {
  readonly publicKey: string;
  readonly privateKey: string;
  readonly subject: string;
  readonly keyId: string;
}

/** سبب تعطيل الدفع في الـ worker: سبب محدود بيتسجل، وسببه وحده. */
export type PushDisabledReason =
  'NOT_CONFIGURED' | 'PUBLIC_KEY_OR_SUBJECT_INVALID' | 'PRIVATE_KEY_INVALID' | 'KEY_MISMATCH';

/** نتيجة قراءة جاهزية الدفع: جاهز بإعداده، أو متعطّل بسببه. */
export type PushWorkerReadiness =
  | { readonly ready: true; readonly configuration: PushWorkerConfiguration }
  | { readonly ready: false; readonly reason: PushDisabledReason };

// المفتاح الخاص لـ P-256: 32 بايت، أي 43 حرف base64url من غير padding.
const PRIVATE_KEY = /^[A-Za-z0-9_-]{43}$/;

function isAbsent(value: string | undefined): boolean {
  return value === undefined || value === '';
}

/**
 * بيقرأ جاهزية الدفع من البيئة.
 * القاعدة: الدفع بيتفعّل بس لما التلات متغيرات تكون صحّة والمفتاح الخاص يطلع منه المفتاح العام المعلن؛
 * المفتاح الخاص بيتقرا هنا وبس، والـ worker هو اللي بيقراه، والسبب اللي بيرجع محدود ومش بيحمل أي مفتاح.
 *
 * @param env بيئة العملية
 * @returns الإعداد لو الدفع جاهز، أو سبب التعطيل
 */
export function readPushWorkerConfiguration(env: NodeJS.ProcessEnv): PushWorkerReadiness {
  const publicKey = env['VAPID_PUBLIC_KEY'];
  const subject = env['VAPID_SUBJECT'];
  const privateKey = env['VAPID_PRIVATE_KEY'];
  if (isAbsent(publicKey) && isAbsent(subject) && isAbsent(privateKey))
    return { ready: false, reason: 'NOT_CONFIGURED' };
  const api = readPushApiConfiguration(env);
  if (api === null) return { ready: false, reason: 'PUBLIC_KEY_OR_SUBJECT_INVALID' };
  if (privateKey === undefined || privateKey === '' || !PRIVATE_KEY.test(privateKey))
    return { ready: false, reason: 'PRIVATE_KEY_INVALID' };
  const bytes = Buffer.from(privateKey, 'base64url');
  // المفتاح كله أصفار مش سالب صالح على المنحنى، فمفتاح توقيع مش.
  if (bytes.length !== 32 || bytes.equals(Buffer.alloc(32)))
    return { ready: false, reason: 'PRIVATE_KEY_INVALID' };
  let derived: string;
  try {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(bytes);
    const point = ecdh.getPublicKey();
    if (point.length !== 65 || point[0] !== 0x04)
      return { ready: false, reason: 'PRIVATE_KEY_INVALID' };
    derived = point.toString('base64url');
  } catch {
    // سالب بره مدى المنحنى: setPrivateKey بيرفضه، فالمفتاح مش صالح للتوقيع.
    return { ready: false, reason: 'PRIVATE_KEY_INVALID' };
  }
  if (derived !== api.publicKey) return { ready: false, reason: 'KEY_MISMATCH' };
  return {
    ready: true,
    configuration: {
      publicKey: api.publicKey,
      privateKey,
      subject: api.subject,
      keyId: api.keyId,
    },
  };
}
