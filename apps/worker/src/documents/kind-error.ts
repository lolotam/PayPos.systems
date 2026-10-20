/** النوع مش متسجّل. الرسالة كود ثابت عشان Redis ما يشوفش بيانات المستند. */
export class DocumentKindUnknownError extends Error {
  readonly code = 'DOCUMENT_KIND_UNKNOWN' as const;

  constructor() {
    super('DOCUMENT_KIND_UNKNOWN');
    this.name = 'DocumentKindUnknownError';
  }
}
