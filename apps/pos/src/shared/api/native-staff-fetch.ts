import { apiOrigin } from './origin';

// الـ web view على iOS مابيبعتش كوكي مضيف الـ API من `capacitor://localhost` والمتصفح بيسقط `Origin`، فالطلبات دي بتعدي أصلية.
export async function nativeStaffFetch(request: Request): Promise<Response> {
  if (!request.url.startsWith(`${apiOrigin()}/`)) throw new Error('NATIVE_FETCH_FOREIGN_URL');

  const headers = {
    ...Object.fromEntries(request.headers.entries()),
    Origin: 'capacitor://localhost',
  };
  const body = request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text();
  const { CapacitorHttp } = await import('@capacitor/core');
  const nativeResponse = await CapacitorHttp.request({
    url: request.url,
    method: request.method,
    headers,
    ...(body === '' ? {} : { data: body }),
    disableRedirects: true,
    connectTimeout: 15000,
    readTimeout: 15000,
    responseType: 'text',
  });
  const responseHeaders = Object.fromEntries(
    Object.entries(nativeResponse.headers).filter(([name]) => name.toLowerCase() !== 'set-cookie'),
  );
  const empty = request.method === 'HEAD' || [204, 205, 304].includes(nativeResponse.status);
  const responseBody = empty
    ? null
    : typeof nativeResponse.data === 'string'
      ? nativeResponse.data
      : JSON.stringify(nativeResponse.data);
  return new Response(responseBody, { status: nativeResponse.status, headers: responseHeaders });
}
