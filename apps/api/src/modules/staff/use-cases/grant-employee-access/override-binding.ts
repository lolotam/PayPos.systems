import type { StaffAccessOverrideTerms } from '../../ports/staff-access.port.ts';

/**
 * بصمة canonically لاستثناءات الصلاحيات: ترتيب الاستثناءات جزء من البصمة، ومعرّف النطاق
 * بيتطبّع لحروف صغيرة لأن UUID مش حساس لحالة الأحرف، والسبب جزء من البصمة كمان عشان استثناءين
 * بنفس الصلاحية والنطاق بس أسباب مختلفة ما يتقارنوش.
 *
 * @param overrides الاستثناءات كما وصلت في الطلب
 * @returns بصمة نصية قابلة للمقارنة
 */
export function canonicalOverrideKey(
  overrides: readonly StaffAccessOverrideTerms[] | undefined,
): string {
  return (overrides ?? [])
    .map((terms) =>
      [
        terms.permission_code,
        terms.effect,
        terms.scope_type,
        terms.scope_id.toLowerCase(),
        terms.reason,
        terms.expires_at ?? '',
      ].join('\u0000'),
    )
    .join('\u0001');
}

/**
 * ربط استثناءات الصلاحيات بمحاولات المنح: لكل محاولة بصمة استثناءاتها وأصحابها. البصمة
 * بتتحرر بانتهاء المحاولة — نجاح أو رفض — عشان إعادة المحاولة باستثناءات مصححة تنجح، وبتضل
 * موجودة طول ما في محاولات متزامنة لنفس الاستثناءات.
 */
export class AttemptOverrideBinding {
  readonly #bindings = new Map<string, { readonly key: string; readonly owners: Set<symbol> }>();

  /**
   * يربط بصمة الاستثناءات بمحاولة المنح ويمرر صاحب المحاولة: البصمة الموجودة ما بتتغيرش،
   * بس صاحب جديد بيتضاف.
   */
  bind(attemptId: string, canonical: string, owner: symbol): void {
    const entry = this.#bindings.get(attemptId);
    if (entry === undefined) {
      this.#bindings.set(attemptId, { key: canonical, owners: new Set([owner]) });
      return;
    }
    entry.owners.add(owner);
  }

  /**
   * بصمة الاستثناءات المرتبطة بالمحاولة، أو null لو مفيش ربط — معناها المحاولة مالهاش
   * استثناءات مربوطة لسه.
   */
  keyOf(attemptId: string): string | null {
    return this.#bindings.get(attemptId)?.key ?? null;
  }

  /**
   * يحرر صاحب المحاولة من بصماته: البصمة بتتحلّ لما ما يفضلش صاحب، فالمحاولات المتزامنة لنفس
   * البصمة ما تشيلش بعضها، والمحاولة اللي فشلتت ما بتسيبش بصمة ورا.
   */
  release(owner: symbol): void {
    for (const [attemptId, entry] of [...this.#bindings]) {
      entry.owners.delete(owner);
      if (entry.owners.size === 0) this.#bindings.delete(attemptId);
    }
  }
}
