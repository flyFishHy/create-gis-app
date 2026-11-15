import { describe, expect, it, vi } from 'vitest'
import { createGISApp } from '../src/gis-app.js'
import { GISRuntimeError } from '../src/types.js'
import type { GISPlugin, UIAdapter } from '../src/types.js'

describe('GISApp lifecycle and plugins', () => {
  it('initializes a headless Runtime and disposes plugin resources in reverse dependency order', async () => {
    const app = createGISApp({ id: 'headless' })
    const cleanup: string[] = []
    const base: GISPlugin = {
      name: 'base',
      install(_app, _options, resources) { resources.add(() => { cleanup.push('base') }) },
    }
    const feature: GISPlugin = {
      name: 'feature',
      dependencies: ['base'],
      install(_app, _options, resources) { resources.add(() => { cleanup.push('feature') }) },
    }
    app.use(feature).use(base)

    await app.init({ version: '1' })
    expect(app.status).toBe('ready')
    expect(app.config).toMatchObject({ version: '1' })
    await app.dispose()

    expect(app.status).toBe('disposed')
    expect(cleanup).toEqual(['feature', 'base'])
  })

  it('rejects missing dependencies and dependency cycles before installing plugins', async () => {
    const missing = createGISApp()
    missing.use({ name: 'dependent', dependencies: ['absent'], install: vi.fn() })
    await expect(missing.init({})).rejects.toMatchObject({ code: 'PLUGIN_DEPENDENCY_MISSING' })
    expect(missing.status).toBe('error')
    await missing.dispose()

    const cycle = createGISApp()
    cycle.use({ name: 'a', dependencies: ['b'], install: vi.fn() })
    cycle.use({ name: 'b', dependencies: ['a'], install: vi.fn() })
    await expect(cycle.init({})).rejects.toMatchObject({ code: 'PLUGIN_DEPENDENCY_MISSING' })
    await cycle.dispose()
  })

  it('rolls back failed initialization, preserves phase information, and disallows retry', async () => {
    const app = createGISApp()
    const cleanup = vi.fn()
    const failure = new Error('plugin init failed')
    app.use({
      name: 'broken',
      install(_app, _options, resources) { resources.add(cleanup) },
      onInit() { throw failure },
    })

    await expect(app.init({})).rejects.toMatchObject({
      code: 'APP_INITIALIZATION_FAILED',
      stage: 'plugin-initialization',
      cause: failure,
    })
    expect(cleanup).toHaveBeenCalledOnce()
    expect(app.status).toBe('error')
    await expect(app.init({})).rejects.toMatchObject({ code: 'APP_INVALID_STATE' })
    await app.dispose()
  })

  it('serializes init and dispose calls made concurrently', async () => {
    const app = createGISApp()
    let finishInit!: () => void
    app.use({
      name: 'slow',
      install() {},
      onInit: () => new Promise<void>((resolve) => { finishInit = resolve }),
    })
    const init = app.init({})
    const dispose = app.dispose()
    await Promise.resolve()
    expect(app.status).toBe('initializing')
    finishInit()
    await Promise.all([init, dispose])
    expect(app.status).toBe('disposed')
  })

  it('supports unmount and remount while retaining the Runtime', async () => {
    const app = createGISApp()
    const calls: string[] = []
    const adapter: UIAdapter = {
      mount(target) { calls.push(`mount:${String(target)}`) },
      unmount() { calls.push('unmount') },
      dispose() { calls.push('dispose') },
    }
    app.use({ name: 'test-ui', install(runtime, _options, resources) { runtime.registerUIAdapter(adapter, resources) } })
    await app.init({})
    await app.mount('#one')
    await app.unmount()
    await app.mount('#two')
    expect(app.status).toBe('mounted')
    await app.dispose()
    expect(calls).toEqual(['mount:#one', 'unmount', 'mount:#two', 'unmount', 'dispose'])
  })

  it('cleans a failed mount and keeps the pre-mount state so another target can be tried', async () => {
    const app = createGISApp()
    const unmount = vi.fn()
    let failed = true
    const adapter: UIAdapter = {
      mount() { if (failed) { failed = false; throw new Error('bad target') } },
      unmount,
      dispose() {},
    }
    app.use({ name: 'test-ui', install(runtime, _options, resources) { runtime.registerUIAdapter(adapter, resources) } })
    await app.init({})
    let mountError: unknown
    try { await app.mount('#bad') } catch (error) { mountError = error }
    expect(mountError).toMatchObject({ message: 'bad target' })
    expect(app.status).toBe('ready')
    expect(unmount).toHaveBeenCalledOnce()
    await app.mount('#good')
    expect(app.status).toBe('mounted')
    await app.dispose()
  })

  it('reports UI Adapter absence without making the headless Runtime unusable', async () => {
    const app = createGISApp()
    await app.init({})
    await expect(app.mount('#map')).rejects.toBeInstanceOf(GISRuntimeError)
    expect(app.status).toBe('ready')
    await app.dispose()
  })
})
