/**
 * The token that hands identity's discount-approver PIN verifier to the module that decides the approval
 * (ADR-0051 §3). It lives here because shared/ is the only place two modules may meet: a token may cross
 * it, while a value imported from another module may only be called where it was imported.
 */
export const DISCOUNT_APPROVER_VERIFIER = Symbol('DISCOUNT_APPROVER_VERIFIER');
