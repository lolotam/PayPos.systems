/**
 * بيولّد UUID v7 كـ port (CLAUDE.md §4.3): الـ use case مبينادي randomUUID بنفسه، عشان الاختبار يثبّت الـ ids.
 */
export interface IdGenerator {
  /** id جديد مرتب بالوقت — للصفوف اللي الـ use case بيعملها. */
  newId(): string;
}
