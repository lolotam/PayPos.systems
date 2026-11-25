import type { TemplateComponent } from '../channel.ts';

export interface TemplateParameter {
  readonly name: string;
  readonly type: 'text' | 'number';
  readonly required: boolean;
  readonly sensitivity: 'safe' | 'sensitive';
  readonly component: 'header' | 'body' | 'button';
  readonly buttonIndex?: string;
  /** safe يرفض أي سلسلة من ٤–٨ أرقام؛ display_name يسمح بسنة داخل الاسم ويرفض الرابط والهاتف والرمز وحده؛ date يثبت التاريخ الميلادي الفعلي؛ money يقبل 1250.000 كدينار بثلاث خانات لأن قاعدة ٤–٨ أرقام ترفض جزء 1250؛ id يقبل معرّف UUID بأحرف صغيرة فقط لأن الأرقام البينية ترفضها قاعدة ٤–٨ أرقام؛ time يقبل ساعة محلية HH:MM فقط بين 00:00 و23:59؛ period يقبل شهراً ميلادياً YYYY-MM وحده لأن قاعدة ٤–٨ أرقام ترفض سنة 2026. */
  readonly textKind?: 'safe' | 'display_name' | 'date' | 'money' | 'id' | 'time' | 'period';
  /** قيمة ترحيب/تعويض ثابتة لكل لغة عند غياب معامل اختياري، للحفاظ على عدد متغيرات قالب Meta ثابتاً (PP-272). */
  readonly defaultValue?: Readonly<Record<'ar' | 'en', string>>;
}
export interface TemplateDefinition {
  readonly key: string;
  readonly revision: number;
  readonly locales: readonly ('ar' | 'en')[];
  readonly category: 'AUTHENTICATION' | 'UTILITY' | 'MARKETING';
  readonly parameters: readonly TemplateParameter[];
  readonly copy: Readonly<Record<'ar' | 'en', string>>;
}
export interface SafeParameter {
  readonly name: string;
  readonly type: 'text' | 'number';
  readonly value: string | number;
}

// A descriptor allowlist is necessary but not sufficient: safe text cannot smuggle a phone, bearer link or code.
const UNSAFE_TEXT = /(?:https?:|\+[1-9]\d{7,14}|\b(?:bearer|token|otp|code)\b|\b\d{4,8}\b)/i;
const DISPLAY_NAME_UNSAFE =
  /(?:https?:|[a-z][a-z\d+.-]*:\/\/|\b[a-z\d-]+\.[a-z]{2,}\b|\p{Nd}(?:[\s().+-]*\p{Nd}){6,}|\b(?:bearer|token|otp|code)\b|^\p{Nd}{4,8}$)/iu;

/**
 * بيطابق المعاملات المرسلة مع واصفات القالب بالترتيب المعلن.
 * المعامل الاختياري (required: false) يجوز حذفه كله، لكن أي معامل موجود لازم يطابق اسمه ونوعه وحساسيته وقاعدة النص.
 * المعامل الاختياري المحذوف والمكتوب له قيمة ثابتة لكل لغة بينعوّض بالقيمة دي وقت التحضير (PP-272).
 *
 * @param definition تعريف القالب
 * @param locale لغة القالب
 * @param parameters المعاملات المرسلة بالترتيب
 * @returns true لو كل واصف إجباري موجود وما فيش معامل زيادة أو مكرر أو بترتيب غلط
 */
export function validateParameters(
  definition: TemplateDefinition,
  locale: string,
  parameters: readonly SafeParameter[],
): boolean {
  if (!definition.locales.includes(locale as 'ar' | 'en')) return false;
  const matched = matchParameters(definition, parameters, locale as 'ar' | 'en');
  return (
    matched !== null &&
    matched.every(({ descriptor, parameter }) => parameterAllowed(descriptor, parameter))
  );
}

interface MatchedParameter {
  readonly descriptor: TemplateParameter;
  readonly parameter: SafeParameter;
}

/**
 * بيربط كل معامل مرسل بواصفه بالترتيب؛ المعامل الاختياري الغائب بينعوّض بقيمته الثابتة للغة إن وُجدت.
 * بيرجع null لو معامل إجباري ناقص أو فيه معامل زيادة أو مكرر أو بترتيب غلط.
 */
function matchParameters(
  definition: TemplateDefinition,
  parameters: readonly SafeParameter[],
  locale: 'ar' | 'en',
): MatchedParameter[] | null {
  const matched: MatchedParameter[] = [];
  let cursor = 0;
  for (const descriptor of definition.parameters) {
    const parameter = parameters[cursor];
    if (parameter !== undefined && parameter.name === descriptor.name) {
      matched.push({ descriptor, parameter });
      cursor += 1;
    } else if (!descriptor.required) {
      const fallback = descriptor.defaultValue?.[locale];
      if (fallback !== undefined) {
        if (descriptor.type !== 'text') return null;
        matched.push({
          descriptor,
          parameter: { name: descriptor.name, type: 'text', value: fallback },
        });
      }
    } else {
      return null;
    }
  }
  return cursor === parameters.length ? matched : null;
}

function parameterAllowed(descriptor: TemplateParameter, parameter: SafeParameter): boolean {
  return (
    descriptor.sensitivity === 'safe' &&
    parameter.type === descriptor.type &&
    typeof parameter.value === (descriptor.type === 'number' ? 'number' : 'string') &&
    (typeof parameter.value === 'number'
      ? Number.isFinite(parameter.value)
      : textAllowed(descriptor, parameter.value)) &&
    (!descriptor.required || parameter.value !== '')
  );
}

function textAllowed(descriptor: TemplateParameter, value: string): boolean {
  if (value.length > 255) return false;
  if (descriptor.textKind === 'date')
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value
    );
  if (descriptor.textKind === 'id')
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
  if (descriptor.textKind === 'time') return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (descriptor.textKind === 'display_name')
    return value.trim().length > 0 && !DISPLAY_NAME_UNSAFE.test(value.trim());
  if (descriptor.textKind === 'money') return /^\d{1,11}\.\d{3}$/.test(value);
  if (descriptor.textKind === 'period') return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
  return !UNSAFE_TEXT.test(value);
}

/**
 * يبني مكوّنات القالب بالترتيب المعلن؛ المعامل الاختياري الغائب والمكتوب له قيمة ثابتة
 * بينعوّض بالقيمة دي للغة المطلوبة، عشان يبقى عدد متغيرات قالب Meta ثابتاً (PP-272).
 *
 * @param definition تعريف القالب
 * @param parameters المعاملات المرسلة بالترتيب
 * @param locale لغة القالب، وبتستخدم للقيمة الثابتة بدل المعامل الاختياري الغائب
 * @returns مكوّنات القالب جاهزة للإرسال
 * @throws NOTIFICATION_PARAMETERS_INVALID لو المعاملات ناقصة أو مكررة أو مرتّبة غلط
 */
export function templateComponents(
  definition: TemplateDefinition,
  parameters: readonly SafeParameter[],
  locale: 'ar' | 'en',
): TemplateComponent[] {
  const components: TemplateComponent[] = [];
  const matched = matchParameters(definition, parameters, locale);
  if (matched === null) throw new Error('NOTIFICATION_PARAMETERS_INVALID');
  matched.forEach(({ descriptor, parameter: value }) => {
    const parameter = { type: 'text' as const, text: String(value.value) };
    const previous = components.at(-1);
    if (descriptor.component !== 'button' && previous?.type === descriptor.component) {
      components[components.length - 1] = {
        ...previous,
        parameters: [...previous.parameters, parameter],
      };
    } else {
      components.push({
        type: descriptor.component,
        parameters: [parameter],
        ...(descriptor.component === 'button'
          ? { sub_type: 'url' as const, index: descriptor.buttonIndex ?? '0' }
          : {}),
      });
    }
  });
  return components;
}
