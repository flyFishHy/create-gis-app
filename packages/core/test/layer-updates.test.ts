import { expect, it, vi } from 'vitest'
import { createGISApp } from '../src/index.js'
import { createFakeLayerDefinition, createFakeMapPlugin, FakeMapAdapter } from './fake-map.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

it('checks edit versions inside the serialized queue and rejects stale edits before engine mutation', async () => {
  const gate = deferred(),
    started = deferred(),
    apply = vi.fn(async () => {
      started.resolve()
      await gate.promise
    })
  const app = createGISApp()
  app.use(
    createFakeMapPlugin(undefined, {
      test: createFakeLayerDefinition(() => ({
        setVisible() {},
        setZIndex() {},
        dispose() {},
        update: apply,
      })),
    })
  )
  try {
    await app.init({ layers: [{ id: 'one', type: 'test', title: 'Before' }] })
    const layer = app.layers.get('one')!,
      version = layer.version
    const first = app.layers.update('one', { title: 'External' })
    await started.promise
    const stale = app.layers.update('one', { title: 'Stale edit', expectedVersion: version })
    const rejected = expect(stale).rejects.toMatchObject({
      code: 'APP_INVALID_STATE',
      stage: 'layer-update',
    })
    gate.resolve()
    await first
    await rejected
    expect(apply).toHaveBeenCalledOnce()
    expect(layer.title).toBe('External')
    expect(layer.version).toBe(version + 1)
    expect(app.context.state.snapshot().layers[0]?.version).toBe(layer.version)
  } finally {
    gate.resolve()
    await app.dispose()
  }
})

it.each(['remove', 'dispose'] as const)(
  'waits for an active update before %s and rejects its stale commit',
  async (action) => {
    const gate = deferred(),
      started = deferred()
    const release = vi.fn(),
      visible = vi.fn()
    const app = createGISApp()
    app.use(
      createFakeMapPlugin(new FakeMapAdapter(), {
        test: createFakeLayerDefinition(() => ({
          setVisible: visible,
          setZIndex() {},
          dispose: release,
          update: () => {
            started.resolve()
            return gate.promise
          },
        })),
      })
    )
    await app.init({ layers: [{ id: 'one', type: 'test', title: 'Before' }] })
    const layer = app.layers.get('one')!
    const update = app.layers.update('one', { title: 'After', visible: false })
    const failed = expect(update).rejects.toMatchObject({ code: 'APP_DISPOSED' })
    await started.promise
    const queued = layer.update({ title: 'Queued' })
    const queuedFailed = expect(queued).rejects.toMatchObject({ code: 'APP_DISPOSED' })
    const removal = action === 'remove' ? app.layers.remove('one') : app.dispose()
    expect(release).not.toHaveBeenCalled()
    gate.resolve()
    await Promise.all([failed, queuedFailed, removal])
    expect(layer.title).toBe('Before')
    expect(visible).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledTimes(1)
    await app.dispose()
  }
)

it('serializes updates, recovers after failure and rejects unsupported options before committing metadata', async () => {
  const gate = deferred(),
    started = deferred(),
    calls: string[] = []
  const app = createGISApp()
  app.use(
    createFakeMapPlugin(new FakeMapAdapter(), {
      test: createFakeLayerDefinition((config) => ({
        setVisible() {},
        setZIndex() {},
        dispose() {},
        ...(config.id === 'basic'
          ? {}
          : {
              async update(patch) {
                calls.push(patch.title!)
                if (patch.title === 'First') {
                  started.resolve()
                  await gate.promise
                  throw new Error('Rejected')
                }
              },
            }),
      })),
    })
  )
  try {
    await app.init({
      layers: [
        { id: 'one', type: 'test' },
        { id: 'basic', type: 'test', title: 'Before' },
      ],
    })
    const first = app.layers.update('one', { title: 'First' })
    const failed = expect(first).rejects.toThrow('Rejected')
    await started.promise
    const second = app.layers.update('one', { title: 'Second' })
    expect(calls).toEqual(['First'])
    gate.resolve()
    await Promise.all([failed, second])
    expect(calls).toEqual(['First', 'Second'])
    expect(app.layers.get('one')!.title).toBe('Second')
    await expect(
      app.layers.update('basic', { title: 'After', options: { opacity: 0.5 } })
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' })
    expect(app.layers.get('basic')!.title).toBe('Before')
  } finally {
    await app.dispose()
  }
})
