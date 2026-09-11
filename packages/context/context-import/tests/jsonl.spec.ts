import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { asRecord, readJsonLines, stringField } from '../src/jsonl.ts'
import { removeTempRoots, tempRoot } from './harness.ts'

afterAll(removeTempRoots)

describe('readJsonLines', () => {
  it('visits each JSON line with its 1-based number and skips blank lines', async () => {
    const root = await tempRoot('jsonl-visit')
    const path = await root.write('log.jsonl', ['{"a":1}', '', '   ', '{"b":2}'])
    const visited: Array<[unknown, number]> = []

    await readJsonLines(path, { visit: (value, line) => visited.push([value, line]), onMalformed: () => {} })

    expect(visited).toEqual([[{ a: 1 }, 1], [{ b: 2 }, 4]])
  })

  it('reports malformed lines by number and keeps reading the file', async () => {
    const root = await tempRoot('jsonl-malformed')
    const path = await root.write('log.jsonl', ['{"a":1}', 'not json', '{"b":2}'])
    const malformed: number[] = []
    const visited: unknown[] = []

    await readJsonLines(path, { visit: value => visited.push(value), onMalformed: line => malformed.push(line) })

    expect(malformed).toEqual([2])
    expect(visited).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('stops after a visited value when the predicate asks and reads on when it does not', async () => {
    const root = await tempRoot('jsonl-stop')
    const path = await root.write('log.jsonl', ['1', '2', '3'])
    const stopAfterSecond: unknown[] = []
    const never: unknown[] = []

    await readJsonLines(path, {
      visit: value => stopAfterSecond.push(value),
      onMalformed: () => {},
      stop: value => value === 2,
    })
    await readJsonLines(path, {
      visit: value => never.push(value),
      onMalformed: () => {},
      stop: () => false,
    })

    expect(stopAfterSecond).toEqual([1, 2])
    expect(never).toEqual([1, 2, 3])
  })

  it('closes the stream and rejects when the file cannot be read', async () => {
    const root = await tempRoot('jsonl-missing')
    const visit = vi.fn()

    await expect(readJsonLines(join(root.path, 'absent.jsonl'), { visit, onMalformed: () => {} }))
      .rejects.toThrow()

    expect(visit).not.toHaveBeenCalled()
  })
})

describe('asRecord', () => {
  it.each([
    [undefined, undefined],
    [null, undefined],
    [7, undefined],
    ['text', undefined],
    [[1, 2], undefined],
    [{ a: 1 }, { a: 1 }],
  ])('reads %j as %j', (value, expected) => {
    expect(asRecord(value)).toEqual(expected)
  })
})

describe('stringField', () => {
  it.each([
    [{ key: 'value' }, 'value'],
    [{ key: '' }, undefined],
    [{ key: 7 }, undefined],
    [{}, undefined],
  ])('reads %j.key as %j', (record, expected) => {
    expect(stringField(record as Record<string, unknown>, 'key')).toEqual(expected)
  })
})
