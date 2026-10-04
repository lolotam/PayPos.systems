import { passkey } from '@better-auth/passkey';
import { APIError } from 'better-auth/api';

/** RP والأصول لا تتسع بالإعدادات إلى staging داخل إنتاج أو إلى عميل غير معتمد. */
export function passkeyPolicy(
  baseURL: string,
  trustedOrigins: readonly string[],
  localPosOrigin?: string,
) {
  const host = new URL(baseURL).hostname;
  const staging = host === 'api.staging.pospay.systems';
  const local = host === 'localhost';
  const rpID = local ? 'localhost' : staging ? 'staging.pospay.systems' : 'pospay.systems';
  const allowed = local
    ? trustedOrigins.filter((origin) => {
        const url = new URL(origin);
        return url.hostname === 'localhost' && url.protocol === 'http:' && url.origin === origin;
      })
    : [`https://app.${rpID}`, `https://pos.${rpID}`].filter((origin) =>
        trustedOrigins.includes(origin),
      );
  return {
    rpID,
    origins: allowed,
    personalOrigin: local
      ? localPosOrigin !== undefined && allowed.includes(localPosOrigin)
        ? localPosOrigin
        : null
      : (allowed.find((origin) => origin === `https://pos.${rpID}`) ?? null),
  };
}

/** جميع مسارات plugin العامة مغلقة؛ الواجهة المقيدة وحدها تستدعي التسجيل داخلياً. */
export function isPasskeyRoute(url: string): boolean {
  try {
    return /\/passkey(?:\/|$)/i.test(decodeURIComponent(new URL(url).pathname));
  } catch {
    return true;
  }
}

/** الـ plugin لا يفرض UV في 1.7.5؛ نفحص نتيجة التحقق قبل أن يكتب الاعتماد. */
export function registrationPlugin(
  policy: ReturnType<typeof passkeyPolicy>,
): ReturnType<typeof passkey> {
  return passkey({
    rpID: policy.rpID,
    rpName: 'PosPay',
    origin: policy.origins,
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      residentKey: 'required',
      userVerification: 'required',
    },
    registration: {
      requireSession: false,
      resolveUser: ({ context }) => {
        if (context === undefined || context === null) throw new APIError('UNAUTHORIZED');
        return { id: context, name: context, displayName: context };
      },
      afterVerification: ({ verification, clientData }) => {
        if (
          verification.registrationInfo?.userVerified !== true ||
          clientData.authenticatorAttachment !== 'platform'
        )
          throw new APIError('BAD_REQUEST');
      },
    },
  });
}
