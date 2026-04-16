import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';

describe('API docs and CSRF bootstrap', () => {
  afterEach(() => {
    process.env.NODE_ENV = 'test';
    delete process.env.APP_BASE_URL;
    delete process.env.PUBLIC_HOST;
  });

  it('serves OpenAPI with accurate API token auth contracts', async () => {
    const app = createApp();

    const response = await request(app).get('/api/openapi.json');

    expect(response.status).toBe(200);
    expect(response.body.components.securitySchemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
    expect(response.body.components.securitySchemes.cookieAuth.name).toBe('session_id');
    expect(response.body.info.description).toContain('/api/openapi.json');

    const apiTokenSchema = response.body.components.schemas.APIToken;
    expect(apiTokenSchema.properties.token_prefix).toBeDefined();
    expect(apiTokenSchema.properties.prefix).toBeUndefined();
    expect(apiTokenSchema.properties.is_active).toBeDefined();
    expect(apiTokenSchema.properties.revoked_at).toBeDefined();

    const createResponse =
      response.body.paths['/api-tokens'].post.responses['201'].content['application/json'].schema;
    expect(createResponse.$ref).toBe('#/components/schemas/CreateAPITokenRouteResponse');

    const deleteResponses = response.body.paths['/api-tokens/{id}'].delete.responses;
    expect(deleteResponses['200']).toBeDefined();
    expect(deleteResponses['204']).toBeUndefined();
  });

  it('sets a secure CSRF session cookie behind the configured HTTPS production host', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SESSION_SECRET = 'test-session-secret';
    process.env.APP_BASE_URL = 'https://ship.maxpetrusenko.com';

    const app = createApp('https://ship.maxpetrusenko.com');

    const response = await request(app)
      .get('/api/csrf-token')
      .set('Host', 'ship.maxpetrusenko.com');
    const setCookie = response.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie].filter(Boolean);

    expect(response.status).toBe(200);
    expect(response.body.token).toEqual(expect.any(String));
    expect(cookies).toEqual(
      expect.arrayContaining([
        expect.stringContaining('connect.sid='),
      ]),
    );
    expect(cookies[0]).toContain('Secure');
  });

  it('returns JSON for invalid CSRF tokens', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'dev@ship.local', password: 'admin123' });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'CSRF_ERROR',
        message: 'Invalid CSRF token',
      },
    });
  });
});
