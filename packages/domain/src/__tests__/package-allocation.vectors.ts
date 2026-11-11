/** أرقام محسوبة يدوياً، عشان الاختبار يقارن الحساب بمرجع مستقل عن تنفيذ التوزيع. */
export const allocationFixtures = [
  {
    name: 'paid 10.001 KWD, weights 20:10',
    pricePaid: 10_001n,
    components: [
      { serviceId: 'service-b', sessions: 1, listPriceSnapshot: 10_000n },
      { serviceId: 'service-a', sessions: 2, listPriceSnapshot: 10_000n },
    ],
    expectedValues: [3_334n, 6_667n],
    expectedSlots: [[3_334n], [3_333n, 3_334n]],
  },
  {
    name: 'zero prices fall back to original sessions 1:3',
    pricePaid: 10_001n,
    components: [
      { serviceId: 'service-a', sessions: 1, listPriceSnapshot: 0n },
      { serviceId: 'service-b', sessions: 3, listPriceSnapshot: 0n },
    ],
    expectedValues: [2_500n, 7_501n],
    expectedSlots: [[2_500n], [2_500n, 2_500n, 2_501n]],
  },
  {
    name: 'two extra mills in three tied components',
    pricePaid: 2n,
    components: [
      { serviceId: 'service-c', sessions: 1, listPriceSnapshot: 1n },
      { serviceId: 'service-b', sessions: 1, listPriceSnapshot: 1n },
      { serviceId: 'service-a', sessions: 1, listPriceSnapshot: 1n },
    ],
    expectedValues: [0n, 1n, 1n],
    expectedSlots: [[0n], [1n], [1n]],
  },
  {
    name: 'mixed zero price gets no weight when list total is positive',
    pricePaid: 7n,
    components: [
      { serviceId: 'service-a', sessions: 3, listPriceSnapshot: 0n },
      { serviceId: 'service-b', sessions: 2, listPriceSnapshot: 100n },
    ],
    expectedValues: [0n, 7n],
    expectedSlots: [
      [0n, 0n, 0n],
      [3n, 4n],
    ],
  },
] as const;
