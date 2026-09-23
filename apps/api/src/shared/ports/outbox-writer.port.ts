/**
 * event رايح لـ modules تانية — نفس شكل الصف في الـ outbox، من غير أي نوع من Drizzle.
 */
export interface DomainEvent {
  /** نوع الـ aggregate بـ snake_case (company, business, order). */
  readonly aggregateType: string;
  readonly aggregateId: string;
  /** PascalCase، نفس الاسم في events/published.ts بتاع الـ module. */
  readonly eventType: string;
  /** JSON خالص — الفلوس كنص بالفلوس (mills)، مش number. */
  readonly payload: unknown;
}

/**
 * بيكتب events الـ use case جوه نفس الـ transaction بتاعته (CLAUDE.md §4.1، §6) — الـ use case بيشوف
 * الـ port ده بس، والـ adapter اللي مربوط بالـ tx هو اللي يعرف Drizzle.
 */
export interface OutboxWriter {
  /**
   * بيضيف الـ event؛ بيتكتب بس لو الـ transaction عملت commit، فمفيش event لتغيير متسجلش.
   *
   * @param event الـ event اللي هيتبعت للـ modules التانية
   * @returns بيخلص لما الـ event يتكتب في الـ transaction
   */
  append(event: DomainEvent): Promise<void>;
}
