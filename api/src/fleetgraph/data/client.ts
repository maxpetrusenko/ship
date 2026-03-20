/**
 * Internal HTTP client for Ship API calls.
 *
 * FleetGraph runs in-process with Express, so all calls go to localhost.
 * Authenticated via a workspace-scoped API token (Bearer header).
 */

import { ShipApiError } from './types.js';

function getDefaultBaseUrl(): string {
  const port = process.env.PORT || '3000';
  return `http://localhost:${port}`;
}
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 1;

/** Status codes that trigger a retry */
function isRetryable(status: number): boolean {
  return status >= 500 && status < 600;
}

export class ShipApiClient {
  private readonly baseUrl: string;
  private readonly apiToken: string;

  constructor(
    baseUrl?: string,
    apiToken?: string,
  ) {
    this.baseUrl = (baseUrl ?? process.env.SHIP_API_BASE_URL ?? getDefaultBaseUrl()).replace(/\/$/, '');
    this.apiToken = apiToken ?? process.env.FLEETGRAPH_API_TOKEN ?? '';

    if (!this.apiToken) {
      console.warn('[ShipApiClient] FLEETGRAPH_API_TOKEN is empty; requests will likely fail auth');
    }
  }

  // ---------------------------------------------------------------------------
  // Core request method
  // ---------------------------------------------------------------------------

  /**
   * Make an authenticated GET request to a Ship API endpoint.
   *
   * Returns parsed JSON on success, `null` on 404, throws ShipApiError otherwise.
   * Retries once on 5xx responses.
   */
  async get<T>(path: string): Promise<T | null> {
    return this.request<T>('GET', path);
  }

  /**
   * Make an authenticated POST request to a Ship API endpoint.
   */
  async post<T>(path: string, body?: unknown): Promise<T | null> {
    return this.request<T>('POST', path, body);
  }

  /**
   * Make an authenticated PATCH request to a Ship API endpoint.
   */
  async patch<T>(path: string, body?: unknown): Promise<T | null> {
    return this.request<T>('PATCH', path, body);
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    attempt = 0,
  ): Promise<T | null> {
    const url = `${this.baseUrl}${path}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiToken}`,
      'Accept': 'application/json',
    };

    const init: RequestInit = {
      method,
      headers,
      signal: controller.signal,
      redirect: 'follow',
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, init);

      // 404 -> null (expected for missing entities)
      if (response.status === 404) {
        return null;
      }

      // 401 -> throw immediately (no retry)
      if (response.status === 401) {
        throw new ShipApiError(
          'Unauthorized: invalid or expired FLEETGRAPH_API_TOKEN',
          401,
          path,
        );
      }

      // 5xx -> retry once
      if (isRetryable(response.status) && attempt < MAX_RETRIES) {
        return this.request<T>(method, path, body, attempt + 1);
      }

      // Other errors
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new ShipApiError(
          `Ship API ${method} ${path} returned ${response.status}: ${text}`,
          response.status,
          path,
        );
      }

      // Success
      const json = (await response.json()) as T;
      return json;
    } catch (err: unknown) {
      // AbortError = timeout
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Retry timeout once
        if (attempt < MAX_RETRIES) {
          return this.request<T>(method, path, body, attempt + 1);
        }
        throw new ShipApiError(
          `Ship API ${method} ${path} timed out after ${REQUEST_TIMEOUT_MS}ms`,
          0,
          path,
        );
      }

      // Re-throw ShipApiError as-is
      if (err instanceof ShipApiError) {
        throw err;
      }

      // Network errors
      if (attempt < MAX_RETRIES) {
        return this.request<T>(method, path, body, attempt + 1);
      }

      throw new ShipApiError(
        `Ship API ${method} ${path} failed: ${err instanceof Error ? err.message : String(err)}`,
        0,
        path,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
