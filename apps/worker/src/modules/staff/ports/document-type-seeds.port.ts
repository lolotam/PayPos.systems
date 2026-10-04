import type { DefaultDocumentType } from '../domain/default-document-types.ts';

/** حد الكتابة الوحيد للبذرة داخل معاملة المستهلك المعزولة بالشركة. */
export interface DocumentTypeSeeds {
  /**
   * يضيف الأنواع الناقصة فقط؛ نوع موجود بنفس الكود لا يُلمس حتى لو عدله المدير.
   *
   * @param types الأنواع مع معرفاتها الجديدة
   * @returns عدد الأنواع المضافة فعلاً
   */
  insertMissing(types: readonly (DefaultDocumentType & { id: string })[]): Promise<number>;
}
/** مصدر معرفات UUID v7 المحقون. */
export interface SeedIds {
  /** معرف جديد لكل نوع مزروع. */
  newId(): string;
}
