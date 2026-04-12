# Commander

Web-based command center for [Squadron](https://github.com/mlund01/squadron) instances. Provides a dashboard for managing missions, agents, skills, tools, config, and costs across one or more connected Squadron instances.

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

Commander can be protected with an OIDC login wall. When enabled, all browser-facing routes (`/api/*` and the UI) require a valid session. The `/ws` WebSocket endpoint used by Squadron instances is **not** protected — it's machine-to-machine.

Authentication is **disabled by default**. It activates when `OAUTH_ISSUER_URL` is set. If that variable is set but any other required variable is missing, Commander will refuse to start.

### Environment variables

#### Required (to enable auth)

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

### How it works

- **Login**: Browser hits `/auth/login` → redirected to your IdP with PKCE. After login, the IdP redirects back to `/auth/callback`, which verifies the ID token, sets a signed session cookie, and redirects to the app.
- **Session**: Stateless HMAC-SHA256 signed cookie. No server-side session store. Survives restarts.
- **Logout**: `GET /auth/logout` clears the cookie and redirects through the IdP's end-session endpoint (if advertised via OIDC discovery).
- **`/auth/me`**: Returns `{email, name, sub}` JSON for the current user, or 401. Used by the frontend to show the logged-in user.

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
