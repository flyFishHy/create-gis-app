<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import type { CSSProperties } from 'vue'
import type { MultiSelectOption, SelectValue } from './select-values.js'
import { selectValueKey } from './select-values.js'
import SvgIcon from './SvgIcon.vue'
import ScrollArea from './ScrollArea.vue'

const props = withDefaults(defineProps<{
  modelValue: readonly SelectValue[]
  options: readonly MultiSelectOption[]
  label: string
  disabled?: boolean
  placeholder?: string
  searchText?: string
  clearText?: string
  emptyText?: string
  missingText?: string
}>(), { placeholder: 'Select values', searchText: 'Search', clearText: 'Clear selection', emptyText: 'No matching values', missingText: 'Not in current data' })
const emit = defineEmits<{ 'update:modelValue': [value: SelectValue[]]; open: [] }>()
const root = ref<HTMLElement>(), trigger = ref<HTMLButtonElement>(), menu = ref<HTMLElement>(), search = ref<HTMLInputElement>()
const target = ref<HTMLElement>(), open = ref(false), query = ref(''), active = ref(0)
const position = ref<CSSProperties>({}), theme = ref<CSSProperties>({})
const listId = `gis-multi-${useId()}`
const selected = (value: SelectValue) => props.modelValue.some(item => item === value)
const choices = computed(() => {
  const options = new Map(props.options.map(option => [selectValueKey(option.value), option]))
  for (const value of props.modelValue) if (!options.has(selectValueKey(value))) options.set(selectValueKey(value), { value, label: String(value), hint: props.missingText })
  return [...options.values()]
})
const filtered = computed(() => choices.value.filter(option => `${option.label} ${option.value}`.toLocaleLowerCase().includes(query.value.toLocaleLowerCase())))
// Bound DOM size for high-cardinality fields; searching still covers every candidate.
const visible = computed(() => filtered.value.slice(0, 100))
const selectedLabels = computed(() => props.modelValue.map(value => choices.value.find(option => option.value === value)?.label ?? String(value)))
const summary = computed(() => selectedLabels.value.length ? `${selectedLabels.value[0]}${selectedLabels.value.length > 1 ? ` +${selectedLabels.value.length - 1}` : ''}` : props.placeholder)

function close() { open.value = false }
async function show() {
  if (props.disabled || !trigger.value) return
  emit('open')
  query.value = ''; active.value = 0
  target.value = root.value?.closest<HTMLElement>('.gis-ui-root') ?? document.body
  const css = getComputedStyle(trigger.value)
  theme.value = Object.fromEntries(Array.from(css).filter(key => key.startsWith('--gis-ui-')).map(key => [key, css.getPropertyValue(key)]))
  const anchor = trigger.value.getBoundingClientRect()
  const width = Math.min(Math.max(anchor.width, 240), window.innerWidth - 16)
  const below = window.innerHeight - anchor.bottom - 14, above = anchor.top - 14
  const upward = below < 220 && above > below
  position.value = { width: `${width}px`, left: `${Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8))}px`,
    maxHeight: `${Math.max(90, Math.min(300, upward ? above : below))}px`,
    ...(upward ? { bottom: `${window.innerHeight - anchor.top + 6}px` } : { top: `${anchor.bottom + 6}px` }) }
  open.value = true
  await nextTick()
  search.value?.focus()
}
function choose(index: number) {
  const option = visible.value[index]
  if (!option || option.disabled || props.disabled) return
  emit('update:modelValue', selected(option.value) ? props.modelValue.filter(value => value !== option.value) : [...props.modelValue, option.value])
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); trigger.value?.focus(); return }
  if (event.key === 'Tab') { close(); return }
  if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'].includes(event.key) || (event.key === ' ' && event.target !== search.value)) {
    event.preventDefault(); event.stopPropagation()
    if (!open.value) { void show(); return }
    if (event.key === 'Enter' || event.key === ' ') choose(active.value)
    else if (event.key === 'Home') active.value = 0
    else if (event.key === 'End') active.value = visible.value.length - 1
    else active.value = (active.value + (event.key === 'ArrowDown' ? 1 : -1) + visible.value.length) % (visible.value.length || 1)
  }
}
function outside(event: Event) {
  if (event.target instanceof Node && !root.value?.contains(event.target) && !menu.value?.contains(event.target)) close()
}
function scrolling(event: Event) { if (!(event.target instanceof Node) || !menu.value?.contains(event.target)) close() }
function removeListeners() {
  document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside)
  window.removeEventListener('resize', close); window.removeEventListener('scroll', scrolling, true)
}
watch(open, value => {
  removeListeners()
  if (value) {
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', outside)
    window.addEventListener('resize', close); window.addEventListener('scroll', scrolling, true)
  }
}, { flush: 'sync' })
watch(query, () => { active.value = 0 })
watch(() => props.disabled, value => { if (value) close() })
watch(active, async () => { await nextTick(); menu.value?.querySelector(`#${listId}-${active.value}`)?.scrollIntoView?.({ block: 'nearest' }) })
onBeforeUnmount(removeListeners)
</script>

<template>
  <div ref="root" class="gis-ui-multi-select" :class="{ 'is-open': open }">
    <button ref="trigger" type="button" class="gis-ui-select-trigger" role="combobox" aria-haspopup="listbox" :aria-label="label" :aria-expanded="open" :aria-controls="open ? listId : undefined"
      :disabled="disabled" :title="selectedLabels.join(', ') || placeholder" @click="open ? close() : show()" @keydown="keydown">
      <span class="gis-ui-select-value">{{ summary }}</span><SvgIcon name="chevron-down" :size="13" />
    </button>
    <Teleport v-if="open && target" :to="target">
      <div ref="menu" class="gis-ui-multi-menu" :style="[theme, position]" @keydown="keydown">
        <div class="gis-ui-multi-search"><SvgIcon name="search" :size="14" /><input ref="search" v-model="query" type="search" role="combobox" aria-expanded="true" :aria-label="`${searchText} ${label}`" :placeholder="searchText" :aria-controls="listId" :aria-activedescendant="visible.length ? `${listId}-${active}` : undefined"></div>
        <ScrollArea class="gis-ui-multi-options">
          <ul :id="listId" class="gis-ui-select-options" role="listbox" aria-multiselectable="true" :aria-label="label">
            <li v-for="(option, index) in visible" :id="`${listId}-${index}`" :key="selectValueKey(option.value)" role="option"
              :aria-label="option.label" :aria-selected="selected(option.value)" :aria-disabled="option.disabled || undefined"
              class="gis-ui-select-option" :class="{ 'is-selected': selected(option.value), 'is-active': index === active, 'is-disabled': option.disabled }"
              :title="option.hint || `${option.label} (${typeof option.value})`" @pointermove="active = index" @mousedown.prevent @click="choose(index)">
              <span class="gis-ui-multi-check"><SvgIcon v-if="selected(option.value)" name="check" :size="12" /></span><span>{{ option.label }}</span><small v-if="option.hint">{{ option.hint }}</small>
            </li>
          </ul>
          <p v-if="!visible.length" class="gis-ui-empty">{{ emptyText }}</p>
        </ScrollArea>
        <footer><span>{{ modelValue.length }} / {{ choices.length }}<span v-if="filtered.length > 100"> · {{ visible.length }}/{{ filtered.length }}</span></span><button type="button" :disabled="disabled || !modelValue.length" @click="emit('update:modelValue', [])">{{ clearText }}</button></footer>
      </div>
    </Teleport>
  </div>
</template>
