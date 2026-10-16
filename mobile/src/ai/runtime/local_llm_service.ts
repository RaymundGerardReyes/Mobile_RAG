import {
  GenerationChunk,
  GenerationRequest,
  LocalLlmPort,
  ModelRuntimeState,
  ModelRuntimeStatus,
} from '../../application/ports/local_llm_port.js';
import { ModelAssetStore } from '../../application/ports/model_asset_store.js';
import { DiagnosticsLogger, ErrorCodes } from '../../diagnostics/diagnostics_logger.js';

export interface LocalLlmServiceOptions {
  adapter: LocalLlmPort;
  logger?: DiagnosticsLogger;
  inactivityTimeoutMs?: number; // Default 3 minutes (180,000 ms)
  initialState?: ModelRuntimeState;
  manifestId?: string;
  modelName?: string;
}

export class LocalLlmService implements LocalLlmPort {
  private adapter: LocalLlmPort;
  private logger: DiagnosticsLogger;
  private state: ModelRuntimeState;
  private manifestId?: string;
  private modelName?: string;
  private lastErrorCode?: string;
  private lastErrorMessage?: string;
  private inactivityTimeoutMs: number;
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private isGenerating = false;

  constructor(options: LocalLlmServiceOptions) {
    this.adapter = options.adapter;
    this.logger = options.logger ?? DiagnosticsLogger.getInstance();
    this.state = options.initialState ?? 'ready';
    this.manifestId = options.manifestId;
    this.modelName = options.modelName;
    this.inactivityTimeoutMs = options.inactivityTimeoutMs ?? 180000;
  }

  public async getStatus(): Promise<ModelRuntimeStatus> {
    const adapterStatus = await this.adapter.getStatus();
    return {
      state: this.state,
      manifestId: this.manifestId ?? adapterStatus.manifestId,
      modelName: this.modelName ?? adapterStatus.modelName,
      peakMemoryBytes: adapterStatus.peakMemoryBytes,
      lastErrorCode: this.lastErrorCode ?? adapterStatus.lastErrorCode,
      lastErrorMessage: this.lastErrorMessage ?? adapterStatus.lastErrorMessage,
    };
  }

  public setState(state: ModelRuntimeState): void {
    const prev = this.state;
    this.state = state;
    this.logger.debug('llm_state_machine', `State transition: ${prev} -> ${state}`);
  }

  /**
   * Verifies the model asset integrity and transitions state:
   * Missing -> Verifying -> Ready (or back to Missing on error).
   */
  public async verify(assetStore: ModelAssetStore, manifestId?: string): Promise<boolean> {
    this.setState('verifying');
    try {
      const asset = await assetStore.resolveModelAsset(manifestId);
      if (!asset) {
        this.setState('missing');
        this.lastErrorCode = ErrorCodes.MODEL_NOT_FOUND;
        this.lastErrorMessage = 'Model asset file not found';
        return false;
      }

      const isValid = await assetStore.verifyChecksum(asset.modelPath, asset.sha256);
      if (!isValid) {
        this.setState('missing');
        this.lastErrorCode = ErrorCodes.MODEL_HASH_MISMATCH;
        this.lastErrorMessage = 'Model SHA-256 checksum mismatch';
        return false;
      }

      this.manifestId = asset.manifestId;
      this.modelName = asset.modelName;
      this.lastErrorCode = undefined;
      this.lastErrorMessage = undefined;
      this.setState('ready');
      return true;
    } catch (err: any) {
      this.setState('missing');
      this.lastErrorCode = ErrorCodes.MODEL_NOT_FOUND;
      this.lastErrorMessage = err?.message;
      return false;
    }
  }

  public async load(): Promise<void> {
    if (this.state === 'loaded') {
      this.resetInactivityTimer();
      return;
    }

    if (this.state === 'missing') {
      const msg = 'Cannot load model: model file is missing';
      this.lastErrorCode = ErrorCodes.MODEL_NOT_FOUND;
      this.lastErrorMessage = msg;
      this.logger.error('llm_state_machine', msg, ErrorCodes.MODEL_NOT_FOUND);
      throw new Error(msg);
    }

    this.clearInactivityTimer();
    this.setState('loading');

    try {
      await this.adapter.load();
      this.setState('loaded');
      this.resetInactivityTimer();
    } catch (err: any) {
      this.setState('ready');
      this.lastErrorCode = ErrorCodes.LLM_INIT_FAILED;
      this.lastErrorMessage = err?.message || 'Adapter load failed';
      this.logger.error('llm_state_machine', `Model load failed: ${this.lastErrorMessage}`, ErrorCodes.LLM_INIT_FAILED);
      throw err;
    }
  }

  public async *generate(
    request: GenerationRequest,
    signal?: AbortSignal
  ): AsyncIterable<GenerationChunk> {
    if (this.isGenerating) {
      const msg = 'Concurrent model generation is not permitted in mobile runtime';
      this.logger.warn('llm_state_machine', msg, ErrorCodes.CONCURRENT_GENERATION_NOT_ALLOWED);
      throw new Error(ErrorCodes.CONCURRENT_GENERATION_NOT_ALLOWED);
    }

    this.clearInactivityTimer();

    if (this.state !== 'loaded') {
      await this.load();
    }

    this.isGenerating = true;
    this.setState('generating');

    try {
      for await (const chunk of this.adapter.generate(request, signal)) {
        yield chunk;
      }
    } catch (err: any) {
      if (signal?.aborted || err?.name === 'AbortError') {
        this.lastErrorCode = ErrorCodes.LLM_CANCELLED;
        this.logger.info('llm_state_machine', 'Generation cancelled by user', {
          errorCode: ErrorCodes.LLM_CANCELLED,
        });
      } else if (err?.message?.includes('OOM') || err?.message?.includes('out of memory')) {
        this.lastErrorCode = ErrorCodes.LLM_OOM;
        this.lastErrorMessage = err?.message;
        this.logger.error('llm_state_machine', 'Generation OOM: releasing context', ErrorCodes.LLM_OOM);
        try {
          await this.adapter.release();
        } catch {
          // ignore
        }
        this.setState('ready');
      } else {
        this.lastErrorCode = 'LLM_RUNTIME_ERROR';
        this.lastErrorMessage = err?.message;
        this.logger.error('llm_state_machine', `Generation error: ${err?.message}`, this.lastErrorCode);
      }
      throw err;
    } finally {
      this.isGenerating = false;
      // Only transition back to loaded if still generating (not released to ready or missing)
      if (this.state === 'generating') {
        this.setState('loaded');
        this.resetInactivityTimer();
      }
    }
  }

  public async release(): Promise<void> {
    this.clearInactivityTimer();
    if (this.state === 'ready' || this.state === 'missing') {
      return;
    }

    this.setState('releasing');
    try {
      await this.adapter.release();
    } catch (err: any) {
      this.logger.warn('llm_state_machine', `Adapter release warning: ${err?.message}`);
    } finally {
      this.setState('ready');
    }
  }

  /**
   * Called by app lifecycle listener when app transitions to background on iOS.
   * Immediately releases memory to avoid iOS Jetsam termination.
   */
  public async onAppBackgrounded(): Promise<void> {
    this.logger.info('llm_lifecycle', 'App backgrounded: releasing LLM context from memory');
    await this.release();
  }

  private resetInactivityTimer(): void {
    this.clearInactivityTimer();
    if (this.inactivityTimeoutMs <= 0) return;

    this.inactivityTimer = setTimeout(async () => {
      this.logger.info('llm_lifecycle', `Inactivity timeout (${this.inactivityTimeoutMs}ms): releasing model context`);
      await this.release();
    }, this.inactivityTimeoutMs);

    // Unref timer in Node so it doesn't hold test runner process open
    if (typeof (this.inactivityTimer as any)?.unref === 'function') {
      (this.inactivityTimer as any).unref();
    }
  }

  private clearInactivityTimer(): void {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }
}
