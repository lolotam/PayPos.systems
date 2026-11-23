/**
 * جدول حالات قاعدة «من يقرأ تعليق التقييم» (BR-B4، RT-Q7b، قرار المالك 2026-11-22) بصيغة محايدة بلا أي نوع من الكود.
 * نفس الملف حرفياً موجود في API (apps/api/.../identity/domain/__tests__) وفي الـ worker (apps/worker/.../identity/domain/__tests__)،
 * وكل جانب بيشغّل الحالات على دالته ويتأكد من بصمة الجدول، فأي تعديل في جانب واحد يكسر الجانب التاني لحد ما يتساوى الجدولان.
 * الشركة C والنشاط B والفرعان b1 وb2؛ الدور null معناه دور مخصص من الشركة.
 */
export interface RuleScope {
  readonly scopeType: 'COMPANY' | 'BUSINESS' | 'BRANCH';
  readonly scopeId: string;
}

export interface RuleCase {
  readonly name: string;
  readonly branch: 'b1' | 'b2';
  readonly memberships: readonly (RuleScope & {
    readonly id: string;
    readonly role: string | null;
  })[];
  readonly grants: readonly (RuleScope & {
    readonly membership: string;
    readonly effect: 'ALLOW' | 'DENY';
  })[];
  readonly owner: boolean;
  readonly readable: boolean;
}

const company: RuleScope = { scopeType: 'COMPANY', scopeId: 'C' };
const business: RuleScope = { scopeType: 'BUSINESS', scopeId: 'B' };
const b1: RuleScope = { scopeType: 'BRANCH', scopeId: 'b1' };
const b2: RuleScope = { scopeType: 'BRANCH', scopeId: 'b2' };

export const RULE_CASES: readonly RuleCase[] = [
  {
    name: 'a branch manager membership covering the branch with its own ALLOW reads',
    branch: 'b1',
    memberships: [{ id: 'm1', role: 'branch_manager', ...b1 }],
    grants: [{ membership: 'm1', effect: 'ALLOW', ...b1 }],
    owner: false,
    readable: true,
  },
  {
    name: 'a manager membership without an ALLOW does not read, even when a sibling custom membership holds one',
    branch: 'b1',
    memberships: [
      { id: 'm1', role: 'branch_manager', ...b1 },
      { id: 'm2', role: null, ...company },
    ],
    grants: [{ membership: 'm2', effect: 'ALLOW', ...company }],
    owner: false,
    readable: false,
  },
  {
    name: 'a manager membership without an ALLOW does not read, even when a former-manager (cashier) membership holds one',
    branch: 'b1',
    memberships: [
      { id: 'm1', role: 'branch_manager', ...b1 },
      { id: 'm2', role: 'cashier', ...b1 },
    ],
    grants: [{ membership: 'm2', effect: 'ALLOW', ...b1 }],
    owner: false,
    readable: false,
  },
  {
    name: 'a manager membership with no grants at all does not read',
    branch: 'b1',
    memberships: [{ id: 'm1', role: 'branch_manager', ...b1 }],
    grants: [],
    owner: false,
    readable: false,
  },
  {
    name: 'a manager membership that does not cover the branch does not read it',
    branch: 'b1',
    memberships: [{ id: 'm1', role: 'branch_manager', ...b2 }],
    grants: [{ membership: 'm1', effect: 'ALLOW', ...b2 }],
    owner: false,
    readable: false,
  },
  {
    name: 'a business manager reads the first branch of the business',
    branch: 'b1',
    memberships: [{ id: 'm1', role: 'business_manager', ...business }],
    grants: [{ membership: 'm1', effect: 'ALLOW', ...business }],
    owner: false,
    readable: true,
  },
  {
    name: 'a business manager reads the second branch of the business',
    branch: 'b2',
    memberships: [{ id: 'm1', role: 'business_manager', ...business }],
    grants: [{ membership: 'm1', effect: 'ALLOW', ...business }],
    owner: false,
    readable: true,
  },
  {
    name: 'a general manager at company scope reads',
    branch: 'b2',
    memberships: [{ id: 'm1', role: 'general_manager', ...company }],
    grants: [{ membership: 'm1', effect: 'ALLOW', ...company }],
    owner: false,
    readable: true,
  },
  {
    name: 'a covering DENY on the same membership removes the reader',
    branch: 'b1',
    memberships: [{ id: 'm1', role: 'branch_manager', ...b1 }],
    grants: [
      { membership: 'm1', effect: 'ALLOW', ...b1 },
      { membership: 'm1', effect: 'DENY', ...company },
    ],
    owner: false,
    readable: false,
  },
  {
    name: 'a covering DENY on a sibling non-manager membership removes the reader',
    branch: 'b1',
    memberships: [
      { id: 'm1', role: 'branch_manager', ...b1 },
      { id: 'm2', role: null, ...company },
    ],
    grants: [
      { membership: 'm1', effect: 'ALLOW', ...b1 },
      { membership: 'm2', effect: 'DENY', ...b1 },
    ],
    owner: false,
    readable: false,
  },
  {
    name: 'a DENY on the other branch does not remove this branch',
    branch: 'b1',
    memberships: [{ id: 'm1', role: 'business_manager', ...business }],
    grants: [
      { membership: 'm1', effect: 'ALLOW', ...business },
      { membership: 'm1', effect: 'DENY', ...b2 },
    ],
    owner: false,
    readable: true,
  },
  {
    name: 'the same DENY removes the other branch',
    branch: 'b2',
    memberships: [{ id: 'm1', role: 'business_manager', ...business }],
    grants: [
      { membership: 'm1', effect: 'ALLOW', ...business },
      { membership: 'm1', effect: 'DENY', ...b2 },
    ],
    owner: false,
    readable: false,
  },
  {
    name: 'the canonical owner ignores a DENY when an ALLOW source exists',
    branch: 'b1',
    memberships: [{ id: 'm1', role: 'owner', ...company }],
    grants: [
      { membership: 'm1', effect: 'ALLOW', ...company },
      { membership: 'm1', effect: 'DENY', ...company },
    ],
    owner: true,
    readable: true,
  },
  {
    name: 'the canonical owner is not a reader without an ALLOW source',
    branch: 'b1',
    memberships: [{ id: 'm1', role: 'owner', ...company }],
    grants: [{ membership: 'm1', effect: 'DENY', ...company }],
    owner: true,
    readable: false,
  },
  {
    name: 'a custom role with an ALLOW is excluded',
    branch: 'b1',
    memberships: [{ id: 'm1', role: null, ...company }],
    grants: [{ membership: 'm1', effect: 'ALLOW', ...company }],
    owner: false,
    readable: false,
  },
  {
    name: 'a cashier role with a stale ALLOW is excluded',
    branch: 'b1',
    memberships: [{ id: 'm1', role: 'cashier', ...b1 }],
    grants: [{ membership: 'm1', effect: 'ALLOW', ...b1 }],
    owner: false,
    readable: false,
  },
  {
    name: 'an ALLOW whose own scope is the other branch does not cover this branch',
    branch: 'b1',
    memberships: [{ id: 'm1', role: 'business_manager', ...business }],
    grants: [{ membership: 'm1', effect: 'ALLOW', ...b2 }],
    owner: false,
    readable: false,
  },
  {
    name: 'an ALLOW narrower than the membership still covers its own branch',
    branch: 'b1',
    memberships: [{ id: 'm1', role: 'general_manager', ...company }],
    grants: [{ membership: 'm1', effect: 'ALLOW', ...b1 }],
    owner: false,
    readable: true,
  },
  {
    name: 'one manager membership without an ALLOW does not block another that has its own',
    branch: 'b1',
    memberships: [
      { id: 'm1', role: 'branch_manager', ...b1 },
      { id: 'm2', role: 'business_manager', ...business },
    ],
    grants: [{ membership: 'm2', effect: 'ALLOW', ...business }],
    owner: false,
    readable: true,
  },
  {
    name: 'a user with no membership does not read',
    branch: 'b1',
    memberships: [],
    grants: [],
    owner: false,
    readable: false,
  },
];
