import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, type StreamChunk } from '@deepseek-ai/dsh-llm'

/** Deterministic adapter: the import under test seeds history and runs no turn. */
class ContextImportMockAdapter extends LlmAdapter {
  async * stream(): AsyncIterable<StreamChunk> {
    const text = 'context import verified'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'context-import-mock-llm'
export const inject = ['llm']

/**
 * Register the test-only `context-import-mock` adapter.
 * @param ctx - plugin context owning the llm registry.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['context-import-mock'], new ContextImportMockAdapter())
}
