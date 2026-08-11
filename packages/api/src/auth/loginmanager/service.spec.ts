import { generateKeyPairSync } from 'crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import type { Express } from 'express';
import type { SuperAgentTest } from 'supertest';
import type {
  LoginManagerDependencies,
  LoginManagerStore,
  LoginManagerUser,
  LoginManagerUserQuery,
  LoginManagerUserUpdate,
} from './types';
import { createLoginManagerHandlers } from './service';

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const issuer = 'https://issuer.example.com';
const audience = 'cortex';
const envNames = [
  'DOMAIN_CLIENT',
  'DOMAIN_SERVER',
  'LOGIN_MANAGER_ENABLED',
  'LOGIN_MANAGER_BASE_URL',
  'LOGIN_MANAGER_CALLBACK_URL',
  'LOGIN_MANAGER_REFRESH_URL',
  'LOGIN_MANAGER_REDIRECT_URL',
  'LOGIN_MANAGER_SUCCESS_REDIRECT_URL',
  'LOGIN_MANAGER_PUBLIC_KEY_B64',
  'LOGIN_MANAGER_TOKEN_ENCRYPTION_KEY_B64',
  'LOGIN_MANAGER_EXPECTED_ISS',
  'LOGIN_MANAGER_EXPECTED_AUD',
  'LOGIN_MANAGER_FLOW',
] as const;
const originalEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));

class MemoryStore implements LoginManagerStore {
  readonly values = new Map<string, object>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async set(key: string, value: object): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

interface Harness {
  app: Express;
  store: MemoryStore;
  users: LoginManagerUser[];
  createUser: jest.Mock;
  updateUser: jest.Mock;
  invalidateUserCache: jest.Mock;
  issueAuthTokens: jest.Mock;
  clearAuthSession: jest.Mock;
  fetchMock: jest.MockedFunction<typeof fetch>;
  twoRefreshRequestsStarted: Promise<void>;
}

function configureEnvironment(): void {
  process.env.DOMAIN_SERVER = 'http://localhost:3000';
  process.env.DOMAIN_CLIENT = 'http://localhost:5174';
  process.env.LOGIN_MANAGER_ENABLED = 'true';
  process.env.LOGIN_MANAGER_BASE_URL = 'https://auth.example.com';
  process.env.LOGIN_MANAGER_CALLBACK_URL = 'https://auth.example.com/api/v1/user/jwt_callback';
  process.env.LOGIN_MANAGER_REFRESH_URL = 'https://auth.example.com/api/v1/jwt/refresh';
  process.env.LOGIN_MANAGER_REDIRECT_URL = 'http://localhost:5174';
  process.env.LOGIN_MANAGER_SUCCESS_REDIRECT_URL = 'http://localhost:5174/c/new';
  process.env.LOGIN_MANAGER_PUBLIC_KEY_B64 = Buffer.from(
    rsa.publicKey.export({ type: 'spki', format: 'pem' }),
  ).toString('base64');
  process.env.LOGIN_MANAGER_TOKEN_ENCRYPTION_KEY_B64 = Buffer.alloc(32, 7).toString('base64');
  process.env.LOGIN_MANAGER_EXPECTED_ISS = issuer;
  process.env.LOGIN_MANAGER_EXPECTED_AUD = audience;
  process.env.LOGIN_MANAGER_FLOW = 'standard';
}

function claims(jti: string, overrides: Record<string, string | number | boolean | string[]> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: issuer,
    aud: audience,
    iat: now,
    nbf: now - 1,
    exp: now + 3_600,
    jti,
    sub: 'cognito-sub-1',
    email: 'person@example.com',
    email_verified: true,
    flow: 'standard',
    type: 'access',
    token_use: 'id',
    given_name: 'RSAWEB',
    family_name: 'Person',
    'cognito:username': 'person',
    'cognito:groups': ['ordinary-group'],
    'custom:tenant_id': 'tenant-1',
    'custom:company_id': 'company-1',
    'custom:users_id': 'rsaweb-user-1',
    ...overrides,
  };
}

function sign(jti: string, overrides: Record<string, string | number | boolean | string[]> = {}) {
  return jwt.sign(claims(jti, overrides), rsa.privateKey, {
    algorithm: 'RS256',
  });
}

function matches(user: LoginManagerUser, query: LoginManagerUserQuery): boolean {
  return (Object.keys(query) as Array<keyof LoginManagerUserQuery>).every(
    (field) => query[field] === undefined || user[field] === query[field],
  );
}

function createHarness(initialUsers: LoginManagerUser[] = []): Harness {
  const store = new MemoryStore();
  const users = [...initialUsers];
  const createUser = jest.fn(async (user: LoginManagerUser) => {
    const created = { ...user, _id: `user-${users.length + 1}`, id: `user-${users.length + 1}` };
    users.push(created);
    return created;
  });
  const updateUser = jest.fn(async (id: string, update: LoginManagerUserUpdate) => {
    const index = users.findIndex((user) => (user.id ?? user._id) === id);
    if (index < 0) {
      return null;
    }
    users[index] = { ...users[index], ...update };
    return users[index];
  });
  const invalidateUserCache = jest.fn(async () => undefined);
  const issueAuthTokens = jest.fn(async () => 'cortex-access-token');
  const clearAuthSession = jest.fn(async () => undefined);
  const fetchMock = jest.fn<typeof fetch>();
  const deps: LoginManagerDependencies = {
    store,
    findUser: async (query) => users.find((user) => matches(user, query)) ?? null,
    getUserById: async (id) => users.find((user) => String(user.id ?? user._id) === id) ?? null,
    createUser,
    updateUser,
    invalidateUserCache,
    issueAuthTokens,
    clearAuthSession,
    fetch: fetchMock,
  };
  const handlers = createLoginManagerHandlers(deps);
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  let refreshRequestCount = 0;
  let markTwoRefreshRequestsStarted = (): void => undefined;
  const twoRefreshRequestsStarted = new Promise<void>((resolve) => {
    markTwoRefreshRequestsStarted = resolve;
  });
  app.get('/api/auth/login-manager/start', handlers.start);
  app.get('/api/auth/login-manager/callback', handlers.callback);
  app.post('/api/auth/login-manager/callback', handlers.callback);
  app.post('/api/auth/refresh', (req, res) => {
    refreshRequestCount += 1;
    if (refreshRequestCount === 2) {
      markTwoRefreshRequestsStarted();
    }
    return handlers.refresh(req, res);
  });
  app.post('/api/auth/logout', handlers.logout);
  return {
    app,
    store,
    users,
    createUser,
    updateUser,
    invalidateUserCache,
    issueAuthTokens,
    clearAuthSession,
    fetchMock,
    twoRefreshRequestsStarted,
  };
}

async function start(agent: SuperAgentTest): Promise<void> {
  const response = await agent.get('/api/auth/login-manager/start');
  expect(response.status).toBe(302);
  const location = new URL(response.headers.location);
  expect(location.origin).toBe('https://auth.example.com');
  expect(location.searchParams.get('callback')).toBe(
    'https://auth.example.com/api/v1/user/jwt_callback',
  );
  expect(location.searchParams.get('redirect')).toBe('http://localhost:5174');
  expect(location.searchParams.has('state')).toBe(false);
}

async function login(agent: SuperAgentTest, jti: string): Promise<request.Response> {
  await start(agent);
  return await agent
    .post('/api/auth/login-manager/callback')
    .type('form')
    .send({
      jwt: sign(jti),
      refresh: sign(`${jti}-refresh`, { type: 'refresh' }),
    });
}

beforeEach(() => {
  configureEnvironment();
});

afterAll(() => {
  for (const name of envNames) {
    const value = originalEnv[name];
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe('Login Manager browser flow', () => {
  it('creates a user, invalidates the auth user cache, and redirects without tokens', async () => {
    const harness = createHarness();
    const response = await login(request.agent(harness.app), 'new-user');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('http://localhost:5174/c/new');
    expect(response.headers.location).not.toContain('jwt=');
    expect(response.headers.location).not.toContain('refresh=');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(harness.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'person@example.com',
        loginManagerId: 'rsaweb-user-1',
        provider: 'login-manager',
        role: 'USER',
      }),
    );
    expect(harness.invalidateUserCache).toHaveBeenCalledWith('user-1');
    expect(harness.issueAuthTokens).toHaveBeenCalledTimes(1);
  });

  it('logs in an existing identity without creating or elevating it', async () => {
    const existing: LoginManagerUser = {
      _id: 'existing-user',
      id: 'existing-user',
      name: 'RSAWEB Person',
      username: 'person',
      email: 'person@example.com',
      emailVerified: true,
      provider: 'login-manager',
      role: 'USER',
      tenantId: 'tenant-1',
      loginManagerId: 'rsaweb-user-1',
      loginManagerIssuer: issuer,
      loginManagerCompanyId: 'company-1',
      loginManagerGroups: ['ordinary-group'],
    };
    const harness = createHarness([existing]);
    const response = await login(request.agent(harness.app), 'existing-user');

    expect(response.status).toBe(302);
    expect(harness.createUser).not.toHaveBeenCalled();
    expect(harness.updateUser).not.toHaveBeenCalled();
    expect(harness.issueAuthTokens).toHaveBeenCalledWith(
      'existing-user',
      expect.anything(),
      expect.anything(),
      false,
    );
  });

  it('links a verified existing email and invalidates its cached auth document', async () => {
    const harness = createHarness([
      {
        _id: 'local-user',
        id: 'local-user',
        email: 'person@example.com',
        provider: 'local',
        role: 'USER',
        tenantId: 'tenant-1',
      },
    ]);
    const response = await login(request.agent(harness.app), 'link-user');

    expect(response.status).toBe(302);
    expect(harness.updateUser).toHaveBeenCalledWith(
      'local-user',
      expect.objectContaining({
        loginManagerId: 'rsaweb-user-1',
        loginManagerIssuer: issuer,
        emailVerified: true,
      }),
    );
    expect(harness.invalidateUserCache).toHaveBeenCalledWith('local-user');
  });

  it.each([
    ['jwt', { refresh: sign('missing-jwt-refresh', { type: 'refresh' }) }],
    ['refresh', { jwt: sign('missing-refresh') }],
  ])('rejects a callback missing %s', async (_name, query) => {
    const harness = createHarness();
    const agent = request.agent(harness.app);
    await start(agent);
    const response = await agent.post('/api/auth/login-manager/callback').type('form').send(query);
    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('/login?error=auth_failed');
    expect(harness.issueAuthTokens).not.toHaveBeenCalled();
  });

  it('rejects oversized callback parameters', async () => {
    const harness = createHarness();
    const agent = request.agent(harness.app);
    await start(agent);
    const response = await agent
      .post('/api/auth/login-manager/callback')
      .type('form')
      .send({
        jwt: `a.${'b'.repeat(8_200)}.c`,
        refresh: sign('oversized-refresh'),
      });
    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('/login?error=auth_failed');
  });

  it('rejects a callback without the one-time state cookie', async () => {
    const harness = createHarness();
    const response = await request(harness.app)
      .post('/api/auth/login-manager/callback')
      .type('form')
      .send({ jwt: sign('no-state'), refresh: sign('no-state-refresh') });
    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('/login?error=auth_failed');
  });

  it('rejects replaying a callback JTI even with a new valid state', async () => {
    const harness = createHarness();
    const agent = request.agent(harness.app);
    expect((await login(agent, 'replay-jti')).headers.location).toBe('http://localhost:5174/c/new');
    await start(agent);
    const replay = await agent
      .post('/api/auth/login-manager/callback')
      .type('form')
      .send({
        jwt: sign('replay-jti'),
        refresh: sign('another-refresh'),
      });
    expect(replay.headers.location).toContain('/login?error=auth_failed');
    expect(harness.issueAuthTokens).toHaveBeenCalledTimes(1);
  });

  it('fails closed when disabled or misconfigured', async () => {
    const harness = createHarness();
    process.env.LOGIN_MANAGER_ENABLED = 'false';
    expect((await request(harness.app).get('/api/auth/login-manager/start')).status).toBe(503);

    process.env.LOGIN_MANAGER_ENABLED = 'true';
    delete process.env.LOGIN_MANAGER_EXPECTED_AUD;
    expect((await request(harness.app).get('/api/auth/login-manager/start')).status).toBe(503);
  });
});

describe('Login Manager refresh lifecycle', () => {
  function refreshPayload(jti: string): Response {
    return new Response(
      JSON.stringify({
        jwt: sign(jti),
        refresh: sign(`${jti}-rotated`, {
          type: 'refresh',
          exp: Math.floor(Date.now() / 1000) + 7_200,
        }),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  it('refreshes, validates, rotates the server-side token, and renews Cortex auth', async () => {
    const harness = createHarness();
    const agent = request.agent(harness.app);
    expect((await login(agent, 'refresh-login')).status).toBe(302);
    harness.fetchMock.mockResolvedValueOnce(refreshPayload('refresh-success'));

    const response = await agent.post('/api/auth/refresh');
    expect(response.status).toBe(200);
    expect(response.body.token).toBe('cortex-access-token');
    expect(response.body.user).toMatchObject({ email: 'person@example.com' });
    expect(harness.fetchMock).toHaveBeenCalledTimes(1);
    expect(harness.issueAuthTokens).toHaveBeenLastCalledWith(
      'user-1',
      expect.anything(),
      expect.anything(),
      true,
    );
    const body = JSON.parse(String(harness.fetchMock.mock.calls[0]?.[1]?.body)) as {
      token: string;
    };
    expect(jwt.decode(body.token)).toMatchObject({ jti: 'refresh-login-refresh' });
  });

  it('clears the external and Cortex sessions after definitive refresh failure', async () => {
    const harness = createHarness();
    const agent = request.agent(harness.app);
    await login(agent, 'failed-refresh-login');
    harness.fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }));

    const response = await agent.post('/api/auth/refresh');
    expect(response.status).toBe(401);
    expect(harness.clearAuthSession).toHaveBeenCalledWith('user-1', expect.anything());
    expect(
      [...harness.store.values.keys()].some((storeKey) => storeKey.startsWith('session:')),
    ).toBe(false);
  });

  it('deduplicates concurrent refresh requests for the same browser session', async () => {
    const harness = createHarness();
    const agent = request.agent(harness.app);
    const loginResponse = await login(agent, 'concurrent-login');
    const setCookies = loginResponse.headers['set-cookie'];
    if (!Array.isArray(setCookies)) {
      throw new Error('Login response did not set session cookies');
    }
    const cookieHeader = setCookies.map((cookie) => cookie.split(';')[0]).join('; ');
    let release: ((response: Response) => void) | undefined;
    let markFetchStarted = (): void => undefined;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    harness.fetchMock.mockImplementation(() => {
      markFetchStarted();
      return pending;
    });

    const first = request(harness.app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieHeader)
      .then((response) => response);
    const second = request(harness.app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieHeader)
      .then((response) => response);
    await Promise.all([fetchStarted, harness.twoRefreshRequestsStarted]);
    release?.(refreshPayload('concurrent-refresh'));
    const [firstResponse, secondResponse] = await Promise.all([first, second]);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(harness.fetchMock).toHaveBeenCalledTimes(1);
  });
});
