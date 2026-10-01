import { check, integer, FrameworkError } from './catalog.js';

/** Read-only provider bridge. The provider verifies its own authenticated upstream response. */
export function createCodeGateway({ framework, providers = {}, timeoutMs = 15000 }) {
  integer(timeoutMs, 'provider timeout', 1, 120000);
  return {
    async reconcile(actor, { codeId }) {
      const material = framework.codeLookupMaterial(actor, codeId);
      const provider = Object.hasOwn(providers, material.providerId) && providers[material.providerId];
      check(typeof provider?.lookup === 'function', 'NO_CODE_PROVIDER', 'Automatic status lookup is not configured for this code', 404);
      const controller = new AbortController(); let timer;
      try {
        const response = await Promise.race([
          Promise.resolve().then(async () => {
            try { return await provider.lookup({ ...material, signal: controller.signal }); }
            catch { throw new FrameworkError('CODE_PROVIDER_ERROR', 'Code status could not be verified; retry later', 502); }
          }),
          new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new FrameworkError('PROVIDER_TIMEOUT', 'Code status is still unverified; retry later', 504)); }, timeoutMs); }),
        ]);
        check(!controller.signal.aborted, 'PROVIDER_TIMEOUT', 'Code status lookup timed out', 504);
        check(response?.codeId === codeId && ['unknown', 'redeemed', 'revoked'].includes(response.status), 'INVALID_PROVIDER', 'Provider returned an invalid code status', 502);
        if (response.status === 'unknown') return { codeId, status: 'unverified' };
        return framework.confirmCodeStatus({ permissions: ['codes.confirm'], codeProviderIds: [material.providerId] }, {
          codeId, providerId: material.providerId, eventId: response.eventId, status: response.status, occurredAt: response.occurredAt,
        });
      } catch (error) {
        if (error instanceof FrameworkError) throw error;
        throw new FrameworkError('CODE_PROVIDER_ERROR', 'Code status could not be verified; retry later', 502);
      } finally { clearTimeout(timer); controller.abort(); }
    },
  };
}
