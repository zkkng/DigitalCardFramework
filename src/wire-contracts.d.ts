import type {Operations} from './wire-types.js';
export class WireContractError extends Error {
  readonly code: 'INVALID_WIRE_CONTRACT';
  readonly operation: string;
  readonly phase: string;
  readonly errors: ReadonlyArray<unknown>;
  constructor(operation: string, phase: string, errors: ReadonlyArray<unknown>);
}
export function operationContract(id: keyof Operations): {path: string; method: string};
export function validateWireRequest<K extends keyof Operations>(id: K, value: unknown): Operations[K]['request'];
export function validateWireResponse(id: keyof Operations, status: number, value: unknown): unknown;
