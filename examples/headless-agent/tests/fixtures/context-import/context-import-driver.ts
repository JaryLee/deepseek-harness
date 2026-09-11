#!/usr/bin/env node
/** Test driver: import one foreign session through the real Loader composition. */

import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { SessionId } from '@deepseek-ai/dsh-session'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('context-import driver requires a config path')
const fixture = process.env.CONTEXT_IMPORT_FIXTURE
if (fixture === undefined) throw new Error('context-import driver requires CONTEXT_IMPORT_FIXTURE')

const ctx = await boot('context-import-e2e', resolveConfigPath(configPath, undefined))
try {
  const service = ctx.get('contextImport') as {
    importNewSession(options: { sourcePath: string; sessionId: unknown; cwd: string }): Promise<{
      events: unknown[]
      dropped: unknown[]
      sessionId: unknown
    }>
    list(): Promise<unknown[]>
    injectIntoCurrent(options: { agent: unknown; sourcePath: string }): Promise<{ injected: boolean; summary: string }>
  }
  const outcome = await service.importNewSession({
    sourcePath: fixture,
    sessionId: SessionId('imported-e2e'),
    cwd: process.cwd(),
  })
  const agent = ctx.agents.get(outcome.sessionId as never)
  const messages = agent?.session.deriveMessages().length ?? 0
  const foreign = (await service.list()).length
  console.log(`IMPORTED events=${outcome.events.length} messages=${messages} dropped=${outcome.dropped.length} foreign=${foreign}`)
  if (outcome.events.length === 0) throw new Error('context-import driver: empty import')
} finally {
  await ctx.fiber.dispose()
}
