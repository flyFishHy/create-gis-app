<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import SvgIcon from './SvgIcon.vue'
import ScrollArea from './ScrollArea.vue'

const props = defineProps<{
  modelValue: string
  options: readonly { value: string; label: string }[]
  label: string
  placeholder?: string
  disabled?: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: string]
  'open': []
}>()
const root = ref<HTMLElement>()
const trigger = ref<HTMLButtonElement>()
const open = ref(false)
const active = ref(-1)
const listId = `gis-select-${useId()}`
const selectedIndex = computed(() => props.options.findIndex(option => option.value === props.modelValue))
const selectedLabel = computed(() => props.options[selectedIndex.value]?.label ?? props.placeholder ?? '')
let typed = ''
let lastTyped = 0

function close() { open.value = false; typed = '' }
function show(fromEnd = false) {
  if (props.disabled || !props.options.length) return
  active.value = selectedIndex.value >= 0 ? selectedIndex.value : fromEnd ? props.options.length - 1 : 0
  open.value = true
  emit('open')
}
function choose(index: number) {
  const option = props.options[index]
  if (!option) return
  emit('update:modelValue', option.value)
  close()
  trigger.value?.focus()
}
function outside(event: PointerEvent) {
  if (event.target instanceof Node && !root.value?.contains(event.target)) close()
}
function blur(event: FocusEvent) {
  if (!(event.relatedTarget instanceof Node) || !root.value?.contains(event.relatedTarget)) close()
}
function keydown(event: KeyboardEvent) {
  const { key } = event
  if (key === 'Tab') { close(); return }
  if (key === 'Escape') {
    if (open.value) { event.preventDefault(); event.stopPropagation(); close() }
    return
  }
  if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(key)) {
    event.preventDefault()
    event.stopPropagation()
    if (key === 'Enter' || key === ' ') {
      if (open.value) choose(active.value); else show()
    } else if (!open.value) {
      show(key === 'ArrowUp' || key === 'End')
      if (key === 'Home') active.value = 0
      if (key === 'End') active.value = props.options.length - 1
    } else if (key === 'Home') active.value = 0
    else if (key === 'End') active.value = props.options.length - 1
    else active.value = (active.value + (key === 'ArrowDown' ? 1 : -1) + props.options.length) % props.options.length
  } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    if (!open.value) show()
    const now = Date.now()
    typed = (now - lastTyped < 600 ? typed : '') + key.toLocaleLowerCase()
    lastTyped = now
    const index = props.options.findIndex(option => option.label.toLocaleLowerCase().startsWith(typed))
    if (index >= 0) active.value = index
  }
}
watch(open, value => {
  document.removeEventListener('pointerdown', outside)
  if (value) document.addEventListener('pointerdown', outside)
}, { flush: 'sync' })
watch(() => props.options, () => { if (open.value) close() })
watch(() => props.disabled, value => { if (value) close() })
watch(active, async () => {
  await nextTick()
  root.value?.querySelector(`#${listId}-option-${active.value}`)?.scrollIntoView?.({ block: 'nearest' })
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
</script>

<template>
  <div ref="root" class="gis-ui-select" :class="{ 'is-open': open }" @focusout="blur" @keydown.esc.stop.prevent="close(); trigger?.focus()">
    <button ref="trigger" class="gis-ui-select-trigger" type="button" role="combobox"
      :aria-label="label" :aria-expanded="open" aria-haspopup="listbox" :aria-controls="open ? listId : undefined"
      :aria-activedescendant="open && active >= 0 ? `${listId}-option-${active}` : undefined"
      :disabled="disabled || !options.length" :title="selectedLabel"
      @click="open ? close() : show()" @keydown.stop="keydown">
      <span class="gis-ui-select-value">{{ selectedLabel }}</span>
      <SvgIcon name="chevron-down" :size="14" />
    </button>
    <ScrollArea v-if="open" class="gis-ui-select-menu">
    <ul :id="listId" class="gis-ui-select-options" role="listbox" :aria-label="label">
      <li v-for="(option, index) in options" :id="`${listId}-option-${index}`" :key="option.value"
        class="gis-ui-select-option" :class="{ 'is-selected': option.value === modelValue, 'is-active': index === active }"
        role="option" :aria-selected="option.value === modelValue" :title="option.label"
        @pointermove="active = index" @mousedown.prevent @click="choose(index)">
        <span>{{ option.label }}</span><span class="gis-ui-select-check" aria-hidden="true">{{ option.value === modelValue ? '✓' : '' }}</span>
      </li>
    </ul>
    </ScrollArea>
  </div>
</template>
