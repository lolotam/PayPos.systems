// بيانات فقط: نفس قواعد SPEC §4 تُختبر في النطاقين دون استيراد كود أحدهما للآخر.
export const packageDefinitionCases = [
  { name: 'one session', price: 0n, components: [{ serviceId: 'a', sessions: 1 }], error: null },
  { name: '365 sessions', price: 1n, components: [{ serviceId: 'a', sessions: 365 }], error: null },
  {
    name: 'maximum price',
    price: 99_999_999_999_999n,
    components: [{ serviceId: 'a', sessions: 1 }],
    error: null,
  },
  {
    name: 'negative price',
    price: -1n,
    components: [{ serviceId: 'a', sessions: 1 }],
    error: 'INVALID_PRICE',
  },
  {
    name: 'overflow price',
    price: 100_000_000_000_000n,
    components: [{ serviceId: 'a', sessions: 1 }],
    error: 'INVALID_PRICE',
  },
  { name: 'empty definition', price: 0n, components: [], error: 'INVALID_COMPONENTS' },
  {
    name: 'empty service',
    price: 0n,
    components: [{ serviceId: '', sessions: 1 }],
    error: 'INVALID_COMPONENTS',
  },
  {
    name: 'duplicate service',
    price: 0n,
    components: [
      { serviceId: 'a', sessions: 1 },
      { serviceId: 'a', sessions: 2 },
    ],
    error: 'DUPLICATE_SERVICE',
  },
  {
    name: 'zero sessions',
    price: 0n,
    components: [{ serviceId: 'a', sessions: 0 }],
    error: 'INVALID_SESSIONS',
  },
  {
    name: 'negative sessions',
    price: 0n,
    components: [{ serviceId: 'a', sessions: -1 }],
    error: 'INVALID_SESSIONS',
  },
  {
    name: '366 sessions',
    price: 0n,
    components: [{ serviceId: 'a', sessions: 366 }],
    error: 'INVALID_SESSIONS',
  },
  {
    name: 'fractional sessions',
    price: 0n,
    components: [{ serviceId: 'a', sessions: 1.5 }],
    error: 'INVALID_SESSIONS',
  },
  {
    name: 'unsafe sessions',
    price: 0n,
    components: [{ serviceId: 'a', sessions: 9007199254740992 }],
    error: 'INVALID_SESSIONS',
  },
] as const;
