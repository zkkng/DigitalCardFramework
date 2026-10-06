import type { Operations, Schemas } from './wire-types.js';
export declare class WireApiError extends Error {
    readonly code: string;
    readonly status: number;
    constructor(error: Schemas['Error'], status: number);
}
export interface WireTransportOptions {
    baseUrl?: string;
    fetch?: typeof globalThis.fetch;
    principal: () => string | null;
}
export interface WireCallOptions<K extends keyof Operations> {
    path?: Operations[K]['path'];
    query?: Record<string, string | number | boolean | null | undefined>;
    signal?: AbortSignal;
}
export declare function createWireTransport({ baseUrl, fetch: request, principal }: WireTransportOptions): <K extends keyof Operations>(id: K, input: Operations[K]['request'], options?: WireCallOptions<K>) => Promise<Operations[K]['response']>;
