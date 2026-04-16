/**
 * Authentication schemas - Login, session, and API tokens
 */

import { z, registry } from '../registry.js';
import { UuidSchema, DateTimeSchema } from './common.js';

// ============== Login ==============

export const LoginRequestSchema = z.object({
  email: z.string().email().openapi({
    description: 'User email address',
    example: 'user@example.com',
  }),
  password: z.string().min(1).openapi({
    description: 'User password',
  }),
}).openapi('LoginRequest');

registry.register('LoginRequest', LoginRequestSchema);

export const LoginResponseSchema = z.object({
  user: z.object({
    id: UuidSchema,
    email: z.string().email(),
    name: z.string(),
    is_admin: z.boolean().optional(),
  }),
  workspace: z.object({
    id: UuidSchema,
    name: z.string(),
    slug: z.string(),
  }).nullable().optional(),
}).openapi('LoginResponse');

registry.register('LoginResponse', LoginResponseSchema);

// ============== Session ==============

export const SessionResponseSchema = z.object({
  user: z.object({
    id: UuidSchema,
    email: z.string().email(),
    name: z.string(),
    is_admin: z.boolean().optional(),
  }),
  workspace: z.object({
    id: UuidSchema,
    name: z.string(),
    slug: z.string(),
    person_id: UuidSchema.optional().openapi({
      description: 'Person document ID for current user',
    }),
    role: z.string().optional(),
  }).nullable(),
}).openapi('SessionResponse');

registry.register('SessionResponse', SessionResponseSchema);

// ============== API Token ==============

export const APITokenSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  token_prefix: z.string().openapi({
    description: 'Token prefix for identification (first 12 chars)',
    example: 'ship_abc1234',
  }),
  last_used_at: DateTimeSchema.nullable(),
  expires_at: DateTimeSchema.nullable(),
  is_active: z.boolean().openapi({
    description: 'True when the token is not revoked and not expired',
  }),
  revoked_at: DateTimeSchema.nullable(),
  created_at: DateTimeSchema,
}).openapi('APIToken');

registry.register('APIToken', APITokenSchema);

export const CreateAPITokenSchema = z.object({
  name: z.string().min(1).max(100).openapi({
    description: 'Descriptive name for the token',
    example: 'CI/CD Pipeline',
  }),
  expires_in_days: z.number().int().min(1).max(365).optional().openapi({
    description: 'Days until token expires (default: never)',
  }),
}).openapi('CreateAPIToken');

registry.register('CreateAPIToken', CreateAPITokenSchema);

export const CreateAPITokenResponseSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  token: z.string().openapi({
    description: 'Full token value. Only shown once at creation time.',
    example: 'ship_abc123xyz789...',
  }),
  token_prefix: z.string().openapi({
    description: 'Token prefix for identification (first 12 chars)',
    example: 'ship_abc1234',
  }),
  expires_at: DateTimeSchema.nullable(),
  created_at: DateTimeSchema,
  warning: z.string().openapi({
    example: 'Save this token now. It will not be shown again.',
  }),
}).openapi('CreateAPITokenResponse');

registry.register('CreateAPITokenResponse', CreateAPITokenResponseSchema);

const APITokenListResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(APITokenSchema),
}).openapi('APITokenListResponse');

registry.register('APITokenListResponse', APITokenListResponseSchema);

const CreateAPITokenRouteResponseSchema = z.object({
  success: z.literal(true),
  data: CreateAPITokenResponseSchema,
}).openapi('CreateAPITokenRouteResponse');

registry.register('CreateAPITokenRouteResponse', CreateAPITokenRouteResponseSchema);

const RevokeAPITokenResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    message: z.literal('API token revoked'),
  }),
}).openapi('RevokeAPITokenResponse');

registry.register('RevokeAPITokenResponse', RevokeAPITokenResponseSchema);

// ============== Register Auth Endpoints ==============

registry.registerPath({
  method: 'post',
  path: '/auth/login',
  tags: ['Authentication'],
  summary: 'Login',
  description: 'Authenticate with email and password. Sets a session cookie on success.',
  security: [], // No auth required for login
  request: {
    body: {
      content: {
        'application/json': {
          schema: LoginRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Login successful',
      content: {
        'application/json': {
          schema: LoginResponseSchema,
        },
      },
    },
    401: {
      description: 'Invalid credentials',
      content: {
        'application/json': {
          schema: z.object({ error: z.literal('Invalid credentials') }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/auth/logout',
  tags: ['Authentication'],
  summary: 'Logout',
  description: 'End the current session and clear the session cookie.',
  responses: {
    200: {
      description: 'Logout successful',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true) }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/auth/session',
  tags: ['Authentication'],
  summary: 'Get current session',
  description: 'Get information about the current authenticated user and workspace.',
  responses: {
    200: {
      description: 'Session information',
      content: {
        'application/json': {
          schema: SessionResponseSchema,
        },
      },
    },
    401: {
      description: 'Not authenticated',
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api-tokens',
  tags: ['API Tokens'],
  summary: 'List API tokens',
  description: 'List all API tokens for the current user.',
  responses: {
    200: {
      description: 'List of API tokens',
      content: {
        'application/json': {
          schema: APITokenListResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api-tokens',
  tags: ['API Tokens'],
  summary: 'Create API token',
  description: 'Create a new API token. The full token is only returned once at creation.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateAPITokenSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Created API token',
      content: {
        'application/json': {
          schema: CreateAPITokenRouteResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api-tokens/{id}',
  tags: ['API Tokens'],
  summary: 'Delete API token',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
  },
  responses: {
    200: {
      description: 'Token revoked',
      content: {
        'application/json': {
          schema: RevokeAPITokenResponseSchema,
        },
      },
    },
    404: {
      description: 'Token not found',
    },
  },
});
