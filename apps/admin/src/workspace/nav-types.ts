import type { Country, Employee, VerticalType } from '@pospay/contracts';
import type { MessageKey } from '@pospay/i18n';

/** أنماط التنقّل المعتمدة في مواصفة 074؛ الافتراضي C. */
export type NavigationStyle = 'A' | 'B' | 'C';

/** الأقسام السبعة لمنطقة الإدارة في app-map.md. */
export type NavigationSectionId =
  | 'home'
  | 'sales'
  | 'catalog'
  | 'customers'
  | 'team'
  | 'reports'
  | 'setup';

/** القوائم الفرعية لمنطقة الإدارة في app-map.md، مرتّبة حسب أقسامها. */
export type NavigationSubmenuId =
  | 'home'
  | 'service-visits'
  | 'discounts'
  | 'orders'
  | 'payments'
  | 'cash'
  | 'pos'
  | 'restaurant'
  | 'delivery'
  | 'for-this-business-type'
  | 'catalog'
  | 'stores'
  | 'production'
  | 'customers'
  | 'appointments'
  | 'online'
  | 'marketing'
  | 'loyalty'
  | 'employees'
  | 'schedules'
  | 'attendance'
  | 'leave'
  | 'pay'
  | 'staff-reports'
  | 'sales-reports'
  | 'stock-reports'
  | 'performance'
  | 'expenses'
  | 'exports'
  | 'business'
  | 'access'
  | 'staff-app'
  | 'appearance'
  | 'plan'
  | 'developers'
  | 'compliance';

/** أسماء الأيقونات المصدَّرة بالفعل من @pospay/ui وفق ADR-0060. */
export type NavigationIconName =
  | 'ArrowCounterClockwise'
  | 'Bell'
  | 'Building2'
  | 'CircleAlert'
  | 'Clock3'
  | 'House'
  | 'Inbox'
  | 'KeyRound'
  | 'MapPin'
  | 'Monitor'
  | 'ShieldCheck'
  | 'Smartphone'
  | 'Star'
  | 'Store'
  | 'Upload'
  | 'UserRound';

/**
 * شروط الظهور الحية المنقولة كما هي من ملفات *-nav-item.tsx الحالية دون إضافة أو حذف صلاحيات (BR-006).
 */
export type NavigationVisibilityCondition =
  | 'always'
  | 'alert-rules-or-rating-access'
  | 'business-identity-access'
  | 'commission-plans-access'
  | 'employee-app-link-access'
  | 'imported-refunds-access'
  | 'leave-report-access'
  | 'staff-app-columns-access';

/** مصادر عدّادات الاعتمادات المخططة للخطوة 7 فقط حيث توفرها قراءة قائمة رخيصة (FR-026، R10). */
export type NavigationCountSource =
  | 'approvals-inbox'
  | 'leave-approvals'
  | 'attendance-requests'
  | 'attendance-exceptions';

/** أنواع الأنشطة المخططة للمرحلة 6 في app-map.md بجانب VerticalType المعتمد في العقود. */
export type PlannedVerticalType = 'clinic' | 'gym' | 'education';

/** نوع النشاط الذي يظهر له المدخل؛ المصفوفة الفارغة تعني كل أنواع الأنشطة. */
export type NavigationBusinessType = VerticalType | PlannedVerticalType;

/** أكواد الأدوار البشرية المعتمدة في @pospay/contracts (PRD §3.2). */
export type NavigationRoleCode = Employee['role_code'];

interface BaseNavigationPageEntry {
  readonly id: string;
  readonly labelKey: MessageKey;
  readonly descriptionKey?: MessageKey;
  readonly icon: NavigationIconName;
  readonly section: NavigationSectionId;
  readonly submenu: NavigationSubmenuId;
  readonly businessTypes: readonly NavigationBusinessType[];
  readonly countries?: readonly Country[];
  readonly count?: NavigationCountSource;
  /** true للصفوف الـ 127 الموجودة في منطقة الإدارة بـ app-map.md، وfalse لصفحات الأطفال الفرعية. */
  readonly appMapEntry: boolean;
}

interface LiveNavigationPageEntry extends BaseNavigationPageEntry {
  readonly state: 'live';
  readonly visible: NavigationVisibilityCondition;
  /** المعرّف المنشور سابقًا تحت /soon/، حتى لو صارت الصفحة فرعية أو مضمّنة (FR-023). */
  readonly formerSoonId?: string;
  /**
   * أدوار تحصر ظهور المدخل الحي في القوائم وباحث الصفحات؛ الغياب يعني كل الأدوار.
   * مدخل صار مبنيًا يحتفظ بجمهوره المحدد في خريطة التطبيق (BR-006، BR-007) ولا يتسع بالبناء.
   */
  readonly roles?: readonly [NavigationRoleCode, ...NavigationRoleCode[]];
}

/** صفحة حية لها مسار فعلي مبني في apps/admin/app اليوم. */
export interface LiveRoutePageEntry extends LiveNavigationPageEntry {
  readonly route: string;
  readonly parent?: string;
  readonly embeddedInParent?: false;
}

/** صفحة حية مضمّنة مؤقتًا داخل صفحتها الأب (مثل إعدادات الجداول داخل /schedules حتى الخطوة 11). */
export interface EmbeddedLivePageEntry extends LiveNavigationPageEntry {
  readonly route?: undefined;
  readonly parent: string;
  readonly embeddedInParent: true;
  readonly appMapEntry: true;
}

/** صفحة غير مبنية تفتح /soon/<id> وتُفلتر بنوع النشاط والدور (NAV-Q14). */
export interface SoonNavigationPageEntry extends BaseNavigationPageEntry {
  readonly state: 'soon';
  readonly route?: undefined;
  readonly parent?: undefined;
  readonly roles: readonly [NavigationRoleCode, ...NavigationRoleCode[]];
  readonly appMapEntry: true;
}

export type NavigationPageEntry =
  | LiveRoutePageEntry
  | EmbeddedLivePageEntry
  | SoonNavigationPageEntry;

export type TopLevelNavigationPageEntry = Exclude<NavigationPageEntry, EmbeddedLivePageEntry> & {
  readonly parent?: undefined;
};

export interface NavigationSectionMeta {
  readonly id: NavigationSectionId;
  readonly labelKey: MessageKey;
  readonly submenus: readonly NavigationSubmenuId[];
}

export interface NavigationSubmenuMeta {
  readonly id: NavigationSubmenuId;
  readonly section: NavigationSectionId;
  readonly labelKey: MessageKey;
}

export interface StyleATab {
  readonly id: NavigationSubmenuId;
  readonly section: NavigationSectionId;
  readonly labelKey: MessageKey;
  readonly pageIds: readonly string[];
}

export interface StyleAGroup {
  readonly id: NavigationSectionId;
  readonly labelKey: MessageKey;
  readonly icon: NavigationIconName;
  readonly bottomBar: boolean;
  readonly tabs: readonly StyleATab[];
}

export interface StyleBColumn {
  readonly id: NavigationSubmenuId;
  readonly section: NavigationSectionId;
  readonly labelKey: MessageKey;
  readonly pageIds: readonly string[];
}

export interface StyleBModule {
  readonly id: 'today' | 'sell' | 'stock' | 'grow' | 'people' | 'business';
  readonly labelKey: MessageKey;
  readonly descriptionKey: MessageKey;
  readonly icon: NavigationIconName;
  readonly sections: readonly NavigationSectionId[];
  readonly columns: readonly StyleBColumn[];
}

export interface StyleCSection {
  readonly id: NavigationSubmenuId;
  readonly section: NavigationSectionId;
  readonly labelKey: MessageKey;
  readonly pageIds: readonly string[];
}

export interface StyleCWorkspace {
  readonly id: 'front-desk' | 'stock' | 'customers' | 'team' | 'business';
  readonly labelKey: MessageKey;
  readonly descriptionKey: MessageKey;
  readonly icon: NavigationIconName;
  readonly sections: readonly NavigationSectionId[];
  readonly panelSections: readonly StyleCSection[];
}

export interface NavigationGroupings {
  readonly A: readonly StyleAGroup[];
  readonly B: readonly StyleBModule[];
  readonly C: readonly StyleCWorkspace[];
}
