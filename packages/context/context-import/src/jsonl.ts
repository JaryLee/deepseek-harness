import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

/** What a JSONL reader does with each line it reads. */
export interface JsonLineHandlers {
  /** Handle one parsed JSON value with its 1-based line number. */
  visit(value: unknown, line: number): void
  /** Handle a line that is neither blank nor valid JSON. */
  onMalformed(line: number): void
  /**
   * Stop reading the file after this returns true for a visited value.
   * Listing foreign sessions reads heads only: the logs reach gigabytes.
   */
  stop?(value: unknown): boolean
}

/**
 * Read a JSONL file one line at a time.
 *
 * Foreign session logs reach gigabytes, so lines are streamed and never
 * accumulated; callers keep only the entries they translate.
 *
 * @param path - File to read as UTF-8 JSONL.
 * @param handlers - Line handlers, including the optional early-stop predicate.
 * @returns Resolves once the whole file was read or `handlers.stop` asked to stop.
 */
export async function readJsonLines(path: string, handlers: JsonLineHandlers): Promise<void> {
  const input = createReadStream(path, { encoding: 'utf8' })
  const lines = createInterface({ input, crlfDelay: Infinity })
  let line = 0
  try {
    for await (const raw of lines) {
      line += 1
      const text = raw.trim()
      if (text === '') continue
      let value: unknown
      try {
        value = JSON.parse(text)
      } catch {
        // A foreign format is not a contract this plugin owns, so one line that
        // is not JSON is reported to the caller instead of failing the import.
        handlers.onMalformed(line)
        continue
      }
      handlers.visit(value, line)
      if (handlers.stop?.(value) === true) break
    }
  } finally {
    lines.close()
    input.destroy()
  }
}

/**
 * Read a foreign log record as a property bag.
 * @param value - Parsed JSON value of one line.
 * @returns The record, or `undefined` when the line was not a JSON object.
 */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/**
 * Read a string property from a foreign log record.
 * @param record - Property bag to read.
 * @param key - Property name.
 * @returns The value when it is a non-empty string, otherwise `undefined`.
 */
export function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}
