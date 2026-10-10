import type { AttendanceChangeRequest } from '@pospay/contracts';
import type { AttendanceChangePlan } from '../domain/attendance-change-request.ts';
import type {
  AttendanceChangeKind,
  AttendanceChangeKindInput,
  AttendanceChangeKindScope,
  AttendanceChangeKindValues,
} from './attendance-change-kinds.port.ts';

/** الفاعل المثبت والمفتاح؛ لا تؤخذ السلطة من العميل. */
export interface AttendanceChangeActor {
  companyId: string;
  businessId: string;
  userId: string;
  key: string;
  fingerprint: string;
  requestId?: string;
}
/** لحظة الفحص الأولي تختلف عن لحظة القرار بعد انتظار الأقفال. */
export interface AttendanceChangeClock {
  /** يعيد لحظة قابلة للحقن لاختبار انتهاء العضوية أثناء الانتظار. */
  now(): Date;
}
/** حقائق القرار المقفولة ووسيلة حفظه الذرية. */
export interface AttendanceChangeScope extends AttendanceChangeKindScope {
  owner: boolean;
  canRequest: boolean;
  canDecide: boolean;
  employeeUserId: string | null;
  before: AttendanceChangeRequest | null;
  /**
   * يحفظ الخطة والجلسة والتدقيق والأحداث معاً ويرجع عقد الرد.
   *
   * @param plan انتقال دورة الطلب
   * @param values حقائق الجلسة المثبتة
   */
  save(
    plan: AttendanceChangePlan,
    values: AttendanceChangeKindValues,
  ): Promise<AttendanceChangeRequest>;
}
/** حدود المعاملات الثلاثة تمنع تكرار الأثر وتثبت السلطة قبل إعادة الرد. */
export interface AttendanceChangeTransactions {
  /**
   * يسلسل الطلب مع الحضور ويطبق عمل النوع تحت الأقفال.
   *
   * @param actor هوية الفاعل والمفتاح
   * @param input مغلف الطلب
   * @param kind مخطط النوع المتاح
   * @param clock الساعة المحقونة
   * @param work العمل داخل المعاملة
   */
  file(
    actor: AttendanceChangeActor,
    input: AttendanceChangeKindInput,
    kind: AttendanceChangeKind,
    clock: AttendanceChangeClock,
    work: (scope: AttendanceChangeScope) => Promise<AttendanceChangeRequest>,
  ): Promise<AttendanceChangeRequest>;
  /**
   * يسحب الطلب ضمن معاملة معاد تنفيذها بأمان بالمفتاح نفسه.
   *
   * @param actor هوية الفاعل والمفتاح
   * @param clock الساعة المحقونة
   * @param work العمل داخل المعاملة
   */
  cancel(
    actor: AttendanceChangeActor,
    clock: AttendanceChangeClock,
    work: (scope: AttendanceChangeScope) => Promise<AttendanceChangeRequest>,
  ): Promise<AttendanceChangeRequest>;
  /**
   * يثبت صلاحية القرار وهوية المالك والموظف ليمنع القرار الذاتي لغير المالك داخل المعاملة.
   *
   * @param actor هوية صاحب القرار والمفتاح
   * @param clock الساعة المحقونة
   * @param work العمل داخل المعاملة
   */
  decide(
    actor: AttendanceChangeActor,
    clock: AttendanceChangeClock,
    work: (scope: AttendanceChangeScope) => Promise<AttendanceChangeRequest>,
  ): Promise<AttendanceChangeRequest>;
}
