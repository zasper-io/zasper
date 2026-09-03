import { BaseApiUrl } from '@/config';

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** Thrown whenever the server answers with a non-2xx status. */
export class ApiError extends Error {
  readonly status: number;
  /** Raw response body, useful because the server reports errors as JSON or plain text. */
  readonly body: string;

  constructor(method: Method, path: string, status: number, body: string) {
    super(`${method} ${path} failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export interface RequestOptions {
  method?: Method;
  /** Sent as JSON, except for FormData which is passed through untouched. */
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

function buildUrl(path: string, query: RequestOptions['query']): string {
  if (query === undefined) {
    return BaseApiUrl + path;
  }
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  });
  const search = params.toString();
  return search === '' ? BaseApiUrl + path : `${BaseApiUrl}${path}?${search}`;
}

function buildHeaders(body: unknown): Record<string, string> {
  const headers: Record<string, string> = {};
  // FormData needs the browser-generated Content-Type so the multipart boundary
  // survives; setting it by hand breaks the server's form parser.
  if (!(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const token = localStorage.getItem('token');
  if (token !== null) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function request(path: string, options: RequestOptions = {}): Promise<Response> {
  const { method = 'GET', body, query } = options;

  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
  }

  const res = await fetch(buildUrl(path, query), {
    method,
    headers: buildHeaders(body),
    body: payload,
  });

  if (!res.ok) {
    const details = await res.text().catch(() => '');
    throw new ApiError(method, path, res.status, details);
  }

  return res;
}

export async function requestJson<T>(path: string, options?: RequestOptions): Promise<T> {
  const res = await request(path, options);
  return (await res.json()) as T;
}

export async function requestText(path: string, options?: RequestOptions): Promise<string> {
  const res = await request(path, options);
  return res.text();
}

export async function requestEmpty(path: string, options?: RequestOptions): Promise<void> {
  await request(path, options);
}

/**
 * The response body as bytes, for a download. It goes through fetch like everything else rather than
 * being handed to the browser as a link, because a link cannot carry the Authorization header a
 * protected server requires.
 */
export async function requestBlob(path: string, options?: RequestOptions): Promise<Blob> {
  const res = await request(path, options);
  return res.blob();
}

export interface UploadOptions {
  body: FormData;
  /** How much of the body has gone out, from 0 to 1. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/**
 * A multipart POST that reports how far it has got. XMLHttpRequest rather than fetch, which has no
 * upload progress event at all: without one, a large upload is a spinner with nothing behind it.
 */
export function requestUpload<T>(path: string, options: UploadOptions): Promise<T> {
  const { body, onProgress, signal } = options;

  return new Promise<T>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', buildUrl(path, undefined));

    const token = localStorage.getItem('token');
    if (token !== null) {
      request.setRequestHeader('Authorization', `Bearer ${token}`);
    }
    // Content-Type is left to the browser, which is the only thing that knows the multipart boundary.

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress !== undefined) {
        onProgress(event.loaded / event.total);
      }
    });
    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        resolve(JSON.parse(request.responseText) as T);
      } else {
        reject(new ApiError('POST', path, request.status, request.responseText));
      }
    });
    request.addEventListener('error', () => {
      // No status and no body: the request never reached a server that could give either.
      reject(new ApiError('POST', path, 0, 'The server could not be reached.'));
    });
    request.addEventListener('abort', () => {
      reject(new DOMException('The upload was cancelled.', 'AbortError'));
    });
    signal?.addEventListener('abort', () => request.abort());

    request.send(body);
  });
}

/**
 * The most specific explanation a failed request carries, for the places that show one to the user.
 * `ApiError.message` is only a status line; the server puts the reason in a JSON `message` field.
 */
export function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    try {
      const parsed = JSON.parse(error.body) as { message?: unknown };
      if (typeof parsed.message === 'string' && parsed.message !== '') {
        return parsed.message;
      }
    } catch {
      // Not JSON. The raw body, when there is one, still says more than the status line.
    }
    return error.body === '' ? error.message : error.body;
  }
  return error instanceof Error ? error.message : 'An unknown error occurred';
}

/**
 * Reports a rejected request without propagating it, for the calls whose result
 * the UI does not act on.
 */
export function logApiError(message: string): (error: unknown) => void {
  return (error: unknown) => {
    console.error(message, error);
  };
}
