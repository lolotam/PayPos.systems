import { documentBytesKinds, type DocumentBytesKinds } from '@pospay/contracts';

/** مصدر HTML لنوع واحد. القراءة من قاعدة المستأجر ملك المصدر (27g)، مش السجل. */
export interface HtmlDocumentSource {
  readonly output?: 'html';

  /**
   * بيجيب HTML النوع. الإشارة بتتقطع لما مهلة الوظيفة تخلّص قبل ما المتصفح يتفتح.
   *
   * @param companyId المستأجر
   * @param renderId وظيفة الرندر
   * @param signal إلغاء المهلة الكلية
   */
  load(companyId: string, renderId: string, signal?: AbortSignal): Promise<string>;
}

/** مصدر بايتات جاهزة؛ النوع ده ما يحتاجش Chromium ولا خطوة HTML إلى PDF. */
export interface BytesDocumentSource {
  readonly output: 'bytes';
  readonly mimeType: string;

  /**
   * بيجيب بايتات النوع ونوع محتواها ثابت في تعريف المصدر وخريطة العقود.
   *
   * @param companyId المستأجر
   * @param renderId وظيفة الرندر
   * @param signal إلغاء المهلة الكلية
   */
  load(companyId: string, renderId: string, signal?: AbortSignal): Promise<Uint8Array>;
}

export type DocumentSource = HtmlDocumentSource | BytesDocumentSource;

/** سجل الأنواع. الخريطة المشتركة بتمنع اختلاف مخرجات المصدر عن قبول الطلب في API. */
export class DocumentSourceRegistry {
  readonly #sources = new Map<string, DocumentSource>();

  constructor(private readonly bytesKinds: DocumentBytesKinds = documentBytesKinds) {}

  register(kind: string, source: DocumentSource): void {
    const expected = Object.prototype.hasOwnProperty.call(this.bytesKinds, kind)
      ? this.bytesKinds[kind]
      : undefined;
    const matches =
      source.output === 'bytes' ? expected?.mimeType === source.mimeType : expected === undefined;
    if (!matches) {
      throw new Error(`Document source output does not match bytes kind map: ${kind}`);
    }
    this.#sources.set(kind, source);
  }

  get(kind: string): DocumentSource | undefined {
    return this.#sources.get(kind);
  }
}
