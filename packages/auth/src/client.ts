import {
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
} from '@simplewebauthn/browser';
import { createAuthClient } from 'better-auth/client';
import { twoFactorClient } from 'better-auth/client/plugins';

// TODO(spec): session lifetime stays on Better Auth's default — the spec does not set it.
// The browser only calls the endpoints. Nothing here hashes, compares, or stores a secret.

export interface AuthResponse {
  readonly data: unknown;
  readonly error: unknown;
}

export interface SessionRequest {
  fetchOptions?: {
    headers?: { cookie?: string };
    cache?: 'no-store';
  };
}

export interface PospayAuthClient {
  signIn: {
    email: (input: { email: string; password: string }) => Promise<AuthResponse>;
  };
  getSession: (input?: SessionRequest) => Promise<AuthResponse>;
  signOut: () => Promise<AuthResponse>;
  twoFactor: {
    enable: (input: { password: string; method: 'totp' }) => Promise<AuthResponse>;
    verifyTotp: (input: { code: string }) => Promise<AuthResponse>;
  };
}

/**
 * عميل Better Auth للمتصفح. السر والتحقق يفضلوا على الـ API؛ هنا بس عنوان الطلب والـ cookie.
 *
 * @param baseURL عنوان الـ API العام (NEXT_PUBLIC_API_URL) — من غيره الطلب مش هيوصل /v1/auth
 * @returns عميل better-auth/client مع TOTP، من غير أي كود سيرفر
 */
export function createPospayAuthClient(baseURL: string): PospayAuthClient {
  return createAuthClient({
    baseURL,
    basePath: '/v1/auth',
    fetchOptions: { credentials: 'include' },
    plugins: [twoFactorClient()],
  });
}

/** التسجيل يفتح authenticator فقط؛ لا يستدعي مسار plugin ولا ينشئ جلسة عامة. */
export function registerStaffPasskey(options: PublicKeyCredentialCreationOptionsJSON) {
  return startRegistration({ optionsJSON: options });
}
