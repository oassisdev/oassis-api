# Optional website authentication

Website accounts run only on `https://oassis.dev`, at `/login`, `/signup` and `/dashboard`. They do not authorize the private operations console. Verified accounts can generate API keys and share account credits across MCP and HTTP; x402 remains independently available.

Implementation: Better Auth 1.7.10, native Cloudflare D1 adapter. Migration `0006_site_auth.sql` creates five `site_*` tables separate from the existing billing tables. Email passwords use the library's salted scrypt hashes. Sessions expire after seven days and use host-only Secure, HttpOnly, SameSite=Lax cookies. Authentication routes and account pages are excluded from tool traces. Authentication has its own abuse protection; anonymous MCP usage has a separate 100-credit lifetime trial.

## Required production secret

`AUTH_SECRET`: a random secret of at least 32 characters, set with `wrangler secret put AUTH_SECRET`. Do not commit it, print it in logs or reuse console credentials. Changing it invalidates existing website authentication cookies and affects encrypted OAuth tokens.

## Google sign-in

Create a Google Cloud project, configure Google Auth Platform branding/audience and create a **Web application** OAuth client. Configure:

- Authorized JavaScript origin: `https://oassis.dev`
- Authorized redirect URI: `https://oassis.dev/api/auth/callback/google`
- Credentials in Worker secrets: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`

During Google testing, only configured test users can sign in. Publish the OAuth application's audience when ready for public sign-in, following Google's requirements. Homepage, support email and privacy policy must refer to Oassis.

## GitHub sign-in

Create a GitHub **OAuth App** (not a GitHub App):

- Homepage URL: `https://oassis.dev`
- Authorization callback URL: `https://oassis.dev/api/auth/callback/github`
- Credentials in Worker secrets: `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`

After setting a provider's pair of secrets, new requests enable that provider. The full authorization-code flow must be tested with the real application before calling the integration verified. Implicit account linking is enabled only when the existing Oassis email and the incoming provider email are both verified and match. No provider bypasses this verification gate. Unverified password accounts cannot be implicitly linked.

## Deployment

Run `npm run check`, apply the additive D1 migration and deploy the Worker. Never put client secrets in HTML, public environment variables, screenshots or GitHub.

## Current limitations

Email/password signup and login are available without a mail provider. Email addresses created this way are marked **unverified**; no email verification, password recovery or mail delivery is claimed. Do not give unverified accounts privileged access. Account support/deletion requests use the support page. A verified email delivery service is needed before enabling verification or password recovery.

Google and GitHub buttons remain visible with a configuration notice until their credentials exist. The full-width website dashboard opens on the personal profile: editable display name, read-only email and verification status, registration date, linked sign-in providers and session expiry. Account metadata is loaded only for the authenticated user. Updates use Better Auth’s authenticated update-user endpoint. Developer links lead to Web Tools, Tasks, MCP and x402; no usage or billing totals are invented.

## Installation

Use `npm ci --legacy-peer-deps`: the standalone Worker does not use the optional SvelteKit/Vite adapter peer dependencies. `jose` is pinned at 6.2.12 to satisfy Better Auth's crypto dependency; x402 retains its own compatible version.
