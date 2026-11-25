import type { ArgumentsHost } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { EnvelopeExceptionFilter } from '../src/shared/exception.filter.ts';

/** سبب واحد من سلسلة الخطأ: الفئة والكود وSQLSTATE واسم القيد بس، بلا نص رسالة قد يحمل معاملات. */
interface FaultLink {
  readonly name: string;
  readonly code: string | null;
  readonly sqlstate: string | null;
  readonly constraint: string | null;
}

/** خطأ خادم 5xx كما رآه مرشح الاستثناءات: السلسلة بقيمها المسموحة فقط. */
export interface ServerFault {
  readonly status: number;
  readonly chain: readonly FaultLink[];
}

const faults: ServerFault[] = [];
let installed = false;
const SYMBOLIC = /^[A-Z][A-Z0-9_]{2,63}$/;
const SQLSTATE = /^[0-9A-Z]{5}$/;
const INJECTED = 'INJECTED_';

function link(error: unknown): FaultLink {
  const value = (typeof error === 'object' && error !== null ? error : {}) as Record<string, unknown>;
  const text = (key: string, pattern: RegExp): string | null =>
    typeof value[key] === 'string' && pattern.test(value[key] as string)
      ? (value[key] as string)
      : null;
  return {
    name: error instanceof Error ? error.constructor.name : typeof error,
    code: text('code', /^[A-Z0-9_]{1,64}$/),
    sqlstate: text('sqlstate', SQLSTATE),
    constraint: text('constraint_name', /^[a-z0-9_]{1,63}$/) ?? text('constraint', /^[a-z0-9_]{1,63}$/),
  };
}

function describe(exception: unknown, status: number): ServerFault {
  const chain: FaultLink[] = [];
  const seen = new Set<unknown>();
  let current: unknown = exception;
  while (current !== undefined && current !== null && !seen.has(current) && chain.length < 6) {
    seen.add(current);
    chain.push(link(current));
    current = (current as { cause?: unknown }).cause;
  }
  return { status, chain };
}

/**
 * هل الخطأ محقون عمداً في الاختبار؟ تُقرأ رسالة الخطأ هنا فقط — مش بتتخزَّن — عشان نكتم ضجيج
 * الأخطاء المحقونة، والسجل نفسه يبقى قيم السماح بس.
 */
function isInjectedFault(exception: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = exception;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    if (
      current instanceof Error &&
      SYMBOLIC.test(current.message) &&
      current.message.startsWith(INJECTED)
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * يلتقط كل خطأ 5xx يمر بمرشح الاستثناءات في تطبيق الاختبار ويطبعه فوراً (الفئة والكود وSQLSTATE
 * واسم القيد بس، بلا نص رسالة ولا إطار مكدس). يُطبع كل شيء ما عدا الأخطاء المحقونة عمداً.
 */
export function captureServerFaults(): void {
  if (installed) return;
  installed = true;
  const original = EnvelopeExceptionFilter.prototype.catch;
  EnvelopeExceptionFilter.prototype.catch = function patched(
    this: EnvelopeExceptionFilter,
    exception: unknown,
    host: ArgumentsHost,
  ): void {
    original.call(this, exception, host);
    const status = host.switchToHttp().getResponse<FastifyReply>().statusCode;
    if (status < 500) return;
    const fault = describe(exception, status);
    faults.push(fault);
    if (!isInjectedFault(exception)) console.error('SERVER_FAULT', JSON.stringify(fault));
  };
}

/**
 * يسجل خطأً ابتلعه المتحكم قبل أن يصل مرشح الاستثناءات (مثل تحويل فشل تسجيل الدخول بالرقم السري
 * إلى NOT_READY) بنفس الشكل الآمن، ليظهر سببه الحقيقي في فشل متقطع.
 */
export function recordSwallowedFault(error: unknown, status: number): void {
  const fault = describe(error, status);
  faults.push(fault);
  console.error('SERVER_FAULT_SWALLOWED', JSON.stringify(fault));
}

/** كل أخطاء 5xx الملتقطة منذ بداية العملية — للاختبارات التي تؤكد غيابها. */
export function serverFaults(): readonly ServerFault[] {
  return faults;
}
