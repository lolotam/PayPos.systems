import type { ArgumentsHost } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { EnvelopeExceptionFilter } from '../src/shared/exception.filter.ts';

/** سبب واحد من سلسلة الخطأ: الفئة والكود وSQLSTATE واسم القيد بلا نص رسالة قد يحمل معاملات. */
interface FaultLink {
  readonly name: string;
  readonly code: string | null;
  readonly constraint: string | null;
  readonly message: string;
}

/** خطأ خادم 5xx كما رآه مرشح الاستثناءات: السلسلة وإطارات المكدس فقط. */
export interface ServerFault {
  readonly status: number;
  readonly chain: readonly FaultLink[];
  readonly frames: readonly string[];
}

const faults: ServerFault[] = [];
let installed = false;
const SYMBOLIC = /^[A-Z][A-Z0-9_]{2,63}$/;

function link(error: unknown): FaultLink {
  const value = (typeof error === 'object' && error !== null ? error : {}) as Record<string, unknown>;
  const text = (key: string, pattern: RegExp): string | null =>
    typeof value[key] === 'string' && pattern.test(value[key] as string)
      ? (value[key] as string)
      : null;
  return {
    name: error instanceof Error ? error.constructor.name : typeof error,
    code: text('code', /^[A-Z0-9_]{1,64}$/),
    constraint: text('constraint_name', /^[a-z0-9_]{1,63}$/) ?? text('constraint', /^[a-z0-9_]{1,63}$/),
    // الرسائل الرمزية فقط؛ أي نص آخر قد يحمل معاملات SQL أو هاتفاً فيُحجب.
    message: error instanceof Error && SYMBOLIC.test(error.message) ? error.message : '[withheld]',
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
  const stack = exception instanceof Error ? (exception.stack ?? '') : '';
  const frames = stack
    .split('\n')
    .filter((line) => /^\s+at /.test(line))
    .slice(0, 14)
    .map((line) => line.trim());
  return { status, chain, frames };
}

/**
 * يلتقط كل خطأ 5xx يمر بمرشح الاستثناءات في تطبيق الاختبار ويطبعه فوراً (الفئة والكود وSQLSTATE
 * واسم القيد وإطارات المكدس بلا رسائل حرة). يُطبع كل شيء ما عدا الأخطاء المحقونة عمداً.
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
    if (!fault.chain.some((entry) => entry.message.startsWith('INJECTED_')))
      console.error('SERVER_FAULT', JSON.stringify(fault));
  };
}

/** كل أخطاء 5xx الملتقطة منذ بداية العملية — للاختبارات التي تؤكد غيابها. */
export function serverFaults(): readonly ServerFault[] {
  return faults;
}
