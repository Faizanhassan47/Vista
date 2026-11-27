import { getDeviceHeaders } from './services/deviceService';

function cookieValue(name) {
  const prefix = `${encodeURIComponent(name)}=`;
  const entry = document.cookie.split('; ').find((item) => item.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : '';
}

export async function apiFetch(url, options = {}, hasRetriedCsrf = false) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  const deviceHeaders = getDeviceHeaders();
  if (deviceHeaders['X-Device-Location'] && !headers.has('X-Device-Location')) {
    headers.set('X-Device-Location', deviceHeaders['X-Device-Location']);
  }
  if (deviceHeaders['X-Device-Name'] && !headers.has('X-Device-Name')) {
    headers.set('X-Device-Name', deviceHeaders['X-Device-Name']);
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrfToken = cookieValue('csrf_token');
    if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
  }
  const response = await fetch(url, { ...options, method, headers, credentials: 'include' });
  if (options.signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }
  if (response.status === 403 && !hasRetriedCsrf && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const payload = await response.clone().json().catch(() => null);
    if (payload?.detail === 'Invalid CSRF token') {
      const apiPrefix = url.includes('/api/') ? url.slice(0, url.indexOf('/api/')) : '';
      const refreshResponse = await fetch(`${apiPrefix}/api/auth/me`, {
        credentials: 'include',
        signal: options.signal,
      });
      if (refreshResponse.ok) return apiFetch(url, options, true);
    }
  }
  if (response.status === 401) {
    const isLoginEndpoint = url.includes('/api/auth/login');
    if (!isLoginEndpoint) {
      window.dispatchEvent(new CustomEvent('auth:unauthorized', {
        detail: { url, status: response.status },
      }));
    }
  }
  return response;
}
