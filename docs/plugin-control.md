# Run a delegated plugin command

`@digital-card/framework/plugin-host` provides the `digital-card-plugin@1` control protocol. An operator installs a service identity, exact version, credential, command grants and permitted account IDs. A plugin authenticates, obtains an expiring session, and invokes a command with a separate host-issued delegation. The [JSON Schema](plugin-protocol.schema.json) and package declarations describe the messages.

The implemented command profile is:

| Command | Framework operation | Authority |
| --- | --- | --- |
| `inventory.read` | `inventoryPage`, default limit 10, maximum 200 | Delegated owner's inventory; no caller-selected owner |
| `catalog.read` | `operatorCatalog` | Live `catalog.read` permission plus service and delegation grants |
| `purchase.quote` | `quote` | Current purchase terms for the delegated account |
| `purchase.register` | `registerCommandIntent` | Persists an exact reviewed quote; the server creates its retry key |
| `purchase.pending` | `commandIntents` | The delegated account's current purchase recovery head |
| `purchase.execute` | `commandIntent`, `executeCommandIntentAsync` | Retained account-owned purchase identity; original immutable input and receipt replay |
| `purchase.acknowledge` | `commandIntent`, `acknowledgeCommandIntent` | Resolves the original purchase head; repeated acknowledgment is safe |

Inventory and catalog commands perform reads. Purchase commands use the durable recovery flow below. Request IDs correlate replies; they are not durable economic receipt keys. Other mutations and remote strategy evaluation require separate contracts. The existing [committed action delivery](card-actions.md) protocol remains a separate route.

## Install the host handler

Use this handler in trusted server code. `resolveActor` must consult the current access authority on every call and return a verified framework principal for the supplied account ID, or `null`. Do not build its answer from plugin JSON, role claims or a cached delegation permission snapshot. `authorize` can further restrict current features and resource policy; only `true` permits a command.

```js
import {createServer} from 'node:http';
import {createPluginHost} from '@digital-card/framework/plugin-host';

const plugins = createPluginHost({
  framework,
  plugins: [{
    id: 'example.reader', version: '1.0.0',
    token: process.env.PLUGIN_TOKEN,
    commands: ['inventory.read'], userIds: permittedAccountIds,
  }],
  resolveActor: resolveCurrentVerifiedPrincipal,
  authorize: currentPluginResourcePolicy,
});
const server = createServer({maxHeaderSize: 8192}, async (request, response) => {
  if (await plugins.handle(request, response)) return;
  await existingApiHandler(request, response);
});
server.maxConnections = 32;
server.headersTimeout = 5000;
server.requestTimeout = 10000;
server.keepAliveTimeout = 5000;
server.listen(8080, '127.0.0.1');
```

`framework`, the verified-principal resolver, resource policy and existing API handler come from the installation. This standalone handler is not automatically mounted by the default host. Use HTTPS for remote transport or a trusted TLS proxy terminating to loopback. Cookie and Origin headers are rejected on the plugin endpoints; bearer credentials never replace a delegation or create a user identity. Imported card data cannot install a service.

After authenticating an account and authorizing its delegation to this installed plugin, trusted host code can issue a token:

```js
const delegation = plugins.issueDelegation({
  pluginId: 'example.reader', actor: verifiedPrincipal,
  commands: ['inventory.read'], ttlMs: 60000,
});
```

Deliver this opaque value securely to the service. The network protocol has no delegation-issuance or grant-administration endpoint. Tokens bind the account, service, generation, commands and expiry; principal permissions are resolved again before and after awaited command work.

## Invoke from Python or another language

The [Python standard-library example](../examples/plugins/python-plugin-client.py) performs handshake, scoped command and session cleanup without JavaScript authored by the plugin developer. Set `PLUGIN_CONTROL_URL`, `PLUGIN_TOKEN` and `PLUGIN_DELEGATION` securely, then run `python examples/plugins/python-plugin-client.py`. It reads one owned inventory item; `--catalog` requires a catalog delegation and live native permission. This transport example checks envelope identities and correlation; domain responses follow the published schema.

POST `/plugins/handshake` with JSON and `Authorization: Bearer …`:

```json
{"protocol":"digital-card-plugin@1","pluginId":"example.reader","version":"1.0.0"}
```

The reply includes the matching identity/version, opaque `sessionId`, ISO expiry, generation, current service commands and resource quotas. Multiple sessions can coexist. POST `/plugins/commands` with the same service credential and `X-DC-Delegation: …`:

```json
{"protocol":"digital-card-plugin@1","sessionId":"HOST_ISSUED_SESSION","requestId":"read-1","command":"inventory.read","input":{"limit":1}}
```

Use the real 43-character session token in place of the example placeholder. A successful reply correlates `requestId` and `command` and contains `result`. POST `/plugins/sessions/close` with `protocol` and `sessionId` to invalidate that session and its late work. Errors return the protocol, optional validated request ID and `{code,message,retryable}`; no credential is echoed.

## Expiry, revocation and limits

Defaults are a 10-second deadline, 64 KiB request, 1 MiB response, four admitted requests per service, sixteen globally, 256 sessions and 256 delegations. Each service has at most four live sessions. Sessions default to one minute and delegations to five minutes; neither may exceed five minutes. Body and output bounds are enforced in addition to the typed command limits. The operator must also bound TCP connections and header reads on the surrounding HTTP server.

`revokeDelegation(token)`, `setGrants(id, commands)`, `disable(id)` and `dispose()` fence active work. Disabling removes the credential mapping; reenable requires a new unique credential. Grant changes invalidate existing sessions and delegations. Resource authority, generation and expiry are checked again after awaited results. A timed-out callback that ignores cancellation retains its admission slot until it settles, preventing an unbounded backlog of abandoned tasks. Authority resolvers and policy adapters must honor the supplied abort signal.

The registry and tokens are ephemeral: restart requires another handshake and a newly authorized delegation. Session/delegation capacity refuses new grants with HTTP 507 instead of evicting live ones; expired entries are reclaimed. Excess admission returns HTTP 429, an expired or cancelled read returns HTTP 504, and malformed framework output cannot be returned as a successful typed response.

This control profile does not confer an OS sandbox, arbitrary framework dispatch, executable installation or provider authority. Full dependency selection, other mutable command profiles, upgrade/migration and portable policy/UI extension profiles remain separate contracts.

## Durable purchase recovery

Purchase grants require all six trusted adapters: `quote`, `commandIntents`, `registerCommandIntent`, `commandIntent`, `executeCommandIntentAsync` and `acknowledgeCommandIntent`. The retained lookup exposes only identity, owner, command and state. The host checks exact purchase ownership before execution or acknowledgment and refreshes live authority after an awaited lookup. It never dispatches a method named by JSON input.

Call `purchase.quote` with `{productId,quantity}`, review the returned product/catalog/admin revisions and integer price, then send that exact quote to `purchase.register`. Caller-selected keys and incomplete review terms are rejected. An existing unacknowledged purchase is returned unchanged, even when the proposed quote differs. Recover or acknowledge that original before proposing another purchase.

Call `purchase.execute` with `{id}`. If the reply is lost, use `purchase.pending`, then execute the retained ID again; the original durable receipt is returned without another debit. Deterministic rejection remains on the failed intent. Acknowledge only after confirming the original outcome; after acknowledgment, discovery is empty and an acknowledgment retry still succeeds through the retained identity lookup. `requestId` correlates a network reply; the server-owned intent key supplies economic deduplication.

Revocation, disconnect and deadline checks suppress late replies. A purchase can already be committed when that happens: cancellation does not roll it back. Reauthorize and recover the durable intent. A new session or host restart does not replace the account's original purchase head.

The Python example accepts `--command-json` with a single `{command,input}` object on stdin. The [Go transport example](../examples/plugins/go-plugin-client/main.go) accepts the same input and environment variables. Both use bounded HTTP requests, refuse credential redirects, correlate replies and close their session. They are transport examples; the host validates domain result contracts. Include the [Go runtime notices](../examples/plugins/go-action-receiver/THIRD_PARTY_NOTICES.txt) with Go source or binary distributions.

Build Go with `go -C examples/plugins/go-plugin-client build -mod=readonly -o /tmp/plugin-client .` and run `node test/plugin-purchase-conformance.mjs /tmp/plugin-client python3`. Use `--python-only` instead of the executable for Python qualification alone. Shared fixtures cover lost registration/execution/acknowledgment replies, retained originals, one debit on replay, account and command isolation, incomplete reviews and failed intent recovery.
