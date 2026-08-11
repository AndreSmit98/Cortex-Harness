import type { JwtPayload } from 'jsonwebtoken';
import type { Request, Response } from 'express';

export interface LoginManagerConfig {
  baseUrl: URL;
  callbackUrl: URL;
  refreshUrl: URL;
  redirectUrl: URL;
  successRedirectUrl: URL;
  failureRedirectUrl: URL;
  publicKey: string;
  encryptionKey: Buffer;
  expectedIssuer: string;
  expectedAudience: string | string[];
  expectedFlow: string;
  label: string;
  authDebug: boolean;
}

export interface LoginManagerClaims extends JwtPayload {
  iss: string;
  aud: string | string[];
  exp: number;
  nbf: number;
  iat: number;
  jti: string;
  sub?: string;
  email: string;
  email_verified: boolean;
  flow: string;
  type: string;
  token_use: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  'cognito:username'?: string;
  'cognito:groups'?: string[];
  'custom:tenant_id'?: string;
  'custom:company_id'?: string;
  'custom:users_id'?: string;
}

export interface LoginManagerUser {
  _id?: string | { toString(): string };
  id?: string;
  name?: string;
  username?: string;
  email: string;
  emailVerified?: boolean;
  provider?: string;
  role?: string;
  tenantId?: string;
  loginManagerId?: string;
  loginManagerIssuer?: string;
  loginManagerCompanyId?: string;
  loginManagerGroups?: string[];
}

export interface LoginManagerUserQuery {
  email?: string;
  tenantId?: string;
  loginManagerId?: string;
  loginManagerIssuer?: string;
}

export interface LoginManagerUserUpdate {
  name?: string;
  email?: string;
  emailVerified?: boolean;
  tenantId?: string;
  loginManagerId?: string;
  loginManagerIssuer?: string;
  loginManagerCompanyId?: string;
  loginManagerGroups?: string[];
}

export interface LoginManagerStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: object, ttl?: number): Promise<unknown>;
  delete(key: string): Promise<unknown>;
}

export interface LoginManagerDependencies {
  store: LoginManagerStore;
  findUser(query: LoginManagerUserQuery): Promise<LoginManagerUser | null>;
  getUserById(userId: string): Promise<LoginManagerUser | null>;
  createUser(user: LoginManagerUser): Promise<LoginManagerUser>;
  updateUser(userId: string, update: LoginManagerUserUpdate): Promise<LoginManagerUser | null>;
  invalidateUserCache(userId: string): Promise<void>;
  issueAuthTokens(
    userId: string,
    req: Request,
    res: Response,
    reuseSession: boolean,
  ): Promise<string>;
  clearAuthSession(userId: string, req: Request): Promise<void>;
  fetch?: typeof fetch;
}

export interface LoginManagerPublicConfig {
  enabled: boolean;
  label: string;
}

export interface LoginManagerHandlers {
  start(req: Request, res: Response): Promise<void>;
  callback(req: Request, res: Response): Promise<void>;
  refresh(req: Request, res: Response): Promise<void>;
  logout(req: Request, res: Response): Promise<void>;
}
