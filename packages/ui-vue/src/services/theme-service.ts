import { shallowRef, type ShallowRef } from 'vue'
import type { ThemeOptions, ThemeService } from '../types.js'

const VALID_MODES = new Set(['light', 'dark', 'system'])

export class ThemeServiceImpl implements ThemeService {
  private readonly current: ShallowRef<Readonly<ThemeOptions>>
  private readonly listeners = new Set<(theme: Readonly<ThemeOptions>) => void>()

  constructor(initial: ThemeOptions = {}) {
    this.current = shallowRef(normalizeTheme(initial))
  }

  get(): Readonly<ThemeOptions> { return this.current.value }

  set(options: ThemeOptions): void {
    this.current.value = normalizeTheme({ ...this.current.value, ...options, tokens: { ...this.current.value.tokens, ...options.tokens } })
    for (const listener of [...this.listeners]) listener(this.current.value)
  }

  subscribe(listener: (theme: Readonly<ThemeOptions>) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  clear(): void { this.listeners.clear() }
}

function normalizeTheme(theme: ThemeOptions): Readonly<ThemeOptions> {
  const mode = theme.mode ?? 'light'
  if (!VALID_MODES.has(mode)) throw new Error(`Unknown theme mode "${mode}".`)
  return Object.freeze({ ...theme, mode, tokens: Object.freeze({ ...(theme.tokens ?? {}) }) })
}
