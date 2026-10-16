import {
  GenerationChunk,
  GenerationRequest,
  LocalLlmPort,
  ModelRuntimeStatus,
} from '../../application/ports/local_llm_port.js';

export interface MockAdapterOptions {
  manifestId?: string;
  modelName?: string;
  responses?: string[];
  chunkDelayMs?: number;
  shouldFailLoad?: boolean;
  loadErrorCode?: string;
  shouldFailGeneration?: boolean;
  generationErrorCode?: string;
}

export class MockLocalLlmAdapter implements LocalLlmPort {
  private status: ModelRuntimeStatus;
  private responses: string[];
  private chunkDelayMs: number;
  private options: MockAdapterOptions;

  constructor(options: MockAdapterOptions = {}) {
    this.options = options;
    this.responses = options.responses ?? [
      'The Philippine Civil Service Commission was established under Article IX-B of the 1987 Philippine Constitution as the central personnel agency of the Government. According to page 12 of the textbook, its primary mandate is to ensure merit and fitness in civil service appointments.',
    ];
    this.chunkDelayMs = options.chunkDelayMs ?? 5;
    this.status = {
      state: 'ready',
      manifestId: options.manifestId ?? 'qwen-0.5b-q4_k_m',
      modelName: options.modelName ?? 'Qwen2.5-0.5B-Instruct-Q4_K_M.gguf',
    };
  }

  public setResponses(responses: string[]): void {
    this.responses = responses;
  }

  public setOptions(options: Partial<MockAdapterOptions>): void {
    this.options = { ...this.options, ...options };
    if (options.responses) this.responses = options.responses;
    if (options.chunkDelayMs !== undefined) this.chunkDelayMs = options.chunkDelayMs;
  }

  public async getStatus(): Promise<ModelRuntimeStatus> {
    return { ...this.status };
  }

  public async load(): Promise<void> {
    if (this.options.shouldFailLoad) {
      this.status = {
        state: 'ready',
        lastErrorCode: this.options.loadErrorCode ?? 'LLM_INIT_FAILED',
        lastErrorMessage: 'Mock simulated load failure',
      };
      throw new Error(this.status.lastErrorMessage);
    }
    this.status.state = 'loaded';
    this.status.peakMemoryBytes = 420 * 1024 * 1024; // 420 MB mock footprint
  }

  public async *generate(
    request: GenerationRequest,
    signal?: AbortSignal
  ): AsyncIterable<GenerationChunk> {
    if (this.status.state !== 'loaded') {
      await this.load();
    }

    if (this.options.shouldFailGeneration) {
      this.status.state = 'loaded';
      this.status.lastErrorCode = this.options.generationErrorCode ?? 'LLM_OOM';
      this.status.lastErrorMessage = 'Simulated out-of-memory during generation';
      throw new Error(this.status.lastErrorMessage);
    }

    this.status.state = 'generating';
    const textToEmit = this.responses[0] ?? 'Default generated response text.';
    const words = textToEmit.split(' ');

    try {
      for (let i = 0; i < words.length; i++) {
        if (signal?.aborted) {
          this.status.state = 'loaded';
          this.status.lastErrorCode = 'LLM_CANCELLED';
          throw new DOMException('Generation was aborted', 'AbortError');
        }

        if (this.chunkDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.chunkDelayMs));
        }

        const isLast = i === words.length - 1;
        const chunkText = isLast ? words[i]! : words[i]! + ' ';
        yield {
          text: chunkText,
          isComplete: isLast,
        };
      }
    } finally {
      if (this.status.state === 'generating') {
        this.status.state = 'loaded';
      }
    }
  }

  public async release(): Promise<void> {
    this.status.state = 'ready';
    this.status.peakMemoryBytes = 0;
  }
}

