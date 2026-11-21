import type { AppState, AppStateSnapshot, AppStatus, DeepReadonly, EventService, JsonValue, StateContributor, Unsubscribe } from '../types.js'
import { GISRuntimeError } from '../errors.js'
import { stateValue, freezeStateValue as freeze } from './json-value.js'
export { stateValue } from './json-value.js'
/** Internal writer. Only the frozen read facade is exposed through AppContext. */
export class AppStateImpl {
  private statusValue: AppStatus = 'created'
  private interactionValue: AppStateSnapshot['interactions'] = { activeToolId: null, selection: null }
  private readonly listeners = new Set<(snapshot: DeepReadonly<AppStateSnapshot>) => void>()
  private readonly slices = new Map<string, StateContributor>()
  private read?: () => Pick<AppStateSnapshot, 'map' | 'layers' | 'data'>
  private cached?: DeepReadonly<AppStateSnapshot>
  private signature = ''
  private readonly branches = new Map<string, { signature: string; value: JsonValue }>()
  private revision = -1
  private depth = 0
  private notifying = false
  private pending = false
  private closed = false
  readonly view: AppState = Object.freeze({ snapshot: () => this.snapshot(), subscribe: (listener: (snapshot: DeepReadonly<AppStateSnapshot>) => void) => this.subscribe(listener) })

  constructor(private readonly events: EventService) {}
  get status(): AppStatus { return this.statusValue }
  get interactions(): AppStateSnapshot['interactions'] { return this.interactionValue }
  connect(read: () => Pick<AppStateSnapshot, 'map' | 'layers' | 'data'>): void { this.read = read; this.refresh() }
  setStatus(status: AppStatus): void { this.statusValue = status; this.refresh() }
  setInteractions(patch: Partial<AppStateSnapshot['interactions']>): void {
    this.interactionValue = freeze(stateValue({ ...this.interactionValue, ...patch })) as unknown as AppStateSnapshot['interactions']
    this.refresh()
  }
  batch<T>(operation: () => T): T { this.depth++; try { return operation() } finally { this.depth--; this.refresh() } }
  snapshot(): DeepReadonly<AppStateSnapshot> { if (!this.cached) this.refresh(); return this.cached! }
  subscribe(listener: (snapshot: DeepReadonly<AppStateSnapshot>) => void): Unsubscribe {
    if (this.closed) return () => {}
    this.listeners.add(listener); return () => { this.listeners.delete(listener) }
  }
  register(name: string, contributor: StateContributor): Unsubscribe {
    if (this.closed || !name.trim() || this.slices.has(name)) throw new GISRuntimeError({
      code: this.closed ? 'APP_DISPOSED' : 'CONFIG_INVALID', message: 'Invalid or duplicate state slice.', stage: 'state-registration', detail: { name },
    })
    const refresh = () => this.refresh()
    this.slices.set(name, contributor)
    let unsubscribe: Unsubscribe | undefined
    try { unsubscribe = contributor.subscribe(refresh); this.refresh() }
    catch (error) {
      this.slices.delete(name)
      try { unsubscribe?.() } catch (cause) { this.report(cause) }
      throw error
    }
    let active = true
    return () => {
      if (!active) return
      active = false
      this.slices.delete(name)
      try { unsubscribe?.() } finally { this.refresh() }
    }
  }
  refresh(): void {
    if (!this.read || this.closed) return
    const base = this.read()
    const extensions: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>
    for (const [name, slice] of this.slices) {
      try { extensions[name] = stateValue(slice.snapshot()) } catch (cause) { this.report(cause) }
    }
    // Compare each branch by value, retaining immutable references for unchanged
    // domains. Never trust identity of mutable adapter/plugin inputs.
    const value: Record<string, JsonValue> = { status: this.statusValue }
    const signatures: string[] = [this.statusValue]
    for (const [key, input] of Object.entries({ ...base, interactions: this.interactionValue, extensions })) {
      const json = stateValue(input)
      const signature = JSON.stringify(json)
      let branch = this.branches.get(key)
      if (!branch || branch.signature !== signature) {
        branch = { signature, value: freeze(json) }
        this.branches.set(key, branch)
      }
      value[key] = branch.value
      signatures.push(signature)
    }
    const signature = JSON.stringify(signatures)
    if (signature !== this.signature) {
      this.signature = signature
      this.cached = freeze({ ...(value as object), revision: ++this.revision }) as unknown as DeepReadonly<AppStateSnapshot>
      this.pending = true
    }
    if (this.depth || this.notifying || !this.pending) return
    this.notifying = true
    try {
      while (this.pending) {
        this.pending = false
        const snapshot = this.cached!
        for (const listener of [...this.listeners]) { try { listener(snapshot) } catch (cause) { this.report(cause) } }
      }
    } finally { this.notifying = false }
  }
  close(): void { this.closed = true; this.listeners.clear(); this.slices.clear(); this.branches.clear() }
  private report(cause: unknown): void { this.events.emit('app:error', { error: new GISRuntimeError({ code: 'APP_INVALID_STATE', stage: 'state-observer', message: 'State observer failed.', cause }) }) }
}
