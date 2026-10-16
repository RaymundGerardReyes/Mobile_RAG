export type ModelRuntimeState =
  | 'missing'
  | 'verifying'
  | 'ready'
  | 'loading'
  | 'loaded'
  | 'generating'
  | 'releasing';

export interface ModelRuntimeStatus {
  state: ModelRuntimeState;
  manifestId?: string;
  modelName?: string;
  peakMemoryBytes?: number;
  lastErrorCode?: string;
  lastErrorMessage?: string;
}

export interface GenerationRequest {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  stopTokens?: string[];
}

export interface GenerationChunk {
  text: string;
  isComplete: boolean;
}

export interface LocalLlmPort {
  getStatus(): Promise<ModelRuntimeStatus>;
  load(): Promise<void>;
  generate(
    request: GenerationRequest,
    signal?: AbortSignal
  ): AsyncIterable<GenerationChunk>;
  release(): Promise<void>;
}

