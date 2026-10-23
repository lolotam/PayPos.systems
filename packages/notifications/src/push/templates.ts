import {
  validateParameters,
  type SafeParameter,
  type TemplateDefinition,
  type TemplateParameter,
} from '../templates/definition.ts';

/** نص الإشعار في لغة واحدة: العنوان اللي بيشوفه الموظف والجسم. */
export interface PushTemplateCopy {
  readonly title: string;
  readonly body: string;
}

/** تعريف قالب الدفع: مفتاحه ومراجعته ومعاملاته المسموحة ونصوصه بالعربي والإنجليزي. */
export interface PushTemplateDefinition {
  readonly key: string;
  readonly revision: number;
  readonly parameters: readonly TemplateParameter[];
  readonly copy: Readonly<Record<'ar' | 'en', PushTemplateCopy>>;
}

// اسم الفرع لو كان فاضي أو مرفوض بقواعد العرض بيتعامل كأنه مش موجود: الاسم باللغة التانية أو اللفظ العام.
const FALLBACK_NAMES = new Set(['branch_name_ar', 'branch_name_en']);

// اللفظ العام لما اسم الفرع ناقص باللغة المطلوبة وفي اللغة التانية كمان (ADR-0037 قرار 4).
const GENERIC_BRANCH: Readonly<Record<'ar' | 'en', string>> = {
  ar: 'الفرع',
  en: 'the branch',
};

// وقت الشيفت صيغته HH:MM (24 ساعة) بالظبط؛ قيمة حرة كانت هتوصّل بيانات عميل لشاشة القفل.
const SHIFT_START_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// المعاملات اللي ليها صيغة صارمة غير قواعد النص العام.
const STRICT_PARAMETERS: Readonly<Record<string, RegExp>> = {
  shift_start: SHIFT_START_PATTERN,
};

const SHIFT_NOT_CLOCKED_IN_SELF: PushTemplateDefinition = {
  key: 'shift_not_clocked_in_self',
  revision: 1,
  parameters: [
    { name: 'shift_start', type: 'text', required: true, sensitivity: 'safe', component: 'body' },
    {
      name: 'branch_name_ar',
      type: 'text',
      required: true,
      sensitivity: 'safe',
      component: 'body',
      textKind: 'display_name',
    },
    {
      name: 'branch_name_en',
      type: 'text',
      required: true,
      sensitivity: 'safe',
      component: 'body',
      textKind: 'display_name',
    },
  ],
  copy: {
    ar: {
      title: 'بصمة الحضور',
      body: 'لسه مفيش بصمة حضور ليك لشيفت الساعة {shift_start} في {branch_name}.',
    },
    en: {
      title: 'Clock-in',
      body: 'No clock-in yet for your {shift_start} shift at {branch_name}.',
    },
  },
};

// كل قوالب الدفع المعروفة؛ قالب واحد لحد ما ييجي قالب تاني.
const PUSH_TEMPLATES: readonly PushTemplateDefinition[] = [SHIFT_NOT_CLOCKED_IN_SELF];

const find = (key: string): PushTemplateDefinition | null =>
  PUSH_TEMPLATES.find((definition) => definition.key === key) ?? null;

// قالب الدفع بيشارك قواعد الأمان بتاعة قوالب الإشعارات، فبنلفّه في نفس الشكل.
const asTemplateDefinition = (parameters: readonly TemplateParameter[]): TemplateDefinition => ({
  key: 'push_notice',
  revision: 1,
  locales: ['ar', 'en'],
  category: 'UTILITY',
  parameters,
  copy: { ar: '', en: '' },
});

const valueOf = (parameters: readonly SafeParameter[], name: string): string | null => {
  const parameter = parameters.find((item) => item.name === name);
  if (parameter === undefined || typeof parameter.value !== 'string') return null;
  return parameter.value;
};

/**
 * بيحكم إن اسم الفرع صالح للتعرض.
 * القاعدة: الاسم الفاضي أو اللي مرفوض بقواعد العرض (رابط أو هاتف أو رمز) بيتعامل كأنه مش موجود.
 *
 * @param descriptor وصف معامل الاسم
 * @param parameter قيمة الاسم كما جت
 * @returns الاسم بعد التشذيب، أو null لو الاسم مش صالح للتعرض
 */
const usableName = (descriptor: TemplateParameter, parameter: SafeParameter): string | null => {
  if (typeof parameter.value !== 'string') return null;
  const value = parameter.value.trim();
  if (value === '') return null;
  const single: SafeParameter = { name: descriptor.name, type: descriptor.type, value };
  if (!validateParameters(asTemplateDefinition([descriptor]), 'ar', [single])) return null;
  return value;
};

const usableBranchName = (
  definition: PushTemplateDefinition,
  parameters: readonly SafeParameter[],
  name: string,
): string | null => {
  const descriptor = definition.parameters.find((item) => item.name === name);
  const parameter = parameters.find((item) => item.name === name);
  if (descriptor === undefined || parameter === undefined) return null;
  return usableName(descriptor, parameter);
};

const branchName = (
  definition: PushTemplateDefinition,
  parameters: readonly SafeParameter[],
  locale: 'ar' | 'en',
): string => {
  const own = usableBranchName(
    definition,
    parameters,
    locale === 'ar' ? 'branch_name_ar' : 'branch_name_en',
  );
  if (own !== null) return own;
  const other = usableBranchName(
    definition,
    parameters,
    locale === 'ar' ? 'branch_name_en' : 'branch_name_ar',
  );
  if (other !== null) return other;
  return GENERIC_BRANCH[locale];
};

const matches = (
  definition: PushTemplateDefinition,
  parameters: readonly SafeParameter[],
): boolean => {
  if (parameters.length !== definition.parameters.length) return false;
  const normalized: SafeParameter[] = [];
  for (const [index, descriptor] of definition.parameters.entries()) {
    const parameter = parameters[index];
    if (parameter === undefined) return false;
    const unusable =
      FALLBACK_NAMES.has(descriptor.name) && usableName(descriptor, parameter) === null;
    normalized.push(unusable ? { ...parameter, value: GENERIC_BRANCH.ar } : parameter);
  }
  if (!validateParameters(asTemplateDefinition(definition.parameters), 'ar', normalized))
    return false;
  return definition.parameters.every((descriptor, index) => {
    const pattern = STRICT_PARAMETERS[descriptor.name];
    if (pattern === undefined) return true;
    const parameter = normalized[index];
    return (
      parameter !== undefined &&
      typeof parameter.value === 'string' &&
      pattern.test(parameter.value)
    );
  });
};

/**
 * ينضّف معاملات القالب قبل تخزينها.
 * القاعدة: اسم الفرع الفاضي أو المرفوض بيتشال من النسخة المخزنة (فاضي)،
 * وباقي المعاملات ماتتغيرش، والقالب المايطابقش أو المعاملات المرفوضة بيرجعوا null.
 *
 * @param key        مفتاح القالب
 * @param revision   مراجعة القالب
 * @param parameters المعاملات الآمنة المرتبة
 * @returns نسخة نظيفة من المعاملات، أو null لو القالب مش معروف أو المعاملات مرفوضة
 */
export function sanitizePushParameters(
  key: string,
  revision: number,
  parameters: readonly SafeParameter[],
): readonly SafeParameter[] | null {
  const definition = find(key);
  if (definition === null || definition.revision !== revision) return null;
  if (!matches(definition, parameters)) return null;
  const sanitized: SafeParameter[] = [];
  for (const [index, descriptor] of definition.parameters.entries()) {
    const parameter = parameters[index];
    if (parameter === undefined) return null;
    if (!FALLBACK_NAMES.has(descriptor.name)) {
      sanitized.push(parameter);
      continue;
    }
    const usable = usableName(descriptor, parameter);
    sanitized.push(usable === null ? { ...parameter, value: '' } : { ...parameter, value: usable });
  }
  return sanitized;
}

/**
 * بيتأكد إن القالب ومراجعته ومعاملاته مطابقة لقالب دفع معروف.
 * القاعدة: اسم الفرع الفاضي أو المرفوض بيتحسب مش موجود (بينستبدل وقت العرض)،
 * ووقت الشيفت لازم يكون وقت HH:MM، وأي معامل تاني قيمته رابط أو هاتف أو رمز بتترفض.
 *
 * @param key        مفتاح القالب
 * @param revision   مراجعة القالب
 * @param parameters المعاملات الآمنة المرتبة
 * @returns true لو القالب معروف ومعاملاته مطابقة
 */
export function validPushTemplate(
  key: string,
  revision: number,
  parameters: readonly SafeParameter[],
): boolean {
  return sanitizePushParameters(key, revision, parameters) !== null;
}

/**
 * بيرسم نص الإشعار بلغة الاشتراك.
 * القاعدة: اسم الفرع بلغة الإشعار، ولما ينقص أو يرفض بنستخدم الاسم باللغة التانية،
 * ولما ينقص الاتنين بنستخدم اللفظ العام.
 *
 * @param key        مفتاح القالب
 * @param revision   مراجعة القالب
 * @param locale     لغة الاشتراك
 * @param parameters المعاملات الآمنة المرتبة
 * @returns العنوان والجسم، أو null لو القالب مش معروف أو المعاملات مرفوضة
 */
export function renderPushNotice(
  key: string,
  revision: number,
  locale: 'ar' | 'en',
  parameters: readonly SafeParameter[],
): PushTemplateCopy | null {
  const definition = find(key);
  if (definition === null || definition.revision !== revision) return null;
  if (!matches(definition, parameters)) return null;
  const copy = definition.copy[locale];
  const values: Record<string, string> = {
    shift_start: valueOf(parameters, 'shift_start') ?? '',
    branch_name: branchName(definition, parameters, locale),
  };
  return {
    title: copy.title,
    body: copy.body.replace(
      /\{(shift_start|branch_name)\}/g,
      (_match, name: string) => values[name] ?? '',
    ),
  };
}
