# SheetFinances PWA

Initial React, TypeScript, Vite, TanStack Query, and installable PWA scaffold.
The app is isolated from the Apps Script source files in the repository root.

## Requirements

- Node.js 22.12 or newer
- npm

## Run locally

1. Copy `.env.example` to `.env.local`.
2. Set `VITE_FINANCE_API_URL` to the Apps Script Web App `/exec` URL or to a
   CORS-enabled gateway URL. Do not add a trailing query string.
3. Install dependencies and start Vite:

   ```sh
   npm install
   npm run dev
   ```

The login form uses `auth.login`, validates the resulting session with `me`,
and keeps its token in `localStorage` until logout or revocation. Existing
session tokens are migrated from `sessionStorage` when the app next opens.
This keeps the user signed in across browser restarts on the same browser
profile; use it only on a trusted device and sign out on shared devices. The
API accepts GET tokens in the query string, so avoid exposing URLs containing
the token in screenshots, logs, or shared links.
Login requests use a CORS-safelisted text content type to avoid an unnecessary
preflight. If the browser still blocks requests, Apps Script may require a
CORS-enabled gateway.

The app also persists successful API query results and the last validated
session profile/workspaces in IndexedDB for up to 24 hours after their last
successful fetch. Stale data is refreshed when the connection is available;
cached results remain viewable offline during that window. The cache is scoped
by user and workspace, excludes session tokens, and is cleared on logout or
when the API rejects the session. IndexedDB data is not encrypted, so use only
a trusted device. The service worker still caches static app files separately.
There is no offline write queue or background synchronization of changes yet;
the current screens are read-only.

The registration secret is configured only as the Apps Script Script Property
`FINANCE_API_REGISTRATION_SECRET`. Never put it in this PWA, `.env.local`, or
Git. Create the initial owner account through a controlled API client (such as
Postman) by sending `auth.register` with the secret in the request body; the
secret is not needed for login. Do not provide public registration in the PWA.

## Build

```sh
npm run typecheck
npm run build
npm run preview
```

The Vite base path is configured for this repository's GitHub Pages project URL
(`/FinancesPWA/`). Update it if the repository name changes.

## Deploy to GitHub Pages

1. In the repository's **Settings → Secrets and variables → Actions → Variables**,
   add the repository variable `VITE_FINANCE_API_URL` with the deployed Apps
   Script `/exec` URL or CORS-enabled gateway URL. This URL is embedded in the
   public frontend bundle, so it must not contain credentials or secrets.
2. In **Settings → Pages**, set the source to **GitHub Actions**.
3. Push the PWA and workflow changes to the `main` branch. The
   `Deploy PWA to GitHub Pages` workflow builds the app from this repository root and publishes it
   automatically. It can also be started manually from the **Actions** tab.
4. After the workflow succeeds, open
   `https://claytoneduardoceo.github.io/FinancesPWA/`.
