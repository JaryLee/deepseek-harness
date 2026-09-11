#!/usr/bin/env node
/** Test driver: import one foreign session through the real Loader composition. */

import type {} from '@deepseek-ai/dsh-agent'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ContextImportApi } from '../../src/index.ts'
import { bootProductionProfile } from '../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('context-import driver requires a config path')
const fixture = process.env.CONTEXT_IMPORT_FIXTURE
if (fixture === undefined) throw new Error('context-import driver requires CONTEXT_IMPORT_FIXTURE')

const ctx = await bootProductionProfile({
  binName: 'context-import-e2e',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})
try {
  const service = ctx.get('contextImport') as ContextImportApi
  const outcome = await service.importNewSession({
    sourcePath: fixture,
    sessionId: SessionId('imported-e2e'),
    cwd: process.cwd(),
  })
  const agent = ctx.agents.get(outcome.sessionId)
  const messages = agent?.session.deriveMessages().length ?? 0
  const foreign = (await service.list()).length
  console.log(`IMPORTED events=${outcome.events.length} messages=${messages} dropped=${outcome.dropped.length} foreign=${foreign}`)
  if (outcome.events.length === 0) throw new Error('context-import driver: empty import')
} finally {
  await ctx.fiber.dispose()
}
