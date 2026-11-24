import { useSignIn } from '@/session/api/use-sign-in';
import { useVerifyTotp } from '@/session/api/use-verify-totp';

export function SignInStyleProbe({ kind }: { kind: 'password' | 'totp' }) {
  const password = useSignIn();
  const totp = useVerifyTotp();
  const current = kind === 'password' ? password : totp;
  return <>
    <button disabled={current.pending} onClick={() => void (kind === 'password'
      ? password.submit({ email: 'synthetic@nav.invalid', password: 'synthetic' })
      : totp.submit({ code: '123456' }))}>Sign in</button>
    {current.error && <p role="alert">{current.error}</p>}
  </>;
}
