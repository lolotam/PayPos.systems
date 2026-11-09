import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EmployeeDocumentsSection } from './employee-documents-section';
import { useEmployeeDocuments } from '../api/use-employee-documents';

const language = vi.hoisted(() => ({ value: 'en' as 'ar' | 'en', fetch: vi.fn() }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => language.value }));
vi.mock('@/shared/api/origin', () => ({ apiOrigin: () => 'https://api.test' }));
const id = '01920000-0000-7000-8000-0000000000a2';
const other = '01920000-0000-7000-8000-0000000000a3';
const props = { companyId: id, businessId: id, userId: id, employeeId: id };
const document = {
  id,
  employee_id: id,
  type_code: 'civil_id',
  type_name_en: 'Original paper',
  type_name_ar: t('ar', 'permissions.readOnly'),
  object_key: 'synthetic/verified',
  expires_on: null,
  uploaded_by: id,
  recorded_at: '2026-10-04T08:00:00.000Z',
  status: 'NO_EXPIRY',
};
const view = (items = [document]) => ({
  today: '2026-10-05',
  items,
  can_manage: true,
  types: [
    {
      id,
      code: 'civil_id',
      name_en: 'Civil ID',
      name_ar: t('ar', 'employeeDocuments.title'),
      alert_days: 30,
      requires_expiry: false,
      active: true,
      revision: 1,
    },
  ],
});
const json = (data: unknown) =>
  new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json' },
  });
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function mockPopup() {
  const handle = {
    opener: window as unknown,
    closed: false,
    location: { assign: vi.fn() },
    close: vi.fn(),
  };
  handle.close.mockImplementation(() => {
    handle.closed = true;
  });
  vi.spyOn(window, 'open').mockReturnValue(handle as unknown as Window);
  return handle;
}
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (employeeId: string) => (
    <QueryClientProvider client={client}>
      <EmployeeDocumentsSection {...props} employeeId={employeeId} />
    </QueryClientProvider>
  );
  const rendered = render(tree(id));
  return { ...rendered, client, change: () => rendered.rerender(tree(other)) };
}
beforeEach(() => {
  vi.stubGlobal('fetch', language.fetch);
});
afterEach(() => {
  cleanup();
  language.fetch.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(['ar', 'en'] as const)(
  'ignores a late private download after employee change (%s)',
  async (locale) => {
    language.value = locale;
    const download = deferred();
    let requested = false;
    language.fetch.mockImplementation(async (request: Request) => {
      if (request.url.endsWith('/files/download')) {
        requested = true;
        return download.promise;
      }
      return json(view(request.url.includes(other) ? [] : [document]));
    });
    const opened = mockPopup();
    const page = setup();
    const title = locale === 'ar' ? document.type_name_ar : document.type_name_en;
    expect(await screen.findByText(title)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'employeeDocuments.open') }));
    await waitFor(() => expect(requested).toBe(true));
    page.change();
    expect(await screen.findByText(t(locale, 'employeeDocuments.empty'))).toBeTruthy();
    await act(async () => {
      download.resolve(json({ download_url: 'https://storage.test/private', expires_in: 60 }));
    });
    expect(screen.queryByText(title)).toBeNull();
    expect(screen.getByText(t(locale, 'employeeDocuments.empty'))).toBeTruthy();
    expect(opened.close).toHaveBeenCalledOnce();
    expect(opened.location.assign).not.toHaveBeenCalled();
  },
);

it.each(['ar', 'en'] as const)(
  'does not record an old upload in the next employee context (%s)',
  async (locale) => {
    language.value = locale;
    const ready = deferred();
    let polling = false;
    let records = 0;
    language.fetch.mockImplementation(async (request: Request | string) => {
      const url = typeof request === 'string' ? request : request.url;
      if (url === 'https://storage.test/upload') return new Response(null);
      if (url.endsWith('/files/uploads'))
        return json({
          id,
          upload_url: 'https://storage.test/upload',
          expires_in: 120,
          headers: { 'content-type': 'application/pdf', 'content-length': '3' },
        });
      if (url.endsWith('/confirm')) return json({ id, status: 'QUEUED' });
      if (url.endsWith(`/files/${id}`)) {
        polling = true;
        return ready.promise;
      }
      if (typeof request !== 'string' && request.method === 'POST') {
        records += 1;
        return json(document);
      }
      return json(view(url.includes(other) ? [] : [document]));
    });
    const page = setup();
    fireEvent.change(await screen.findByLabelText(t(locale, 'employeeDocuments.file')), {
      target: { files: [new File(['pdf'], 'paper.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'employeeDocuments.upload') }));
    await screen.findByText(t(locale, 'employeeDocuments.verifying'));
    await waitFor(() => expect(polling).toBe(true));
    page.change();
    expect(await screen.findByText(t(locale, 'employeeDocuments.empty'))).toBeTruthy();
    await act(async () => {
      ready.resolve(json({ id, status: 'READY', content_type: 'application/pdf', size_bytes: 3 }));
    });
    expect(screen.queryByText(t(locale, 'employeeDocuments.recorded'))).toBeNull();
    expect(screen.getByText(t(locale, 'employeeDocuments.empty'))).toBeTruthy();
    expect(records).toBe(0);
  },
);

function pendingDocumentTransport() {
  const download = deferred();
  const ready = deferred();
  const requestState = {
    refreshed: undefined as Response | undefined,
    downloading: false,
    polling: false,
  };
  const recorded: string[] = [];
  language.fetch.mockImplementation(async (request: Request | string) => {
    const url = typeof request === 'string' ? request : request.url;
    if (url === 'https://storage.test/upload') return new Response(null);
    if (url.endsWith('/files/download')) {
      requestState.downloading = true;
      return download.promise;
    }
    if (url.endsWith('/files/uploads'))
      return json({
        id,
        upload_url: 'https://storage.test/upload',
        expires_in: 120,
        headers: { 'content-type': 'application/pdf', 'content-length': '3' },
      });
    if (url.endsWith('/confirm')) return json({ id, status: 'QUEUED' });
    if (url.endsWith(`/files/${id}`)) {
      requestState.polling = true;
      return ready.promise;
    }
    if (typeof request !== 'string' && request.method === 'POST') {
      recorded.push(url);
      return json(document);
    }
    return requestState.refreshed ? requestState.refreshed.clone() : json(view());
  });
  return { download, ready, recorded, requestState };
}

async function pendingJourney(locale: 'ar' | 'en', includeDownload = true) {
  language.value = locale;
  const { download, ready, recorded, requestState } = pendingDocumentTransport();
  const opened = mockPopup();
  const page = setup();
  const input = await screen.findByLabelText(t(locale, 'employeeDocuments.file'));
  if (includeDownload) {
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'employeeDocuments.open') }));
  }
  fireEvent.change(input, {
    target: { files: [new File(['pdf'], 'paper.pdf', { type: 'application/pdf' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: t(locale, 'employeeDocuments.upload') }));
  expect(await screen.findByText(t(locale, 'employeeDocuments.verifying'))).toBeTruthy();
  await waitFor(() => {
    expect(requestState.polling).toBe(true);
    expect(requestState.downloading).toBe(includeDownload);
  });
  return {
    ...page,
    opened,
    recorded,
    refresh: async (response: Response) => {
      requestState.refreshed = response;
      await act(async () => {
        await page.client.refetchQueries({ queryKey: ['employee-documents', id, id, id, id] });
      });
    },
    finish: async () => {
      await act(async () => {
        download.resolve(json({ download_url: 'https://storage.test/private', expires_in: 60 }));
        ready.resolve(
          json({ id, status: 'READY', content_type: 'application/pdf', size_bytes: 3 }),
        );
      });
      await waitFor(() => {
        const mutations = page.client.getMutationCache().getAll();
        const record = mutations.find(
          (mutation) => mutation.options.mutationKey?.at(-1) === 'record',
        );
        const opened = mutations.find(
          (mutation) => mutation.options.mutationKey?.at(-1) === 'open',
        );
        expect(mutations).toHaveLength(includeDownload ? 2 : 1);
        expect(record?.state.status).toBe('success');
        expect(record?.state.data).toBeUndefined();
        if (!includeDownload) return;
        expect(opened?.state.status).toBe('error');
        expect(JSON.stringify(opened?.state.error)).not.toContain('storage.test');
      });
    },
  };
}

it.each([
  ['ar', 403],
  ['en', 403],
  ['ar', 404],
  ['en', 404],
] as const)(
  'keeps private documents closed after a refreshed refusal (%s, %s)',
  async (locale, status) => {
    const page = await pendingJourney(locale);
    const refusal = {
      code: status === 403 ? 'FORBIDDEN' : 'NOT_FOUND',
      message_ar: t('ar', status === 403 ? 'errors.FORBIDDEN' : 'errors.NOT_FOUND'),
      message_en: 'Documents are unavailable',
    };
    await page.refresh(
      new Response(JSON.stringify(refusal), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const message = locale === 'ar' ? refusal.message_ar : refusal.message_en;
    expect((await screen.findByRole('alert')).textContent).toBe(message);
    expect(screen.queryByRole('button', { name: t(locale, 'employeeDocuments.open') })).toBeNull();
    expect(screen.queryByLabelText(t(locale, 'employeeDocuments.file'))).toBeNull();
    expect(
      page.client.getQueryCache().findAll({ queryKey: ['employee-documents', id, id, id, id] }),
    ).toEqual([]);
    await page.finish();
    expect((await screen.findByRole('alert')).textContent).toBe(message);
    expect(
      screen.queryByText(locale === 'ar' ? document.type_name_ar : document.type_name_en),
    ).toBeNull();
    expect(screen.queryByText(t(locale, 'employeeDocuments.recorded'))).toBeNull();
    expect(page.opened.close).toHaveBeenCalledOnce();
    expect(page.opened.location.assign).not.toHaveBeenCalled();
    expect(page.recorded).toEqual([]);
  },
);

it.each(['ar', 'en'] as const)(
  'does not announce or record an upload after manage access is removed (%s)',
  async (locale) => {
    const page = await pendingJourney(locale, false);
    await page.refresh(json({ ...view(), can_manage: false }));
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: t(locale, 'employeeDocuments.upload') }),
      ).toBeNull();
      expect(screen.queryByLabelText(t(locale, 'employeeDocuments.file'))).toBeNull();
    });
    expect(
      screen.getByText(locale === 'ar' ? document.type_name_ar : document.type_name_en),
    ).toBeTruthy();
    await page.finish();
    expect(screen.queryByText(t(locale, 'employeeDocuments.recorded'))).toBeNull();
    expect(screen.queryByText(t(locale, 'employeeDocuments.verifying'))).toBeNull();
    expect(screen.getByRole('button', { name: t(locale, 'employeeDocuments.open') })).toBeTruthy();
    expect(page.recorded).toEqual([]);
  },
);

it.each(['ar', 'en'] as const)(
  'shows a bilingual retry after popup refusal (%s)',
  async (locale) => {
    language.value = locale;
    language.fetch.mockResolvedValue(json(view()));
    vi.spyOn(window, 'open').mockReturnValue(null);
    setup();
    const open = await screen.findByRole('button', { name: t(locale, 'employeeDocuments.open') });
    fireEvent.click(open);
    expect((await screen.findByRole('alert')).textContent).toBe(
      t(locale, 'employeeDocuments.openRetry'),
    );
    expect(open.hasAttribute('disabled')).toBe(false);
    expect(
      language.fetch.mock.calls.some(([request]) => request.url.endsWith('/files/download')),
    ).toBe(false);
  },
);

it('never navigates a placeholder that its user manually closed', async () => {
  language.value = 'en';
  const download = deferred();
  language.fetch.mockImplementation(async (request: Request) =>
    request.url.endsWith('/files/download') ? download.promise : json(view()),
  );
  const opened = mockPopup();
  setup();
  fireEvent.click(await screen.findByRole('button', { name: t('en', 'employeeDocuments.open') }));
  opened.closed = true;
  await act(async () => {
    download.resolve(json({ download_url: 'https://storage.test/private', expires_in: 60 }));
  });
  expect(opened.location.assign).not.toHaveBeenCalled();
  expect((await screen.findByRole('alert')).textContent).toBe(
    t('en', 'employeeDocuments.openRetry'),
  );
  const open = screen.getByRole('button', { name: t('en', 'employeeDocuments.open') });
  expect(open.hasAttribute('disabled')).toBe(false);
});

it('does not let a usable scope A callback borrow the restored scope', async () => {
  language.fetch.mockImplementation(async (request: Request) => {
    if (request.url.endsWith('/files/download')) {
      return json({ download_url: 'https://storage.test/private', expires_in: 60 });
    }
    return json(view());
  });
  const opened = vi.spyOn(window, 'open').mockImplementation(() => {
    return {
      opener: null,
      closed: false,
      location: { assign: vi.fn() },
      close: vi.fn(),
    } as unknown as Window;
  });
  const retained: Array<(storageKey: string) => void> = [];
  function Probe({ employeeId }: { employeeId: string }) {
    const documents = useEmployeeDocuments(id, id, id, employeeId);
    retained.push(documents.open.mutate);
    const item = documents.view.data?.items[0];
    return <p>{item?.type_name_en ?? t('en', 'employeeDocuments.empty')}</p>;
  }
  const client = new QueryClient();
  const page = (employeeId: string) => (
    <QueryClientProvider client={client}>
      <Probe employeeId={employeeId} />
    </QueryClientProvider>
  );
  const { rerender } = render(page(id));
  expect(await screen.findByText('Original paper')).toBeTruthy();
  const fresh = retained.at(-1);
  act(() => fresh?.('synthetic/verified'));
  await waitFor(() => expect(opened).toHaveBeenCalledOnce());
  rerender(page(other));
  expect(await screen.findByText('Original paper')).toBeTruthy();
  rerender(page(id));
  expect(await screen.findByText('Original paper')).toBeTruthy();
  act(() => fresh?.('synthetic/verified'));
  expect(opened).toHaveBeenCalledOnce();
  act(() => retained.at(-1)?.('synthetic/verified'));
  await waitFor(() => expect(opened).toHaveBeenCalledTimes(2));
});
