import { t } from '@pospay/i18n';
import { focusManager } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { RatingPage } from './rating-page';

function api(view: Record<string, unknown> = { business_name: 'Test Salon', state: 'open' }) {
  const requests: Request[] = [];
  const transport = vi.fn(async (request: Request) => {
    requests.push(request);
    return request.method === 'GET' ? Response.json(view) : new Response(null, { status: 204 });
  });
  vi.stubGlobal('fetch', transport);
  return { requests, transport };
}

function pendingResponse() {
  let resolve: (response: Response) => void = () => {
    throw new Error('Response not pending');
  };
  let reject: (reason: Error) => void = () => {
    throw new Error('Response not pending');
  };
  const promise = new Promise<Response>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  focusManager.setFocused(false);
  window.history.replaceState(null, '', '/#test-link');
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.test');
});

it.each(['http', 'network'])(
  'keeps an expired link closed after a later %s failure',
  async (failure) => {
    const { transport } = api();
    render(<RatingPage />);
    await screen.findByRole('heading');
    transport.mockImplementationOnce(async () =>
      Response.json({ code: 'RATING_LINK_UNAVAILABLE' }, { status: 404 }),
    );
    await act(async () => focusManager.setFocused(true));
    expect(await screen.findByText(t('ar', 'publicRating.unavailable'))).toBeDefined();
    act(() => focusManager.setFocused(false));
    const lateFailure = pendingResponse();
    transport.mockImplementationOnce(() => lateFailure.promise);
    act(() => focusManager.setFocused(true));
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(3));
    await act(async () => {
      if (failure === 'http')
        lateFailure.resolve(Response.json({ code: 'NOT_READY' }, { status: 503 }));
      else lateFailure.reject(new TypeError('PRIVATE_NETWORK_DETAIL'));
    });
    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByRole('alert').textContent).toBe(t('en', 'publicRating.unavailable'));
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('button', { name: t('en', 'publicRating.optOut') })).toBeNull();
    window.history.replaceState(null, '', '/#fresh-link');
    fireEvent(window, new HashChangeEvent('hashchange'));
    expect(await screen.findByRole('heading')).toHaveProperty(
      'textContent',
      t('en', 'publicRating.title') + ' Test Salon',
    );
    expect(screen.getAllByRole('radio')).toHaveLength(5);
  },
);

it.each(['', ' \t\n '])(
  'submits stars with a blank optional comment omitted: %j',
  async (comment) => {
    const { requests } = api();
    render(<RatingPage />);
    fireEvent.click(await screen.findByRole('radio', { name: '5' }));
    if (comment !== '')
      fireEvent.change(screen.getByRole('textbox'), { target: { value: comment } });
    fireEvent.click(screen.getByRole('button', { name: t('ar', 'publicRating.submit') }));
    expect(await screen.findByText(t('ar', 'publicRating.done'))).toBeDefined();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(await requests.find((request) => request.url.endsWith('/submit'))?.json()).toEqual({
      stars: 5,
    });
  },
);

it('reconciles a rating consumed in another tab to completion with working opt-out', async () => {
  const { transport } = api();
  render(<RatingPage />);
  fireEvent.click(await screen.findByRole('radio', { name: '4' }));
  transport.mockImplementationOnce(async () =>
    Response.json({ code: 'RATING_LINK_UNAVAILABLE' }, { status: 404 }),
  );
  transport.mockImplementationOnce(async () =>
    Response.json({ business_name: 'Test Salon', state: 'submitted' }),
  );
  fireEvent.click(screen.getByRole('button', { name: t('ar', 'publicRating.submit') }));
  expect(await screen.findByText(t('ar', 'publicRating.done'))).toBeDefined();
  expect(screen.queryByText(t('ar', 'publicRating.unavailable'))).toBeNull();
  expect(screen.queryByRole('radio')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: t('ar', 'publicRating.optOut') }));
  expect(await screen.findByText(t('ar', 'publicRating.optedOut'))).toBeDefined();
});

it('keeps completion when a pre-submit focus read resolves late', async () => {
  const { transport } = api();
  render(<RatingPage />);
  fireEvent.click(await screen.findByRole('radio', { name: '5' }));
  const submission = pendingResponse();
  const refetch = pendingResponse();
  transport.mockImplementationOnce(() => submission.promise);
  fireEvent.click(screen.getByRole('button', { name: t('ar', 'publicRating.submit') }));
  await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
  transport.mockImplementationOnce(() => refetch.promise);
  act(() => focusManager.setFocused(true));
  await waitFor(() => expect(transport).toHaveBeenCalledTimes(3));
  await act(async () => submission.resolve(new Response(null, { status: 204 })));
  expect(await screen.findByText(t('ar', 'publicRating.done'))).toBeDefined();
  await act(async () =>
    refetch.resolve(Response.json({ business_name: 'Test Salon', state: 'open' })),
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: t('ar', 'publicRating.optOut') })).toHaveProperty(
      'disabled',
      false,
    ),
  );
  expect(screen.getByText(t('ar', 'publicRating.done'))).toBeDefined();
  expect(screen.queryByRole('radio')).toBeNull();
});

it.each(['open', 'submitted'])(
  'keeps cached %s content after a transient refetch failure, then closes an expired link',
  async (state) => {
    const { transport } = api({ business_name: 'Test Salon', state });
    render(<RatingPage />);
    await screen.findByRole('heading');
    transport.mockRejectedValueOnce(new TypeError('PRIVATE_NETWORK_DETAIL'));
    act(() => focusManager.setFocused(true));
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: t('ar', 'publicRating.optOut') })).toHaveProperty(
        'disabled',
        false,
      ),
    );
    expect(screen.getByRole('heading').textContent).toContain('Test Salon');
    if (state === 'open') expect(screen.getAllByRole('radio')).toHaveLength(5);
    else expect(screen.getByText(t('ar', 'publicRating.done'))).toBeDefined();
    act(() => focusManager.setFocused(false));
    transport.mockImplementationOnce(async () =>
      Response.json({ code: 'RATING_LINK_UNAVAILABLE' }, { status: 404 }),
    );
    act(() => focusManager.setFocused(true));
    expect(await screen.findByText(t('ar', 'publicRating.unavailable'))).toBeDefined();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('button', { name: t('ar', 'publicRating.optOut') })).toBeNull();
  },
);

it('ignores completion of an old link after navigation to a new link', async () => {
  // Regression: an old mutation must never mark a different link as submitted.
  let finishOld: (response: Response) => void = () => {
    throw new Error('No pending submission');
  };
  const { transport } = api();
  render(<RatingPage />);
  fireEvent.click(await screen.findByRole('radio', { name: '5' }));
  transport.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finishOld = resolve;
      }),
  );
  fireEvent.click(screen.getByRole('button', { name: t('ar', 'publicRating.submit') }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', {
        name: t('ar', 'publicRating.optOut'),
      }),
    ).toHaveProperty('disabled', true),
  );
  window.history.replaceState(null, '', '/#new-link');
  fireEvent(window, new HashChangeEvent('hashchange'));
  expect(await screen.findByRole('textbox')).toHaveProperty('value', '');
  await act(async () => {
    finishOld(new Response(null, { status: 204 }));
  });
  expect(screen.getAllByRole('radio')).toHaveLength(5);
  expect(screen.queryByText(t('ar', 'publicRating.done'))).toBeNull();
});

it('shows only the business name and form, with isolated capability requests', async () => {
  const { requests } = api({
    business_name: 'Test Salon',
    state: 'open',
    customer_name: 'PRIVATE_CUSTOMER',
    phone: 'PRIVATE_PHONE',
    staff: 'PRIVATE_STAFF',
    comment: 'PRIVATE_NOTE',
    stars: 2,
    session: 'PRIVATE_SESSION',
  });
  const { container } = render(<RatingPage />);
  expect(await screen.findByRole('heading')).toHaveProperty(
    'textContent',
    t('ar', 'publicRating.title') + ' Test Salon',
  );
  expect(screen.getAllByRole('radio')).toHaveLength(5);
  expect(screen.getByRole('textbox')).toHaveProperty('value', '');
  expect(screen.getByRole('button', { name: t('ar', 'publicRating.submit') })).toBeDefined();
  expect(screen.getByRole('button', { name: t('ar', 'publicRating.optOut') })).toBeDefined();
  expect(container.textContent).not.toMatch(/PRIVATE_|test-link/);
  expect(container.querySelector('main')?.dir).toBe('rtl');
  expect(requests[0]?.url).toBe('https://api.example.test/v1/ratings/view');
  expect(requests[0]?.credentials).toBe('omit');
  expect(requests[0]?.cache).toBe('no-store');
  expect(requests[0]?.headers.get('x-rating-token')).toBe('test-link');
  expect(requests[0]?.headers.has('x-company-id')).toBe(false);
});

it('submits once, replaces the form with completion, and permits opt-out afterward', async () => {
  const { requests } = api();
  render(<RatingPage />);
  fireEvent.click(await screen.findByRole('radio', { name: '5' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Nice < 3 & > 1' } });
  fireEvent.click(screen.getByRole('button', { name: t('ar', 'publicRating.submit') }));
  expect(await screen.findByText(t('ar', 'publicRating.done'))).toBeDefined();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByText('Nice < 3 & > 1')).toBeNull();
  const submitted = requests.find((request) => request.url.endsWith('/submit'));
  expect(await submitted?.json()).toEqual({ stars: 5, comment: 'Nice < 3 & > 1' });
  fireEvent.click(screen.getByRole('button', { name: t('ar', 'publicRating.optOut') }));
  expect(await screen.findByText(t('ar', 'publicRating.optedOut'))).toBeDefined();
  expect(screen.getByText(t('ar', 'publicRating.done'))).toBeDefined();
});

it('reopens a consumed link with completion and opt-out but no form', async () => {
  api({ business_name: 'Test Salon', state: 'submitted' });
  render(<RatingPage />);
  expect(await screen.findByText(t('ar', 'publicRating.done'))).toBeDefined();
  expect(screen.queryByRole('radio')).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.getByRole('button', { name: t('ar', 'publicRating.optOut') })).toBeDefined();
});

it.each([404, 429, 503])('shows a private, generic state for HTTP %s', async (status) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json(
        {
          code: status === 404 ? 'RATING_LINK_UNAVAILABLE' : 'NOT_READY',
          message_ar: 'PRIVATE_SERVER_MESSAGE',
          details: { customer: 'PRIVATE_CUSTOMER' },
        },
        { status },
      ),
    ),
  );
  const { container } = render(<RatingPage />);
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    status === 404 ? t('ar', 'publicRating.unavailable') : t('ar', 'publicRating.error'),
  );
  expect(screen.queryByRole('heading')).toBeNull();
  expect(screen.queryByRole('radio')).toBeNull();
  expect(container.textContent).not.toContain('PRIVATE_');
});

it('renders English LTR and recovers from a network failure', async () => {
  const { transport } = api();
  transport.mockRejectedValueOnce(new TypeError('PRIVATE_NETWORK_DETAIL'));
  render(<RatingPage />);
  expect(await screen.findByRole('alert')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'English' }));
  expect(screen.getByRole('main').dir).toBe('ltr');
  expect(screen.getByRole('alert').textContent).toBe('Something went wrong. Please try again.');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('heading')).toHaveProperty(
    'textContent',
    'Rate your visit to Test Salon',
  );
  expect(document.documentElement.lang).toBe('en');
});

it('keeps rating available after opt-out and hides an expired link on a write', async () => {
  const { transport } = api();
  render(<RatingPage />);
  fireEvent.click(await screen.findByRole('button', { name: t('ar', 'publicRating.optOut') }));
  expect(await screen.findByText(t('ar', 'publicRating.optedOut'))).toBeDefined();
  expect(screen.getAllByRole('radio')).toHaveLength(5);
  transport.mockImplementationOnce(async () =>
    Response.json({ code: 'RATING_LINK_UNAVAILABLE' }, { status: 404 }),
  );
  fireEvent.click(screen.getByRole('radio', { name: '4' }));
  fireEvent.click(screen.getByRole('button', { name: t('ar', 'publicRating.submit') }));
  expect(await screen.findByText(t('ar', 'publicRating.unavailable'))).toBeDefined();
  expect(screen.queryByRole('heading')).toBeNull();
});

it('rejects invalid input visibly without submitting', async () => {
  const { requests } = api();
  render(<RatingPage />);
  fireEvent.click(await screen.findByRole('button', { name: t('ar', 'publicRating.submit') }));
  expect(await screen.findByRole('alert')).toBeDefined();
  expect(requests.filter((request) => request.method === 'POST')).toHaveLength(0);
  expect(screen.getAllByRole('radio')).toHaveLength(5);
});

it('does not reuse a business name when navigating to another link', async () => {
  const { transport } = api();
  const { container } = render(<RatingPage />);
  await screen.findByRole('heading');
  transport.mockImplementationOnce(async () =>
    Response.json({ code: 'RATING_LINK_UNAVAILABLE' }, { status: 404 }),
  );
  window.history.replaceState(null, '', '/#another-test-link');
  fireEvent(window, new HashChangeEvent('hashchange'));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toBe(t('ar', 'publicRating.unavailable')),
  );
  expect(container.textContent).not.toContain('Test Salon');
});
