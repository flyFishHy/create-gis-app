import { GISRuntimeError } from './types.js'
import type { EventService, GISAppEvents, Unsubscribe } from './types.js'

export class EventServiceImpl implements EventService {
  private readonly listeners = new Map<keyof GISAppEvents, Set<(payload: never) => void>>()

  on<K extends keyof GISAppEvents>(event: K, listener: (payload: GISAppEvents[K]) => void): Unsubscribe {
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
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      try { listener(payload as never) } catch (cause) {
        if (event !== 'app:error') this.emit('app:error', { error: new GISRuntimeError({ code: 'APP_INVALID_STATE', message: `Observer for ${event} failed.`, stage: 'event-listener', cause }) })
      }
    }
  }
}
