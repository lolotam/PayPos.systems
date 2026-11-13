import type { OutboxDispatcherDatabase, Tx } from '@pospay/db';

/** معاملة الشركة التي تمررها حالات استخدام التغطية دون استيراد @pospay/db. */
export type CoverageTx = Tx;

/** مشغّل معاملة شركة واحدة لقراءات التغطية؛ يبقي فتح المعاملة خارج حالة الاستخدام. */
export type CoverageTenantRunner = <T>(
  companyId: string,
  fn: (tx: CoverageTx) => Promise<T>,
) => Promise<T>;

/** هوية بند خدمة ومراجعته الحالية في المصدر أو الإسقاط. */
export interface ServiceLineCoverageRow {
  readonly lineId: string;
  readonly revision: number;
}

/** صفحة من بنود الخدمة ومؤشر الاستمرار عند اكتمال الصفحة. */
export interface ServiceLineCoveragePage {
  readonly rows: readonly ServiceLineCoverageRow[];
  readonly nextAfter: string | null;
}

export interface ServiceLineCoverageReader {
  /**
   * يعيد كل بنود ACTIVE وCANCELLED بمراجعاتها لإثبات أن الإسقاط يغطي المصدر قبل الاعتماد.
   *
   * @param tx معاملة الشركة التي يقرأ منها القارئ
   * @param companyId هوية الشركة صاحبة البنود
   * @param after معرّف آخر بند في الصفحة السابقة أو null لأول صفحة
   * @param limit أقصى عدد صفوف في الصفحة
   */
  readPage(
    tx: CoverageTx,
    companyId: string,
    after: string | null,
    limit: number,
  ): Promise<ServiceLineCoveragePage>;
}

/** هوية صف راتب تاريخي بموظفه وتاريخ سريانه ومراجعته. */
export interface SalaryCoverageRow {
  readonly employeeId: string;
  readonly effectiveFrom: string;
  readonly revision: number;
}

/** مؤشر keyset لصف راتب، وتاريخه بصيغة YYYY-MM-DD. */
export interface SalaryCoverageCursor {
  readonly employeeId: string;
  readonly effectiveFrom: string;
}

/** صفحة من تاريخ الرواتب ومؤشر الصفحة التالية. */
export interface SalaryCoveragePage {
  readonly rows: readonly SalaryCoverageRow[];
  readonly next: SalaryCoverageCursor | null;
}

export interface SalaryCoverageReader {
  /**
   * يعيد صفحة تاريخ الرواتب بما فيها رواتب المحذوفين لأنها المرجع الذي تُقاس عليه تغطية الإسقاط.
   *
   * @param tx معاملة الشركة التي يقرأ منها القارئ
   * @param companyId هوية الشركة صاحبة الرواتب
   * @param after مؤشر الموظف والتاريخ في الصفحة السابقة أو null لأول صفحة
   * @param limit أقصى عدد صفوف في الصفحة
   */
  readPage(
    tx: CoverageTx,
    companyId: string,
    after: SalaryCoverageCursor | null,
    limit: number,
  ): Promise<SalaryCoveragePage>;
}

export interface CoverageProjectionReader {
  /**
   * يعيد مراجعات رؤوس البنود المطلوبة حتى تكشف المقارنة أي بند غائب أو متأخر.
   *
   * @param tx معاملة الشركة التي يقرأ منها القارئ
   * @param companyId هوية الشركة صاحبة الرؤوس
   * @param lineIds هويات البنود المطلوب قراءة مراجعاتها
   */
  lineRevisions(
    tx: CoverageTx,
    companyId: string,
    lineIds: readonly string[],
  ): Promise<readonly ServiceLineCoverageRow[]>;

  /**
   * يعيد مراجعات رواتب الموظفين المطلوبين ليقارنها المستدعي بمفتاح الموظف وتاريخ السريان.
   *
   * @param tx معاملة الشركة التي يقرأ منها القارئ
   * @param companyId هوية الشركة صاحبة الرواتب
   * @param employeeIds هويات الموظفين المطلوب قراءة مراجعات رواتبهم
   */
  salaryRevisions(
    tx: CoverageTx,
    companyId: string,
    employeeIds: readonly string[],
  ): Promise<readonly SalaryCoverageRow[]>;

  /**
   * يعيد الأحداث التي تحمل علامة consumer المطلوب لاستخراج الأحداث المحتفظ بها غير المستهلكة.
   *
   * @param tx معاملة الشركة التي يقرأ منها القارئ
   * @param companyId هوية الشركة صاحبة العلامات
   * @param consumerId هوية المستهلك المطلوب فحص علامات الاستهلاك التي تحملها
   * @param eventIds هويات الأحداث المطلوب فحص علامات الاستهلاك لها
   */
  markedEventIds(
    tx: CoverageTx,
    companyId: string,
    consumerId: string,
    eventIds: readonly string[],
  ): Promise<ReadonlySet<string>>;
}

/** واجهة صفحات الأحداث المحتفظ بها من 50-0، وتعمل بصلاحية pospay_dispatcher المحدودة. */
export type CoverageRetainedPageReader = Pick<
  OutboxDispatcherDatabase,
  'commissionInputReplayPage'
>;

/** وجود الشركة وغياب حذفها؛ التقرير يرفض أي نطاق لشركة غير موجودة بدل أن يغطّي نطاقاً فارغاً. */
export interface CoverageCompanyReader {
  /**
   * هل الشركة موجودة داخل معاملة المستأجر وغير محذوفة.
   *
   * @param tx معاملة الشركة التي يقرأ منها التقرير
   * @param companyId هوية الشركة المفحوصة
   * @returns هل الشركة موجودة وغير محذوفة
   */
  isOpen(tx: CoverageTx, companyId: string): Promise<boolean>;
}
