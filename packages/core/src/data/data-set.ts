import { GISRuntimeError } from '../errors.js'
import type { DataSet } from '../types/data.js'
import type { Unsubscribe } from '../types/common.js'

export class DataSetImpl<T> implements DataSet<T> {
  private readonly listeners = new Set<(data: T) => void>()
  private readonly validators = new Set<(data: T) => void>()
  private currentStatus: DataSet<T>['status'] = 'loading'
  private currentData?: T
  private currentError?: Error

  constructor(readonly id: string, readonly cancel?: () => void, private readonly report?: (cause: unknown) => void, private readonly changed?: () => void, private readonly assertWritable?: () => void) {}

  get status(): DataSet<T>['status'] { return this.currentStatus }
  get data(): T | undefined { return this.currentData }
  get error(): Error | undefined { return this.currentError }

  setReady(data: T): void {
    this.assertActive()
    this.currentData = data
    this.currentError = undefined
    this.currentStatus = 'ready'
    this.changed?.()
  }

  setError(error: Error): void {
    if (this.currentStatus === 'disposed') return
    this.currentError = error
    this.currentStatus = 'error'
    this.changed?.()
  }

  subscribe(listener: (data: T) => void): Unsubscribe {
    this.assertActive()
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  update(data: T): void {
    this.assertActive()
    this.assertWritable?.()
    for (const validator of [...this.validators]) validator(data)
    this.setReady(data)
    for (const listener of [...this.listeners]) {
      try { listener(data) } catch (cause) { this.report?.(cause) }
    }
  }

  validate(validator: (data: T) => void): Unsubscribe {
    this.assertActive()
    this.validators.add(validator)
    return () => this.validators.delete(validator)
  }

  async dispose(): Promise<void> {
    if (this.currentStatus === 'disposed') return
    this.listeners.clear()
    this.validators.clear()
    this.cancel?.()
    this.currentData = undefined
    this.currentStatus = 'disposed'
    this.changed?.()
  }

  private assertActive(): void {
    if (this.currentStatus === 'disposed') {
      throw new GISRuntimeError({
        code: 'APP_DISPOSED',
        message: `DataSet "${this.id}" has been disposed.`,
        stage: 'data-update',
      })
    }
  }
}
