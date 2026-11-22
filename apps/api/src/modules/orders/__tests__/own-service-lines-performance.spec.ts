import { perfSuite } from './own-service-lines.perf.ts';

// plan §5.3 البنود 1–3 على الحجم المعتمد: 600 زيارة/602 سطراً لها، وزميلات بعشرة أضعافها (6,020 سطراً).
perfSuite({ colleagues: 6020, warm: 0, background: 1500 });
