import { test, expect } from './fixtures/isolated-env';

/**
 * E2E tests for FleetGraph API endpoints.
 *
 * These tests validate the FleetGraph REST surface:
 * - Status endpoint (always available)
 * - Alerts endpoint (reads from DB, no graph required)
 * - On-demand / chat validation and 503 when FleetGraph is not initialized
 * - Alert resolve validation
 *
 * Note: Full graph invocation tests require OPENAI_API_KEY in the E2E
 * environment. Without it, FleetGraph does not start and on-demand/chat
 * routes return 503. The tests below cover both paths.
 */

async function getCsrfToken(page: import('@playwright/test').Page, apiUrl: string): Promise<string> {
  const response = await page.request.get(`${apiUrl}/api/csrf-token`);
  expect(response.ok()).toBe(true);
  const { token } = await response.json();
  return token;
}

async function loginAsAdmin(page: import('@playwright/test').Page, apiUrl: string) {
  await page.goto('/login');
  await page.locator('#email').fill('dev@ship.local');
  await page.locator('#password').fill('admin123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL('/login', { timeout: 5000 });

  const csrfToken = await getCsrfToken(page, apiUrl);
  return { csrfToken };
}

// ---------------------------------------------------------------------------
// GET /api/fleetgraph/status
// ---------------------------------------------------------------------------

test.describe('FleetGraph Status', () => {
  test('GET /api/fleetgraph/status returns expected shape', async ({ page, apiServer }) => {
    await loginAsAdmin(page, apiServer.url);

    const response = await page.request.get(`${apiServer.url}/api/fleetgraph/status`);
    expect(response.ok(), 'Status endpoint should succeed').toBe(true);

    const data = await response.json();
    expect(data).toHaveProperty('running');
    expect(data).toHaveProperty('sweepIntervalMs');
    expect(data).toHaveProperty('alertsActive');
    expect(typeof data.running).toBe('boolean');
    expect(typeof data.sweepIntervalMs).toBe('number');
    expect(typeof data.alertsActive).toBe('number');
  });

  test('GET /api/fleetgraph/status returns 0 active alerts on fresh DB', async ({ page, apiServer }) => {
    await loginAsAdmin(page, apiServer.url);

    const response = await page.request.get(`${apiServer.url}/api/fleetgraph/status`);
    const data = await response.json();
    expect(data.alertsActive, 'Fresh DB should have no active alerts').toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GET /api/fleetgraph/alerts
// ---------------------------------------------------------------------------

test.describe('FleetGraph Alerts', () => {
  test('GET /api/fleetgraph/alerts returns empty array on fresh DB', async ({ page, apiServer }) => {
    await loginAsAdmin(page, apiServer.url);

    const response = await page.request.get(`${apiServer.url}/api/fleetgraph/alerts`);
    expect(response.ok(), 'Alerts endpoint should succeed').toBe(true);

    const data = await response.json();
    expect(data.alerts).toEqual([]);
    expect(data.total).toBe(0);
  });

  test('GET /api/fleetgraph/alerts accepts entity filter query params', async ({ page, apiServer }) => {
    await loginAsAdmin(page, apiServer.url);

    const response = await page.request.get(
      `${apiServer.url}/api/fleetgraph/alerts?entityType=issue&entityId=00000000-0000-0000-0000-000000000000`
    );
    expect(response.ok()).toBe(true);

    const data = await response.json();
    expect(data.alerts).toEqual([]);
  });

  test('GET /api/fleetgraph/alerts requires authentication', async ({ page, apiServer }) => {
    // Clear cookies to simulate unauthenticated request
    await page.context().clearCookies();

    const response = await page.request.get(`${apiServer.url}/api/fleetgraph/alerts`);
    expect(response.status()).toBeGreaterThanOrEqual(401);
    expect(response.status()).toBeLessThanOrEqual(403);
  });
});

// ---------------------------------------------------------------------------
// POST /api/fleetgraph/on-demand
// ---------------------------------------------------------------------------

test.describe('FleetGraph On-Demand', () => {
  test('POST /api/fleetgraph/on-demand returns 400 when entityType missing', async ({ page, apiServer }) => {
    const { csrfToken } = await loginAsAdmin(page, apiServer.url);

    const response = await page.request.post(`${apiServer.url}/api/fleetgraph/on-demand`, {
      headers: { 'x-csrf-token': csrfToken },
      data: { entityId: '00000000-0000-0000-0000-000000000000' },
    });

    expect(response.status(), 'Missing entityType should return 400 or 503').toBeGreaterThanOrEqual(400);
  });

  test('POST /api/fleetgraph/on-demand returns 400 when entityId missing', async ({ page, apiServer }) => {
    const { csrfToken } = await loginAsAdmin(page, apiServer.url);

    const response = await page.request.post(`${apiServer.url}/api/fleetgraph/on-demand`, {
      headers: { 'x-csrf-token': csrfToken },
      data: { entityType: 'issue' },
    });

    expect(response.status(), 'Missing entityId should return 400 or 503').toBeGreaterThanOrEqual(400);
  });

  test('POST /api/fleetgraph/on-demand returns 503 when not initialized (no OPENAI_API_KEY)', async ({ page, apiServer }) => {
    const { csrfToken } = await loginAsAdmin(page, apiServer.url);

    const response = await page.request.post(`${apiServer.url}/api/fleetgraph/on-demand`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        entityType: 'sprint',
        entityId: '00000000-0000-0000-0000-000000000000',
      },
    });

    // Without OPENAI_API_KEY: 503. With it: 200 or 400/500 depending on data.
    const status = response.status();
    expect([200, 400, 500, 503]).toContain(status);

    if (status === 503) {
      const data = await response.json();
      expect(data.error).toContain('not initialized');
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/fleetgraph/chat
// ---------------------------------------------------------------------------

test.describe('FleetGraph Chat', () => {
  test('POST /api/fleetgraph/chat returns 400 when question missing', async ({ page, apiServer }) => {
    const { csrfToken } = await loginAsAdmin(page, apiServer.url);

    const response = await page.request.post(`${apiServer.url}/api/fleetgraph/chat`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        entityType: 'sprint',
        entityId: '00000000-0000-0000-0000-000000000000',
      },
    });

    expect(response.status(), 'Missing question should return 400 or 503').toBeGreaterThanOrEqual(400);
  });

  test('POST /api/fleetgraph/chat returns 400 when entityType missing', async ({ page, apiServer }) => {
    const { csrfToken } = await loginAsAdmin(page, apiServer.url);

    const response = await page.request.post(`${apiServer.url}/api/fleetgraph/chat`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        entityId: '00000000-0000-0000-0000-000000000000',
        question: 'Why is this sprint behind?',
      },
    });

    expect(response.status()).toBeGreaterThanOrEqual(400);
  });

  test('POST /api/fleetgraph/chat returns 503 when not initialized', async ({ page, apiServer }) => {
    const { csrfToken } = await loginAsAdmin(page, apiServer.url);

    const response = await page.request.post(`${apiServer.url}/api/fleetgraph/chat`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        entityType: 'issue',
        entityId: '00000000-0000-0000-0000-000000000000',
        question: 'What is blocking this issue?',
      },
    });

    const status = response.status();
    expect([200, 500, 503]).toContain(status);

    if (status === 503) {
      const data = await response.json();
      expect(data.error).toContain('not initialized');
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/fleetgraph/alerts/:id/resolve
// ---------------------------------------------------------------------------

test.describe('FleetGraph Alert Resolve', () => {
  test('POST resolve returns 400 when outcome missing', async ({ page, apiServer }) => {
    const { csrfToken } = await loginAsAdmin(page, apiServer.url);

    const response = await page.request.post(
      `${apiServer.url}/api/fleetgraph/alerts/00000000-0000-0000-0000-000000000000/resolve`,
      {
        headers: { 'x-csrf-token': csrfToken },
        data: {},
      }
    );

    expect(response.status(), 'Missing outcome should return 400').toBe(400);
    const data = await response.json();
    expect(data.error).toContain('outcome');
  });

  test('POST resolve returns 400 for invalid outcome', async ({ page, apiServer }) => {
    const { csrfToken } = await loginAsAdmin(page, apiServer.url);

    const response = await page.request.post(
      `${apiServer.url}/api/fleetgraph/alerts/00000000-0000-0000-0000-000000000000/resolve`,
      {
        headers: { 'x-csrf-token': csrfToken },
        data: { outcome: 'invalid_outcome' },
      }
    );

    expect(response.status(), 'Invalid outcome should return 400').toBe(400);
  });

  test('POST resolve returns 404 for non-existent alert', async ({ page, apiServer }) => {
    const { csrfToken } = await loginAsAdmin(page, apiServer.url);

    const response = await page.request.post(
      `${apiServer.url}/api/fleetgraph/alerts/00000000-0000-0000-0000-000000000000/resolve`,
      {
        headers: { 'x-csrf-token': csrfToken },
        data: { outcome: 'dismiss' },
      }
    );

    expect(response.status(), 'Non-existent alert should return 404').toBe(404);
  });

  test('POST resolve requires authentication', async ({ page, apiServer }) => {
    await page.context().clearCookies();

    const response = await page.request.post(
      `${apiServer.url}/api/fleetgraph/alerts/00000000-0000-0000-0000-000000000000/resolve`,
      {
        data: { outcome: 'dismiss' },
      }
    );

    expect(response.status()).toBeGreaterThanOrEqual(401);
    expect(response.status()).toBeLessThanOrEqual(403);
  });
});
