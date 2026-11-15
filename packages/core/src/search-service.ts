import { GISRuntimeError } from './errors.js'
import type { AppStatus, EventService, ResourceScope, SearchProvider, SearchQuery, SearchResult, SearchService } from './types.js'
import { assertResourceScopeActive } from './resource-scope.js'

/** Runtime-owned provider registrations; query results belong to each caller. */
export class SearchServiceImpl implements SearchService {
  private readonly providers = new Map<string, SearchProvider>()
  private readonly listeners = new Set<() => void>()
  private readonly queries = new Set<AbortController>()
  private disposed = false
  constructor(private readonly status: () => AppStatus, private readonly events: EventService) {}
  private assertActive() {
    if (this.disposed || ['disposing', 'disposed', 'error'].includes(this.status())) {
      throw new GISRuntimeError({ code: 'APP_DISPOSED', message: 'Search is unavailable after shutdown.', stage: 'search' })
    }
  }
  registerProvider(provider: SearchProvider, resources?: ResourceScope): () => void {
    this.assertActive()
    if (resources) assertResourceScopeActive(resources)
    if (!provider.id?.trim() || this.providers.has(provider.id)) throw new GISRuntimeError({ code: 'CONFIG_INVALID', message: `Duplicate or empty search provider: ${provider.id}`, stage: 'search-registration' })
    if (provider.layerIds && (provider.layerIds.some(id => typeof id !== 'string' || !id.trim()) || new Set(provider.layerIds).size !== provider.layerIds.length)) throw new GISRuntimeError({ code: 'CONFIG_INVALID', message: 'Provider layerIds must contain unique non-empty IDs.' })
    const entry = Object.freeze({ id: provider.id, ...(provider.layerIds ? { layerIds: Object.freeze([...provider.layerIds]) } : {}), search: (query: SearchQuery) => provider.search(query) })
    this.providers.set(entry.id, entry)
    const stop = () => { if (this.providers.get(entry.id) === entry) { this.providers.delete(entry.id); this.notify() } }
    try { resources?.add(stop) }
    catch (error) { this.providers.delete(entry.id); throw error }
    this.notify()
    return stop
  }
  listProviders(): readonly SearchProvider[] { return [...this.providers.values()] }
  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private notify() {
    for (const listener of [...this.listeners]) {
      try { listener() } catch (cause) { this.events.emit('app:error', { error: new GISRuntimeError({ code: 'SEARCH_FAILED', message: 'Search observer failed.', cause }) }) }
    }
  }
  async search(query: SearchQuery): Promise<SearchResult[]> {
    this.assertActive()
    const controller = new AbortController()
    this.queries.add(controller)
    const abort = () => controller.abort(query.signal?.reason)
    query.signal?.addEventListener('abort', abort, { once: true })
    let rejectAbort!: () => void
    const aborted = new Promise<never>((_, reject) => { rejectAbort = () => reject(new DOMException('Search aborted', 'AbortError')) })
    controller.signal.addEventListener('abort', rejectAbort, { once: true })
    try {
      if (query.signal?.aborted) abort()
      if (controller.signal.aborted) return await aborted
      if (!query.keyword.trim()) return []
      const providers = this.listProviders().filter(provider => !query.layerId || !provider.layerIds || provider.layerIds.includes(query.layerId))
      const work = Promise.allSettled(providers.map(provider => Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new DOMException('Search aborted', 'AbortError')
        return provider.search({ ...query, signal: controller.signal })
      })))
      const batches = await Promise.race([work, aborted])
      const successes = batches.filter((batch): batch is PromiseFulfilledResult<readonly SearchResult[]> => batch.status === 'fulfilled')
      const failures = batches.filter((batch): batch is PromiseRejectedResult => batch.status === 'rejected')
      if (failures.length) {
        const error = new GISRuntimeError({ code: 'SEARCH_FAILED', message: successes.length ? 'Some search providers failed.' : 'All search providers failed.', cause: new AggregateError(failures.map(batch => batch.reason)), stage: 'search' })
        this.events.emit('app:error', { error })
        if (!successes.length) throw error
      }
      return successes.flatMap(batch => batch.value).filter(result => !query.layerId || !result.layerId || result.layerId === query.layerId)
    } finally {
      query.signal?.removeEventListener('abort', abort)
      controller.signal.removeEventListener('abort', rejectAbort)
      this.queries.delete(controller)
    }
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const query of this.queries) query.abort()
    this.queries.clear(); this.providers.clear(); this.listeners.clear()
  }
}
