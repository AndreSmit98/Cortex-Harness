# RSAWEB Login Manager local setup

Cortex uses RSAWEB Login Manager's custom signed-JWT redirect protocol. It is not configured through `OPENID_*`, and its refresh tokens are not shared with MCP OAuth.

## Local URLs

- Backend API: `http://localhost:3000`
- Browser-facing Vite frontend: `http://localhost:5174`
- Login Manager redirect allowlist entry: **exactly** `http://localhost:5174`
- Successful development redirect: `http://localhost:5174/c/new`

The callback string above must match the Login Manager staging allowlist exactly. Do not replace `localhost` with `127.0.0.1`, change the port, add a trailing slash, or add query parameters without coordinating an allowlist update.

## Configuration

Copy the Login Manager variables from `.env.example` into a local `.env` and set:

```env
LOGIN_MANAGER_ENABLED=true
LOGIN_MANAGER_REDIRECT_URL=http://localhost:5174
LOGIN_MANAGER_SUCCESS_REDIRECT_URL=http://localhost:5174/c/new
LOGIN_MANAGER_PUBLIC_KEY_B64=<base64-encoded RSAWEB staging public PEM>
LOGIN_MANAGER_TOKEN_ENCRYPTION_KEY_B64=<base64-encoded 32-byte random key>
LOGIN_MANAGER_EXPECTED_ISS=<exact iss claim>
LOGIN_MANAGER_EXPECTED_AUD=<exact aud claim>
```

Also configure the normal Cortex prerequisites, especially `MONGO_URI`. The Login Manager launch scripts set ports and public localhost domains; they do not create a database or inject credentials.

Generate the local refresh-token encryption key with:

```bash
openssl rand -base64 32
```

Keep the public-key value, encryption key, JWTs, refresh tokens, `.env`, and PEM files out of Git. `LOGIN_MANAGER_AUTH_DEBUG` never enables token logging.

`LOGIN_MANAGER_CALLBACK_URL` is Login Manager's own JWT callback endpoint. `LOGIN_MANAGER_REDIRECT_URL` must be exactly `http://localhost:5174` locally; no other localhost port or callback path is allowlisted. Login Manager returns `jwt` and `refresh` to that frontend root. Before React starts, Cortex removes those parameters from browser history and submits them to `/api/auth/login-manager/callback` over the same origin for server-side verification.

The supplied Login Manager protocol does not document echoing an arbitrary `state` parameter. Cortex therefore keeps the exact allowlisted redirect URL unchanged and correlates each callback with a one-time server-side attempt plus an opaque `HttpOnly`, `SameSite=Lax` cookie. The callback consumes both the attempt and JWT `jti` once.

## Run the development application

Build the shared packages once after cloning or after changing shared code:

```bash
npm run build:data-provider
npm run build:data-schemas
npm run build:api
```

Then use two terminals:

```bash
npm run backend:dev:login-manager
npm run frontend:dev:login-manager
```

The dedicated frontend command uses Vite strict-port mode. It fails if port `5174` is occupied instead of moving to a callback-incompatible port.

For the built single-origin application, set `LOGIN_MANAGER_SUCCESS_REDIRECT_URL=http://localhost:5174/c/new`, build the frontend, and run:

```bash
npm run start:login-manager
```

## Production portability

Production requires only environment and Login Manager allowlist changes:

- Set `DOMAIN_SERVER`, `DOMAIN_CLIENT`, `LOGIN_MANAGER_REDIRECT_URL`, and `LOGIN_MANAGER_SUCCESS_REDIRECT_URL` to production HTTPS URLs.
- Add the exact production Cortex callback to Login Manager's allowlist.
- Supply the production public key, expected issuer/audience, and a production encryption key.

No authentication code, OpenID configuration, MCP OAuth configuration, Catalyst configuration, or AppSail configuration is required.
