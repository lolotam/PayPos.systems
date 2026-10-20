import { PlaywrightDocumentRenderer } from '@pospay/documents';

const LAUNCH_FAILURE = /Executable doesn't exist|Failed to launch|browserType\.launch/;

/** غياب Chromium في CI بيفشل المجموعة. محليًا الرسالة بتفضل والاختبار بيتخطى. */
export function realChromiumUnavailable(
  error: unknown,
  env: NodeJS.ProcessEnv = process.env,
): false {
  const message = error instanceof Error ? error.message : '';
  if (!LAUNCH_FAILURE.test(message)) {
    throw error instanceof Error ? error : new Error('DOCUMENT_RENDER_FAILED');
  }
  if ((env['CI'] ?? '') !== '') {
    throw new Error('Chromium headless shell is required in CI', { cause: error });
  }
  console.info('Chromium headless shell is not installed; real PDF render skipped');
  return false;
}

export async function probeChromium(): Promise<boolean> {
  let failure: unknown;
  const renderer = new PlaywrightDocumentRenderer({
    backoffMs: [60_000],
    onLaunchError: (error: unknown) => {
      failure = error;
    },
  });
  try {
    await renderer.start();
    if (renderer.isAvailable()) return true;
    if (failure === undefined) throw new Error('DOCUMENT_RENDER_FAILED');
    return realChromiumUnavailable(failure);
  } finally {
    await renderer.close();
  }
}
