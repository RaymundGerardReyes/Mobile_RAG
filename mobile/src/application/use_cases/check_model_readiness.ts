import { ModelAssetStore, VerifiedModelAsset } from '../ports/model_asset_store.js';
import { LocalLlmPort, ModelRuntimeStatus } from '../ports/local_llm_port.js';
import { DiagnosticsLogger, ErrorCodes } from '../../diagnostics/diagnostics_logger.js';

export interface ModelReadinessResult {
  isReady: boolean;
  status: ModelRuntimeStatus;
  asset: VerifiedModelAsset | null;
  checksumVerified: boolean;
  error?: string | null;
}

export class CheckModelReadiness {
  private assetStore: ModelAssetStore;
  private llmPort: LocalLlmPort;
  private logger: DiagnosticsLogger;

  constructor(
    assetStore: ModelAssetStore,
    llmPort: LocalLlmPort,
    logger?: DiagnosticsLogger
  ) {
    this.assetStore = assetStore;
    this.llmPort = llmPort;
    this.logger = logger ?? DiagnosticsLogger.getInstance();
  }

  public async execute(manifestId?: string): Promise<ModelReadinessResult> {
    // 1. Transition state machine to 'verifying'
    if (typeof (this.llmPort as any).setState === 'function') {
      (this.llmPort as any).setState('verifying');
    }

    try {
      const asset = await this.assetStore.resolveModelAsset(manifestId);
      if (!asset) {
        if (typeof (this.llmPort as any).setState === 'function') {
          (this.llmPort as any).setState('missing');
        }
        const updatedStatus = await this.llmPort.getStatus();
        this.logger.warn('model_readiness', 'Model asset not found in storage', ErrorCodes.MODEL_NOT_FOUND);
        return {
          isReady: false,
          status: updatedStatus,
          asset: null,
          checksumVerified: false,
          error: 'Model asset file not found',
        };
      }

      const isValidHash = await this.assetStore.verifyChecksum(asset.modelPath, asset.sha256);
      if (!isValidHash) {
        if (typeof (this.llmPort as any).setState === 'function') {
          (this.llmPort as any).setState('missing');
        }
        const updatedStatus = await this.llmPort.getStatus();
        this.logger.error('model_readiness', 'Model SHA-256 checksum mismatch', ErrorCodes.MODEL_HASH_MISMATCH);
        return {
          isReady: false,
          status: updatedStatus,
          asset,
          checksumVerified: false,
          error: 'Model SHA-256 checksum failed validation',
        };
      }

      // Success: transition to 'ready'
      if (typeof (this.llmPort as any).setState === 'function') {
        (this.llmPort as any).setState('ready');
      }
      const updatedStatus = await this.llmPort.getStatus();

      this.logger.info('model_readiness', `Model ${asset.manifestId} verified successfully`);
      return {
        isReady: updatedStatus.state === 'ready' || updatedStatus.state === 'loaded',
        status: updatedStatus,
        asset,
        checksumVerified: true,
        error: null,
      };
    } catch (err: any) {
      if (typeof (this.llmPort as any).setState === 'function') {
        (this.llmPort as any).setState('missing');
      }
      const updatedStatus = await this.llmPort.getStatus();
      this.logger.error('model_readiness', `Model readiness check error: ${err?.message}`, ErrorCodes.MODEL_NOT_FOUND);
      return {
        isReady: false,
        status: updatedStatus,
        asset: null,
        checksumVerified: false,
        error: err?.message,
      };
    }
  }
}

