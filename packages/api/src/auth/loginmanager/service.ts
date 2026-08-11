import { SystemRoles } from 'librechat-data-provider';
import { shouldUseSecureCookie } from '~/oauth/csrf';
import type { Request, Response } from 'express';
import type {
  LoginManagerClaims,
  LoginManagerConfig,
  LoginManagerDependencies,
  LoginManagerHandlers,
  LoginManagerUser,
  LoginManagerUserQuery,
  LoginManagerUserUpdate,
} from './types';
import { LoginManagerConfigError, getLoginManagerConfig } from './config';
import {
  decryptToken,
  encryptToken,
  hashOpaqueValue,
  randomOpaqueValue,
  verifyAccessToken,
  verifyRefreshToken,
} from './crypto';

const STATE_COOKIE = 'login_manager_state';
const SESSION_COOKIE = 'login_manager_session';
const PROVIDER_COOKIE = 'token_provider';
const PROVIDER = 'login-manager';
const AUTH_FAILED = 'auth_failed';
const ATTEMPT_TTL_MS = 10 * 60 * 1000;
const REFRESH_TIMEOUT_MS = 8_000;
const MAX_TOKEN_LENGTH = 8_192;
const MAX_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface AttemptRecord {
  kind: 'attempt';
  expiresAt: number;
}

interface SessionRecord {
  kind: 'session';
  userId: string;
  externalId: string;
  issuer: string;
  encryptedRefreshToken: string;
  expiresAt: number;
}

interface ReplayRecord {
  kind: 'replay';
  expiresAt: number;
}

interface RefreshResponse {
  jwt: string;
  refresh: string;
}

interface CompletionResult {
  user: LoginManagerUser;
  sessionId: string;
  sessionExpiresAt: number;
}

interface RefreshResult {
  userId: string;
  sessionExpiresAt: number;
}

export class LoginManagerRequestError extends Error {
  readonly status: number;
  readonly definitive: boolean;

  constructor(message: string, status = 400, definitive = true) {
    super(message);
    this.name = 'LoginManagerRequestError';
    this.status = status;
    this.definitive = definitive;
  }
}

function key(prefix: string, value: string): string {
  return `${prefix}:${hashOpaqueValue(value)}`;
}

function tokenTtl(exp: number): number {
  return Math.min(MAX_SESSION_TTL_MS, Math.max(1, exp * 1000 - Date.now()));
}

function getCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) {
    return undefined;
  }
  const prefix = `${name}=`;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(prefix)) {
      continue;
    }
    try {
      return decodeURIComponent(trimmed.slice(prefix.length));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function getQueryString(req: Request, name: string): string | undefined {
  const value = req.query[name];
  return typeof value === 'string' ? value : undefined;
}

function getCallbackString(req: Request, name: string): string | undefined {
  if (req.method === 'POST' && req.body && typeof req.body === 'object') {
    const value = (req.body as Record<string, unknown>)[name];
    return typeof value === 'string' ? value : undefined;
  }
  return getQueryString(req, name);
}

function serializeRedirectUrl(url: URL): string {
  return url.pathname === '/' && !url.search && !url.hash ? url.origin : url.toString();
}

function requireCallbackToken(value: string | undefined, name: string): string {
  if (!value) {
    throw new LoginManagerRequestError(`Missing ${name} callback parameter`);
  }
  if (value.length > MAX_TOKEN_LENGTH) {
    throw new LoginManagerRequestError(`${name} callback parameter is too large`, 413);
  }
  if (value.split('.').length !== 3) {
    throw new LoginManagerRequestError(`${name} callback parameter is malformed`);
  }
  return value;
}

function externalId(claims: LoginManagerClaims): string {
  return claims['custom:users_id']?.trim() || claims.sub?.trim() || '';
}

function userId(user: LoginManagerUser): string {
  const id = user._id ?? user.id;
  if (!id) {
    throw new LoginManagerRequestError('Cortex user record has no identifier', 500);
  }
  return typeof id === 'string' ? id : id.toString();
}

function displayName(claims: LoginManagerClaims): string {
  const composed = [claims.given_name, claims.family_name].filter(Boolean).join(' ').trim();
  return composed || claims.name?.trim() || claims.email;
}

function arraysEqual(left: string[] | undefined, right: string[]): boolean {
  return (
    (left?.length ?? 0) === right.length && left?.every((value, index) => value === right[index])
  );
}

function buildUpdate(user: LoginManagerUser, claims: LoginManagerClaims): LoginManagerUserUpdate {
  const groups = claims['cognito:groups']?.filter((group) => typeof group === 'string') ?? [];
  const update: LoginManagerUserUpdate = {};
  const expected = {
    name: displayName(claims),
    email: claims.email.trim().toLowerCase(),
    emailVerified: true,
    tenantId: claims['custom:tenant_id']?.trim(),
    loginManagerId: externalId(claims),
    loginManagerIssuer: claims.iss,
    loginManagerCompanyId: claims['custom:company_id']?.trim(),
  };

  for (const field of Object.keys(expected) as Array<keyof typeof expected>) {
    const value = expected[field];
    if (value !== undefined && user[field] !== value) {
      update[field] = value;
    }
  }
  if (!arraysEqual(user.loginManagerGroups, groups)) {
    update.loginManagerGroups = groups;
  }
  return update;
}

function sanitizeUser(user: LoginManagerUser): LoginManagerUser {
  const id = userId(user);
  return {
    _id: id,
    id,
    name: user.name,
    username: user.username,
    email: user.email,
    emailVerified: user.emailVerified,
    provider: user.provider,
    role: user.role,
    tenantId: user.tenantId,
    loginManagerId: user.loginManagerId,
    loginManagerIssuer: user.loginManagerIssuer,
    loginManagerCompanyId: user.loginManagerCompanyId,
    loginManagerGroups: user.loginManagerGroups,
  };
}

function setNoStore(res: Response): void {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  res.set('Referrer-Policy', 'no-referrer');
}

function clearStateCookie(res: Response): void {
  res.clearCookie(STATE_COOKIE, { path: '/api/auth/login-manager' });
}

function clearSessionCookies(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/api/auth' });
  res.clearCookie(PROVIDER_COOKIE);
  res.clearCookie('refreshToken');
}

function setProviderCookie(res: Response, expiresAt: number): void {
  res.cookie(PROVIDER_COOKIE, PROVIDER, {
    expires: new Date(expiresAt),
    httpOnly: true,
    secure: shouldUseSecureCookie(),
    sameSite: 'strict',
  });
}

function setSessionCookie(res: Response, sessionId: string, expiresAt: number): void {
  res.cookie(SESSION_COOKIE, sessionId, {
    expires: new Date(expiresAt),
    httpOnly: true,
    secure: shouldUseSecureCookie(),
    sameSite: 'strict',
    path: '/api/auth',
  });
}

function redirectFailure(res: Response, config: LoginManagerConfig): void {
  const url = new URL(config.failureRedirectUrl);
  url.searchParams.set('error', AUTH_FAILED);
  res.redirect(url.toString());
}

function redirectFailureFromEnvironment(res: Response): void {
  try {
    const url = new URL('/login', process.env.DOMAIN_CLIENT);
    url.searchParams.set('error', AUTH_FAILED);
    res.redirect(url.toString());
  } catch {
    res.redirect(`/login?error=${AUTH_FAILED}`);
  }
}

export function createLoginManagerHandlers(deps: LoginManagerDependencies): LoginManagerHandlers {
  const keyedLocks = new Map<string, Promise<void>>();
  const refreshes = new Map<string, Promise<RefreshResult>>();
  const requestFetch = deps.fetch ?? fetch;

  async function withKeyLock<T>(lockKey: string, task: () => Promise<T>): Promise<T> {
    const previous = keyedLocks.get(lockKey);
    let release = (): void => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    keyedLocks.set(lockKey, current);
    if (previous) {
      await previous;
    }
    try {
      return await task();
    } finally {
      release();
      if (keyedLocks.get(lockKey) === current) {
        keyedLocks.delete(lockKey);
      }
    }
  }

  async function consumeAttempt(state: string): Promise<void> {
    const storeKey = key('attempt', state);
    await withKeyLock(storeKey, async () => {
      const attempt = await deps.store.get<AttemptRecord>(storeKey);
      await deps.store.delete(storeKey);
      if (!attempt || attempt.kind !== 'attempt' || attempt.expiresAt <= Date.now()) {
        throw new LoginManagerRequestError('Invalid or expired Login Manager state');
      }
    });
  }

  async function consumeReplay(claims: LoginManagerClaims): Promise<void> {
    const replayKey = key('replay', `${claims.iss}\0${claims.jti}`);
    await withKeyLock(replayKey, async () => {
      const existing = await deps.store.get<ReplayRecord>(replayKey);
      if (existing && existing.kind === 'replay' && existing.expiresAt > Date.now()) {
        throw new LoginManagerRequestError('Login Manager callback was already used');
      }
      const expiresAt = claims.exp * 1000;
      await deps.store.set(
        replayKey,
        { kind: 'replay', expiresAt } satisfies ReplayRecord,
        tokenTtl(claims.exp),
      );
    });
  }

  async function resolveUser(claims: LoginManagerClaims): Promise<LoginManagerUser> {
    const identityQuery: LoginManagerUserQuery = {
      loginManagerId: externalId(claims),
      loginManagerIssuer: claims.iss,
      ...(claims['custom:tenant_id'] ? { tenantId: claims['custom:tenant_id'] } : {}),
    };
    let user = await deps.findUser(identityQuery);
    if (!user) {
      user = await deps.findUser({
        email: claims.email.trim().toLowerCase(),
        ...(claims['custom:tenant_id'] ? { tenantId: claims['custom:tenant_id'] } : {}),
      });
    }

    if (user?.loginManagerId && user.loginManagerId !== externalId(claims)) {
      throw new LoginManagerRequestError(
        'Email belongs to a different Login Manager identity',
        409,
      );
    }
    if (user?.loginManagerIssuer && user.loginManagerIssuer !== claims.iss) {
      throw new LoginManagerRequestError('Email belongs to a different Login Manager issuer', 409);
    }

    if (!user) {
      const groups = claims['cognito:groups']?.filter((group) => typeof group === 'string') ?? [];
      const created = await deps.createUser({
        name: displayName(claims),
        username: claims['cognito:username']?.trim() || claims.email.split('@')[0],
        email: claims.email.trim().toLowerCase(),
        emailVerified: true,
        provider: PROVIDER,
        role: SystemRoles.USER,
        tenantId: claims['custom:tenant_id']?.trim(),
        loginManagerId: externalId(claims),
        loginManagerIssuer: claims.iss,
        loginManagerCompanyId: claims['custom:company_id']?.trim(),
        loginManagerGroups: groups,
      });
      await deps.invalidateUserCache(userId(created));
      return created;
    }

    const update = buildUpdate(user, claims);
    if (!Object.keys(update).length) {
      return user;
    }
    const updated = await deps.updateUser(userId(user), update);
    if (!updated) {
      throw new LoginManagerRequestError('Cortex user update failed', 500);
    }
    await deps.invalidateUserCache(userId(updated));
    return updated;
  }

  async function complete(
    state: string,
    accessToken: string,
    refreshToken: string,
    config: LoginManagerConfig,
  ): Promise<CompletionResult> {
    await consumeAttempt(state);
    const claims = verifyAccessToken(accessToken, config);
    const refreshClaims = verifyRefreshToken(refreshToken, config);
    if (
      refreshClaims.iss !== claims.iss ||
      (externalId(refreshClaims) && externalId(refreshClaims) !== externalId(claims))
    ) {
      throw new LoginManagerRequestError('Refresh token identity does not match access token');
    }
    await consumeReplay(claims);
    const user = await resolveUser(claims);
    const sessionId = randomOpaqueValue();
    const expiresAt = refreshClaims.exp * 1000;
    const session: SessionRecord = {
      kind: 'session',
      userId: userId(user),
      externalId: externalId(claims),
      issuer: claims.iss,
      encryptedRefreshToken: encryptToken(refreshToken, config.encryptionKey),
      expiresAt,
    };
    await deps.store.set(key('session', sessionId), session, tokenTtl(refreshClaims.exp));
    return { user, sessionId, sessionExpiresAt: expiresAt };
  }

  async function rotate(sessionId: string, config: LoginManagerConfig): Promise<RefreshResult> {
    const storeKey = key('session', sessionId);
    const record = await deps.store.get<SessionRecord>(storeKey);
    if (!record || record.kind !== 'session' || record.expiresAt <= Date.now()) {
      throw new LoginManagerRequestError('Login Manager session is missing or expired', 401);
    }
    let refreshToken: string;
    try {
      refreshToken = decryptToken(record.encryptedRefreshToken, config.encryptionKey);
    } catch {
      throw new LoginManagerRequestError('Login Manager session is invalid', 401);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
    let response: globalThis.Response;
    try {
      response = await requestFetch(config.refreshUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: refreshToken }),
        signal: controller.signal,
      });
    } catch {
      throw new LoginManagerRequestError(
        'Login Manager refresh is temporarily unavailable',
        503,
        false,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const definitive = [400, 401, 403, 422].includes(response.status);
      throw new LoginManagerRequestError(
        definitive ? 'Login Manager refresh was rejected' : 'Login Manager refresh failed',
        definitive ? 401 : 503,
        definitive,
      );
    }

    let payload: RefreshResponse;
    try {
      const parsed = (await response.json()) as Partial<RefreshResponse> | null;
      if (!parsed || typeof parsed.jwt !== 'string' || typeof parsed.refresh !== 'string') {
        throw new Error('invalid response');
      }
      payload = { jwt: parsed.jwt, refresh: parsed.refresh };
    } catch {
      throw new LoginManagerRequestError('Login Manager refresh response is invalid', 502, true);
    }
    const accessToken = requireCallbackToken(payload.jwt, 'jwt');
    const rotatedRefresh = requireCallbackToken(payload.refresh, 'refresh');
    let claims: LoginManagerClaims;
    let refreshClaims: LoginManagerClaims;
    try {
      claims = verifyAccessToken(accessToken, config);
      refreshClaims = verifyRefreshToken(rotatedRefresh, config);
    } catch {
      throw new LoginManagerRequestError('Login Manager refresh returned invalid tokens', 401);
    }
    if (claims.iss !== record.issuer || externalId(claims) !== record.externalId) {
      throw new LoginManagerRequestError('Refreshed Login Manager identity changed', 401);
    }
    if (externalId(refreshClaims) && externalId(refreshClaims) !== record.externalId) {
      throw new LoginManagerRequestError('Rotated refresh token identity changed', 401);
    }

    const expiresAt = refreshClaims.exp * 1000;
    const rotated: SessionRecord = {
      ...record,
      encryptedRefreshToken: encryptToken(rotatedRefresh, config.encryptionKey),
      expiresAt,
    };
    await deps.store.set(storeKey, rotated, tokenTtl(refreshClaims.exp));
    return { userId: record.userId, sessionExpiresAt: expiresAt };
  }

  function refreshOnce(sessionId: string, config: LoginManagerConfig): Promise<RefreshResult> {
    const existing = refreshes.get(sessionId);
    if (existing) {
      return existing;
    }
    const refresh = rotate(sessionId, config).finally(() => {
      if (refreshes.get(sessionId) === refresh) {
        refreshes.delete(sessionId);
      }
    });
    refreshes.set(sessionId, refresh);
    return refresh;
  }

  async function deleteExternalSession(sessionId: string | undefined): Promise<void> {
    if (sessionId) {
      await deps.store.delete(key('session', sessionId));
    }
  }

  return {
    async start(_req, res) {
      setNoStore(res);
      try {
        const config = getLoginManagerConfig();
        const state = randomOpaqueValue();
        const expiresAt = Date.now() + ATTEMPT_TTL_MS;
        await deps.store.set(
          key('attempt', state),
          { kind: 'attempt', expiresAt } satisfies AttemptRecord,
          ATTEMPT_TTL_MS,
        );
        res.cookie(STATE_COOKIE, state, {
          maxAge: ATTEMPT_TTL_MS,
          httpOnly: true,
          secure: shouldUseSecureCookie(),
          sameSite: 'lax',
          path: '/api/auth/login-manager',
        });
        const url = new URL(config.baseUrl);
        url.searchParams.set('callback', config.callbackUrl.toString());
        url.searchParams.set('redirect', serializeRedirectUrl(config.redirectUrl));
        res.redirect(url.toString());
      } catch (error) {
        const status = error instanceof LoginManagerConfigError ? 503 : 500;
        res.status(status).json({ message: 'Login Manager is unavailable' });
      }
    },

    async callback(req, res) {
      setNoStore(res);
      clearStateCookie(res);
      let config: LoginManagerConfig;
      try {
        config = getLoginManagerConfig();
      } catch {
        redirectFailureFromEnvironment(res);
        return;
      }
      try {
        const state = getCookie(req, STATE_COOKIE);
        if (!state) {
          throw new LoginManagerRequestError('Missing Login Manager state');
        }
        const accessToken = requireCallbackToken(getCallbackString(req, 'jwt'), 'jwt');
        const refreshToken = requireCallbackToken(getCallbackString(req, 'refresh'), 'refresh');
        const result = await complete(state, accessToken, refreshToken, config);
        try {
          await deps.issueAuthTokens(userId(result.user), req, res, false);
        } catch (error) {
          await deleteExternalSession(result.sessionId);
          clearSessionCookies(res);
          throw error;
        }
        setSessionCookie(res, result.sessionId, result.sessionExpiresAt);
        setProviderCookie(res, result.sessionExpiresAt);
        res.redirect(config.successRedirectUrl.toString());
      } catch {
        redirectFailure(res, config);
      }
    },

    async refresh(req, res) {
      setNoStore(res);
      let config: LoginManagerConfig;
      try {
        config = getLoginManagerConfig();
      } catch {
        clearSessionCookies(res);
        res.status(503).send('Login Manager is unavailable');
        return;
      }
      const sessionId = getCookie(req, SESSION_COOKIE);
      if (!sessionId) {
        clearSessionCookies(res);
        res.status(401).send('Login Manager session not provided');
        return;
      }
      try {
        const result = await refreshOnce(sessionId, config);
        const user = await deps.getUserById(result.userId);
        if (!user) {
          throw new LoginManagerRequestError('Cortex user no longer exists', 401);
        }
        const token = await deps.issueAuthTokens(result.userId, req, res, true);
        setSessionCookie(res, sessionId, result.sessionExpiresAt);
        setProviderCookie(res, result.sessionExpiresAt);
        res.status(200).send({ token, user: sanitizeUser(user) });
      } catch (error) {
        const requestError =
          error instanceof LoginManagerRequestError
            ? error
            : new LoginManagerRequestError('Login Manager refresh failed', 500, false);
        if (requestError.definitive) {
          let record: SessionRecord | undefined;
          try {
            record = await deps.store.get<SessionRecord>(key('session', sessionId));
            await deleteExternalSession(sessionId);
            if (record?.userId) {
              await deps.clearAuthSession(record.userId, req);
            }
          } catch {
            record = undefined;
          }
          clearSessionCookies(res);
        }
        res.status(requestError.status).send(requestError.message);
      }
    },

    async logout(req, res) {
      const sessionId = getCookie(req, SESSION_COOKIE);
      await deleteExternalSession(sessionId).catch(() => undefined);
      res.clearCookie(SESSION_COOKIE, { path: '/api/auth' });
    },
  };
}
