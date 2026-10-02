export interface CommittedAction {
  idempotencyKey: string;
  userId: string | null;
  source: Record<string, unknown>;
  params: Record<string, unknown>;
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
