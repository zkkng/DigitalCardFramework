import type {ActionJson} from './action-contracts.js';
export {actionProtocol,actionDeliverySchema,validateActionDelivery,validateActionAcknowledgment} from './action-contracts.js';
export type {ActionJson,ActionDelivery,ActionAcknowledgment} from './action-contracts.js';
export interface CommittedAction {
  idempotencyKey: string;
  userId: string | null;
  source: Record<string, ActionJson>;
  params: Record<string, ActionJson>;
  signal?: AbortSignal;
}
export interface RemoteActionOptions {
  url: string | URL;
  pluginId: string;
  handlerId: string;
  token: string;
  timeoutMs?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  fetchImpl?: typeof fetch;
}
/** Invoke a configured receiver after the framework has committed a durable job. */
export declare function createRemoteActionHandler(
  options: RemoteActionOptions,
): (job: CommittedAction) => Promise<{ jobId: string; status: "completed" }>;
