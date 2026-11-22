import { shallowRef } from 'vue'
import type { ToolbarItemDefinition, ToolbarService } from '../types.js'

export class ToolbarServiceImpl implements ToolbarService {
  readonly items = shallowRef<readonly ToolbarItemDefinition[]>([])

  register(item: ToolbarItemDefinition): () => void {
    if (!item.id.trim()) throw new Error('Toolbar item id must be a non-empty string.')
    if (this.items.value.some((entry) => entry.id === item.id)) {
      throw new Error(`Toolbar item "${item.id}" is already registered.`)
    }
    this.items.value = [...this.items.value, Object.freeze({ ...item })]
    let registered = true
    return () => {
      if (!registered) return
      registered = false
      this.items.value = this.items.value.filter((entry) => entry.id !== item.id)
    }
  }

  list(): ToolbarItemDefinition[] {
    return this.items.value
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))
  }

  clear(): void {
    this.items.value = []
  }
}
