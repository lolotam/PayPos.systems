import { attendanceStatementDocument } from '@pospay/contracts';
import { attendanceStatementHtml } from '@pospay/documents';

import { AttendanceStatementEmptyError } from '../statement-empty-error.ts';
import type { HtmlDocumentSource } from '../source-registry.ts';
import { buildAttendanceStatementDocument } from './attendance-statement-document.ts';
import type {
  AttendanceStatementSourceDeps,
  StatementData,
  StatementLogoDocument,
} from './statement-ports.ts';

/**
 * مصدر مستند بيان الحضور: يقرأ البيان من قارئ الـ staff، وبعدين الشعار من قارئ الملفات،
 * والنداءين ورا بعض ومش متداخلين ومش متوازيين (FR-010). مفيش تغطية في الفترة = فشل
 * نهائي من أول مرة (FR-013a)، وأي عجز في قراءة الشعار بيفشل المحاولة عشان BullMQ يعيدها.
 *
 * @param deps قارئ البيان وقارئ الشعار والساعة
 * @returns مصدر HTML للنوع
 */
export function createAttendanceStatementSource(
  deps: AttendanceStatementSourceDeps,
): HtmlDocumentSource {
  return {
    async load(companyId, renderId, signal) {
      const read = await deps.readStatement(companyId, renderId, signal);
      if (read.kind === 'EMPTY') throw new AttendanceStatementEmptyError();
      const logo = await readStatementLogo(deps, companyId, renderId, read.data, signal);
      const document = buildAttendanceStatementDocument({
        statement: read.data.statement,
        logo,
        issuedAt: deps.clock.now(),
      });
      return attendanceStatementHtml(attendanceStatementDocument.parse(document));
    },
  };
}

/**
 * يقرأ الشعار المسجّل على صف الطلب. من غير ملف مسجّل، القارئ ما بيناداش أصلاً؛
 * والملف اللي مش مؤهّل بيطلع null فيتطبع الاسم بس (BR-01).
 *
 * @param deps اعتماديات المصدر
 * @param companyId المستأجر
 * @param renderId معرّف الرندر
 * @param data بيانات البيان المقروءة
 * @param signal إلغاء المهلة
 * @returns الشعار جاهز للتضمين أو null
 */
async function readStatementLogo(
  deps: AttendanceStatementSourceDeps,
  companyId: string,
  renderId: string,
  data: StatementData,
  signal?: AbortSignal,
): Promise<StatementLogoDocument | null> {
  if (data.logoFileId === null) return null;
  const logo = await deps.readLogo(
    companyId,
    {
      businessId: data.businessId,
      fileId: data.logoFileId,
      requesterUserId: data.requesterUserId,
      renderId,
    },
    signal,
  );
  if (logo === null) return null;
  return { content_type: logo.content_type, base64: Buffer.from(logo.bytes).toString('base64') };
}
