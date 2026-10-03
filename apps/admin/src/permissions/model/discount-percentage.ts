export function displayDiscountPercentage(bps: number | null): string {
  return bps === null ? '' : (bps / 100).toFixed(2);
}
