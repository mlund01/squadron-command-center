# Commander

Web-based command center for [Squadron](https://github.com/mlund01/squadron) instances. Provides a dashboard for managing missions, agents, skills, tools, config, and costs across one or more connected Squadron instances.

## Deploy to Fly.io

The repo ships with a `Dockerfile` and `fly.toml` configured for an always-on, shared-cpu-1x VM in `iad` with HTTPS forced. Deploy directly from [fly.io](https://fly.io/) — no CLI, no local build:

1. Sign in at [fly.io/dashboard](https://fly.io/dashboard) (create an account if you don't have one; a payment method is required even on the free tier).
2. Click **Launch an App** → **Launch from GitHub** and authorize the Fly GitHub app if prompted.
3. Pick this repo. Fly detects the committed `fly.toml` and `Dockerfile`, so you can leave the defaults alone.
4. Choose an app name and region, then click **Deploy**. Fly clones the repo, builds the Docker image on their builders, and rolls it out.

Your app will be live at `https://<your-app-name>.fly.dev/`. WebSockets (`/ws`) work out of the box.

### Enable the auth wall (optional)

Commander is publicly accessible by default. See [Authentication](#authentication-optional) for setup.

**OIDC is the recommended option** — it delegates credential handling, MFA, and account recovery to a real identity provider. Use basic auth only for quick personal deployments where setting up an IdP isn't worth it.

### Updating

Push to `main` and trigger a redeploy from the dashboard, or enable auto-deploy under the app's **Settings** → **Deployments**.

## Quick start

```bash
go build -o commander .
./commander
```

Open `http://localhost:8080`. Commander will wait for a Squadron instance to connect via WebSocket at `/ws`.

### CLI flags

| Flag | Default | Description |
|---|---|---|
| `-addr` | `:8080` | HTTP listen address |
| `-web-dir` | (embedded) | Path to `web/dist` for development |
| `-disable-config-edit` | `false` | Disable config file editing from the UI |
| `-keep-alive` | `0` | Self-terminate if no keep-alive ping within N seconds (0 = disabled) |

## Authentication (optional)

Commander supports two auth modes; both protect all browser-facing routes (`/api/*` and the UI) behind a session cookie. The `/ws` WebSocket endpoint used by Squadron instances is **not** protected — it's machine-to-machine.

| Mode | When to use | How to enable |
|---|---|---|
| **OIDC** (recommended) | Any real deployment. Delegates credential handling, MFA, revocation, and account recovery to a proper identity provider. | Set `OAUTH_ISSUER_URL` + related vars (below). |
| **Basic** (username/password) | Quick personal deployments where standing up an IdP would be overkill. Single account, no MFA, no recovery. Includes in-memory brute-force protection (per-IP exponential backoff, 1s → 2s → 4s → … capped at 15 min, reset on success or after a 15-min idle window) and CSRF-protected login. Limiter state resets on restart. | Set `BASIC_AUTH_USERNAME` + `BASIC_AUTH_PASSWORD_HASH` (below). |

Authentication is **disabled by default**. The two modes are mutually exclusive — setting variables for both causes Commander to refuse to start.

### OIDC mode

#### Required environment variables

| Variable | Description |
|---|---|
| `OAUTH_ISSUER_URL` | OIDC issuer URL (e.g. `https://your-tenant.auth0.com/`) |
| `OAUTH_CLIENT_ID` | OAuth client ID |
| `OAUTH_CLIENT_SECRET` | OAuth client secret |
| `OAUTH_REDIRECT_URL` | Callback URL (e.g. `https://commander.example.com/auth/callback`) |
| `OAUTH_COOKIE_SECRET` | Session signing key, hex or base64 encoded, minimum 32 bytes |

#### Optional

| Variable | Default | Description |
|---|---|---|
| `OAUTH_SCOPES` | `openid profile email` | Comma-separated OIDC scopes |
| `OAUTH_AUDIENCE` | (none) | Forwarded as `audience` query param (Auth0-compatible) |
| `OAUTH_SESSION_TTL` | `24h` | Session duration (Go duration format) |
| `OAUTH_COOKIE_NAME` | `commander_session` | Session cookie name |
| `OAUTH_ALLOWED_EMAILS` | (none) | Comma-separated email allowlist; if set, only these emails can log in |

### Auth0 setup

1. Create a **Regular Web Application** in Auth0.

2. In the application settings, add your callback and logout URLs:
   - **Allowed Callback URLs**: `https://commander.example.com/auth/callback`
   - **Allowed Logout URLs**: `https://commander.example.com/`

3. Set the environment variables:

```bash
export OAUTH_ISSUER_URL=https://your-tenant.auth0.com/
export OAUTH_CLIENT_ID=<client-id>
export OAUTH_CLIENT_SECRET=<client-secret>
export OAUTH_REDIRECT_URL=https://commander.example.com/auth/callback
export OAUTH_COOKIE_SECRET=$(openssl rand -hex 32)
```

4. Start Commander:

```bash
./commander
```

This works with any OIDC-compliant provider (Google, Okta, Keycloak, Azure AD, etc.) — just change the issuer URL and client credentials.

### Basic mode (username/password)

> ⚠️ OIDC is strongly preferred. Basic mode exists for convenience; it has no MFA, no recovery, and only a single account.

#### Required environment variables

| Variable | Description |
|---|---|
| `BASIC_AUTH_USERNAME` | The single account username. |
| `BASIC_AUTH_PASSWORD_HASH` | A bcrypt hash of the password. Generate with e.g. `htpasswd -nbBC 12 "" 'your-password' \| tr -d ':\n'` or `python3 -c "import bcrypt; print(bcrypt.hashpw(b'your-password', bcrypt.gensalt()).decode())"`. |
| `OAUTH_COOKIE_SECRET` | Session signing key, hex or base64 encoded, minimum 32 bytes. (Shared across both modes — the name is historical.) |

#### Optional environment variables

| Variable | Default | Description |
|---|---|---|
| `OAUTH_SESSION_TTL` | `24h` | Session duration. |
| `OAUTH_COOKIE_NAME` | `commander_session` | Session cookie name. |
| `AUTH_COOKIE_SECURE` | `false` | Set to `true` behind HTTPS-terminating proxies to mark the session cookie `Secure`. |

#### Setup

```bash
export BASIC_AUTH_USERNAME=admin
export BASIC_AUTH_PASSWORD_HASH='$2b$12$...'
export OAUTH_COOKIE_SECRET=$(openssl rand -hex 32)
./commander
```

On `/auth/login`, Commander serves a plain HTML form. Each failed attempt from an IP doubles the lockout (1s after the first failure, 2s after the second, and so on, capped at 15 minutes); the counter resets on a successful login or after 15 minutes of no failures. The form is CSRF-protected (synchronizer token + cookie) and ships with `Cache-Control: no-store`, `X-Frame-Options: DENY`, a tight `Content-Security-Policy`, and `Referrer-Policy: no-referrer`. Passwords are capped at 72 bytes (bcrypt's silent-truncation limit). Lockout state is in-memory only and resets on restart.

The bcrypt hash is validated at startup — if `BASIC_AUTH_PASSWORD_HASH` isn't a well-formed bcrypt hash, Commander refuses to start with a clear error instead of silently failing every login.

### How it works

- **Login (OIDC)**: Browser hits `/auth/login` → redirected to your IdP with PKCE. After login, the IdP redirects back to `/auth/callback`, which verifies the ID token, sets a signed session cookie, and redirects to the app.
- **Login (basic)**: Browser hits `/auth/login` → served an HTML form. POST back with username/password. Password is checked against the stored bcrypt hash with constant-time comparison; the per-IP limiter gates repeated failures.
- **Session**: Stateless HMAC-SHA256 signed cookie. No server-side session store. Survives restarts (the basic-mode brute-force counter does not — this is fine for single-instance deployments).
- **Logout**: `GET /auth/logout` clears the cookie. In OIDC mode it also redirects through the IdP's end-session endpoint (if advertised via discovery).
- **`/auth/me`**: Returns `{email, name, sub}` JSON for the current user, or 401. Used by the frontend to show the logged-in user. In basic mode all three fields hold the configured username.

## Development

### Backend

```bash
go build ./...
go test ./...
go vet ./...
```

### Frontend

```bash
cd web
npm install
npm run dev    # dev server with hot reload
npm run build  # production build to web/dist
```

The production build is embedded into the Go binary via `//go:embed`.
