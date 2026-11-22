<script setup lang="ts">
import { computed, ref, inject, nextTick, onMounted, onBeforeUnmount, watch } from 'vue'
import { useAppState } from '../use-app-state.js'
import type { ToolbarItemDefinition } from '../types.js'
import { useGISApp } from '../use-gis-app.js'
import { useGISUI } from '../use-gis-ui.js'
import SvgIcon from '../components/SvgIcon.vue'
import Tooltip from '../components/Tooltip.vue'
import { DockedPanelMotionKey } from '../ui-context.js'

withDefaults(defineProps<{ tooltipPlacement?: 'left' | 'right' | 'bottom' }>(), {
  tooltipPlacement: 'bottom',
})
const app = useGISApp()
const ui = useGISUI()
const snapshot = useAppState()
const activeTool = computed(() => snapshot.value.interactions.activeToolId)
const error = ref<string>()
const docked = inject(
  DockedPanelMotionKey,
  computed(() => false)
)
const root = ref<HTMLElement>(),
  measure = ref<HTMLElement>(),
  more = ref<HTMLButtonElement>(),
  menu = ref<HTMLElement>()
const moreMeasure = ref<HTMLButtonElement>()
const moreLabel = computed(() => (ui.locale.get() === 'zh' ? '更多' : 'More'))
const limit = ref(Infinity),
  menuOpen = ref(false),
  menuStyle = ref<Record<string, string>>()
let observer: ResizeObserver | undefined
let frame = 0,
  measuredWidths: number[] | undefined,
  measuredMore = 0
function invalidate() {
  measuredWidths = undefined
}
function scheduleFit() {
  if (!frame)
    frame = requestAnimationFrame(() => {
      frame = 0
      fit()
    })
}
const items = computed(() => itemGroups().flatMap(([, entries]) => entries))
const shownGroups = computed(() =>
  itemGroups()
    .map(
      ([group, entries]) =>
        [
          group,
          entries.filter((item) => !docked.value || items.value.indexOf(item) < limit.value),
        ] as const
    )
    .filter(([, entries]) => entries.length)
)
const overflow = computed(() => (docked.value ? items.value.slice(limit.value) : []))
function fit() {
  if (!docked.value || !root.value || !measure.value) return
  if (!measuredWidths) {
    measuredWidths = Array.from(measure.value.querySelectorAll('.gis-ui-toolbar-measure-item')).map(
      (e) => (e as HTMLElement).getBoundingClientRect().width + 6
    )
    measuredMore = (moreMeasure.value?.getBoundingClientRect().width ?? 0) + 6
  }
  const widths = measuredWidths
  const available = root.value.clientWidth
  if (!available) return
  let used = 0,
    count = 0
  const reserve = widths.reduce((a, b) => a + b, 0) > available ? measuredMore : 0
  for (const width of widths) {
    if (used + width > available - reserve) break
    used += width
    count++
  }
  limit.value = count
  menuOpen.value = false
}
async function toggleMenu() {
  menuOpen.value = !menuOpen.value
  if (menuOpen.value && more.value) {
    const r = more.value.getBoundingClientRect()
    menuStyle.value = {
      top: Math.min(r.bottom + 4, window.innerHeight - 100) + 'px',
      right: Math.max(8, window.innerWidth - r.right) + 'px',
    }
    await nextTick()
    menu.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }
}
function closeMenu() {
  menuOpen.value = false
  more.value?.focus()
}
function outside(e: PointerEvent) {
  if (
    e.target instanceof Node &&
    !root.value?.contains(e.target) &&
    !menu.value?.contains(e.target)
  )
    menuOpen.value = false
}
function menuKeys(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    closeMenu()
    return
  }
  if (e.key === 'Tab') {
    menuOpen.value = false
    return
  }
  const buttons = Array.from(
    menu.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []
  )
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
    e.preventDefault()
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    buttons[
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? buttons.length - 1
          : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    ]?.focus()
  }
}
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver((entries) => {
      if (entries.some((entry) => entry.target === measure.value)) invalidate()
      fit()
    })
    if (root.value) observer.observe(root.value)
    if (measure.value) observer.observe(measure.value)
  }
  document.addEventListener('pointerdown', outside)
  window.addEventListener('resize', scheduleFit)
  void nextTick(fit)
})
watch(
  () => ui.locale.get(),
  () => {
    invalidate()
    void nextTick(scheduleFit)
  }
)
watch(items, () => {
  invalidate()
  void nextTick(scheduleFit)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  document.removeEventListener('pointerdown', outside)
  window.removeEventListener('resize', scheduleFit)
  cancelAnimationFrame(frame)
})
function itemGroups() {
  const groups = new Map<string, ToolbarItemDefinition[]>()
  for (const item of ui.toolbar.list()) {
    if (item.toolId && !app.interactions.hasTool(item.toolId)) continue
    const key = item.group ?? ''
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return [...groups.entries()]
}

function isDisabled(item: ToolbarItemDefinition) {
  // Predicates may read public Runtime services without accessing Vue refs themselves.
  void snapshot.value.revision
  return typeof item.disabled === 'function' ? item.disabled() : (item.disabled ?? false)
}

async function activate(item: ToolbarItemDefinition) {
  menuOpen.value = false
  error.value = undefined
  try {
    if (item.toolId) {
      if (activeTool.value === item.toolId) await app.interactions.deactivateTool()
      else await app.interactions.activateTool(item.toolId)
      return
    }
    await item.onClick?.()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}
</script>

<template>
  <div v-if="itemGroups().length" ref="root" class="gis-ui-toolbar-root">
    <div v-if="docked" ref="measure" class="gis-ui-toolbar-measure" aria-hidden="true" inert>
      <button v-for="item in items" :key="item.id" class="gis-ui-toolbar-measure-item">
        <SvgIcon :name="item.icon ?? 'edit'" :size="16" /><span>{{ ui.locale.t(item.title) }}</span>
      </button>
      <button ref="moreMeasure" class="gis-ui-toolbar-more">
        <SvgIcon name="more-horizontal" :size="16" /><span class="gis-ui-toolbar-more-label">{{
          moreLabel
        }}</span>
      </button>
    </div>
    <div class="gis-ui-toolbar">
      <div
        v-for="([group, items], groupIndex) in shownGroups"
        :key="group || groupIndex"
        class="gis-ui-toolbar-group"
        :aria-label="group || undefined"
      >
        <Tooltip
          v-for="item in items"
          :key="item.id"
          :placement="tooltipPlacement"
          :content="
            item.shortcut
              ? `${ui.locale.t(item.title)} (${item.shortcut})`
              : ui.locale.t(item.title)
          "
          v-slot="{ describedBy }"
        >
          <output
            v-if="item.display"
            class="gis-map-level"
            :aria-label="ui.locale.t(item.title)"
            :aria-describedby="describedBy"
            >{{ item.display() }}</output
          >
          <button
            v-else
            type="button"
            :disabled="isDisabled(item)"
            :class="{ 'is-active': item.toolId ? activeTool === item.toolId : item.active }"
            :aria-label="ui.locale.t(item.title)"
            :aria-describedby="describedBy"
            :aria-pressed="item.toolId ? activeTool === item.toolId : Boolean(item.active)"
            @click="activate(item)"
          >
            <SvgIcon :name="item.icon ?? 'edit'" :size="16" /><span v-if="docked">{{
              ui.locale.t(item.title)
            }}</span>
          </button>
        </Tooltip>
      </div>
      <button
        v-if="overflow.length"
        ref="more"
        class="gis-ui-toolbar-more"
        :aria-label="ui.locale.get() === 'zh' ? '更多工具' : 'More tools'"
        aria-haspopup="menu"
        :aria-expanded="menuOpen"
        @click="toggleMenu"
      >
        <SvgIcon name="more-horizontal" :size="16" /><span class="gis-ui-toolbar-more-label">{{
          moreLabel
        }}</span>
      </button>
    </div>
    <Teleport :to="root?.closest('.gis-ui-root') ?? 'body'" :disabled="!docked">
      <div
        v-if="menuOpen"
        ref="menu"
        class="gis-ui-toolbar-menu"
        role="menu"
        :style="menuStyle"
        @keydown="menuKeys"
      >
        <button
          v-for="item in overflow"
          :key="item.id"
          role="menuitem"
          :disabled="isDisabled(item)"
          :class="{ 'is-active': item.toolId ? activeTool === item.toolId : item.active }"
          @click="activate(item)"
        >
          <SvgIcon :name="item.icon ?? 'edit'" :size="16" /><span>{{
            ui.locale.t(item.title)
          }}</span>
        </button>
      </div>
    </Teleport>
    <p v-if="error" class="gis-ui-error" role="alert">{{ error }}</p>
  </div>
</template>
