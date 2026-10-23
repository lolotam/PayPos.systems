import type { CapacitorConfig } from '@capacitor/cli';

// الطعم (flavour) بييجي من متغير بيئة واحد، لأن الـ API origin بيتخبّط في البناء نفسه
// (ADR-0055 قرار 4): التطبيقين لازم يبنوا من نفس المصدر وبأصول مختلفة.
const flavour = process.env.FLAVOUR === 'production' ? 'production' : 'staging';

const config: CapacitorConfig = {
  appId: flavour === 'production' ? 'systems.pospay.business' : 'systems.pospay.business.staging',
  appName: 'PosPay Business',
  webDir: '../pos/dist-native',
  // الـ hostname والـ scheme ما يتغيروش بعد أول إصدار: تغييرهم معناه origin جديد،
  // والـ IndexedDB (ربط الجهاز وطابور المزامنة) بيضيع (حالة «تحديث التطبيق» في spec 065).
  // مفيش override لـ iOS: هو بيفضل على الـ scheme الافتراضي (capacitor) زي ما هو.
  server: {
    androidScheme: 'https',
    hostname: flavour === 'production' ? 'pos.pospay.systems' : 'pos.staging.pospay.systems',
  },
};

export default config;
