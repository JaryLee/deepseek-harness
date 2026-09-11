/**
 * The `/import list` wire parser and the listing projections the dialog renders
 * from: rows with and without titles, the empty listing, a malformed title, the
 * comma-free working-directory assumption, dedupe, filter, search, grouping,
 * and paging.
 */
import { describe, expect, it } from 'vitest'
import {
  dedupe, filterRows, formatStamp, groupByTool, IMPORT_LIST_HEADER, isImportUsage, PAGE_SIZE,
  pageOf, parseImportRow, parseImportRows, rowName, type ImportRow,
} from '../src/client/rows.ts'

/** One listing row exactly as the Host renders it. */
function rowLine(over: {
  tool?: string
  id?: string
  label?: string
  stamp?: string
  size?: string
  title?: string
} = {}): string {
  const {
    tool = 'codex', id = 'abc-123', label = '/work/repo',
    stamp = '2026-02-03T04:05:06.000Z', size = '12 KiB', title,
  } = over
  return `${tool} ${id}  (${label}, ${stamp}, ${size}${title === undefined ? '' : `, ${JSON.stringify(title)}`})`
}

/** A listing text: header plus the given rows. */
function listing(...lines: string[]): string {
  return [IMPORT_LIST_HEADER, ...lines].join('\n')
}

/** One parsed row, spelled out for assertion readability. */
function parsed(over: Partial<ImportRow> = {}): ImportRow {
  return {
    tool: 'codex',
    id: 'abc-123',
    label: '/work/repo',
    stamp: '2026-02-03T04:05:06.000Z',
    sizeKiB: 12,
    ...over,
  }
}

describe('isImportUsage', () => {
  it('accepts the usage line and rejects everything else', () => {
    expect(isImportUsage('usage: /import list | /import <codex|claude|claude-code> <session-id>')).toBe(true)
    expect(isImportUsage(`${IMPORT_LIST_HEADER}\n${rowLine()}`)).toBe(false)
    expect(isImportUsage('imported 4 events into import-codex-abc')).toBe(false)
    expect(isImportUsage(undefined)).toBe(false)
  })
})

describe('parseImportRow', () => {
  it('parses a row without a title', () => {
    expect(parseImportRow(rowLine())).toEqual(parsed())
  })

  it('parses a row with a JSON title', () => {
    expect(parseImportRow(rowLine({ title: 'fix the build' }))).toEqual(parsed({ title: 'fix the build' }))
  })

  it('parses a title that carries a comma and full-width characters', () => {
    const title = '修复登录，顺便补测试'
    const line = rowLine({ title })
    expect(line).toContain(', "') // the JSON title rides inside the same parentheses
    expect(parseImportRow(line)).toEqual(parsed({ title }))
    expect(parseImportRow(rowLine({ title: 'a, "b", c' }))).toEqual(parsed({ title: 'a, "b", c' }))
    expect(parseImportRow(rowLine({ title: 'with \\ backslash' }))).toEqual(parsed({ title: 'with \\ backslash' }))
  })

  it('parses the claude-code dialect and an empty working directory', () => {
    expect(parseImportRow(rowLine({ tool: 'claude-code', label: '' })))
      .toEqual(parsed({ tool: 'claude-code', label: '' }))
  })

  it('splits on the first comma, so a comma-bearing path yields an unusable row', () => {
    // The listing guarantees a comma-free working directory; the parser reads
    // the first comma as the field separator either way.
    expect(parseImportRow(rowLine({ label: '/work/re,po' }))).toBeUndefined()
  })

  it('treats a shared prefix as the tool, so an unknown dialect is rejected', () => {
    expect(parseImportRow(rowLine({ tool: 'cursor' }))).toBeUndefined()
    expect(parseImportRow(rowLine({ tool: 'code' }))).toBeUndefined()
  })

  it('ignores a malformed title without failing the row', () => {
    // A quoted title whose body is not JSON: the field boundary is recognized,
    // the decode fails, and the row survives without a title.
    expect(parseImportRow('codex abc-123  (/work/repo, 2026-02-03T04:05:06.000Z, 12 KiB, "bad\\q")'))
      .toEqual(parsed())
    // A trailing field that is not a quoted title at all leaves one field too many.
    expect(parseImportRow('codex abc-123  (/work/repo, 2026-02-03T04:05:06.000Z, 12 KiB, {oops})'))
      .toBeUndefined()
  })

  it('decodes a numeric-looking JSON title', () => {
    // The host JSON-encodes the title verbatim, so `"42"` is the string '42'.
    expect(parseImportRow('codex abc-123  (/work/repo, 2026-02-03T04:05:06.000Z, 12 KiB, "42")'))
      .toEqual(parsed({ title: '42' }))
  })

  it('rejects a trailing field that is not a quoted title', () => {
    // A bare token is not a title, so the row then carries one field too many.
    expect(parseImportRow('codex abc-123  (/work/repo, 2026-02-03T04:05:06.000Z, 12 KiB, 42)'))
      .toBeUndefined()
  })

  it('ignores an empty title', () => {
    expect(parseImportRow(rowLine({ title: '' }))).toEqual(parsed())
  })

  it('rejects a row whose tool and id are not separated by one space', () => {
    expect(parseImportRow('codex  abc-123  (/work/repo, 2026-02-03T04:05:06.000Z, 12 KiB)')).toBeUndefined()
    expect(parseImportRow('codex')).toBeUndefined()
    expect(parseImportRow(' codex abc-123  (/work/repo, 2026-02-03T04:05:06.000Z, 12 KiB)')).toBeUndefined()
    expect(parseImportRow('codex\u00a0abc-123  (/work/repo, 2026-02-03T04:05:06.000Z, 12 KiB)')).toBeUndefined()
  })

  it('rejects a row with no id', () => {
    expect(parseImportRow('codex   (/work/repo, 2026-02-03T04:05:06.000Z, 12 KiB)')).toBeUndefined()
    expect(parseImportRow('codex ')).toBeUndefined()
  })

  it('rejects rows whose fields are missing, extra, or unparenthesized', () => {
    expect(parseImportRow('codex abc-123  (/work/repo, 2026-02-03T04:05:06.000Z)')).toBeUndefined()
    expect(parseImportRow('codex abc-123  (/work/repo, 2026-02-03T04:05:06.000Z, 12 KiB, x)')).toBeUndefined()
    expect(parseImportRow('codex abc-123  /work/repo, 2026-02-03T04:05:06.000Z, 12 KiB)')).toBeUndefined()
    expect(parseImportRow('codex abc-123  (/work/repo, 2026-02-03T04:05:06.000Z, 12)')).toBeUndefined()
    expect(parseImportRow('codex abc-123  (/work/repo, 2026-02-03T04:05:06.000Z, twelve KiB)')).toBeUndefined()
  })

  it('rejects a line with no field gap at all', () => {
    expect(parseImportRow('')).toBeUndefined()
    expect(parseImportRow('  (/work/repo, 2026-02-03T04:05:06.000Z, 12 KiB)')).toBeUndefined()
  })
})

describe('parseImportRows', () => {
  it('returns no rows for a text that is not the listing', () => {
    expect(parseImportRows('usage: /import list')).toEqual([])
    expect(parseImportRows('')).toEqual([])
  })

  it('returns no rows for the empty listing', () => {
    expect(parseImportRows([IMPORT_LIST_HEADER, 'none found under the configured roots'].join('\n')))
      .toEqual([])
  })

  it('returns no rows for a bare header', () => {
    expect(parseImportRows(IMPORT_LIST_HEADER)).toEqual([])
  })

  it('parses a two-line listing mixing codex and claude-code', () => {
    const text = listing(
      rowLine({ id: 'a', size: '1 KiB' }),
      rowLine({ id: 'b', tool: 'claude-code', label: '', title: 'second' }),
    )
    expect(parseImportRows(text)).toEqual([
      parsed({ id: 'a', sizeKiB: 1 }),
      parsed({ tool: 'claude-code', id: 'b', label: '', title: 'second' }),
    ])
  })

  it('drops unparseable rows and keeps the rest', () => {
    expect(parseImportRows(listing('not a row', rowLine({ id: 'kept' })))).toEqual([parsed({ id: 'kept' })])
  })

  it('deduplicates by tool and id, keeping the first occurrence', () => {
    const text = listing(
      rowLine({ id: 'dup', title: 'first' }),
      rowLine({ id: 'dup', title: 'second' }),
      rowLine({ id: 'dup', tool: 'claude-code', title: 'other tool' }),
    )
    expect(parseImportRows(text)).toEqual([
      parsed({ id: 'dup', title: 'first' }),
      parsed({ tool: 'claude-code', id: 'dup', title: 'other tool' }),
    ])
  })
})

describe('dedupe', () => {
  it('keeps one row per tool and id', () => {
    expect(dedupe([
      parsed({ id: 'x' }), parsed({ id: 'x', tool: 'claude-code' }), parsed({ id: 'x' }),
    ])).toEqual([parsed({ id: 'x' }), parsed({ id: 'x', tool: 'claude-code' })])
  })
})

describe('groupByTool', () => {
  it('groups in display order and omits empty groups', () => {
    expect(groupByTool([
      parsed({ tool: 'claude-code', id: 'c' }),
      parsed({ tool: 'codex', id: 'a' }),
      parsed({ tool: 'codex', id: 'b' }),
    ])).toEqual([
      { tool: 'codex', rows: [parsed({ id: 'a' }), parsed({ id: 'b' })] },
      { tool: 'claude-code', rows: [parsed({ tool: 'claude-code', id: 'c' })] },
    ])
    expect(groupByTool([parsed({ tool: 'claude-code' })])).toEqual([
      { tool: 'claude-code', rows: [parsed({ tool: 'claude-code' })] },
    ])
    expect(groupByTool([])).toEqual([])
  })
})

describe('filterRows', () => {
  const rows = [
    parsed({ id: 'aaa', title: 'Fix the Build' }),
    parsed({ id: 'bbb' }),
    parsed({ id: 'ccc', tool: 'claude-code', title: 'Refactor' }),
  ]

  it('filters by tool, and lifts the filter for all', () => {
    expect(filterRows(rows, 'all', '').map(row => row.id)).toEqual(['aaa', 'bbb', 'ccc'])
    expect(filterRows(rows, 'codex', '').map(row => row.id)).toEqual(['aaa', 'bbb'])
    expect(filterRows(rows, 'claude-code', '').map(row => row.id)).toEqual(['ccc'])
  })

  it('searches the title when there is one and the id otherwise, case-insensitively', () => {
    expect(filterRows(rows, 'all', 'BUILD').map(row => row.id)).toEqual(['aaa'])
    expect(filterRows(rows, 'all', 'bbb').map(row => row.id)).toEqual(['bbb'])
    // A titled row is searched by its title, not by its id.
    expect(filterRows(rows, 'all', 'aaa')).toEqual([])
  })

  it('trims the query and treats a blank one as no search', () => {
    expect(filterRows(rows, 'all', '   ').map(row => row.id)).toEqual(['aaa', 'bbb', 'ccc'])
    expect(filterRows(rows, 'all', '  bbb  ').map(row => row.id)).toEqual(['bbb'])
  })
})

describe('pageOf', () => {
  const many = Array.from({ length: PAGE_SIZE * 2 + 1 }, (_unused, index) => parsed({ id: `id-${index}` }))

  it('reports one page while there are no rows', () => {
    expect(pageOf([], 0)).toEqual({ rows: [], page: 1, pages: 1, hasPrevious: false, hasNext: false })
  })

  it('slices the requested page and reports its neighbours', () => {
    expect(pageOf(many, 0).rows.map(row => row.id)).toEqual(
      many.slice(0, PAGE_SIZE).map(row => row.id),
    )
    expect(pageOf(many, 1)).toMatchObject({ page: 2, pages: 3, hasPrevious: true, hasNext: true })
    expect(pageOf(many, 2)).toMatchObject({ page: 3, pages: 3, hasPrevious: true, hasNext: false })
    expect(pageOf(many, 2).rows).toHaveLength(1)
  })

  it('clamps a position past the end and a negative one', () => {
    expect(pageOf(many, 9)).toMatchObject({ page: 3, hasNext: false })
    expect(pageOf(many, -3)).toMatchObject({ page: 1, hasPrevious: false })
  })

  it('fits exactly on a page boundary without an empty trailing page', () => {
    const exact = many.slice(0, PAGE_SIZE)
    expect(pageOf(exact, 1)).toMatchObject({ page: 1, pages: 1, rows: exact })
  })
})

describe('rowName', () => {
  it('prefers the recorded title over the id', () => {
    expect(rowName(parsed({ title: 'named' }))).toBe('named')
    expect(rowName(parsed())).toBe('abc-123')
  })
})

describe('formatStamp', () => {
  it('renders an ISO timestamp as a compact local time', () => {
    const stamp = '2026-02-03T04:05:06.000Z'
    const at = new Date(stamp)
    const pad = (value: number) => String(value).padStart(2, '0')
    expect(formatStamp(stamp)).toBe(
      `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`,
    )
  })

  it('returns an unparseable stamp verbatim', () => {
    expect(formatStamp('')).toBe('')
    expect(formatStamp('not a time')).toBe('not a time')
  })
})
