import { GISRuntimeError } from '../errors.js'
import type { GISPlugin } from '../types/plugin.js'

/** Stable dependency order; lifecycle and resource ownership remain with GISApp. */
export function resolvePluginOrder<T extends { readonly plugin: Pick<GISPlugin, 'dependencies'> }>(
  plugins: ReadonlyMap<string, T>
): T[] {
  const ordered: T[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()

  const visit = (name: string, via?: string) => {
    if (visited.has(name)) return
    if (visiting.has(name)) {
      throw new GISRuntimeError({
        code: 'PLUGIN_DEPENDENCY_MISSING',
        message: `Plugin dependency cycle detected at "${name}".`,
        stage: 'plugin-validation',
        detail: { plugin: via ?? name },
      })
    }
    const record = plugins.get(name)
    if (!record) {
      throw new GISRuntimeError({
        code: 'PLUGIN_DEPENDENCY_MISSING',
        message: `Required plugin "${name}" is not registered.`,
        stage: 'plugin-validation',
        detail: { plugin: via },
      })
    }
    visiting.add(name)
    for (const dependency of record.plugin.dependencies ?? []) visit(dependency, name)
    visiting.delete(name)
    visited.add(name)
    ordered.push(record)
  }

  for (const name of plugins.keys()) visit(name)
  return ordered
}
