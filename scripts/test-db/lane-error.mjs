// خطأ متوقع من أداة الـ lane: الـ CLI بيطبعه ويطلع بـ exit 1 من غير stack trace.
export class LaneError extends Error {}

// بنرمي بدل process.exit عشان أي finally (زي فك الـ start lock) تشتغل دايماً.
export function fail(message) {
  throw new LaneError(message);
}
