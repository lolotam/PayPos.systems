/** قارئ بايتات الأجسام الموثّقة: عقد عام مشترك بين مستوردي الكيانات بلا معنى تجاري (073 D-2). */
export interface ObjectBytesReader {
  read(key: string, maxBytes: number): Promise<Uint8Array>;
}

/** يبني قارئ البايتات المشترك: رفض المحتوى يبقى رفض محتوى، وأي فشل آخر تعذّر تخزين (073 D-2). */
export function createObjectBytesReader(
  storage: { read(key: string, maxBytes: number): Promise<Uint8Array> },
  onError: (code: 'IMPORT_FILE_CONTENT_INVALID' | 'STORAGE_UNAVAILABLE') => Error,
): ObjectBytesReader {
  return {
    read: async (key, maxBytes) => {
      try {
        return await storage.read(key, maxBytes);
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          ['FILE_SIZE_INVALID', 'FILE_CONTENT_INVALID'].includes(String(error.code))
        )
          throw onError('IMPORT_FILE_CONTENT_INVALID');
        throw onError('STORAGE_UNAVAILABLE');
      }
    },
  };
}
