import type { AuthDatabase } from '@pospay/db';
import { APIError, createAuthEndpoint } from 'better-auth/api';

/** الأخطاء بنفس الكود والرسالة اللي Better Auth بيرجّعها، فالـ admin بيفرّق رابط ميت بـ INVALID_TOKEN زي الأول. */
const INVALID_TOKEN = { code: 'INVALID_TOKEN', message: 'Invalid token' } as const;
const PASSWORD_TOO_SHORT = { code: 'PASSWORD_TOO_SHORT', message: 'Password too short' } as const;
const PASSWORD_TOO_LONG = { code: 'PASSWORD_TOO_LONG', message: 'Password too long' } as const;
/** نفس جسم فشل الـ schema في better-call (400 + كود VALIDATION_ERROR) — الرسالة عنده ديناميكية، فيناخد ثابتة. */
const VALIDATION_ERROR = { code: 'VALIDATION_ERROR', message: 'Invalid body parameters' } as const;
/** فشل قاعدة بيانات في مسار الـ reset: إجابة ثابتة بدون أي تفصيلة من الخطأ الأصلي. */
const RESET_FAILED = { code: 'INTERNAL_SERVER_ERROR', message: 'Internal Server Error' } as const;

/**
 * نفس فحوصات schema مسار Better Auth الأصلي 1.7.5 بالسلوك الظاهر: newPassword وتوكن الـ body
 * وتوكن الـ query لازم strings — أي نوع غلط أو قيمة ناقصة بترجّع 400 VALIDATION_ERROR قبل أي
 * استهلاك، والتوكن بيتاخد `body.token || query.token` بعد الفحوصات بس (مفيش سقوط لمصدر تاني
 * لو توكن موجود بنوع غلط).
 *
 * @param body جسم الطلب زي ما better-call بيمرّره
 * @param query query الطلب
 * @returns التوكن وكلمة المرور بعد التحقق
 * @throws APIError فشل التحقق بيرجّع 400 VALIDATION_ERROR، ونقص التوكن بيرجّع 400 INVALID_TOKEN
 */
function validatedResetInput(
  body: { token?: unknown; newPassword?: unknown } | undefined,
  query: { token?: unknown } | undefined,
): { token: string; newPassword: string } {
  if (typeof body?.newPassword !== 'string') throw APIError.from('BAD_REQUEST', VALIDATION_ERROR);
  if (body.token !== undefined && typeof body.token !== 'string') {
    throw APIError.from('BAD_REQUEST', VALIDATION_ERROR);
  }
  if (query?.token !== undefined && typeof query.token !== 'string') {
    throw APIError.from('BAD_REQUEST', VALIDATION_ERROR);
  }
  const token = (body.token as string | undefined) || (query?.token as string | undefined);
  if (token === undefined || token === '') throw APIError.from('BAD_REQUEST', INVALID_TOKEN);
  return { token, newPassword: body.newPassword };
}

/** رابط تعيين كلمة المرور بيتخزن في verification بنفس الشكل اللي Better Auth بيقراه: `reset-password:<token>`. */
const identifierOf = (token: string): string => `reset-password:${token}`;

/** SQLSTATE من خطأ Postgres (أو من سببه داخل Drizzle) — خمسة محارف أرقام فقط، ولا شيء آخر يُقرأ من الخطأ. */
const sqlstateOf = (error: unknown): string | undefined => {
  const candidates = [error, (error as { cause?: unknown } | undefined)?.cause];
  for (const candidate of candidates) {
    const code = (candidate as { code?: unknown } | null | undefined)?.code;
    if (typeof code === 'string' && /^\d{5}$/.test(code)) return code;
  }
  return undefined;
};

/**
 * بيرجّع خطأ 500 ثابت لفشل قاعدة بيانات في مسار الـ reset: خطأ Drizzle بيحمل الـ SQL params
 * (التوكن اللسه صالح وهاش كلمة المرور)، فالخطأ الأصلي عمره ما بيتسجّل ولا بيتإرفق كـ cause —
 * السطر الوحيد في الـ log بيبقى تصنيف ثابت وكود SQLSTATE بس.
 *
 * @param log مستقبل الـ log الآمن (خطأ مصنّف بس)؛ غيابه معناه مفيش تسجيل خالص
 * @param error الخطأ الأصلي — بيتقري منه كود SQLSTATE فقط
 * @returns خطأ APIError ثابت 500 من غير أي تفاصيل
 */
function resetFailed(
  log: ((entry: { readonly level: 'error'; readonly message: string }) => void) | undefined,
  error: unknown,
): APIError {
  const sqlstate = sqlstateOf(error);
  log?.({
    level: 'error',
    message: sqlstate === undefined ? 'PASSWORD_RESET_FAILED' : `PASSWORD_RESET_FAILED:${sqlstate}`,
  });
  return APIError.from('INTERNAL_SERVER_ERROR', RESET_FAILED);
}

/**
 * بيحل محل مسار `/reset-password` بتاع Better Auth بمسار واحد ذري (G1، P1-1/P1-2). الأصلي بيستهلك
 * الرابط، ثم يعمل hash، ثم يكتب كلمة المرور، ثم ينادي hook يمسح باقي الروابط — كل خطوة لوحدها من
 * غير قفل، فإعادة إصدار رابط بتدخل بين الخطوات، وفشل المسح بعد حفظ كلمة المرور بيرجّع 500 والرابط
 * ميت. هنا الـ hash بيتحسب الأول بره أي قفل، ثم معاملة واحدة تحت قفل صف اليوزر (نفس قفل إصدار
 * الرابط) بتستهلك الرابط وتكتب كلمة المرور وتمسح كل رابط reset تاني لنفس اليوزر — أو بترجع كلها.
 * أي فشل قاعدة بيانات بيتحوّل لخطأ 500 ثابت من غير تفاصيل (لا توكن ولا hash في الـ log).
 * الـ route والـ origin check والـ rate limit والأخطاء كلها بتفضل Better Auth زي ما هي.
 *
 * @param options قاعدة الهوية ومولّد الـ ids وساعة الطلب ومستقبل الـ log الآمن
 * @returns plugin بيستبدل endpoint الـ resetPassword
 */
export function passwordResetPlugin(options: {
  database: AuthDatabase;
  ids: { newId(): string };
  clock?: { now(): Date } | undefined;
  onLog?: ((entry: { readonly level: 'error'; readonly message: string }) => void) | undefined;
}) {
  const resets = options.database.passwordResets;
  return {
    id: 'pospay-password-reset',
    endpoints: {
      resetPassword: createAuthEndpoint('/reset-password', { method: 'POST' }, async (ctx) => {
        const body = (ctx.body ?? {}) as { token?: unknown; newPassword?: unknown };
        const query = ctx.query as { token?: unknown } | undefined;
        const { token, newPassword } = validatedResetInput(body, query);
        const { minPasswordLength, maxPasswordLength } = ctx.context.password.config;
        if (newPassword.length < minPasswordLength) {
          throw APIError.from('BAD_REQUEST', PASSWORD_TOO_SHORT);
        }
        if (newPassword.length > maxPasswordLength) {
          throw APIError.from('BAD_REQUEST', PASSWORD_TOO_LONG);
        }
        const identifier = identifierOf(token);
        // الرفض المقصود (INVALID_TOKEN) بيتحدد بره الـ try: أي استثناء من قاعدة البيانات أو الـ hasher —
        // حتى لو APIError — بيتحول للـ 500 الثابت، فمفيش تفصيلة من تبعية بتوصل للرد أو للـ log.
        let outcome: 'dead-link' | 'invalid-link' | 'done';
        try {
          // رابط ميت بيترفض قبل الـ hash: مفيش حد من بره يقدر يجبر السيرفر يحسب hash من غير رابط صالح.
          if (!(await resets.linkIsLive(identifier, options.clock?.now() ?? new Date()))) {
            outcome = 'dead-link';
          } else {
            const passwordHash = await ctx.context.password.hash(newPassword);
            outcome = await resets.consumeLinkAndSetPassword({
              identifier,
              passwordHash,
              accountId: options.ids.newId(),
              // الساعة بتتقري جوه المعاملة بعد قفل اليوزر — مش هنا.
              now: () => options.clock?.now() ?? new Date(),
            });
          }
        } catch (error) {
          throw resetFailed(options.onLog, error);
        }
        if (outcome !== 'done') throw APIError.from('BAD_REQUEST', INVALID_TOKEN);
        return ctx.json({ status: true });
      }),
    },
  };
}
