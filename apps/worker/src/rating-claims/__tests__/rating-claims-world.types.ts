// أنواع عالم القبول: موجودة لوحدها عشان ملف العالم يبقى تحت سقف السطور.
import type { Redis } from 'ioredis';

import type { Tx } from '@pospay/db';
import type { VisitBudget } from '../../modules/customers/domain/rating-claim-scheduling.ts';
import type { RatingClaimDiagnostics } from '../../modules/customers/ports/rating-claim-diagnostics.port.ts';
import type { RatingClaimTransactions } from '../../modules/customers/ports/rating-claim-transactions.port.ts';
import type {
  ClaimStateSnapshot,
  RatingClaimState,
} from '../../modules/customers/ports/rating-claim-state.port.ts';
import type {
  ClaimRatingRequests,
  RatingClaimsTurnSummary,
} from '../../modules/customers/use-cases/claim-rating-requests/claim-rating-requests.ts';
import type { RatingClaimsFixture } from './rating-claims.fixture.ts';
import type { SeededRows, SeedOptions } from './rating-claims-rows.fixture.ts';
import type { RecordingDiagnostics, TracedState } from './rating-claims-trace.fixture.ts';

/** خطّاف المطالبة: الطلبات اللي تفشل بعد التنفيذ، والمقدار اللي بتتحرّك بيه الساعة. */
export interface ClaimTrap {
  readonly failAfter: Set<string>;
  /** مللي ثانية بتتحرّك بيه الساعة بعد أول مطالبة، عشان التجديد يبقى مستحق. */
  clockJumpMs: number;
}

/** خطّاف المعاملات: الطلبات اللي ضاع رد الـ commit بتاعها بعد ما اتنفّذ. */
export interface TransactionTrap {
  readonly lostReplies: Set<string>;
}

/** صف مزروع في معاملة مفتوحة: الـ commit بيتأجل لحد ما الاختبار يفتحه. */
export interface HeldSeed {
  readonly requestId: string;
  /** بيتحل لما الصف يتكتب فعلاً جوّه المعاملة المفتوحة. */
  readonly inserted: Promise<void>;
  release(): void;
  readonly done: Promise<unknown>;
}

/** قفل صف طلب في معاملة مفتوحة. */
export interface HeldLock {
  readonly locked: Promise<void>;
  release(): void;
  readonly done: Promise<unknown>;
}

/** خيارات عالم القبول. */
export interface RatingClaimsWorldOptions {
  readonly budget?: VisitBudget;
  /** حالة البصمة في البداية: غير متاحة هي الوضع الافتراضي لاختبارات إعادة المحاولة. */
  readonly tokens?: boolean;
  readonly state?: Partial<RatingClaimStateLimits>;
}

/** حدود تقنية للحالة: كل القيم موجودة، عشان ما فيش undefined في خيار اختياري. */
export interface RatingClaimStateLimits {
  readonly capacity: number;
  readonly leaseMs: number;
  readonly maxTurnMs: number;
  readonly backoffMs: number;
  readonly maxBytes: number;
  readonly reserveBytes: number;
}

/** خيارات الموظف: منفذ حالة تاني أو ميزانية تانية أو تشخيص تاني. */
export interface WorkerOptions {
  state?: RatingClaimState;
  budget?: VisitBudget;
  diagnostics?: RatingClaimDiagnostics;
}

/** عالم القبول: القاعدة والـ Redis والمهايات، وعلماء يقدرون يشتغلوا بالتوازي. */
export interface RatingClaimsWorld {
  readonly base: RatingClaimsFixture;
  readonly company: string;
  readonly otherCompany: string;
  readonly otherBusiness: string;
  readonly branchId: string;
  readonly redis: Redis;
  readonly prefix: string;
  /** منفذ الحالة الحقيقي من غير خطافات، عشان كل عامل يبني خطافاته عليه. */
  readonly rawState: RatingClaimState;
  readonly state: TracedState;
  readonly transactions: RatingClaimTransactions<Tx>;
  readonly diagnostics: RecordingDiagnostics;
  readonly tokens: { allow(requestId: string): boolean };
  readonly claimTrap: ClaimTrap;
  readonly txTrap: TransactionTrap;
  readonly budget: VisitBudget;
  /** موظف جديد لدور خدمة مستقل برمز مالك خاص بيه. */
  worker(options?: WorkerOptions): ClaimRatingRequests<Tx>;
  turn(worker?: ClaimRatingRequests<Tx>): Promise<RatingClaimsTurnSummary>;
  readState(): Promise<ClaimStateSnapshot>;
  /** حالات الطلبات من القاعدة بعد الدور، مقرونة بمعرّف كل طلب. */
  requestStatuses(): Promise<Map<string, string>>;
  /** معرّفات الطلبات اللي وصلها حدث جاهزية في نفس المعاملة. */
  readyRequestIds(): Promise<string[]>;
  seedDueRequests(options: SeedOptions): Promise<SeededRows>;
  /** يزرع صف طلب في معاملة مفتوحة، والـ commit بيتأجل لحد ما الاختبار يفتحه. */
  holdDueRequest(options: SeedOptions): Promise<HeldSeed>;
  /** يقفل صف طلب في معاملة مفتوحة، عشان نجرّب طلب مقفل في معاملة تانية. */
  holdRequestLock(requestId: string): Promise<HeldLock>;
  close(): Promise<void>;
}
