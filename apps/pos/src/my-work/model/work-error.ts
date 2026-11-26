import { PrivateViewHttpError } from '@/shared/private-view/errors';

export {
  monthOutOfRange,
  sessionEnded,
  viewForbidden as workForbidden,
  windowExpired,
  windowRefusal,
} from '@/shared/private-view/errors';
export { PrivateViewHttpError as WorkHttpError } from '@/shared/private-view/errors';

/** المؤشر مرفوض (400 VALIDATION_FAILED): الصفحة التالية ما تتقريش بنفس المؤشر، فالإعادة لازم تبدأ من الصفحة الأولى. */
export function invalidCursor(error: unknown): boolean {
  return (
    error instanceof PrivateViewHttpError &&
    error.status === 400 &&
    error.code === 'VALIDATION_FAILED'
  );
}
