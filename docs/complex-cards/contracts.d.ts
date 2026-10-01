/** Proposed API sketch, contract 0.1.0. These are NOT current package exports. */
export type Digest = `sha256:${string}`;
export type Quality = 'poster' | 'lite' | 'standard' | 'ultra';
export type Side = 'front' | 'back';
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface PresentationRef {
  digest: Digest;
  contractVersion: '0.1.0';
}

/** The host constructs this public DTO. Never pass the full private copy record. */
export interface CardPresentation {
  presentation: PresentationRef;
  title: string;
  copyId?: string;
  editionLabel?: string;
  appearanceSeed?: string;
  publicInputs: Record<string, Json>;
}

export interface ViewInputs {
  tilt: { x: number; y: number }; // [-1,1]; provider clamps/validates.
  pointer: { x: number; y: number; active: boolean };
  pressed: boolean;
  focused: boolean;
  revealProgress: number;
  flipProgress: number;
  host: Readonly<Record<string, Json>>;
}

export interface ViewResult {
  quality: Quality;
  mode: 'interactive' | 'poster';
  fallbackReason?: string;
  buildDigest?: Digest;
}

export type CardEvent =
  | { type: 'ready'; result: ViewResult }
  | { type: 'qualityChanged'; from: Quality; to: Quality; reason: string }
  | { type: 'fallback'; reason: string; side: Side }
  | { type: 'assetError'; assetId: string; code: string }
  | { type: 'interaction'; action: 'tilt' | 'flip' | 'activate' }
  | { type: 'intent'; name: string; payload: Json }
  | { type: 'disposed' };

export interface CardView {
  readonly element: HTMLElement;
  /** Resolves for a usable poster too. Rejects on fatal error or pre-ready disposal. */
  readonly ready: Promise<ViewResult>;
  setInputs(input: Partial<ViewInputs>): void;
  setVisibility(state: 'visible' | 'prewarm' | 'hidden'): void;
  setQuality(maximum: Quality): void;
  setSide(side: Side): void;
  snapshot(options?: { side?: Side; maxEdge?: number }): Promise<Blob>;
  /** Idempotent. Cancels pending work; no callbacks may resurrect the view. */
  dispose(): void;
}

export interface ResolvedAsset {
  assetId: string;
  digest: Digest;
  mediaType: string;
  url: string;
  expectedBytes: number;
}

export interface PresentationResolver {
  resolve(ref: PresentationRef, signal: AbortSignal): Promise<ResolvedPresentation>;
  asset(ref: PresentationRef, assetId: string, signal: AbortSignal): Promise<ResolvedAsset>;
}

export interface ResolvedPresentation {
  ref: PresentationRef;
  descriptorVersion: '0.1.0';
  /** Parsed and semantically validated by a versioned schema, not arbitrary eval. */
  manifest: Readonly<Record<string, Json>>;
  availableBuilds: ReadonlyArray<{
    digest: Digest;
    quality: Quality;
    requiredCapabilities: readonly string[];
    estimatedGpuBytes: number;
  }>;
}

export interface ResourceBudget {
  /** Includes render targets; renderTargetBytes below is a sub-limit. */
  estimatedGpuBytes: number;
  renderTargetBytes: number;
  activeVideoDecoders: number;
  maxDpr: number;
  maxGraphOperationsPerUpdate: number;
}

export interface PlayerStage {
  mount(target: HTMLElement, model: CardPresentation, options?: {
    quality?: Quality;
    side?: Side;
    inputMode?: 'host' | 'pointer' | 'drag';
    onEvent?: (event: CardEvent) => void;
  }): CardView;
  setBudget(budget: Partial<ResourceBudget>): void;
  diagnostics(): Readonly<{
    views: number;
    activeViews: number;
    scheduledFrames: number;
    estimatedGpuBytes: number;
    assetReferences: number;
    pendingJobs: number;
    requestedVideoDecoders: number;
  }>;
  dispose(): void;
}

export interface PlayerOptions {
  /** A contiguous host region; mount targets must be descendants of this root. */
  root: HTMLElement;
  resolver: PresentationResolver;
  adapters: readonly RendererAdapter[]; // Host-installed implementations only.
  budget: ResourceBudget;
  motion: 'respect-preference' | 'static';
  allowAudio: boolean;
  allowConnectedContent: boolean;
}

export declare function createPlayerStage(options: PlayerOptions): PlayerStage;

export interface RendererAdapter {
  id: string;
  version: string;
  playerApiRange: string;
  capabilities: readonly string[];
  /** Selects a compiled plan and reports cost. No download of arbitrary plugins. */
  supports(descriptor: ResolvedPresentation, quality: Quality): boolean;
  /** Public lifecycle; backend-specific drawing ABI is separately versioned. */
  create(context: AdapterContext, plan: Readonly<Record<string, Json>>): Promise<AdapterInstance>;
}

export interface AssetLease {
  readonly assetId: string;
  readonly estimatedBytes: number;
  /** Opaque to portable content; the registered backend understands this handle. */
  readonly handle: unknown;
  release(): void;
}

export interface AdapterContext {
  signal: AbortSignal;
  backend: { id: string; apiVersion: string; port: unknown };
  acquire(assetId: string): Promise<AssetLease>;
  invalidate(): void;
  report(event: Extract<CardEvent, {type:'assetError' | 'fallback'}>): void;
}

export interface AdapterInstance {
  /** Synchronous bounded update. No adapter-owned requestAnimationFrame loop. */
  update(frame: {
    inputs: Readonly<ViewInputs>;
    activeTimeSeconds: number;
    deltaSeconds: number;
    quality: Quality;
  }): { dirty: boolean; needsTime: boolean };
  render(): void;
  setVisibility(visible: boolean): void;
  /** Releases every acquired lease; safe during partial initialization. */
  dispose(): void;
}

export interface EffectRecipeDescriptor {
  id: string;
  version: string;
  parameterSchema: Readonly<Record<string, Json>>;
  inputPorts: Readonly<Record<string, 'number' | 'boolean' | 'vec2' | 'color'>>;
  targetKinds: readonly string[];
  fallback: { kind: 'bake' | 'simplify' | 'omit-decorative'; recipeId?: string };
  trust: 'host-installed';
}

export interface OwnershipProvider {
  id: string;
  resolve(subject: string, identity: Json, signal: AbortSignal): Promise<{
    state: 'owned' | 'not-owned' | 'pending' | 'stale' | 'unavailable';
    authority: string;
    checkedAt: string;
    evidenceVersion: string;
    evidence: Json;
  }>;
  /** Transfer protocols are separately specified; ownership lookup is not a transfer. */
}

/** Example: a host controls all layout; stage resources are explicitly scoped. */
export declare function mountHostExample(
  leftPanel: HTMLElement,
  rightPanel: HTMLElement,
  first: CardPresentation,
  second: CardPresentation,
  stage: PlayerStage
): { dispose(): void };
