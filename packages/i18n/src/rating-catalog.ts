/**
 * نصوص رسالة طلب التقييم: تسمية المنفذين وتسمية الفريق.
 *
 * كل لغة ترتّب حولها بنفسها، فالمسافة قبل الاسم أو بعده جوه النص نفسه: الاسم بين
 * البادئة واللاحقة في العربي، وبين «the» و«team» في الإنجليزي.
 */
export const ratingRequestEn = {
  teamPrefix: 'the ',
  teamSuffix: ' team',
  namesSeparator: ', ',
};
export const ratingRequestAr: Record<keyof typeof ratingRequestEn, string> = {
  teamPrefix: 'فريق ',
  teamSuffix: '',
  namesSeparator: '، ',
};
