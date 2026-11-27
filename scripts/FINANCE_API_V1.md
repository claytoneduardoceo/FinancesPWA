# Finance API v1

The v1 API is served by the Apps Script Web App and selected with `?api=v1`.
The separate mobile shortcut flow uses `?recurso=contexto` for GET and the
mobile POST route described below.

## Initial setup

Run `runFinanceApiV1SetupCheck()` from the Apps Script editor after the
migrated tabs exist. Add these Script Properties first:

- `FINANCE_API_REGISTRATION_SECRET`: a long random secret required for every
  registration.
- `FINANCE_API_OWNER_EMAIL`: the owner's email; it must be the first account
  registered.
- `FINANCE_API_WORKSPACE_ID`: the active workspace UUID from `WORKSPACES`.

The setup check creates the private credential, session, idempotency, and
login-rate-limit tabs and generates a password pepper in Script Properties.
Do not store secrets in spreadsheet cells or source code. Deploy the Web App
to execute as the spreadsheet owner and allow the intended API clients to
access it.

The owner registers first using `auth.register` and then receives the `OWNER`
membership. Other users must register with the shared registration secret.
They have no financial access until an owner/admin adds them by email using
`workspace.members.add`. Supported roles are `ADMIN`, `EDITOR`, and `VIEWER`;
only the owner can grant or remove an `ADMIN`.

## Routes

All responses are JSON with an `ok` boolean. Apps Script `ContentService`
does not provide a configurable HTTP status here, so clients must check
`ok` and `error.code`.

### GET

Append `api=v1`, a `resource`, and the session token as `token`:

- `health`: API readiness.
- `me`: current user and memberships.
- `workspaces`: active workspaces available to the user.
- `dashboard`: aggregated balances, cash-flow timeline, and upcoming
  commitments for a workspace.
- `mobile_events`: read-only review queue and mobile-ingestion history. Use
  `view=review` for `PENDENTE_REVISAO` events and `UNVERIFIED`,
  `PENDING_DATA` or `NEEDS_FORMAL_REVIEW` transactions and installment plans;
  use `view=logs` for the event history. Received payloads are included when
  available. Both views support `limit` and `offset`, are workspace-scoped,
  require an authenticated workspace member, and may be cached on the device.
- `schema`: writable fields and required fields for each entity.
- `members`: active members of the selected workspace (owner/admin only).
- Entity resources: `accounts`, `balance_anchors`, `categories`, `cards`,
  `card_identifiers`, `card_cycle_overrides`, `transactions`, `recurrences`,
  `recurrence_events`, `installment_plans`, `debts`, `invoices`, `budgets`,
  `benefit_wallets`, `benefit_cards`, `benefit_adjustments`, `payroll_links`,
  `prompt_configs`, and `merchant_aliases`.

Entity lists support `workspaceId`, `id`, `limit` (maximum 200), `offset`, and
`includeDeleted=true` (owner/admin only). When a user has exactly one
workspace, `workspaceId` may be omitted.

The dashboard route accepts `workspaceId` and `horizonDays` (1-90, default
30). It uses the latest eligible balance anchor on or before today, then
applies cash-affecting transactions after that anchor. Future cash-affecting
transactions, active monthly recurrences, and active debt installments are
included in the projection when their direction, amount, date, and currency
are known. The response includes balances grouped by currency, daily timeline
points, upcoming commitments, and warnings for incomplete or unsupported data.
Balance totals may be partial when some included accounts have no account
anchor; check `balanceComplete` and `missingAccountCount`.

The projection is an estimate, not a ledger guarantee: recurrence business-day
adjustments are not applied, invoice totals are unavailable and are shown only
as commitments, and card installments are not included in projected cash flow.

### POST

Send JSON to `...?api=v1`:

```json
{
  "action": "auth.register",
  "registrationSecret": "configured-shared-secret",
  "email": "user@example.com",
  "password": "at-least-12-characters"
}
```

Other supported actions:

- `auth.login`: `{ "action": "auth.login", "email": "...", "password": "..." }`
- `auth.logout`: `{ "action": "auth.logout", "token": "..." }`
- `workspace.members.add`: provide `token`, `idempotencyKey`, `email` (or
  `userId`), `role`, and optionally `workspaceId`.
- `workspace.members.remove`: provide `token`, `idempotencyKey`, `userId`,
  and optionally `workspaceId`.
- `entity.create`: provide `token`, `resource`, `idempotencyKey`, and `data`.
- `entity.update`: additionally provide `id` and the current `recordVersion`.
- `entity.delete`: provide `id`, the current `recordVersion`, and
  `idempotencyKey`; deletion is logical.

Example create:

```json
{
  "action": "entity.create",
  "token": "session-token",
  "resource": "transactions",
  "idempotencyKey": "mobile-entry-unique-request-id",
  "data": {
    "TRANSACTION_TYPE": "ONE_OFF",
    "DIRECTION": "EXPENSE",
    "AMOUNT": 25.9,
    "CURRENCY": "BRL",
    "OCCURRED_AT": "2026-06-02",
    "DESCRIPTION": "Example"
  }
}
```

Dates use ISO `YYYY-MM-DD` or UTC ISO datetime strings; month fields use
`YYYY-MM`. Money is numeric. IDs, workspace ownership, timestamps,
record versions, and deletion metadata are assigned or managed by the API.
Updates require the latest version to prevent overwriting concurrent edits.
Every write requires a new idempotency key for each intended operation. Reuse
the same key only when retrying the exact same request. An operation recorded
as incomplete is not replayed automatically and requires manual review, since
Google Sheets cannot commit writes to several tabs atomically.

### Mobile shortcut ingestion

The mobile flow is separate from account sessions. It reuses the migrated
`EXTERNAL_EVENTS` sheet as an attempt log and pending-review queue; each
attempt gets a row whose status and extracted fields are updated as processing
finishes. It does not create the legacy `_inbox_mobile` or
`_inbox_mobile_changelog` tabs.

- Context: `GET ...?recurso=contexto&tipo=PUSH` (also `SMS`, `EMAIL`, `FILE`,
  `WALLET`, or `DEFAULT`). It returns the active prompt, categories, card
  mappings, merchant aliases, and upcoming commitments for the configured
  workspace.
- Ingestion: `POST ...` with JSON containing `origem` and
  `resposta_modelo` (the parsed object or its JSON string). Include a stable
  `external_id` or `notification_id` so retries of the same notification are
  recognized.
- A complete one-off is written to `TRANSACTIONS`; a complete card
  installment purchase goes to `INSTALLMENT_PLANS`. Both use
  `REVIEW_STATUS=UNVERIFIED` and are logged in `AUDIT` and `CHANGELOG`.
- Incomplete or ambiguous input is logged as `PENDENTE_REVISAO` in
  `EXTERNAL_EVENTS`; it does not create a transaction. Notifications marked
  `IGNORAR` are logged as `IGNORADO_NAO_TRANSACIONAL`. Explicit own transfers
  and generic push Pix alerts without an identified counterparty are also
  logged as ignored, not inserted.
- Clear matches update an existing transaction or close a matching recurrence
  event. Debt-payment candidates, an explicitly identified invoice without a
  total, an ambiguous commitment, a possible duplicate, or an unmatched
  cancellation is left for review. The current data model has no individual
  debt-payment events or invoice total for safe automatic reconciliation.
- Existing transaction matches use a five-day date window and R$5 amount
  tolerance, narrowed by merchant/alias when needed. Ambiguous matches are
  never inserted automatically.

**This endpoint is intentionally public and unauthenticated, as requested.**
Anyone who obtains the Web App URL can retrieve the financial context and
submit mobile records; this is not protected by the PWA login, a user token, or
a shared secret. The URL must not be posted publicly. The Apps Script runs
with the spreadsheet owner's permissions, so public deployment can expose
financial details and permit unwanted writes.

Add `mobile_ingestion_v1.gs` to the Apps Script project together with the
current v1 files. Keep `doGet` and `doPost` in `finance_api_router_v1.gs` as the
only Web App handlers; the files under `old/` are reference-only and contain
duplicate handler names and dependencies on the retired spreadsheet model.
`runFinanceApiV1SetupCheck()` now also verifies the `EXTERNAL_EVENTS` schema.

## Security and current scope

Passwords are stored as salted PBKDF2-HMAC-SHA256 hashes using 10,000
iterations to keep authentication responsive in Apps Script. This is a
deliberately reduced work factor; use strong, unique passwords and keep the
server-side pepper private. Existing credentials are rehashed at the new
iteration count after their next successful login. Session tokens are stored
as hashes and can be revoked with `auth.logout`. Sessions do not expire
automatically. As requested, GET tokens are accepted in the query string;
URLs can be retained in browser history, proxies, or logs, so avoid sharing
them and revoke exposed sessions.

This implementation provides authentication, workspace authorization,
entity CRUD, validation, version checks, idempotency, audit, changelog records,
and an initial dashboard projection. The projection's limitations are
described above; it does not calculate invoice totals or include card
installments in projected cash flow.

Apps Script does not expose a custom CORS/preflight handler through this
implementation. Verify browser access before connecting a GitHub Pages PWA;
a gateway/proxy may be required for reliable cross-origin calls.

## Removing old Apps Script project files

`finance_api_project_cleanup_v1.gs` contains a dry-run and a confirmed cleanup
function. The cleanup uses the Apps Script API `projects.updateContent`, which
replaces the project source. It preserves the three API files, this cleanup
file, and `appsscript.json`; it removes other `.gs`/HTML files and the two
known legacy installable triggers.

Before running it:

1. Make a copy of the Apps Script project.
2. Add `finance_api_v1.gs`, `finance_api_auth_v1.gs`,
   `finance_api_router_v1.gs`, and `finance_api_project_cleanup_v1.gs` to that
   project.
3. Enable the Apps Script API in your [Apps Script user settings](https://script.google.com/home/usersettings).
4. In `appsscript.json`, add these scopes to the existing `oauthScopes` list:
   `https://www.googleapis.com/auth/script.projects`,
   `https://www.googleapis.com/auth/script.external_request`,
   `https://www.googleapis.com/auth/script.scriptapp`,
   `https://www.googleapis.com/auth/spreadsheets.currentonly`, and
   `https://www.googleapis.com/auth/script.container.ui`.
5. Save the manifest and run `runFinanceApiV1ProjectCleanupDryRun()` from the
   Apps Script editor. The function requests any missing scopes; authorize
   the requested permissions, then inspect the execution log.
6. Run `runFinanceApiV1ProjectCleanup()` and enter
   `LIMPAR ARQUIVOS LEGADOS` at its confirmation prompt.

The function verifies the allowed file list before replacing project content
and verifies the result afterward. It keeps the manifest unchanged. The Apps
Script API updates the project HEAD, not existing deployed versions; deploy a
new Web App version after cleanup. Cleanup does not require the API's Script
Properties to be configured. Configure them and run `runFinanceApiV1SetupCheck()`
afterward, before using the API. Trigger removal is limited to the two known
legacy handlers visible to the account running the cleanup; review other
installed triggers in Apps Script if any were created by another user.

References: [Apps Script API project management](https://developers.google.com/apps-script/api/how-tos/manage-projects) and
[projects.updateContent](https://developers.google.com/apps-script/api/reference/rest/v1/projects/updateContent).
If the API still reports `ACCESS_TOKEN_SCOPE_INSUFFICIENT`, check **Overview
> Project OAuth Scopes** for `script.projects`, save `appsscript.json` again,
and rerun the function from the editor to refresh authorization.
