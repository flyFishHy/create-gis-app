import { DataSetImpl } from './data-set.js'
import { GISRuntimeError } from '../errors.js'
import type { ServiceDependencies } from '../context/service-dependencies.js'
import { assertRuntimeStatus } from '../runtime/lifecycle.js'
import { assertResourceScopeActive } from '../resource-scope.js'
import type { DataStateSnapshot } from '../types.js'
import type {
  AppContext,
  DataLoadOptions,
  DataProcessor,
  DataService,
  DataSet,
  DataSourceConfig,
  ResourceScope,
} from '../types.js'

export class DataServiceImpl implements DataService {
  private readonly dataSets = new Map<string, DataSetImpl<unknown>>()
  private readonly processors = new Map<string, DataProcessor>()
  private sequence = 0
  private readonly tasks = new Set<Promise<unknown>>()

  constructor(private readonly dependencies: ServiceDependencies) {}
  private get context(): AppContext {
    return this.dependencies.context()
  }
  snapshot(): readonly DataStateSnapshot[] {
    return [...this.dataSets.values()].map((data) => ({
      id: data.id,
      status: data.status,
      error: data.error?.message ?? null,
    }))
  }

  registerProcessor<Input, Output>(name: string, processor: DataProcessor<Input, Output>): void {
    if (!name.trim() || this.processors.has(name)) {
      throw new GISRuntimeError({
        code: 'DATA_PROCESSOR_DUPLICATE',
        message: `Data processor "${name}" is invalid or already registered.`,
        stage: 'data-processor-registration',
      })
    }
    this.processors.set(name, processor)
  }

  unregisterProcessor(name: string, processor: DataProcessor): void {
    if (this.processors.get(name) === processor) this.processors.delete(name)
  }

  async load<T = unknown>(
    source: DataSourceConfig,
    options: DataLoadOptions = {}
  ): Promise<DataSet<T>> {
    const task = this.loadInternal<T>(source, options)
    this.tasks.add(task)
    try {
      return await task
    } finally {
      this.tasks.delete(task)
    }
  }

  abortPending(): void {
    for (const data of this.dataSets.values()) data.cancel?.()
  }
  async settle(): Promise<void> {
    while (this.tasks.size) await Promise.allSettled([...this.tasks])
  }

  private async loadInternal<T>(
    source: DataSourceConfig,
    options: DataLoadOptions
  ): Promise<DataSet<T>> {
    this.assertRuntimeActive('load data')
    const id = options.id ?? source.id ?? `dataset-${++this.sequence}`
    if (this.dataSets.has(id)) {
      throw new GISRuntimeError({
        code: 'DATASET_DUPLICATE',
        message: `DataSet "${id}" already exists.`,
        stage: 'data-load',
      })
    }
    const controller = new AbortController()
    const abortFromCaller = () => controller.abort(options.signal?.reason)
    if (options.signal?.aborted) abortFromCaller()
    else options.signal?.addEventListener('abort', abortFromCaller, { once: true })
    const dataSet = new DataSetImpl<T>(
      id,
      () => controller.abort(),
      (cause) =>
        this.context.events.emit('app:error', {
          error: new GISRuntimeError({
            code: 'DATA_LOAD_FAILED',
            message: 'Data observer failed.',
            stage: 'data-observer',
            cause,
          }),
        }),
      () => this.dependencies.state.refresh(),
      () => this.assertRuntimeActive('update data')
    )
    this.dataSets.set(id, dataSet as DataSetImpl<unknown>)
    this.dependencies.state.refresh()

    try {
      let data: unknown
      if (source.type === 'inline') {
        if (source.data === undefined) throw new Error('Inline data source requires data.')
        data = source.data
      } else if (source.type === 'url') {
        if (!source.url) throw new Error('URL data source requires url.')
        const response = await fetch(source.url, { signal: controller.signal })
        if (!response.ok) throw new Error(`Data request failed with HTTP ${response.status}.`)
        data = source.format === 'text' ? await response.text() : await response.json()
      } else {
        throw new Error(`Unsupported data source type "${String(source.type)}".`)
      }

      if (options.processor) {
        const processor = this.processors.get(options.processor)
        if (!processor) {
          throw new GISRuntimeError({
            code: 'DATA_PROCESSOR_NOT_FOUND',
            message: `Data processor "${options.processor}" is not registered.`,
            stage: 'data-process',
            detail: { processor: options.processor },
          })
        }
        data = await processor.process(data, this.context)
      }
      if (controller.signal.aborted) throw new Error('Data load aborted.')
      this.assertRuntimeActive('finish loading data')
      dataSet.setReady(data as T)
      return dataSet
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      dataSet.setError(error)
      if (cause instanceof GISRuntimeError) throw cause
      throw new GISRuntimeError({
        code: 'DATA_LOAD_FAILED',
        message: `DataSet "${id}" failed to load.`,
        stage: 'data-load',
        detail: { dataSetId: id, sourceType: source.type },
        cause,
      })
    } finally {
      options.signal?.removeEventListener('abort', abortFromCaller)
    }
  }

  get<T = unknown>(id: string): DataSet<T> | undefined {
    return this.dataSets.get(id) as DataSet<T> | undefined
  }

  async remove(id: string): Promise<void> {
    const dataSet = this.dataSets.get(id)
    if (!dataSet) {
      throw new GISRuntimeError({
        code: 'DATASET_NOT_FOUND',
        message: `DataSet "${id}" was not found.`,
        stage: 'data-remove',
      })
    }
    await dataSet.dispose()
    this.dataSets.delete(id)
    this.dependencies.state.refresh()
  }

  async clear(): Promise<void> {
    const errors: unknown[] = []
    for (const dataSet of [...this.dataSets.values()].reverse()) {
      try {
        await dataSet.dispose()
      } catch (error) {
        errors.push(error)
      }
    }
    this.dataSets.clear()
    this.dependencies.state.refresh()
    if (errors.length) {
      throw new GISRuntimeError({
        code: 'APP_DISPOSE_FAILED',
        message: `${errors.length} DataSet(s) failed to dispose.`,
        stage: 'data-clear',
        cleanupErrors: errors,
      })
    }
  }

  registerProcessorResource<Input, Output>(
    name: string,
    processor: DataProcessor<Input, Output>,
    resources: ResourceScope
  ): void {
    assertResourceScopeActive(resources)
    this.registerProcessor(name, processor)
    try {
      resources.add(() => this.unregisterProcessor(name, processor))
    } catch (error) {
      this.unregisterProcessor(name, processor)
      throw error
    }
  }

  private assertRuntimeActive(action: string): void {
    assertRuntimeStatus(this.dependencies.state.status, action, 'data-load')
  }
}
