import type { TemplateComponent } from '../channel.ts';

export interface TemplateParameter {
  readonly name: string;
  readonly type: 'text' | 'number';
  readonly required: boolean;
  readonly sensitivity: 'safe' | 'sensitive';
  readonly component: 'header' | 'body' | 'button';
  readonly buttonIndex?: string;
  /** safe يرفض أي سلسلة من ٤–٨ أرقام؛ display_name يسمح بسنة داخل الاسم ويرفض الرابط والهاتف والرمز وحده. */
  readonly textKind?: 'safe' | 'display_name';
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
  /(?:https?:|\+[1-9]\d{7,14}|\b(?:bearer|token|otp|code)\b|^\d{4,8}$)/i;

export function validateParameters(
  definition: TemplateDefinition,
  locale: string,
  parameters: readonly SafeParameter[],
): boolean {
  return (
    definition.locales.includes(locale as 'ar' | 'en') &&
    definition.parameters.length === parameters.length &&
    definition.parameters.every((descriptor, i) => {
      const parameter = parameters[i];
      return (
        descriptor.sensitivity === 'safe' &&
        parameter !== undefined &&
        parameter.name === descriptor.name &&
        parameter.type === descriptor.type &&
        typeof parameter.value === (descriptor.type === 'number' ? 'number' : 'string') &&
        (typeof parameter.value === 'number'
          ? Number.isFinite(parameter.value)
          : textAllowed(descriptor, parameter.value)) &&
        (!descriptor.required || parameter.value !== '')
      );
    })
  );
}

function textAllowed(descriptor: TemplateParameter, value: string): boolean {
  if (value.length > 255) return false;
  const pattern = descriptor.textKind === 'display_name' ? DISPLAY_NAME_UNSAFE : UNSAFE_TEXT;
  return !pattern.test(value);
}

export function templateComponents(
  definition: TemplateDefinition,
  parameters: readonly SafeParameter[],
): TemplateComponent[] {
  const components: TemplateComponent[] = [];
  definition.parameters.forEach((descriptor, i) => {
    const value = parameters[i];
    if (value === undefined) throw new Error('NOTIFICATION_PARAMETERS_INVALID');
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
