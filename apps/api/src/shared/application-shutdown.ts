import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';

export const SHUTDOWN = Symbol('SHUTDOWN');
const SHUTDOWN_TIMEOUT_MS = 10_000;

// A lifecycle provider, so cleanup runs through Nest's own shutdown path — the one SIGTERM triggers —
// and not through an override of app.close() that a signal would skip.
@Injectable()
export class ShutdownHook implements OnApplicationShutdown {
  readonly #release: () => Promise<void>;

  constructor(@Inject(SHUTDOWN) release: () => Promise<void>) {
    this.#release = release;
  }

  async onApplicationShutdown(): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const limit = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, SHUTDOWN_TIMEOUT_MS);
    });
    await Promise.race([this.#release().catch(() => undefined), limit]);
    clearTimeout(timer);
  }
}
