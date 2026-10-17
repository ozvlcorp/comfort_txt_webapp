# Comfort TXT

Employee portal connected to MoySklad. Public HTTPS entry page, personal MoySklad login and password, no ChatGPT sign-in. Existing visual design retained.

## Authentication

MOYSKLAD_ACCOUNT_ID pins the permitted company UUID. CONNECTION_ENCRYPTION_KEY is a 32-byte base64url runtime secret. Configure both through Sites runtime settings. The former shared API token and owner-email authentication are not used.

Each login validates the employee through the official MoySklad context endpoint using Basic Auth. Foreign-company and archived employees are rejected. Every protected request rechecks employee context and uses that employee's credentials for provider requests. Local creation checks supplement provider-side permissions; new orders are assigned to the signed-in employee. API availability is required. SSO-only and second-factor flows are not implemented; unsupported credentials fail explicitly. No provider tokens are generated or rotated.

A random 256-bit session ID is stored in a Secure, HttpOnly, SameSite=Strict, host-only cookie, valid for two hours. Only its SHA-256 hash is stored in D1. Basic credentials are AES-GCM encrypted in D1 using account/session-bound associated data; they never enter source, logs, browser storage or API responses. Logout deletes the session. Expired sessions and rate-limit records are deleted on subsequent authenticated traffic or login. Login attempts are limited atomically per hashed login and IP. Same-origin JSON is required for mutations. Switching the configured company invalidates prior-company sessions.

## Settings and operations

Organization, price type and an optional existing order status are selected from the employee's accessible API lists. Preferences and drafts are private to company/employee and stored in R2. USD/UZS rates come from MoySklad. Existing owner settings can be read once as defaults for the same company; the old shared credential is never used for requests.

New clients and orders require explicit submission. Orders are saved without a warehouse, conducting, payments or reservations. The responsible employee selects the fulfillment warehouse later in MoySklad. Server quotes validate fresh prices and stock, are signed and employee/account-bound, and expire after five minutes. syncId prevents repeated order creation. Orders are restricted server-side to the current employee’s owner reference, which this app assigns to the creator. Both list/search pages and direct order details enforce that scope, in addition to provider permissions. They also require the site source marker: externalCode must exactly equal comfort- followed by the order’s UUID syncId. The server generates this pair when creating an order; unmarked orders from MoySklad or other integrations are not exposed. Idempotent creation responses use the same gate. The provider query filters the owner and source prefix before pagination; the response is checked again before returning data. There is no owner override from request input and no administrator bypass. Pages of 100 cover that employee’s site-created orders across warehouses/organizations. MoySklad owner reassignment or edits to the source marker change this visibility; provider metadata is not an immutable historical author/provenance record. Order reading does not require order-creation preferences. Fulfillment and payments remain managed in MoySklad.

The first page uses personal login. The remember checkbox stores only the login name. Real business records are not written to localStorage, and logout clears the rendered workspace.

## Development and verification

UI sources: ui/. Backend: server/moysklad.mjs, server/employee-auth.mjs and server/security.mjs. D1 schema: db/schema.ts; generated immutable migrations: drizzle/. Run node server/moysklad.test.mjs for auth/security/order regression checks with actual SQLite and mocked provider calls. After UI edits run node scripts/generate-ui.mjs, then the Sites build helper. Preserve Site ID and public audience.

Read-only checks with the previously authorized token confirmed live catalogue, currency conversion, clients and orders. New personal password login is tested with provider fixtures; an actual employee password has not been supplied for end-to-end validation. No real documents are created during verification. Browser visual QA is unavailable in this environment.

API reference: https://dev.moysklad.ru/doc/api/remap/1.2/

## Mobile catalogue

Catalogue and the complete product-folder directory load immediately after personal login, including before order preferences have been saved. Quantities always represent the aggregate stock and reserves returned by MoySklad without a warehouse filter; without a price type, cards explicitly show that pricing is not selected. Order quotes require validated organization and price preferences. Saved warehouse preferences, including legacy defaults and request-supplied values, are ignored. Catalog, restored drafts and server confirmation use the same aggregate available stock (stock minus reserves); submission checks it again. This does not guarantee fulfillment from a single warehouse. Quotes signed before the warehouse-policy change require a new review, while existing successful orders retain idempotent responses. Category, search and positive-stock filters run against MoySklad before pagination, and stale search responses cannot replace a newer query. Catalog loading and retry errors are visible on product and stock pages.

The layout uses the bottom navigation and a scrollable cart/dialog on phones and tablets through 1366px; product columns adapt to available width, controls and text inputs are sized for touch, and safe-area padding protects screen edges and the home indicator. Browser automation is currently unavailable in this environment, so visual checks on real iOS/Android devices remain a validation limitation.

The current workspace section is reflected in an allowlisted URL fragment and restored on reload. The old `?connect=1` setup shortcut is removed from the address and no longer redirects users to settings. Anonymous access still requires employee sign-in; a fresh explicit login opens the home page.
