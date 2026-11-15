import type { JsonValue, Unsubscribe } from './common.js'
import type { AppContext } from './app.js'

export interface DataSourceConfig {
  readonly id?: string
  readonly type: 'url' | 'inline'
  readonly url?: string
  readonly data?: JsonValue
  readonly format?: 'json' | 'text'
}

export interface DataLoadOptions {
  readonly id?: string
  readonly signal?: AbortSignal
  readonly processor?: string
}

export interface DataSet<T = unknown> {
  readonly id: string
  readonly status: 'loading' | 'ready' | 'error' | 'disposed'
  readonly data?: T
  readonly error?: Error
  subscribe(listener: (data: T) => void): Unsubscribe
  /** Pure synchronous validation before update commits; throwing preserves old data. */
  validate(validator: (data: T) => void): Unsubscribe
  update(data: T): void
  dispose(): Promise<void>
}

export interface DataService {
  load<T = unknown>(source: DataSourceConfig, options?: DataLoadOptions): Promise<DataSet<T>>
  get<T = unknown>(id: string): DataSet<T> | undefined
  remove(id: string): Promise<void>
  clear(): Promise<void>
}

export interface DataProcessor<Input = unknown, Output = unknown> {
  process(input: Input, context: AppContext): Output | Promise<Output>
}
