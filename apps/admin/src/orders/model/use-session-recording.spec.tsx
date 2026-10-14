import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createSessionAttemptJournal } from './session-attempt-journal';
import { createSessionDraft } from './session-drafts';
import * as SessionRecordingModule from './session-recording-result';
import { id, instant, response, scope } from './session-recording-result.fixture';
import { useSessionRecording, type SessionRecordingController } from './use-session-recording';

const post = vi.hoisted(() => vi.fn());
const trace = vi.hoisted(() => {
  const events: string[] = [];
  const flightCalls: number[] = [];
  const atRecorded: Array<string | null> = [];
  const commands: Array<{
    kind: string; occurredAt: string | undefined; membership: string | null | undefined;
    bodyHasOccurred: boolean; membershipOnBody: string | undefined;
  }> = [];
  const slotState = () => {
    const rows = ['a', 'b'].flatMap((slot) => {
      const raw = globalThis.sessionStorage.getItem(`pospay:service-session-attempt:${slot}`);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as { generation: number; envelope: { state?: string } };
      return [{ generation: parsed.generation, state: parsed.envelope.state ?? null }];
    });
    rows.sort((left, right) => right.generation - left.generation);
    return rows[0]?.state ?? null;
  };
  return {
    events, flightCalls, atRecorded, commands,
    note(event: { type: string; inFlight?: boolean; entry?: { state?: string } | null }) {
      if (event.type !== 'JOURNAL') {
        events.push(event.type);
        if (event.type === 'RECORDED') atRecorded.push(slotState());
        return;
      }
      events.push(event.inFlight ? 'JOURNAL:flight' : `JOURNAL:${event.entry?.state ?? 'null'}`);
      if (event.inFlight) flightCalls.push(post.mock.calls.length);
    },
    reset() { events.length = 0; flightCalls.length = 0; atRecorded.length = 0; commands.length = 0; },
  };
});
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ POST: post }) }));
vi.mock('./session-recording-result', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionRecordingModule>();
  return {
    ...actual,
    transitionSessionRecordingResult: (state: Parameters<typeof actual.transitionSessionRecordingResult>[0], event: Parameters<typeof actual.transitionSessionRecordingResult>[1]) => {
      trace.note(event);
      return actual.transitionSessionRecordingResult(state, event);
    },
    sessionResultCommand: (state: Parameters<typeof actual.sessionResultCommand>[0], lines: Parameters<typeof actual.sessionResultCommand>[1]) => {
      const command = actual.sessionResultCommand(state, lines);
      trace.commands.push({
        kind: command.kind, occurredAt: state.drafts.occurred_at, membership: state.drafts.recorder_membership_id,
        bodyHasOccurred: 'occurred_at' in command.body, membershipOnBody: command.body.recorder_membership_id,
      });
      return command;
    },
  };
});

const customer = { id: id(7), name: 'Synthetic customer', phone: '***001' };
const complete = { ...response, outcome: 'COMPLETE' as const, rejected_lines: [] };
type View = { unmount: () => void; result: { current: SessionRecordingController } };
let active: View | null = null;
let mounted = false;
let uuid: { mockRestore: () => void } | null = null;

function draft(localId = id(9), price = '7.125') {
  return {
    occurred_at: instant, recorder_membership_id: id(8),
    lines: [{ ...createSessionDraft(localId), service_id: id(5), price, performers: [{ employee_id: id(6), share_percentage: '', selection: null }] }],
  };
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = renderHook(() => useSessionRecording(scope), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  active = view;
  mounted = true;
  return view;
}
async function ready(view: View) {
  await waitFor(() => expect(view.result.current.journal).not.toBeNull());
}
function chooseCustomer(view: View) {
  act(() => { view.result.current.selectCustomer(customer); });
}
afterEach(() => {
  if (mounted) active?.result.current.journal?.changeScope(null);
  if (mounted) active?.unmount();
  const cleaner = createSessionAttemptJournal(scope, { now: () => Date.now(), newId: () => id(91) });
  cleaner.changeScope(null);
  cleaner.dispose();
  active = null;
  mounted = false;
  uuid?.mockRestore();
  uuid = null;
  sessionStorage.clear();
  post.mockReset();
  trace.reset();
});

it('dispatches the pending journal before sending and the result before the next read', async () => {
  let release!: (value: unknown) => void;
  post.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  const view = mount();
  await ready(view);
  chooseCustomer(view);
  let pending!: Promise<void>;
  act(() => { pending = view.result.current.submit(draft()); });
  await waitFor(() => expect(view.result.current.result.feedback.kind).toBe('SAVING'));
  expect(view.result.current.result.attempt?.key).toEqual(expect.any(String));
  expect(SessionRecordingModule.sessionResultFrozen(view.result.current.result)).toBe(true);
  await act(async () => { release({ data: complete, response: { status: 201 } }); await pending; });
  const flight = trace.events.indexOf('JOURNAL:flight');
  const recorded = trace.events.indexOf('RECORDED');
  expect(trace.flightCalls).toEqual([0]);
  expect(recorded).toBe(flight + 1);
  expect(trace.events[recorded + 1]).toBe('JOURNAL:null');
  expect(trace.atRecorded).toEqual(['IDLE']);
  expect(view.result.current.result.feedback.kind).toBe('COMPLETE');
});

it('keeps membership and occurred_at when the journal is already cleared before the result', async () => {
  post.mockResolvedValueOnce({ data: complete, response: { status: 201 } });
  post.mockResolvedValueOnce({ data: { ...complete, added_lines: response.session.lines }, response: { status: 201 } });
  const view = mount();
  await ready(view);
  chooseCustomer(view);
  await act(async () => { await view.result.current.submit(draft()); });
  const carried = view.result.current.result.drafts;
  expect(trace.atRecorded).toEqual(['IDLE']);
  expect(carried.occurred_at).toBe(instant);
  expect(carried.recorder_membership_id).toBe(id(8));
  await act(async () => { await view.result.current.submit({ ...carried, lines: draft(id(30), '8.000').lines }); });
  const next = trace.commands[1];
  expect(next?.kind).toBe('append');
  expect(next?.occurredAt).toBe(instant);
  expect(next?.membershipOnBody).toBe(id(8));
  expect(next?.bodyHasOccurred).toBe(false);
  const sent = post.mock.calls[1]?.[1] as { body: { recorder_membership_id?: string; occurred_at?: string } } | undefined;
  expect(String(post.mock.calls[1]?.[0])).toContain('/lines');
  expect(sent?.body.recorder_membership_id).toBe(id(8));
  expect(sent?.body.occurred_at).toBeUndefined();
});

it('replays one unresolved attempt and reads the journal only after the failure', async () => {
  post.mockRejectedValueOnce(new TypeError('Network loss'));
  const view = mount();
  await ready(view);
  chooseCustomer(view);
  await act(async () => { await view.result.current.submit(draft()); });
  const failed = trace.events.indexOf('FAILED');
  expect(trace.events[failed - 1]).toBe('JOURNAL:flight');
  expect(trace.events[failed + 1]).toBe('JOURNAL:PENDING');
  expect(view.result.current.result.feedback.kind).toBe('UNRESOLVED');
  const key = view.result.current.result.attempt?.key;
  uuid = vi.spyOn(crypto, 'randomUUID');
  post.mockResolvedValueOnce({ data: complete, response: { status: 201 } });
  await act(async () => { await view.result.current.retry(); });
  expect(uuid).not.toHaveBeenCalled();
  const keys = post.mock.calls.flatMap((call) => String(call[0]).endsWith('/service-sessions')
    ? [(call[1] as { params: { header: Record<string, string> } }).params.header['Idempotency-Key']] : []);
  expect(keys).toEqual([key, key]);
});

it('reloads the same unresolved attempt after the page unmounts', async () => {
  post.mockRejectedValueOnce(new TypeError('Network loss'));
  const first = mount();
  await ready(first);
  chooseCustomer(first);
  await act(async () => { await first.result.current.submit(draft()); });
  const key = first.result.current.result.attempt?.key;
  expect(key).toEqual(expect.any(String));
  first.unmount();
  mounted = false;
  const second = mount();
  await waitFor(() => expect(second.result.current.result.feedback.kind).toBe('UNRESOLVED'));
  expect(second.result.current.result.attempt?.key).toBe(key);
});
