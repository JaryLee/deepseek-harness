/**
 * Pure parse and projection code behind the import dialog: the `/import list`
 * result text becomes {@link ImportRow}s, and those rows are grouped, filtered,
 * searched, and paged. No React and no ctx, so the wire parser is unit-tested
 * on its own.
 * @module @deepseek-ai/dsh-client-ui-context-import/client/rows
 */

/**
 * Foreign CLI dialect a row was discovered under. `claude` is the alias the
 * `/import` command accepts for `claude-code`; the listing always writes the
 * canonical spelling.
 */
export type ImportTool = 'codex' | 'claude-code'

/** Tool selection in the dialog; `all` lifts the filter. */
export type ImportToolFilter = 'all' | ImportTool

/** One importable foreign session, as the `/import list` row parses back. */
export interface ImportRow {
  readonly tool: ImportTool
  /** Foreign session id, possibly truncated by the host. */
  readonly id: string
  /** Working directory the listing reported; empty when the host has none. */
  readonly label: string
  /** ISO timestamp of the last foreign write; empty when the host has none. */
  readonly stamp: string
  /** Size in KiB as the listing rendered it. */
  readonly sizeKiB: number
  /** The CLI's own conversation name, when the host recorded one. */
  readonly title?: string
}

/** Result text of `/import` and `/import help`; the dialog opens on this prefix. */
export const IMPORT_USAGE_PREFIX = 'usage: '

/** First line of a non-empty `/import list` result, verbatim (wire copy). */
export const IMPORT_LIST_HEADER = 'import list · 可导入会话：'

/** The one row carried by an empty `/import list` result. */
const NONE_FOUND = 'none found under the configured roots'

/** Foreign dialects in display order. */
const TOOL_ORDER: readonly ImportTool[] = ['codex', 'claude-code']

const KNOWN_TOOLS: ReadonlySet<string> = new Set<string>(TOOL_ORDER)

/** Space the listing writes between a row's id and its parenthesized fields. */
const FIELD_GAP = '  '

/** Trailing segment of an optional row title, as `renderSummary` appends it. */
const TITLE_SUFFIX = /, ("(?:\\.|[^"\\])*")$/u

/** Number-and-unit text the listing renders for a row's size. */
const KIB = /^(\d+) KiB$/u

/** A foreign session id: one token, so the single-space boundary is unambiguous. */
const ID = /^\S+$/u

/** Page size of the dialog's result table. */
export const PAGE_SIZE = 8

/**
 * Whether result text is the `/import` usage line, the trigger for opening the
 * dialog.
 * @param text - a successful command result's text.
 * @returns true when the dialog should open for a bare `/import`.
 */
export function isImportUsage(text: string | undefined): boolean {
  return text !== undefined && text.startsWith(IMPORT_USAGE_PREFIX)
}

/**
 * Parse one `/import list` row.
 *
 * The listing separates the tool from the id with ONE space and the id from the
 * parenthesized fields with TWO, so the tool boundary is the first single
 * space; a row whose tool is unknown, whose id is empty, or whose fields are
 * not exactly label, timestamp, and size parses to undefined.
 *
 * @param line - one row exactly as `renderSummary` wrote it.
 * @returns the row, or undefined when the line does not match the wire format.
 */
export function parseImportRow(line: string): ImportRow | undefined {
  const separator = line.indexOf(' ')
  if (separator <= 0) return undefined
  const tool = line.slice(0, separator)
  if (!KNOWN_TOOLS.has(tool)) return undefined
  const rest = line.slice(separator + 1)
  const gap = rest.indexOf(FIELD_GAP)
  if (gap <= 0) return undefined
  const id = rest.slice(0, gap)
  if (!ID.test(id)) return undefined
  const body = rest.slice(gap + FIELD_GAP.length)
  if (!body.startsWith('(') || !body.endsWith(')')) return undefined
  const fields = body.slice(1, -1)

  // The title is JSON-encoded and therefore may carry commas; peel it off
  // before splitting the comma-separated label, timestamp, and size.
  let head = fields
  let title: string | undefined
  const titled = TITLE_SUFFIX.exec(fields)
  if (titled?.[1] !== undefined) {
    head = fields.slice(0, titled.index)
    title = parseTitle(titled[1])
  }

  const parts = head.split(',')
  if (parts.length !== 3) return undefined
  const [label, stamp, size] = parts as [string, string, string]
  // The listing writes one space after each comma; the label may also be
  // empty, and its leading space is not part of it.
  const sizeMatch = KIB.exec(size.trim())
  if (sizeMatch?.[1] === undefined) return undefined
  return {
    tool: tool as ImportTool,
    id,
    label,
    stamp: stamp.trim(),
    sizeKiB: Number(sizeMatch[1]),
    ...(title === undefined ? {} : { title }),
  }
}

/**
 * Parse the whole `/import list` result.
 * @param text - the command's successful result text.
 * @returns the parsed rows in listing order, deduplicated by tool and id.
 */
export function parseImportRows(text: string): ImportRow[] {
  if (!text.startsWith(IMPORT_LIST_HEADER)) return []
  const rows = text.split('\n').slice(1).flatMap((line) => {
    if (line === NONE_FOUND) return []
    const row = parseImportRow(line)
    return row === undefined ? [] : [row]
  })
  return dedupe(rows)
}

/**
 * Drop rows repeating a tool and id, keeping the first listing occurrence.
 * @param rows - parsed rows in listing order.
 * @returns rows with one entry per `tool + id`.
 */
export function dedupe(rows: readonly ImportRow[]): ImportRow[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    const key = `${row.tool}\u0000${row.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Decode the JSON-encoded title; a malformed one contributes no title. */
function parseTitle(encoded: string): string | undefined {
  try {
    const value: unknown = JSON.parse(encoded)
    return typeof value === 'string' && value !== '' ? value : undefined
  } catch {
    // The host JSON-encodes the title; a malformed one is ignored rather than
    // failing the whole listing.
    return undefined
  }
}

/**
 * Rows grouped by tool in display order, empty groups omitted.
 * @param rows - rows to group.
 * @returns one group per tool carrying at least one row.
 */
export function groupByTool(rows: readonly ImportRow[]): { tool: ImportTool; rows: ImportRow[] }[] {
  const groups: { tool: ImportTool; rows: ImportRow[] }[] = []
  for (const tool of TOOL_ORDER) {
    const own = rows.filter(row => row.tool === tool)
    if (own.length > 0) groups.push({ tool, rows: own })
  }
  return groups
}

/**
 * Apply the tool filter and the case-insensitive `title ?? id` search.
 * @param rows - deduplicated rows.
 * @param tool - selected tool, or `all`.
 * @param query - raw search text.
 * @returns matching rows in listing order.
 */
export function filterRows(
  rows: readonly ImportRow[],
  tool: ImportToolFilter,
  query: string,
): ImportRow[] {
  const needle = query.trim().toLowerCase()
  return rows.filter((row) => {
    if (tool !== 'all' && row.tool !== tool) return false
    if (needle === '') return true
    return (row.title ?? row.id).toLowerCase().includes(needle)
  })
}

/** One page of results and its position, as the footer renders it. */
export interface ImportPage {
  readonly rows: ImportRow[]
  /** 1-based position of this page. */
  readonly page: number
  /** Total pages; 1 while there are no matches. */
  readonly pages: number
  readonly hasPrevious: boolean
  readonly hasNext: boolean
}

/**
 * Slice one page of rows, clamping an out-of-range position to the last page.
 * @param rows - rows after filtering.
 * @param requestedPage - 0-based page index the dialog asked for.
 * @returns the page slice plus its position and neighbour availability.
 */
export function pageOf(rows: readonly ImportRow[], requestedPage: number): ImportPage {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const page = Math.min(Math.max(0, Math.trunc(requestedPage)), pages - 1)
  return {
    rows: rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    page: page + 1,
    pages,
    hasPrevious: page > 0,
    hasNext: page < pages - 1,
  }
}

/**
 * The row's visible name: the CLI's conversation title when recorded, else the id.
 * @param row - the row.
 * @returns the name to render.
 */
export function rowName(row: ImportRow): string {
  return row.title ?? row.id
}

/**
 * Render the listing's ISO timestamp as a compact local `YYYY-MM-DD hh:mm`.
 * @param stamp - ISO timestamp from the listing, or an empty string.
 * @returns the local rendering, or the input verbatim when it is not a time.
 */
export function formatStamp(stamp: string): string {
  const at = new Date(stamp)
  if (Number.isNaN(at.getTime())) return stamp
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}
