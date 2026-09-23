import templates from '../seed/vertical-templates.json' with { type: 'json' };

/**
 * ما بيتنسخ في business.settings لما business جديد يتعمل بالـ vertical ده (PRD §7.1) — الـ vertical إعداد، مش if.
 */
export interface VerticalTemplate {
  readonly modules: readonly string[];
  readonly features: readonly string[];
}

/**
 * الـ template بتاع كل vertical من vertical-templates.json، من غير الـ phases (دي خطة المشروع مش إعداد).
 *
 * @param vertical نوع الـ business
 * @returns الـ modules والـ features، أو undefined لو الـ vertical مش معروف
 */
export function verticalTemplate(vertical: string): VerticalTemplate | undefined {
  const entry = (templates.templates as Record<string, VerticalTemplate | undefined>)[vertical];
  return entry === undefined ? undefined : { modules: entry.modules, features: entry.features };
}
