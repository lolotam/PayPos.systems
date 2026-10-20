import { closeOptional } from '../shared/optional-capability.ts';

/**
 * إيقاف الرندر بيبدأ مع إيقاف الحلقة، عشان الاتنين يتصفّوا في نفس الوقت.
 * قفل المتصفح مش هنا؛ بيفضل آخر حاجة بعد التصفية.
 */
export async function drainDispatchAndDocuments(input: {
  readonly stopDispatch: () => Promise<void>;
  readonly stopDocuments: () => Promise<void> | undefined;
  readonly stopQueue: () => Promise<unknown> | undefined;
  readonly stopInbound: () => Promise<unknown> | undefined;
}): Promise<void> {
  const documentsStopping = Promise.resolve(input.stopDocuments());
  try {
    await input.stopDispatch();
  } finally {
    await closeOptional([
      () => input.stopQueue(),
      () => input.stopInbound(),
      () => documentsStopping,
    ]);
  }
}
