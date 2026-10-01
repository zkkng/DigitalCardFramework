# Identity and access: complete default, replaceable host

The framework owns collector records, inventory, albums, trades and authorization of card operations. An identity provider owns login credentials, account recovery and MFA. The default production host uses OpenID Connect with PKCE, state and nonce validation, plus durable encrypted opaque sessions. Hosts with existing users can replace identity resolution. No client-provided role, user ID or permission array is trusted.

This separation follows [OpenID Connect's identity contract](https://openid.net/specs/openid-connect-core-1_0.html) and [OWASP's authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html): deny unmatched privileged operations and check every request. Resource ownership checks remain in domain commands as well as route checks.

## Default access

| Actor | Allowed |
|---|---|
| Visitor | Public catalog, availability and public albums |
| Collector | Own collection, acquisition/opening, own albums/preferences, permitted trades and binding use |
| Artist (host-defined grants) | Upload and inspect/cancel own art jobs; optionally preview catalog changes |
| Publisher (host-defined grants) | Publish approved art and catalog/pack definitions |
| Operator/admin | All enumerated administrative permissions |

Newly signed-in users become collectors. They receive no upload, pack-definition, currency-grant or administrative permissions. “Open a pack” and “define a pack's price/odds” are different operations. The default production UI hides the creator workspace from collectors; direct API requests remain forbidden.

## Implemented permissions

`@digital-card/framework/access` exports `PERMISSIONS`, `hasPermission`, `publicPermissions` and `authorizePresentation`.

- Catalog: `catalog.read`, `catalog.preview`, `catalog.publish`.
- Operations: `accounts.register`, `currency.grant`, `audit.read`, `events.read`, `maintenance.run`.
- Trading: `trading.manage` for live rules and individual copy locks.
- Shops: `commerce.manage` for issuance/settings and `raffles.draw` for scheduled allocations.
- Account rewards: `actions.manage` for diagnostics/retry; `actions.dispatch` for trusted workers.
- Codes: `codes.manage`, `codes.import`, `codes.confirm`.
- External funding: `currency.settle`.
- Artwork: `art.import`, `art.review`, `art.publish`, `art.moderate`.

Trusted principals have `{userId, role:'player'|'admin', permissions?:string[], disabled?:boolean}`. The permission list allows staff roles without making them full admins. Admin grants all **known** permissions; unknown actions still fail. Collection commands continue checking the current user's ownership, trade participants, locks, private fields and feature policies. A staff permission does not permit stealing another user's card or accessing their private binding data.

The presentation store expects `{id,...principal}` and an explicit authorizer:

```js
import {authorizePresentation} from '@digital-card/framework/access';
const store = await createPresentationStore({
  root, authorize: authorizePresentation, scan: sandboxedMediaScanner
});
// Map verified userId to id at the host boundary.
```

Creators can inspect/cancel their own jobs; `art.review` can inspect/cancel all jobs. Publishing and quarantine require separate permissions. The storage helper does not infer these grants from the uploaded file. Its authorizer is replaceable for installations needing project/organization-scoped checks. The default is installation-wide RBAC; it does not claim multi-tenant row isolation.

## Existing website integration

At the HTTP boundary supply `resolveIdentity(request)` to `createApiHandler`. Verify the existing website's server session or token, resolve its stable account ID, map `(issuer, subject)` to a framework user, then return a trusted principal. Ignore request-body roles. Use the same authenticated principal for artwork APIs.

The default auth host also accepts synchronous `resolveAccess({issuer, subject, userId})`, evaluated on **every** request. Return `{role, permissions}` or null/`{disabled:true}`. This supports immediate grant revocation without waiting for a session to expire. If your source is asynchronous, use a custom asynchronous HTTP identity resolver or a securely refreshed local policy store. A Promise is rejected by the synchronous default callback.

`HOST_MODULE` can supply `identityProvider` and `resolveAccess`; a custom identity provider no longer needs dummy OIDC environment settings. Legacy `OPERATOR_SUBJECTS` is an explicit admin bootstrap list for the single configured provider. With multiple providers, use `resolveAccess` and match issuer **and** subject; never promote by display name or unverified email. No first-visitor-becomes-admin behavior exists.

```js
// Server-owned configuration, not downloaded card data.
export function resolveAccess(identity) {
  if(identity.issuer !== configuredIssuer) return null;
  if(blockedSubjects.has(identity.subject)) return null;
  return {permissions: grantsBySubject.get(identity.subject) ?? []};
}
```

Use the identity provider's MFA/recovery/admin console instead of inventing a password database. For a standalone installation, configuring that provider, the first operator, durable storage and secrets is required setup. The framework includes the collector application and session adapter; it is not a turnkey identity-provider service.

## Remaining product work and boundaries

- No built-in role-management UI, account suspension console, service-token issuer or scoped multi-tenant organization model yet. Host policy can supply/revoke grants now. Do not claim these consoles exist.
- The reference art demo is a static editor/export playground. It does not receive production database credentials or accept shared server uploads. Local editing alone cannot publish packs into a live catalog.
- Production presentation routes must be mounted behind verified identity, CSRF/origin controls, rate limits and a sandboxed media scan. They are an opt-in server module, not silently exposed by the static demo.
- Staff audit reporting and separation of artist/reviewer/publisher workflows can grow around these permissions. Exactly-once publication and approval records belong to the server publisher, not browser checkboxes.
- Machine publishers should use a host-verified service identity with narrow grants. No browser interaction is required by the commands; use proper host credentials rather than a fake browser session or client-supplied admin flag.

Tests cover direct API escalation attempts, creator versus publisher separation, own-job restrictions, disabled admins, permission revocation in an existing session and unchanged catalog state after forbidden requests. This is verified access infrastructure, not an independent security audit.
