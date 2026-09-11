/**
 * Pure cost vocabulary: the peak/off-peak price table, token-bucket
 * normalization, and the one-money formula. No React, no Cordis — the browser
 * half and the tests share it directly.
 */

/** Price per one million billed tokens, split by bucket. */
export interface TokenRates {
  /** Uncached prompt tokens (cache miss). */
  input: number
  /** Generated completion tokens. */
  output: number
  /** Prompt tokens served from the provider's prompt cache (cache hit read). */
  cacheRead: number
  /** Prompt tokens written to the provider's prompt cache (cache write). */
  cacheWrite: number
}

/** One model's peak rates, optionally with explicit off-peak rates. */
export interface ModelPrice extends TokenRates {
  /**
   * Rates applied inside off-peak windows. Absent scales the peak rates by the
   * configured `offPeakFactor`; present is used verbatim.
   */
  offPeak?: TokenRates
}

/** One peak window as `[startMinute, endMinute)` UTC minutes-of-day. */
export type PeakWindow = readonly [number, number]

/** When off-peak billing applies and how far off-peak rates fall. */
export interface OffPeakPolicy {
  /** Weekday peak windows in UTC minutes-of-day; weekends are always off-peak. */
  readonly peakWindows: readonly PeakWindow[]
  /** Multiplier applied to peak rates for models without explicit `offPeak` rates. */
  readonly offPeakFactor: number
}

/** Configuration accepted from cordis.yml; pricing merges over the built-in default. */
export interface CostMeterConfig {
  /** Per-model peak price overrides or additions (CNY per 1M tokens), keyed by model id. */
  pricing?: Partial<Record<string, ModelPrice>>
  /** Currency symbol prefix; defaults to the CNY symbol '¥'. */
  currency?: string
  /**
   * Weekday peak windows in UTC minutes-of-day, each `[start, end)` with start
   * before end; defaults to `DEFAULT_PEAK_WINDOWS`.
   */
  peakWindows?: readonly PeakWindow[]
  /** Off-peak multiplier for models without explicit `offPeak` rates, in (0, 1]; defaults to 0.5. */
  offPeakFactor?: number
}

/** Normalized billed token buckets, one per disjoint billable class. */
export interface UsageBuckets {
  readonly uncachedInput: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
}

/**
 * Published peak windows: weekdays 01:00–04:00 and 06:00–10:00 UTC (Beijing
 * 09:00–12:00 and 14:00–18:00). Every other time, including the whole weekend,
 * is off-peak. This is a deployment-varying external spec, so override it
 * through `peakWindows` to match the provider's live schedule.
 */
export const DEFAULT_PEAK_WINDOWS: readonly PeakWindow[] = [[60, 240], [360, 600]]

/** Published off-peak multiplier: half the peak rate for every bucket. */
export const DEFAULT_OFF_PEAK_FACTOR = 0.5

/** The published schedule, used when the plugin config names none. */
export const DEFAULT_OFF_PEAK_POLICY: OffPeakPolicy = {
  peakWindows: DEFAULT_PEAK_WINDOWS,
  offPeakFactor: DEFAULT_OFF_PEAK_FACTOR,
}

/**
 * Built-in reference PEAK prices (CNY per 1M tokens) for the models the harness
 * routes by default, from the DeepSeek published rate card. The published card
 * prices cached input, uncached input, and output; `cacheWrite` therefore
 * follows this package's convention of the uncached-input rate, and DeepSeek's
 * own adapter reports no cache-write bucket, so that field prices nothing on
 * those routes. Off-peak billing applies the `offPeakFactor` (half) inside the
 * off-peak windows; a model that declares explicit `offPeak` rates uses those
 * instead. Official published prices change over time and vary by tier, so treat
 * this table as a starting default and override it through `pricing` in the
 * plugin config to match the deployment's live rate card. A model with no entry
 * renders no cost rather than guessing.
 *
 * Keys are the exact model ids the default catalog registers.
 * `deepseek-v4.1-flash` is the id `deepseek-flash` replaced, kept so a session
 * that recorded the earlier id still prices.
 */
export const DEFAULT_PRICING: Readonly<Record<string, ModelPrice>> = {
  'deepseek-flash': { input: 2.0, output: 8.0, cacheRead: 0.04, cacheWrite: 2.0 },
  'deepseek-v4.1-flash': { input: 2.0, output: 8.0, cacheRead: 0.04, cacheWrite: 2.0 },
  'deepseek-v4-flash-vision-exp': { input: 3.0, output: 9.0, cacheRead: 0.1, cacheWrite: 3.0 },
  'deepseek-v4-flash': { input: 3.0, output: 9.0, cacheRead: 0.1, cacheWrite: 3.0 },
  'deepseek-v4-pro': { input: 9.0, output: 27.0, cacheRead: 0.3, cacheWrite: 9.0 },
}

/** Whether a value is one rate set: four finite, non-negative numbers. */
function isRates(value: unknown): value is TokenRates {
  if (value === null || typeof value !== 'object') return false
  const rates = value as Record<string, unknown>
  return (['input', 'output', 'cacheRead', 'cacheWrite'] as const).every((field) => {
    const rate = rates[field]
    return typeof rate === 'number' && Number.isFinite(rate) && rate >= 0
  })
}

/** Whether a value is one price entry: peak rates and, when present, off-peak rates. */
function isModelPrice(value: unknown): value is ModelPrice {
  if (!isRates(value)) return false
  const { offPeak } = value as ModelPrice
  return offPeak === undefined || isRates(offPeak)
}

/**
 * Whether a value is a usable peak schedule: pairs of UTC minute-of-day whose
 * start precedes their end. A wrapping window is rejected rather than silently
 * never matching, which would quietly bill every request at peak rates.
 */
function isPeakWindows(value: unknown): value is readonly PeakWindow[] {
  return Array.isArray(value) && value.every((window: unknown) => {
    if (!Array.isArray(window) || window.length !== 2) return false
    const [start, end] = window as [unknown, unknown]
    return [start, end].every(minute =>
      typeof minute === 'number' && Number.isInteger(minute) && minute >= 0 && minute <= 1440)
      && (start as number) < (end as number)
  })
}

/**
 * Effective pricing table: the built-in reference merged under the config overrides.
 * @param config - plugin config.
 * @returns the merged table.
 * @throws {Error} when a configured entry is not a usable rate set; a malformed
 * rate would otherwise reach the money formula and display as a non-number.
 */
export function resolvePricing(config: CostMeterConfig = {}): Record<string, ModelPrice> {
  const merged: Record<string, ModelPrice> = { ...DEFAULT_PRICING }
  for (const [model, price] of Object.entries(config.pricing ?? {})) {
    if (price === undefined) continue
    if (!isModelPrice(price)) {
      throw new Error(
        `cost meter: pricing["${model}"] must carry finite non-negative input, output, cacheRead, and cacheWrite rates`,
      )
    }
    merged[model] = price
  }
  return merged
}

/**
 * Effective off-peak schedule: the config values over the published defaults.
 * @param config - plugin config.
 * @returns the effective schedule.
 * @throws {Error} when the configured schedule is not usable, so a bad window
 * list fails at load instead of throwing while a cost line renders.
 */
export function resolveOffPeakPolicy(config: CostMeterConfig = {}): OffPeakPolicy {
  const { peakWindows, offPeakFactor } = config
  if (peakWindows !== undefined && !isPeakWindows(peakWindows)) {
    throw new Error('cost meter: peakWindows must be [startMinute, endMinute) UTC minute-of-day pairs, start before end')
  }
  if (offPeakFactor !== undefined
    && !(Number.isFinite(offPeakFactor) && offPeakFactor > 0 && offPeakFactor <= 1)) {
    throw new Error('cost meter: offPeakFactor must be a number in (0, 1]')
  }
  return {
    peakWindows: peakWindows ?? DEFAULT_PEAK_WINDOWS,
    offPeakFactor: offPeakFactor ?? DEFAULT_OFF_PEAK_FACTOR,
  }
}

/**
 * Price for one model id, or undefined when the table has no entry for it.
 * @param pricing - the effective pricing table.
 * @param model - the provider model id.
 * @returns the model's price, or undefined when unknown (cost is not shown).
 */
export function modelPrice(
  pricing: Readonly<Record<string, ModelPrice>>,
  model: string,
): ModelPrice | undefined {
  return pricing[model]
}

/**
 * Whether one instant falls inside a peak window.
 *
 * Windows are UTC minutes-of-day and apply to weekdays only: Saturday and
 * Sunday are entirely off-peak, matching the provider's weekend rule.
 * @param timeMs - the request time in Unix epoch milliseconds.
 * @param windows - weekday peak windows in UTC minutes-of-day.
 * @returns true when the instant is billed at peak rates.
 */
export function isPeakTime(
  timeMs: number,
  windows: readonly PeakWindow[] = DEFAULT_PEAK_WINDOWS,
): boolean {
  const date = new Date(timeMs)
  const day = date.getUTCDay()
  if (day === 0 || day === 6) return false
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes()
  return windows.some(([start, end]) => minutes >= start && minutes < end)
}

/**
 * The billed rates in force at one instant.
 * @param price - the model's price entry.
 * @param timeMs - the request time in Unix epoch milliseconds.
 * @param policy - the off-peak schedule.
 * @returns the peak rates, the explicit off-peak rates, or the scaled peak rates.
 */
export function ratesAt(
  price: ModelPrice,
  timeMs: number,
  policy: OffPeakPolicy = DEFAULT_OFF_PEAK_POLICY,
): TokenRates {
  if (isPeakTime(timeMs, policy.peakWindows)) return price
  if (price.offPeak !== undefined) return price.offPeak
  return {
    input: price.input * policy.offPeakFactor,
    output: price.output * policy.offPeakFactor,
    cacheRead: price.cacheRead * policy.offPeakFactor,
    cacheWrite: price.cacheWrite * policy.offPeakFactor,
  }
}

/** Sum the three prompt-side billed buckets (the total billed prompt tokens). */
export function boundedInputTokens(usage: UsageBuckets): number {
  return usage.uncachedInput + usage.cacheRead + usage.cacheWrite
}

/**
 * The request instant billed for one assistant node: its recorded step start
 * when present, otherwise its completion time. Peak/off-peak billing keys on the
 * request, so the step start is the closer of the two.
 * @param node - an assistant node carrying a completion time and optional timing.
 * @returns the epoch-millisecond instant whose rates apply.
 */
export function billedAt(node: {
  readonly time: number
  readonly timing?: { readonly stepStartTime: number | null } | undefined
}): number {
  return node.timing?.stepStartTime ?? node.time
}

/**
 * Normalize one per-step provider `TokenUsage` sample to billed buckets.
 *
 * Counts are disjoint: `inputTokens` is uncached input only, and the cache
 * buckets are billed separately. A value missing either the input or output
 * count is not a usable usage record and normalizes to null.
 * @param raw - a provider-reported usage value.
 * @returns normalized buckets, or null when the value is not a usable usage record.
 */
export function normalizeUsage(raw: unknown): UsageBuckets | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  const count = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
  const uncachedInput = count(record.inputTokens)
  const output = count(record.outputTokens)
  if (uncachedInput === undefined || output === undefined) return null
  return {
    uncachedInput,
    output,
    cacheRead: count(record.cacheReadTokens) ?? 0,
    cacheWrite: count(record.cacheWriteTokens) ?? 0,
  }
}

/**
 * Money cost of one normalized usage record under one set of rates.
 * @param usage - normalized billed token buckets.
 * @param rates - the per-1M-token rates that apply to this record.
 * @returns the cost in the rates' currency units.
 */
export function costOf(usage: UsageBuckets, rates: TokenRates): number {
  return usage.uncachedInput / 1e6 * rates.input
    + usage.output / 1e6 * rates.output
    + usage.cacheRead / 1e6 * rates.cacheRead
    + usage.cacheWrite / 1e6 * rates.cacheWrite
}

/**
 * Format one money amount with a symbol prefix and sensible precision: whole
 * units drop the decimals, smaller amounts keep at most four.
 * @param cost - the cost in the currency's units.
 * @param currency - the currency symbol prefix.
 * @returns the display string, e.g. "¥0.0123" / "¥3.40".
 */
export function formatCost(cost: number, currency: string): string {
  if (cost >= 1) return `${currency}${cost.toFixed(2)}`
  if (cost <= 0) return `${currency}0`
  return `${currency}${trimZeros(cost.toFixed(4))}`
}

/**
 * Strip trailing zeros (and a trailing decimal point) from a fixed string.
 * `toFixed` always emits a decimal point, so the stripped form keeps at least
 * the integer digits and is never empty.
 */
function trimZeros(value: string): string {
  return value.replace(/0+$/, '').replace(/\.$/, '')
}

/**
 * Compact token count: 517 / 12.2K / 517K / 1.2M (one decimal under three digits).
 * @param n - token count.
 * @returns display string.
 */
export function formatTokens(n: number): string {
  const scaled = (v: number): string =>
    v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}
