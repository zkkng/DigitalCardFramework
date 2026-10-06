import { operationContract, validateWireRequest, validateWireResponse } from './wire-contracts.js';
export class WireApiError extends Error {
    code;
    status;
    constructor(error, status) { super(error.message); this.name = 'WireApiError'; this.code = error.code; this.status = status; }
}
export function createWireTransport({ baseUrl = '/api', fetch: request = globalThis.fetch, principal }) {
    return async function call(id, input, options = {}) {
        const { path, method } = operationContract(id);
        validateWireRequest(id, input);
        const bindings = options.path ?? {};
        const resolved = path.replace(/\{([^}]+)\}/g, (_match, key) => {
            const value = bindings[key];
            if (typeof value !== 'string' || !value)
                throw new Error('Missing route parameter: ' + key);
            return encodeURIComponent(value);
        });
        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(options.query ?? {}))
            if (value !== undefined && value !== null)
                query.set(key, String(value));
        const headers = {};
        if (input !== undefined) {
            headers['Content-Type'] = 'application/json';
            const actor = principal();
            if (actor)
                headers['X-DC-Principal'] = actor;
        }
        const response = await request(baseUrl + resolved + (query.size ? '?' + query.toString() : ''), { method, credentials: 'same-origin', headers, body: input === undefined ? undefined : JSON.stringify(input), signal: options.signal });
        const value = await response.json();
        validateWireResponse(id, response.status, value);
        if (!response.ok)
            throw new WireApiError(value, response.status);
        return value;
    };
}
