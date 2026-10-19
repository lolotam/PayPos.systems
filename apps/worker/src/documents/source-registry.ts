/** مصدر HTML لنوع واحد. القراءة من قاعدة المستأجر ملك المصدر (27g)، مش السجل. */
export interface DocumentSource {
  load(companyId: string, renderId: string): Promise<string>;
}

/** سجل الأنواع. مفيش قاعدة بيانات هنا؛ نوع مجهول بيفشل من غير ما يتفتح متصفح. */
export class DocumentSourceRegistry {
  readonly #sources = new Map<string, DocumentSource>();

  register(kind: string, source: DocumentSource): void {
    this.#sources.set(kind, source);
  }

  get(kind: string): DocumentSource | undefined {
    return this.#sources.get(kind);
  }
}
