/**
 * Import foreign CLI conversations into dsh.
 *
 * The plugin reads Codex and Claude Code session logs, translates one into a
 * dsh session seed, and either creates a new session seeded with that history
 * or injects a reduced rendering into the receiving session as `recall`-form
 * context. `/import` is the human entry point; the Web dialog reads the same
 * listing through {@link ContextImportApi.list}.
 *
 * @module @deepseek-ai/dsh-context-import
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
// Type-only: pulls the commands service merge that types ctx.commands.
import type {} from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import z from '@deepseek-ai/schemastery'
import { parseCodexSession } from './codex.ts'
import { parseClaudeSession } from './claude.ts'
import {
  canonicalTool,
  defaultClaudeRoot,
  defaultCodexIndexPath,
  defaultCodexRoot,
  detectForeignTool,
  extractTitle,
  listClaudeSessions,
  listCodexSessions,
  readCodexTitles,
  resolveCodexShards,
} from './discover.ts'
import { translateTranscript, type ForeignDrop, type TranslatedTranscript } from './translate.ts'
import type { ForeignSessionSummary, ForeignTool, ForeignTranscript } from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'context-import'

/** The command registry that owns `/import` and the agent registry that owns seeded sessions. */
export const inject = ['commands', 'agents']

/** Import sources and rendering bounds. Invalid values fail plugin load. */
export interface Config {
  /** Root of the Codex session logs. Omit for `$CODEX_HOME/sessions`, else `~/.codex/sessions`. */
  codexDir?: string
  /** Root of the Claude Code project logs. Omit for `$CLAUDE_CONFIG_DIR/projects`, else `~/.claude/projects`. */
  claudeDir?: string
  /**
   * Codex session index that carries the CLI's own conversation names.
   * Omit for `$CODEX_HOME/session_index.jsonl`, else `~/.codex/session_index.jsonl`.
   */
  codexIndexPath?: string
  /** Provider recorded on imported history when the foreign log names none. Omit to record the foreign tool. */
  provider?: string
  /** Model recorded on imported history when the foreign log names none. Omit to record `imported`. */
  model?: string
  /** Messages rendered verbatim at the tail of an injected transcript; earlier messages collapse to one line each. */
  injectTailMessages?: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  codexDir: z.string(),
  claudeDir: z.string(),
  codexIndexPath: z.string(),
  provider: z.string(),
  model: z.string(),
  injectTailMessages: z.number().step(1).min(0).default(8),
})

/** Outcome of one new-session import. */
export interface ImportOutcome {
  /** Session the imported history was published under. */
  readonly sessionId: SessionId
  /** Seed events written to the new session, contiguous from seq 0. */
  readonly events: readonly SessionEvent[]
  /** Foreign conversation elements the translation left out. */
  readonly dropped: readonly ForeignDrop[]
  /** Title the import would show for the conversation. */
  readonly title?: string
}

/** Outcome of one injection into the receiving session. */
export interface InjectOutcome {
  /** Whether the receiving session received context. */
  readonly injected: boolean
  /** One-line account of what was injected, or why nothing was. */
  readonly summary: string
}

/** The `contextImport` service: foreign listing plus both import modes. */
export interface ContextImportApi {
  /**
   * List every importable foreign session.
   * @returns Summaries newest first, with the CLI's own conversation names when the CLI recorded one.
   */
  list(): Promise<ForeignSessionSummary[]>
  /**
   * Read one foreign session and translate it into a dsh session seed.
   * @param sourcePath - Session file, or any shard of a multi-file Codex session.
   * @param tool - Dialect to read it as; omit to detect it from the log.
   * @returns The transcript and its translated seed.
   * @throws when the file is not a recognized foreign session or carries no conversation.
   */
  parse(sourcePath: string, tool?: ForeignTool): Promise<{
    readonly transcript: ForeignTranscript
    readonly events: TranslatedTranscript['events']
    readonly dropped: readonly ForeignDrop[]
  }>
  /**
   * Create a new session seeded with a foreign conversation.
   * @param options - Session file, identity to publish under, and working directory.
   * @returns The published session and what the translation left out.
   */
  importNewSession(options: {
    readonly sourcePath: string
    readonly sessionId: SessionId
    readonly cwd: string
  }): Promise<ImportOutcome>
  /**
   * Inject a reduced rendering of a foreign conversation into a live session.
   * @param options - Receiving agent and the foreign session file.
   * @returns Whether anything was injected, with a one-line account.
   */
  injectIntoCurrent(options: {
    readonly agent: Agent
    readonly sourcePath: string
  }): Promise<InjectOutcome>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    contextImport: ContextImportApi
  }
}

/** Longest foreign session id echoed back in command text. */
const ID_LIMIT = 40

/** Bounds every imported region so one hostile log cannot exhaust the seed. */
const MAX_IMPORTED_ENTRIES = 20_000

/** Usage line shared by a bare `/import` and `/import help`. */
const USAGE = 'usage: /import list | /import <codex|claude|claude-code> <session-id> | /import --inject <codex|claude|claude-code> <session-id>'

/**
 * Register the `/import` command and publish the `contextImport` service.
 * @param ctx - plugin context; every registration is disposed with it.
 * @param config - import roots, fallback route identity, and injection bounds.
 * @throws when `injectTailMessages` is not a non-negative safe integer.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const tailMessages = config.injectTailMessages ?? 8
  if (!Number.isSafeInteger(tailMessages) || tailMessages < 0) {
    throw new TypeError(`context-import: injectTailMessages must be a non-negative safe integer, got ${String(config.injectTailMessages)}`)
  }
  const roots = {
    codex: config.codexDir ?? defaultCodexRoot(),
    claude: config.claudeDir ?? defaultClaudeRoot(),
    codexIndex: config.codexIndexPath ?? defaultCodexIndexPath(),
  }
  const route = {
    ...(config.provider === undefined ? {} : { provider: config.provider }),
    ...(config.model === undefined ? {} : { model: config.model }),
  }

  /** Resolve shards, parse, and translate one foreign session. */
  const parseSource = async (sourcePath: string, tool?: ForeignTool) => {
    const dialect = tool ?? await detectForeignTool(sourcePath)
    if (dialect === undefined) {
      throw new Error(`context-import: "${sourcePath}" is not a recognized Codex or Claude Code session log`)
    }
    const transcript = dialect === 'codex'
      ? await parseCodexSession(await resolveCodexShards(sourcePath, roots.codex))
      : await parseClaudeSession(sourcePath)
    /* v8 ignore next -- V8 folds this guard's fall-through arm into the enclosing ternary's alternate range */
    if (transcript.entries.length === 0) {
      throw new Error(`context-import: "${sourcePath}" carries no importable conversation`)
    }
    const trimmed: ForeignTranscript = {
      ...transcript,
      // The configured route only fills a gap: the imported history keeps the
      // provider and model the foreign CLI actually recorded for it.
      ...(transcript.provider === undefined && route.provider !== undefined ? { provider: route.provider } : {}),
      ...(transcript.model === undefined && route.model !== undefined ? { model: route.model } : {}),
      entries: transcript.entries.slice(0, MAX_IMPORTED_ENTRIES),
    }
    const { events, dropped } = translateTranscript(trimmed)
    return { transcript, events, dropped }
  }

  const api: ContextImportApi = {
    list: async () => {
      const titles = await readCodexTitles(roots.codexIndex)
      return [
        ...await listCodexSessions(roots.codex, titles),
        ...await listClaudeSessions(roots.claude),
      ].sort((left, right) => {
        /* v8 ignore next -- both listings date every summary from a file mtime */
        const at = left.updatedAt ?? ''
        /* v8 ignore next -- both listings date every summary from a file mtime */
        const bt = right.updatedAt ?? ''
        return at === bt ? left.id.localeCompare(right.id) : bt.localeCompare(at)
      })
    },
    parse: async (sourcePath, tool) => await parseSource(sourcePath, tool),
    importNewSession: async (options) => {
      const { events, dropped, transcript } = await parseSource(options.sourcePath)
      await ctx.agents.create({
        sessionId: options.sessionId,
        meta: { cwd: options.cwd },
        seed: events,
      })
      const title = transcript.title
      return {
        sessionId: options.sessionId,
        events,
        dropped,
        ...(title === undefined ? {} : { title }),
      }
    },
    injectIntoCurrent: async (options) => {
      const { transcript } = await parseSource(options.sourcePath)
      const text = renderInjection(transcript, tailMessages)
      if (text === '') return { injected: false, summary: 'nothing to inject: the foreign transcript has no text' }
      options.agent.session.append('user/message', createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'plugin', plugin: name, form: 'recall' },
      }), { surfaceOp: 'append' })
      return { injected: true, summary: `injected ${transcript.entries.length} foreign entries from ${transcript.tool}` }
    },
  }
  ctx.effect(() => ctx.provide('contextImport', api), 'context-import: service')

  ctx.effect(() => ctx.commands.register({
    name: 'import',
    description: 'Import a Codex or Claude Code conversation into dsh',
    input: { hint: 'list | <codex|claude|claude-code> <session-id>' },
    handler: async (invocation) => {
      const words = invocation.rawInput.trim().split(/\s+/u).filter(word => word !== '')
      const [first, second, third] = words
      if (first === undefined) return { kind: 'success', text: USAGE }
      if (first === 'help') return { kind: 'success', text: USAGE }
      if (first === 'list') return { kind: 'success', text: await renderList(api) }
      const injecting = first === '--inject'
      const source = injecting ? second : first
      const foreignId = injecting ? third : second
      const tool = source === undefined ? undefined : canonicalTool(source)
      if (tool === undefined || foreignId === undefined) {
        return { kind: 'error', text: `expected codex, claude, claude-code, list, or help\n${USAGE}` }
      }
      try {
        const summary = (await api.list()).find(candidate => candidate.tool === tool && candidate.id === foreignId)
        if (summary === undefined) {
          return { kind: 'error', text: `no ${tool} session "${foreignId}" under the configured roots` }
        }
        const sourcePath = summary.sourcePaths[0]
        /* v8 ignore next -- discovery never yields a session without a file */
        if (sourcePath === undefined) return { kind: 'error', text: `no ${tool} session "${foreignId}" under the configured roots` }
        if (injecting) {
          const outcome = await api.injectIntoCurrent({ agent: invocation.agent, sourcePath })
          return { kind: 'success', text: outcome.summary }
        }
        const outcome = await api.importNewSession({
          sourcePath,
          sessionId: importedSessionId(tool, foreignId),
          cwd: summary.cwd ?? process.cwd(),
        })
        return {
          kind: 'success',
          text: `imported ${outcome.events.length} events into ${outcome.sessionId}${outcome.dropped.length === 0 ? '' : ` (dropped ${outcome.dropped.length})`}`,
        }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  }), 'context-import: /import command')
}

/**
 * Mint the dsh session id one foreign session imports into.
 *
 * The scheme is stable per foreign session, so re-importing the same
 * conversation targets the same identity instead of scattering copies.
 *
 * @param tool - Foreign dialect.
 * @param foreignId - Foreign session id.
 * @returns The branded dsh session id.
 */
export function importedSessionId(tool: ForeignTool, foreignId: string): SessionId {
  return brandString<SessionId>(`import-${tool}-${foreignId}`)
}

/**
 * Render the `/import list` listing.
 * @param api - The service that lists foreign sessions.
 * @returns One header line followed by one row per session, or an empty-state line.
 */
async function renderList(api: ContextImportApi): Promise<string> {
  const summaries = await api.list()
  if (summaries.length === 0) return 'import list · 可导入会话：none found under the configured roots'
  return `import list · 可导入会话：\n${summaries.map(renderSummary).join('\n')}`
}

/**
 * Render one listing row.
 *
 * The row is a wire format: the Web dialog parses it back into tool, id, label,
 * timestamp, size, and title, so the field order and separators are contract.
 *
 * @param summary - Session to render.
 * @returns One row: `<tool> <id>  (<label>, <stamp>, <size> KiB[, "<title>"])`.
 */
export function renderSummary(summary: ForeignSessionSummary): string {
  const label = summary.cwd ?? summary.sourcePaths[0] ?? ''
  const stamp = summary.updatedAt ?? ''
  const size = `${Math.max(1, Math.round(summary.sizeBytes / 1024))} KiB`
  const title = summary.title === undefined ? '' : `, ${JSON.stringify(summary.title)}`
  const id = summary.id.length <= ID_LIMIT ? summary.id : `${summary.id.slice(0, ID_LIMIT)}…`
  return `${summary.tool} ${id}  (${label}, ${stamp}, ${size}${title})`
}

/**
 * Render a foreign transcript for injection into a receiving session.
 *
 * The head collapses to one line per message so a long conversation costs
 * bounded context; the tail stays verbatim up to `tailMessages`.
 *
 * @param transcript - Transcript to render.
 * @param tailMessages - Trailing messages kept verbatim.
 * @returns The rendered context, or `''` when the transcript carries no text.
 */
export function renderInjection(transcript: ForeignTranscript, tailMessages: number): string {
  const messages = transcript.entries.filter((entry): entry is Extract<typeof entry, { kind: 'message' }> =>
    entry.kind === 'message' && entry.text.trim() !== '')
  if (messages.length === 0) return ''
  const head = messages.slice(0, Math.max(0, messages.length - tailMessages))
  const tail = messages.slice(Math.max(0, messages.length - tailMessages))
  const lines = [
    `Recalled from a ${transcript.tool} session${transcript.cwd === undefined ? '' : ` in ${transcript.cwd}`}:`,
    ...head.map(message => `- ${message.role}: ${extractTitle(message.text)}`),
    ...tail.map(message => `${message.role}: ${message.text}`),
  ]
  const summary = transcript.summary ?? transcript.title
  if (summary !== undefined) lines.unshift(summary)
  return lines.join('\n')
}
