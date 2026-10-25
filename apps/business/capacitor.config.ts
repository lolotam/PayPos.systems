import type { CapacitorConfig } from '@capacitor/cli';

// نسخة البناء (flavour) بييجي من متغير بيئة واحد، لأن الـ API origin بيتحط جوّه البناء
// (ADR-0055 قرار 4): نسختين البناء بتتبنيوا من نفس المصدر وبأصول مختلفة.
const flavour = process.env.FLAVOUR === 'production' ? 'production' : 'staging';

// الـ hostname ده لأندرويد بس: iOS بيقرا server.hostname كمان، ولازم يفضل على
// capacitor://localhost عشان الـ secure context (ADR-0055 قرار 3). عشان كده مفيش مزامنة
// غير عن طريق سكربتات apps/business، و«cap sync» لوحده بيسيب أندرويد على الـ host
// الافتراضي — وده عمره ما ينزل للمتجر.
const android = process.env.CAP_PLATFORM === 'android';

const server: NonNullable<CapacitorConfig['server']> = { androidScheme: 'https' };
if (android) {
  server.hostname = flavour === 'production' ? 'pos.pospay.systems' : 'pos.staging.pospay.systems';
}

const config: CapacitorConfig = {
  appId: flavour === 'production' ? 'systems.pospay.business' : 'systems.pospay.business.staging',
  appName: 'PosPay Business',
  webDir: '../pos/dist-native',
  // استدعاءات الإضافات بتحمل بيانات دخول الموظف، فممنوع توصل بخياراتها ونتائجها لسجل الجهاز.
  loggingBehavior: 'none',
  // الـ hostname والـ scheme ما يتغيروش بعد أول إصدار: تغييرهم معناه origin جديد،
  // والـ IndexedDB (ربط الجهاز وطابور المزامنة) بيضيع (حالة «تحديث التطبيق» في spec 065).
  server,
  // الـ web view على iOS بيرسم تحت شريط الحالة والـ notch، فحافة التطبيق (وشريط نسخة
  // التجربة كمان) لازم تفضل تحتهم، وإلا الشريط بيختفي أول ما التطبيق يفتح.
  ios: { contentInset: 'always' },
};

export default config;
