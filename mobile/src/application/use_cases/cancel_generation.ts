import { DiagnosticsLogger, ErrorCodes } from '../../diagnostics/diagnostics_logger.js';

export interface CancelGenerationRequest {
  controller: AbortController;
  runId?: string;
  reason?: string;
}

export class CancelGeneration {
  private logger: DiagnosticsLogger;

  constructor(logger?: DiagnosticsLogger) {
    this.logger = logger ?? DiagnosticsLogger.getInstance();
  }

  public execute(request: CancelGenerationRequest): boolean {
    try {
      if (!request.controller.signal.aborted) {
        request.controller.abort(request.reason || 'User cancelled generation');
        this.logger.info('llm_generation', 'Generation aborted via CancelGeneration use case', {
          runId: request.runId,
          errorCode: ErrorCodes.LLM_CANCELLED,
        });
        return true;
      }
      return false;
    } catch (err: any) {
      this.logger.warn('llm_generation', `Error during generation cancellation: ${err?.message}`);
      return false;
    }
  }
}

