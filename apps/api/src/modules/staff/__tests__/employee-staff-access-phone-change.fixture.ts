import { createHmac } from 'node:crypto';
import { systemUuidV7 } from '@pospay/ids';
import { expect } from 'vitest';

import { present } from '../../../../../../packages/db/test/present.ts';
import {
  addEmployee,
  grant,
  hashStaffPin,
  nextPhone,
  type Fixture,
} from '../../../../test/staff-access.fixture.ts';
import { origin } from '../../../../test/staff-otp-harness.ts';
import type { paired } from '../../../../test/staff-otp-harness.ts';
import { systemClock } from '../../../shared/adapters/system-clock.ts';
import {
  createChangeEmployeeStaffPhoneSteps,
  createStaffAccessPhoneUserSteps,
} from '../persistence/staff-access-phone.adapter.ts';
import { ChangeEmployeeStaffPhoneUseCase } from '../use-cases/change-employee-staff-phone/change-employee-staff-phone.ts';

export type ChangeFixtureDevice = Awaited<ReturnType<typeof paired>>;

const ids = systemUuidV7();
/** الرقم المؤقت الذي يعطيه `grant` للموظفة، والدائم الذي تختاره بعد التغيير الأول، والمؤقت الجديد. */
export const GRANT_PIN = '1234';
export const PERMANENT_PIN = '5678';
export const NEW_PIN = '7351';

/** نقطة فشل مُحقَنة بين خطوات التغيير لتمثيل انقطاع حقيقي في مكان محدد. */
export interface ChangeFaults {
  readonly beforeAuthStep?: boolean;
  readonly afterAuthStep?: boolean;
}

/** نداءات الجهاز: دخول الرقم السري وتغييره بدليل، وطلب يحتاج جلسة POS صالحة. */
function deviceCalls(f: Fixture, device: ChangeFixtureDevice) {
  const headers = (extra: Record<string, string> = {}) => ({
    authorization: `Device ${device.token}`,
    origin,
    ...extra,
  });
  const post = (url: string, payload: object, extra: Record<string, string> = {}) =>
    f.h.app.inject({ method: 'POST', url, headers: headers(extra), payload });
  return {
    signIn: (pin: string, phone: string) =>
      post('/v1/devices/me/staff-pin/sign-in', { phone, pin }),
    changePin: (proof: string, pin: string) =>
      post('/v1/devices/me/staff-pin/change', { proof, pin }),
    /** 200 لجلسة تعمل، و401 لجلسة محذوفة أو غير مؤهلة. */
    sessionStatus: async (cookie: string, pin: string): Promise<number> =>
      (await post('/v1/staff/me/private-view', { pin }, { cookie })).statusCode,
  };
}

/** موظفة بدخول فعّال: منح بالرقم المؤقت، ثم رقم دائم عبر F2، ثم جلسة POS حقيقية. */
function staffFactory(f: Fixture, calls: ReturnType<typeof deviceCalls>) {
  let counter = 500;
  return async () => {
    counter += 1;
    const employee = await addEmployee(f, `Phone change ${counter}`, f.salmiya, counter);
    const phone = nextPhone(f);
    expect((await grant(f, employee, phone)).status).toBe(200);
    const [row] = await f.h.owner`SELECT user_id FROM employee_staff_access
      WHERE employee_id=${employee}`;
    const temporary = await calls.signIn(GRANT_PIN, phone);
    const proof = (temporary.json() as { details?: { proof?: string } }).details?.proof ?? '';
    expect((await calls.changePin(proof, PERMANENT_PIN)).statusCode).toBe(204);
    const signedIn = await calls.signIn(PERMANENT_PIN, phone);
    expect(signedIn.statusCode).toBe(200);
    const cookie = present(String(signedIn.headers['set-cookie']).split(';')[0]);
    return { employee, phone, userId: row?.user_id as string, cookie };
  };
}

/** جلسة STAFF_PERSONAL اصطناعية مع صف نافذة العرض الخاصة بها، لإثبات حذفهما معاً. */
function personalSessionFactory(f: Fixture) {
  return async (userId: string): Promise<string> => {
    const sessionId = ids.newId();
    const deadline = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    const context = JSON.stringify({
      purpose: 'STAFF_PERSONAL',
      companyId: f.company,
      businessId: f.business,
    });
    await f.h.owner`INSERT INTO session(id,expires_at,token,user_id,purpose,staff_personal_context,
        staff_authenticated_at,staff_absolute_deadline)
      VALUES (${sessionId},${deadline}::timestamptz,${`personal-${sessionId}`},${userId},'STAFF_PERSONAL',
        ${context}::text::jsonb,now(),${deadline}::timestamptz)`;
    await f.h.owner`INSERT INTO verification(id,identifier,value,expires_at)
      VALUES (${ids.newId()},${`staff-private-view:v1:${sessionId}`},'synthetic',now()+interval '5 minutes')`;
    return sessionId;
  };
}

/** use case حقيقي على نفس القاعدة، بانقطاع قبل خطوة auth أو بعدها عند الطلب. */
function useCaseFactory(f: Fixture) {
  return (faults: ChangeFaults = {}): ChangeEmployeeStaffPhoneUseCase => {
    const real = createStaffAccessPhoneUserSteps(f.h.auth.staffUsers, (pin) => hashStaffPin(pin));
    return new ChangeEmployeeStaffPhoneUseCase(
      createChangeEmployeeStaffPhoneSteps(f.db, f.cardKey),
      {
        changePhone: async (input) => {
          if (faults.beforeAuthStep === true) throw new Error('CRASH_BEFORE_AUTH_STEP');
          await real.changePhone(input);
        },
        hash: async (pin) => {
          if (faults.afterAuthStep === true) throw new Error('CRASH_AFTER_AUTH_STEP');
          return real.hash(pin);
        },
      },
      { invalidate: async () => undefined },
      systemClock,
      ids,
    );
  };
}

/** قراءات الحالة من الجداول مباشرة (صاحب القاعدة) — بلا المرور بالـ API. */
function readers(f: Fixture) {
  return {
    ownerUserId: async (): Promise<string> => {
      const session = await f.h.auth.getSession(new Headers({ cookie: f.ownerCookie }));
      if (session === null) throw new Error('OWNER_SESSION_MISSING');
      return session.userId;
    },
    pinRow: async (userId: string) =>
      (
        await f.h.owner`SELECT id, pin_hash, temporary, expires_at, set_by, set_at
          FROM cashier_pins WHERE user_id=${userId}`
      )[0],
    recordOf: async (employee: string) =>
      (
        await f.h.owner`SELECT id, state, phone_hash, attempt_id, user_id, membership_id
          FROM employee_staff_access WHERE employee_id=${employee}`
      )[0],
    phoneOf: async (userId: string) =>
      (
        await f.h
          .owner`SELECT phone_number, phone_binding_approved_at FROM "user" WHERE id=${userId}`
      )[0],
    /** بصمة الهاتف المفتاحية نفسها التي يكتبها المنح — تثبت أن التغيير يكتب بصمة قابلة للمقارنة. */
    phoneHash: (phone: string): string =>
      createHmac('sha256', f.cardKey)
        .update('pospay:staff-access:phone:v1\0')
        .update(phone)
        .digest('hex'),
  };
}

/**
 * أدوات اختبار «تغيير هاتف موظفة» فوق نفس التطبيق والقاعدة: موظفة بدخول فعّال ورقم دائم وجلسة POS،
 * ونداء المسار، ومنفّذ use case حقيقي بنقاط انقطاع، وقراءات الحالة من الجداول مباشرة.
 */
export function phoneChangeHelpers(f: Fixture, device: ChangeFixtureDevice) {
  const calls = deviceCalls(f, device);
  const path = (employee: string) =>
    `/v1/businesses/${f.business}/employees/${employee}/staff-access/phone`;
  const changePhone = (
    employee: string,
    phone: string,
    cookie = f.ownerCookie,
    body: Record<string, unknown> = {},
  ) =>
    f.h.send('PUT', path(employee), {
      cookie,
      company: f.company,
      body: { phone, phone_confirmed: true, pin: NEW_PIN, ...body },
    });
  return {
    ...calls,
    ...readers(f),
    activeStaff: staffFactory(f, calls),
    personalSession: personalSessionFactory(f),
    useCase: useCaseFactory(f),
    changePhone,
    path,
  };
}
