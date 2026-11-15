import { GISRuntimeError } from './errors.js'
import type { EventService, GISAppEvents, GISAppOptions, Unsubscribe } from './types.js'

export class EventServiceImpl implements EventService {
  private readonly listeners = new Map<keyof GISAppEvents, Set<(payload: never) => void>>()
  private closed = false
  private reporting = false

  constructor(private readonly onError?: GISAppOptions['onError']) {}

  on<K extends keyof GISAppEvents>(event: K, listener: (payload: GISAppEvents[K]) => void): Unsubscribe {
    if (this.closed) return () => {}
    let listeners = this.listeners.get(event)
    if (!listeners) {
      listeners = new Set()
      this.listeners.set(event, listeners)
    }
    listeners.add(listener as (payload: never) => void)
    return () => listeners?.delete(listener as (payload: never) => void)
  }

  once<K extends keyof GISAppEvents>(event: K, listener: (payload: GISAppEvents[K]) => void): Unsubscribe {
    let unsubscribe: Unsubscribe = () => undefined
    unsubscribe = this.on(event, (payload) => {
      unsubscribe()
      listener(payload)
    })
    return unsubscribe
  }

  emit<K extends keyof GISAppEvents>(event: K, payload: GISAppEvents[K]): void {
    if (this.closed) return
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      try { listener(payload as never) } catch (cause) {
        if (event !== 'app:error') this.emit('app:error', { error: new GISRuntimeError({ code: 'APP_INVALID_STATE', message: `Observer for ${event} failed.`, stage: 'event-listener', cause }) })
      }
    }
    if (event === 'app:error' && !this.reporting) {
      this.reporting = true
      try { this.onError?.((payload as GISAppEvents['app:error']).error) } catch { /* Reporting cannot replace the operation's failure. */ }
      finally { this.reporting = false }
    }
  }

  close(): void { this.closed = true; this.listeners.clear() }
}
