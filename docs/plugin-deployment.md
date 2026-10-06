# Deploying scoped plugin services

`@digital-card/framework/plugin-deployment` wraps the [authenticated command host](plugin-control.md) with reviewed manifests, configuration validation, dependency readiness, draining and replacement. The operator supplies already installed external services and their credentials. This module does not download executables, spawn processes, run migrations or install browser code.

The [manifest schema](plugin-manifest.schema.json) describes `digital-card-plugin-manifest@1`. A manifest declares an exact identity/version, supported control protocol, command capabilities, exact dependency versions, configuration schema and runtime prerequisites. Declaring a capability does not grant it: installations select a subset and explicit permitted account IDs. Network messages cannot install manifests or change these grants.

```js
import {createPluginDeployment} from '@digital-card/framework/plugin-deployment';

const deployment = createPluginDeployment({
  framework: trustedFrameworkAdapters,
  resolveActor: resolveCurrentVerifiedActor,
  manifests: reviewedManifests,
  installations: [{
    id: 'example.buyer',
    token: operatorServiceCredential,
    commands: ['purchase.quote', 'purchase.register', 'purchase.pending',
      'purchase.execute', 'purchase.acknowledge'],
    userIds: permittedAccountIds,
    configuration: {region: 'local'},
  }],
  authorize: ({actor, configuration}) =>
    configuration.region === 'local' && accountMayUsePlugins(actor.userId),
});
```

The adapters and account authorization functions in this example are supplied by trusted host code. Mount `deployment.handle(request, response)` using the same HTTPS/loopback, HTTP connection/header bounds and live principal adapters as the command host. The default production server does not automatically mount it. Use `deployment.issueDelegation` only after verifying the account and authorizing the selected commands.

## Manifest and configuration bounds

There are at most 100 manifests, each limited to 64 KiB, 24 levels and 10,000 JSON nodes. Each manifest has at most 32 dependencies and 16 runtime prerequisites. Duplicate identities, self-dependencies, cycles, missing dependencies and incompatible exact versions fail before admission. Runtime language/prerequisite fields are operator metadata; their declaration does not install a toolchain or qualify that language.

Configuration schemas have an object root. The supported subset is `type`, `properties`, `required`, `additionalProperties`, `items`, `minItems`, `maxItems`, `minLength`, `maxLength`, `minimum`, `maximum`, `enum`, `const`, `description` and `title`. External references, asynchronous validators, executable keywords, formats and regular expressions are rejected. Each installation configuration has the same JSON size/depth/node bounds and must match its schema. Authorization receives a fresh configuration copy; configuration cannot create a principal, role or service grant.

Dependency readiness means every transitive dependency has an enabled service and a live authenticated handshake session. A session is an expiring readiness lease, not a process-health probe. Services must renew their session before expiry and close old sessions; the underlying four-session-per-service limit still applies. A closed or expired dependency session fails command authorization, including after awaited work. `status()` reports the same transitive readiness used by admission, with memoized graph evaluation.

## Drain, disable and replace

`drain(id)` also marks dependents as draining. It rejects new `purchase.register` commands and continues read/recovery commands, including execution and acknowledgment of retained purchase intents. It does not cancel or erase already registered purchases. Wait for `status().active` to reach zero before replacement; a callback that ignores cancellation retains its active slot until it settles.

`disable(id)` disables the service and all transitive dependents, revoking their credentials, sessions and delegations. `enable(id, {token, commands})` requires a fresh credential and grants within the existing manifest. Enabled dependents still need authenticated dependency leases before commands can run. Credential history retains hashes only, up to 4,096 entries; new rotation/replacement refuses capacity with HTTP 507 rather than making old credentials reusable.

To replace the deployment, drain every service and call:

```js
deployment.replace({
  manifests: reviewedReplacementManifests,
  installations: replacementInstallationsWithFreshCredentials,
  migrationApproved: ['example.buyer'],
});
```

The candidate graph, configurations and grants are validated before the old host is disposed. A version change declaring `runtime.migration: 'operator-required'` requires its ID in `migrationApproved`. This is the trusted operator's attestation that required migration work was completed; the wrapper does not execute or verify external migrations. Every replacement requires fresh service credentials, new handshakes and new delegations. Invalid candidates leave the old deployment available for recovery while drained.

The framework instance and durable intent ledger are retained. A purchase committed before disconnect, timeout or revocation remains recoverable through its original intent and receipt after replacement. Removing a service from the replacement graph uninstalls its command access; it does not delete its external data or the account's purchase history. Accounts can recover retained purchases through another authorized service or the normal account client. Back up the framework ledger and external service data separately using their storage procedures.

This deployment profile covers existing scoped framework commands. Provider hooks, arbitrary mutable commands, process restart supervision, remote policy replacement and browser contribution installation require their respective contracts and qualification.
