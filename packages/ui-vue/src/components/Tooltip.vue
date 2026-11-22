<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import type { CSSProperties } from 'vue'

const props = withDefaults(
  defineProps<{
    content: string
    delay?: number
    placement?: 'left' | 'right' | 'bottom'
  }>(),
  { delay: 180, placement: 'right' }
)

const trigger = ref<HTMLElement>()
const bubble = ref<HTMLElement>()
const open = ref(false)
const position = ref<CSSProperties>({ visibility: 'hidden' })
const id = `gis-tooltip-${useId()}`
let timer: ReturnType<typeof setTimeout> | undefined

function cancelTimer() {
  clearTimeout(timer)
  timer = undefined
}
function hide() {
  cancelTimer()
  open.value = false
}

async function show() {
  cancelTimer()
  if (!props.content || !trigger.value) return
  const triggerStyle = getComputedStyle(trigger.value)
  const tokens = Object.fromEntries(
    Array.from(triggerStyle)
      .filter((key) => key.startsWith('--gis-ui-'))
      .map((key) => [key, triggerStyle.getPropertyValue(key)])
  )
  position.value = { ...tokens, visibility: 'hidden' }
  open.value = true
  await nextTick()
  if (!open.value || !trigger.value || !bubble.value) return
  const anchor = trigger.value.getBoundingClientRect()
  const tip = bubble.value.getBoundingClientRect()
  const gap = 10
  const edge = 8
  const preferredLeft = anchor.right + gap
  let left =
    preferredLeft + tip.width <= window.innerWidth - edge
      ? preferredLeft
      : anchor.left - gap - tip.width
  let top = anchor.top + (anchor.height - tip.height) / 2
  if (props.placement === 'left') {
    left =
      anchor.left - gap - tip.width >= edge ? anchor.left - gap - tip.width : anchor.right + gap
  }
  if (props.placement === 'bottom') {
    left = anchor.left + (anchor.width - tip.width) / 2
    top =
      anchor.bottom + gap + tip.height <= window.innerHeight - edge
        ? anchor.bottom + gap
        : anchor.top - gap - tip.height
  }
  position.value = {
    ...tokens,
    left: `${Math.max(edge, Math.min(left, window.innerWidth - tip.width - edge))}px`,
    top: `${Math.max(edge, Math.min(top, window.innerHeight - tip.height - edge))}px`,
    visibility: 'visible',
  }
}

function hover() {
  cancelTimer()
  timer = setTimeout(() => {
    void show()
  }, props.delay)
}
function leave() {
  if (!trigger.value?.contains(document.activeElement)) hide()
}
function blur(event: FocusEvent) {
  if (!(event.relatedTarget instanceof Node) || !trigger.value?.contains(event.relatedTarget))
    hide()
}
function removeListeners() {
  window.removeEventListener('resize', hide)
  window.removeEventListener('scroll', hide, true)
}
watch(open, (value) => {
  removeListeners()
  if (value) {
    window.addEventListener('resize', hide)
    window.addEventListener('scroll', hide, true)
  }
})
onBeforeUnmount(() => {
  cancelTimer()
  removeListeners()
})
</script>

<template>
  <span
    ref="trigger"
    class="gis-ui-tooltip-trigger"
    @pointerenter="hover"
    @pointerleave="leave"
    @focusin="show"
    @focusout="blur"
    @keydown.esc.stop="hide"
    @click="hide"
  >
    <slot :described-by="open ? id : undefined" />
  </span>
  <Teleport to="body">
    <span
      v-if="open"
      :id="id"
      ref="bubble"
      role="tooltip"
      class="gis-ui-tooltip"
      :style="position"
      >{{ content }}</span
    >
  </Teleport>
</template>
