import type {Client} from './client.js';
import type {Localization, LocalizationMessages} from './localization.js';
import type {Schemas} from './wire-types.js';

export type CodeRevealMode = 'open' | 'scratch' | 'peel';
export interface CodeRevealInput {codeId: string; mode?: CodeRevealMode}
export interface CodeRevealHost {
  reveal(input: Schemas['CodeCommand']): {code: string} | PromiseLike<{code: string}>;
  key?: () => string;
}
export type CodeRevealState =
  | {phase: 'covered' | 'loading' | 'disposed'; code: null; error: null; diagnostic?: never}
  | {phase: 'revealed'; code: string; error: null; diagnostic?: never}
  | {phase: 'error'; code: null; error: string; diagnostic: {code: string | undefined; message: string; name: string | undefined}};
export interface CodeRevealController {
  getState(): CodeRevealState;
  subscribe(listener: (state: CodeRevealState) => void): () => boolean;
  /** Reuses an in-flight request and retry key; failures and disposal resolve undefined. */
  open(): Promise<string | undefined>;
  dispose(): void;
}
export function createCodeRevealController(options: CodeRevealHost & {codeId: string}): CodeRevealController;
export interface CodeUILocalizationOptions {
  locale?: string;
  messages?: LocalizationMessages;
  localization?: Localization;
}
export interface CodeRevealOptions extends CodeRevealHost, CodeUILocalizationOptions {
  threshold?: number;
  /** Whether the original view may receive focus after a retryable reveal error. */
  isCurrent?: () => boolean;
}
export interface CodeRevealView {
  node: HTMLElement;
  controller: CodeRevealController;
  dispose(): void;
}
export function renderCodeReveal(input: CodeRevealInput, options: CodeRevealOptions): CodeRevealView;
export type CodeHistoryClient = Pick<Client, 'codeHistory' | 'revealCode' | 'reportCodeUsage' | 'requestKey'> & Partial<Pick<Client, 'reconcileCode' | 'principal'>>;
export type CodeHistoryRevealRenderer = (input: CodeRevealInput, options: {
  reveal: CodeRevealHost['reveal'];
  key: () => string;
  localization: Localization;
  isCurrent?: () => boolean;
}) => (HTMLElement & {dispose?(): void; controller?: CodeRevealController}) | {node: HTMLElement; dispose?(): void; controller?: CodeRevealController};
export interface CodeHistoryOptions<Model = unknown> extends CodeUILocalizationOptions {
  client: CodeHistoryClient;
  codeRevealRenderer?: CodeHistoryRevealRenderer;
  getPrincipal?: () => string | null;
  isCurrentModel?: (captured: Model) => boolean;
}
export interface CodeHistoryView {
  node: HTMLElement;
  /** Resolves after the initial load; handled loading failures appear in the rendered status. */
  ready: Promise<void>;
  dispose(): void;
}
/** History is read through the client; the model can identify the original account/view for retry focus. */
export function renderCodeHistory<Model = unknown>(model: Model, options: CodeHistoryOptions<Model>): CodeHistoryView;
