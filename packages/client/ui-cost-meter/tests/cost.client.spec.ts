// @vitest-environment node
/**
 * ui-cost-meter pure cost vocabulary: bucket normalization of the per-step
 * provider usage shape, the peak/off-peak schedule, the one-money formula, and
 * display formatting.
 */
import { describe, expect, it } from 'vitest'
import { apply as applyHostHalf } from '../src/index.ts'
import {
  billedAt, boundedInputTokens, costOf, DEFAULT_OFF_PEAK_POLICY, DEFAULT_PRICING, formatCost, formatTokens,
  isPeakTime, modelPrice, normalizeUsage, ratesAt, resolveOffPeakPolicy, resolvePricing,
  type OffPeakPolicy,
} from '../src/client/cost.ts'

describe('normalizeUsage', () => {
  it('reads the per-step provider TokenUsage shape (inputTokens)', () => {
    expect(normalizeUsage({
      inputTokens: 1000, outputTokens: 200, cacheReadTokens: 300, cacheWriteTokens: 400,
    })).toEqual({ uncachedInput: 1000, output: 200, cacheRead: 300, cacheWrite: 400 })
  })

  it('defaults absent cache buckets to zero and rejects unusable records', () => {
    expect(normalizeUsage({ inputTokens: 5, outputTokens: 7 }))
      .toEqual({ uncachedInput: 5, output: 7, cacheRead: 0, cacheWrite: 0 })
    expect(normalizeUsage({ inputTokens: 5 })).toBeNull()
    expect(normalizeUsage({ outputTokens: 7 })).toBeNull()
    expect(normalizeUsage({ uncachedInputTokens: 5, outputTokens: 7 })).toBeNull()
    expect(normalizeUsage(undefined)).toBeNull()
    expect(normalizeUsage('nope')).toBeNull()
    expect(normalizeUsage({ inputTokens: -1, outputTokens: 7 })).toBeNull()
  })
})

describe('costOf', () => {
  const rates = { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1.5 }

  it('prices each bucket by its own rate', () => {
    const usage = { uncachedInput: 1_000_000, output: 2_000_000, cacheRead: 2_000_000, cacheWrite: 1_000_000 }
    expect(costOf(usage, rates)).toBe(1 + 4 + 1 + 1.5)
  })

  it('returns zero for an all-zero record', () => {
    expect(costOf({ uncachedInput: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, rates)).toBe(0)
  })
})

describe('boundedInputTokens', () => {
  it('sums the three prompt-side buckets', () => {
    expect(boundedInputTokens({ uncachedInput: 1, output: 9, cacheRead: 2, cacheWrite: 3 })).toBe(6)
  })
})

describe('isPeakTime', () => {
  // 2026-09-07 is a Monday; the 12th and 13th are that week's Saturday and Sunday.
  const at = (day: number, hour: number, minute = 0) => Date.UTC(2026, 8, day, hour, minute)

  it('treats both published weekday windows as peak', () => {
    expect(isPeakTime(at(7, 1))).toBe(true)
    expect(isPeakTime(at(7, 3, 59))).toBe(true)
    expect(isPeakTime(at(7, 6))).toBe(true)
    expect(isPeakTime(at(7, 9, 59))).toBe(true)
  })

  it('treats the gaps, the window ends, and the whole weekend as off-peak', () => {
    expect(isPeakTime(at(7, 0, 59))).toBe(false)
    expect(isPeakTime(at(7, 4))).toBe(false)
    expect(isPeakTime(at(7, 5))).toBe(false)
    expect(isPeakTime(at(7, 10))).toBe(false)
    expect(isPeakTime(at(12, 2))).toBe(false)
    expect(isPeakTime(at(13, 2))).toBe(false)
  })

  it('honours a configured window list', () => {
    expect(isPeakTime(at(7, 5), [[300, 360]])).toBe(true)
    expect(isPeakTime(at(7, 2), [[300, 360]])).toBe(false)
  })
})

describe('ratesAt', () => {
  const price = { input: 3, output: 9, cacheRead: 0.1, cacheWrite: 3 }

  it('uses the peak rates inside a peak window', () => {
    expect(ratesAt(price, Date.UTC(2026, 8, 7, 2))).toEqual(price)
  })

  it('scales every bucket off-peak when the model declares no off-peak rates', () => {
    expect(ratesAt(price, Date.UTC(2026, 8, 7, 5)))
      .toEqual({ input: 1.5, output: 4.5, cacheRead: 0.05, cacheWrite: 1.5 })
  })

  it('uses explicit off-peak rates verbatim', () => {
    const explicit = { ...price, offPeak: { input: 1, output: 2, cacheRead: 0.05, cacheWrite: 1 } }
    expect(ratesAt(explicit, Date.UTC(2026, 8, 12, 2)))
      .toEqual({ input: 1, output: 2, cacheRead: 0.05, cacheWrite: 1 })
  })

  it('honours a configured schedule and factor', () => {
    const policy: OffPeakPolicy = { peakWindows: [[0, 1440]], offPeakFactor: 0.25 }
    expect(ratesAt(price, Date.UTC(2026, 8, 7, 5), policy)).toEqual(price)
    expect(ratesAt(price, Date.UTC(2026, 8, 12, 5), policy))
      .toEqual({ input: 0.75, output: 2.25, cacheRead: 0.025, cacheWrite: 0.75 })
  })
})

describe('the published V4.1 Flash rate card', () => {
  it('prices peak at the published rates and off-peak at exactly half', () => {
    // `deepseek-flash` is the shipped default route and `deepseek-v4.1-flash` is
    // the id it replaced, so both must price a recorded step identically.
    for (const id of ['deepseek-flash', 'deepseek-v4.1-flash']) {
      const price = DEFAULT_PRICING[id]
      expect(price).toMatchObject({ input: 2, output: 8, cacheRead: 0.04, cacheWrite: 2 })
      // 2026-09-07 is a Monday: 02:00 UTC is inside a peak window, 05:00 UTC is not.
      expect(ratesAt(price!, Date.UTC(2026, 8, 7, 2)))
        .toEqual({ input: 2, output: 8, cacheRead: 0.04, cacheWrite: 2 })
      expect(ratesAt(price!, Date.UTC(2026, 8, 7, 5)))
        .toEqual({ input: 1, output: 4, cacheRead: 0.02, cacheWrite: 1 })
    }
  })
})

describe('billedAt', () => {
  it('prefers the recorded step start, falling back to the completion time', () => {
    expect(billedAt({ time: 5, timing: { stepStartTime: 7 } })).toBe(7)
    expect(billedAt({ time: 5, timing: { stepStartTime: null } })).toBe(5)
    expect(billedAt({ time: 5 })).toBe(5)
  })
})

describe('resolvePricing and modelPrice', () => {
  it('merges config overrides over the built-in reference', () => {
    const merged = resolvePricing({ pricing: { 'deepseek-v4-flash-vision-exp': { input: 9, output: 9, cacheRead: 9, cacheWrite: 9 } } })
    expect(modelPrice(merged, 'deepseek-v4-flash-vision-exp')?.input).toBe(9)
    expect(modelPrice(merged, 'deepseek-v4-pro')).toEqual(DEFAULT_PRICING['deepseek-v4-pro'])
    // A configured model not in the reference still resolves.
    expect(modelPrice(merged, 'custom-model')).toBeUndefined()
    expect(modelPrice(resolvePricing({ pricing: { 'custom-model': { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } } }), 'custom-model')?.output).toBe(1)
    // An override explicitly valued undefined leaves the built-in entry in place.
    expect(modelPrice(resolvePricing({ pricing: { 'deepseek-v4-flash': undefined } }), 'deepseek-v4-flash'))
      .toEqual(DEFAULT_PRICING['deepseek-v4-flash'])
  })
  it('rejects a configured entry that is not a usable rate set', () => {
    // A malformed rate would otherwise reach the money formula and reach the
    // screen as a non-number, so the config boundary fails loud instead.
    expect(() => resolvePricing({ pricing: { m: { input: 1, output: 2, cacheRead: 0.1 } as never } }))
      .toThrow(/pricing\["m"\] must carry finite non-negative/)
    expect(() => resolvePricing({ pricing: { m: { input: '1', output: 2, cacheRead: 0.1, cacheWrite: 1 } as never } }))
      .toThrow(/pricing\["m"\]/)
    expect(() => resolvePricing({ pricing: { m: { input: -1, output: 2, cacheRead: 0.1, cacheWrite: 1 } } }))
      .toThrow(/pricing\["m"\]/)
    expect(() => resolvePricing({ pricing: { m: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1, offPeak: {} } as never } }))
      .toThrow(/pricing\["m"\]/)
    // A non-object entry carries no rate set to read: neither null nor a bare
    // number may slip through to the money formula.
    expect(() => resolvePricing({ pricing: { m: null as never } })).toThrow(/pricing\["m"\]/)
    expect(() => resolvePricing({ pricing: { m: 3 as never } })).toThrow(/pricing\["m"\]/)
  })
})

describe('resolveOffPeakPolicy', () => {
  it('defaults to the published schedule and honours overrides', () => {
    expect(resolveOffPeakPolicy()).toEqual(DEFAULT_OFF_PEAK_POLICY)
    const policy = resolveOffPeakPolicy({ peakWindows: [[0, 60]], offPeakFactor: 0.25 })
    expect(policy.peakWindows).toEqual([[0, 60]])
    expect(policy.offPeakFactor).toBe(0.25)
    // A model may also declare explicit off-peak rates, which validate as rates.
    const declaredOffPeak = { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 }
    expect(resolvePricing({ pricing: { m: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1, offPeak: declaredOffPeak } } }))
      .toHaveProperty('m')
  })

  it('rejects a schedule it cannot bill by', () => {
    // Every rejected shape would otherwise throw while a cost line renders
    // (a non-array) or quietly never bill peak (a wrapping window).
    expect(() => resolveOffPeakPolicy({ peakWindows: [[0, 60], null] as never }))
      .toThrow(/peakWindows must be \[startMinute, endMinute\)/)
    expect(() => resolveOffPeakPolicy({ peakWindows: [[0, 60, 120]] as never }))
      .toThrow(/peakWindows/)
    expect(() => resolveOffPeakPolicy({ peakWindows: [[2.5, 60]] }))
      .toThrow(/peakWindows/)
    expect(() => resolveOffPeakPolicy({ peakWindows: [[-1, 60]] }))
      .toThrow(/peakWindows/)
    // A window that wraps midnight cannot match, so it is refused rather than silent.
    expect(() => resolveOffPeakPolicy({ peakWindows: [[1380, 60]] }))
      .toThrow(/peakWindows/)
    expect(() => resolveOffPeakPolicy({ peakWindows: [[60, 60]] }))
      .toThrow(/peakWindows/)
    expect(() => resolveOffPeakPolicy({ offPeakFactor: 1.5 }))
      .toThrow(/offPeakFactor must be a number in \(0, 1\]/)
    expect(() => resolveOffPeakPolicy({ offPeakFactor: Number.NaN }))
      .toThrow(/offPeakFactor/)
  })
})

describe('formatCost and formatTokens', () => {
  it('formats whole units with two decimals and keeps small costs at four', () => {
    expect(formatCost(3.4, '¥')).toBe('¥3.40')
    expect(formatCost(0.012345, '¥')).toBe('¥0.0123')
    expect(formatCost(0, '¥')).toBe('¥0')
    // An amount below the displayed precision reads as zero, never as "-0".
    expect(formatCost(-0.00001, '¥')).toBe('¥0')
  })

  it('compacts token counts', () => {
    expect(formatTokens(517)).toBe('517')
    expect(formatTokens(12_200)).toBe('12.2K')
    expect(formatTokens(517_000)).toBe('517K')
    expect(formatTokens(1_200_000)).toBe('1.2M')
  })
})

describe('node half', () => {
  it('contributes no Host-side plugin body', () => {
    expect(applyHostHalf()).toBeUndefined()
  })
})
