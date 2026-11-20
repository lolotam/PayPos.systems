import { CommitPackageImport } from '../use-cases/commit-package-import/commit-package-import.ts';

/**
 * بديل use case لاختبارات المعالج: التنفيذ والتثبيت مزيفان، وقاعدة النافذة تبقى windowClosed الحقيقية
 * فلا ينحرف البديل عن القاعدة. windowClosed لا تلمس المعاملات ولا الساعة.
 */
export function commitUseCaseDouble(
  parts: Pick<CommitPackageImport, 'execute' | 'fail'>,
): CommitPackageImport {
  return Object.assign(new CommitPackageImport({} as never, {} as never), parts);
}
