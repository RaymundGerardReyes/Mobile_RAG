import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LocalLlmService } from '../../src/ai/runtime/local_llm_service.js';
import { MockLocalLlmAdapter } from '../../src/ai/runtime/mock_local_llm_adapter.js';
import { DiagnosticsLogger, ErrorCodes } from '../../src/diagnostics/diagnostics_logger.js';

describe('AI Runtime: LocalLlmService State Machine & Lifecycle', () => {
  it('follows standard transition cycle: ready -> loading -> loaded -> generating -> loaded -> releasing -> ready', async () => {
    const mock = new MockLocalLlmAdapter({ chunkDelayMs: 1 });
    const service = new LocalLlmService({ adapter: mock, inactivityTimeoutMs: 5000 });

    let status = await service.getStatus();
    assert.equal(status.state, 'ready');

    await service.load();
    status = await service.getStatus();
    assert.equal(status.state, 'loaded');

    const chunks: string[] = [];
    for await (const chunk of service.generate({ prompt: 'Explain the civil service' })) {
      chunks.push(chunk.text);
    }
    assert.ok(chunks.length > 0);

    status = await service.getStatus();
    assert.equal(status.state, 'loaded');

    await service.release();
    status = await service.getStatus();
    assert.equal(status.state, 'ready');
  });

  it('rejects loading when state is missing', async () => {
    const mock = new MockLocalLlmAdapter();
    const service = new LocalLlmService({ adapter: mock, initialState: 'missing' });

    await assert.rejects(
      async () => await service.load(),
      (err: any) => err.message.includes('missing')
    );
  });

  it('prevents concurrent generation calls and throws CONCURRENT_GENERATION_NOT_ALLOWED', async () => {
    const mock = new MockLocalLlmAdapter({ chunkDelayMs: 50 }); // slow generation
    const service = new LocalLlmService({ adapter: mock });
    await service.load();

    const gen1 = service.generate({ prompt: 'First generation prompt' });
    const iterator = gen1[Symbol.asyncIterator]();

    // Start first chunk
    await iterator.next();

    // Now attempt a concurrent call
    await assert.rejects(
      async () => {
        for await (const _ of service.generate({ prompt: 'Second conflicting prompt' })) {
          // should not reach here
        }
      },
      (err: any) => err.message === ErrorCodes.CONCURRENT_GENERATION_NOT_ALLOWED
    );

    // Consume remaining chunks to clean up
    while (true) {
      const res = await iterator.next();
      if (res.done) break;
    }
  });

  it('releases model automatically after inactivity timeout', async () => {
    const mock = new MockLocalLlmAdapter({ chunkDelayMs: 1 });
    // Use short 25ms inactivity timeout for test
    const service = new LocalLlmService({ adapter: mock, inactivityTimeoutMs: 25 });
    await service.load();

    let status = await service.getStatus();
    assert.equal(status.state, 'loaded');

    // Wait for inactivity timeout to fire
    await new Promise((r) => setTimeout(r, 60));

    status = await service.getStatus();
    assert.equal(status.state, 'ready');
  });

  it('immediately releases context on app backgrounded event', async () => {
    const mock = new MockLocalLlmAdapter();
    const service = new LocalLlmService({ adapter: mock });
    await service.load();

    assert.equal((await service.getStatus()).state, 'loaded');

    await service.onAppBackgrounded();

    assert.equal((await service.getStatus()).state, 'ready');
  });

  it('handles generation cancellation via AbortSignal cleanly', async () => {
    const mock = new MockLocalLlmAdapter({ chunkDelayMs: 20 });
    const service = new LocalLlmService({ adapter: mock });
    const controller = new AbortController();

    setTimeout(() => controller.abort(), 25);

    await assert.rejects(
      async () => {
        for await (const _ of service.generate({ prompt: 'Long running generation' }, controller.signal)) {
          // looping
        }
      },
      (err: any) => err.name === 'AbortError' || err.message?.includes('aborted')
    );

    const status = await service.getStatus();
    assert.equal(status.state, 'loaded');
    assert.equal(status.lastErrorCode, ErrorCodes.LLM_CANCELLED);
  });

  it('verify method transitions missing -> verifying -> ready on valid asset', async () => {
    const mock = new MockLocalLlmAdapter();
    const service = new LocalLlmService({ adapter: mock, initialState: 'missing' });
    assert.equal((await service.getStatus()).state, 'missing');

    const fakeStore = {
      resolveModelAsset: async () => ({
        manifestId: 'qwen-model-1',
        modelName: 'qwen.gguf',
        modelPath: '/app/models/qwen.gguf',
        sha256: 'valid-sha256',
        isBundled: true,
        fileSizeBytes: 1024,
      }),
      verifyChecksum: async () => true,
    };

    const verified = await service.verify(fakeStore, 'qwen-model-1');
    assert.equal(verified, true);
    assert.equal((await service.getStatus()).state, 'ready');
    assert.equal((await service.getStatus()).manifestId, 'qwen-model-1');
  });

  it('does not reset state to loaded if release is called during active generation', async () => {
    const mock = new MockLocalLlmAdapter({ chunkDelayMs: 30 });
    const service = new LocalLlmService({ adapter: mock });
    await service.load();

    const gen = service.generate({ prompt: 'Test concurrent release prompt' });
    const iterator = gen[Symbol.asyncIterator]();
    await iterator.next(); // started generating

    // Simulate app backgrounding while generating
    await service.onAppBackgrounded();
    assert.equal((await service.getStatus()).state, 'ready');

    // Drain remainder of generator
    try {
      while (true) {
        const res = await iterator.next();
        if (res.done) break;
      }
    } catch {
      // Ignored
    }

    // State MUST NOT have reverted to 'loaded'!
    assert.equal((await service.getStatus()).state, 'ready');
  });

  it('recovers to ready state on OOM error during generation', async () => {
    const errorAdapter = {
      getStatus: async () => ({ state: 'ready' as const }),
      load: async () => {},
      generate: async function* () {
        throw new Error('CUDA / Metal out of memory (OOM)');
      },
      release: async () => {},
    };

    const service = new LocalLlmService({ adapter: errorAdapter });
    await service.load();

    await assert.rejects(
      async () => {
        for await (const _ of service.generate({ prompt: 'Will OOM' })) {
          // loop
        }
      },
      (err: any) => err.message.includes('OOM')
    );

    const status = await service.getStatus();
    assert.equal(status.state, 'ready');
    assert.equal(status.lastErrorCode, ErrorCodes.LLM_OOM);
  });
});

