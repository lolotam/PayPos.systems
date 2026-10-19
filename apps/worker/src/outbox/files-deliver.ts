import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';

type Next = (event: ClaimedEvent) => Promise<DeliveryOutcome>;

export function deliverFilesEvent(
  event: ClaimedEvent,
  ports: {
    register: Next;
    staff: (event: ClaimedEvent, next: Next) => Promise<DeliveryOutcome>;
    core: Next;
  },
): Promise<DeliveryOutcome> {
  if (event.eventType === 'FileUploadRequested') return ports.register(event);
  if (event.eventType === 'BusinessLogoChanged')
    return ports.staff(event, (claimed) => registerAfterCommit(ports, claimed));
  return ports.staff(event, ports.core);
}

async function registerAfterCommit(
  ports: { register: Next; core: Next },
  event: ClaimedEvent,
): Promise<DeliveryOutcome> {
  const outcome = await ports.core(event);
  if (!outcome.delivered) return outcome;
  return ports.register(event);
}
