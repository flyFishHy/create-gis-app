<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, useId } from 'vue'
defineProps<{ label?: string; id?: string }>()
const root = ref<HTMLElement>(),
  viewport = ref<HTMLElement>(),
  content = ref<HTMLElement>()
const viewportId = `gis-scroll-${useId()}`
type Axis = 'x' | 'y'
const emptyAxis = () => ({ range: 0, value: 0, size: 0, travel: 0, offset: 0 })
const metrics = shallowRef({ x: emptyAxis(), y: emptyAxis() })
const dragging = ref<Axis>()
let drag: { axis: Axis; pointer: number; start: number; value: number } | undefined
let resize: ResizeObserver | undefined, mutation: MutationObserver | undefined
let frame = 0,
  disposed = false
function refresh() {
  const view = viewport.value,
    host = root.value
  if (!view || !host || disposed) return
  const xRange = Math.max(0, view.scrollWidth - view.clientWidth),
    yRange = Math.max(0, view.scrollHeight - view.clientHeight)
  const axis = (range: number, value: number, visible: number, total: number, track: number) => {
    value = Math.max(0, Math.min(range, value))
    track = Math.max(0, track)
    const size = Math.min(track, Math.max(24, total > 0 ? (track * visible) / total : track))
    const travel = Math.max(0, track - size)
    return {
      range,
      value,
      size,
      travel,
      offset: range ? Math.max(0, Math.min(1, value / range)) * travel : 0,
    }
  }
  metrics.value = {
    x: axis(
      xRange,
      view.scrollLeft,
      view.clientWidth,
      view.scrollWidth,
      host.clientWidth - 8 - (yRange > 1 ? 8 : 0)
    ),
    y: axis(
      yRange,
      view.scrollTop,
      view.clientHeight,
      view.scrollHeight,
      host.clientHeight - 8 - (xRange > 1 ? 8 : 0)
    ),
  }
}
function schedule() {
  if (!frame && !disposed)
    frame = requestAnimationFrame(() => {
      frame = 0
      refresh()
    })
}
function contentChanged() {
  // Child removal changes native scroll dimensions before the next paint. Refresh
  // immediately so a focused collapse control cannot expose stale scroll tracks,
  // then verify again on the next frame for image/style-driven layout changes.
  refresh()
  schedule()
}
function setScroll(axis: Axis, value: number) {
  if (!viewport.value) return
  const next = Math.max(0, Math.min(metrics.value[axis].range, value))
  if (axis === 'y') viewport.value.scrollTop = next
  else viewport.value.scrollLeft = next
  refresh()
}
function stopDrag() {
  document.removeEventListener('pointermove', move)
  document.removeEventListener('pointerup', end)
  document.removeEventListener('pointercancel', end)
  window.removeEventListener('blur', cancelDrag)
  drag = undefined
  dragging.value = undefined
}
function cancelDrag() {
  stopDrag()
}
function begin(event: PointerEvent, axis: Axis) {
  if (event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  stopDrag()
  refresh()
  ;(event.currentTarget as HTMLElement).focus()
  drag = {
    axis,
    pointer: event.pointerId,
    start: axis === 'y' ? event.clientY : event.clientX,
    value: metrics.value[axis].value,
  }
  dragging.value = axis
  document.addEventListener('pointermove', move, { passive: false })
  document.addEventListener('pointerup', end)
  document.addEventListener('pointercancel', end)
  window.addEventListener('blur', cancelDrag)
}
function move(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointer) return
  event.preventDefault()
  const state = metrics.value[drag.axis],
    delta = (drag.axis === 'y' ? event.clientY : event.clientX) - drag.start
  if (state.travel) setScroll(drag.axis, drag.value + (delta * state.range) / state.travel)
}
function end(event: PointerEvent) {
  if (drag?.pointer === event.pointerId) stopDrag()
}
function jump(event: PointerEvent, axis: Axis) {
  if (event.button !== 0) return
  event.preventDefault()
  refresh()
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect(),
    state = metrics.value[axis]
  const position = axis === 'y' ? event.clientY - bounds.top : event.clientX - bounds.left
  if (state.travel) setScroll(axis, ((position - state.size / 2) / state.travel) * state.range)
}
function keydown(event: KeyboardEvent, axis: Axis) {
  if (event.key === 'Escape') {
    stopDrag()
    return
  }
  refresh()
  const state = metrics.value[axis],
    page = (axis === 'y' ? viewport.value?.clientHeight : viewport.value?.clientWidth) ?? 0
  let value: number
  if (event.key === 'Home') value = 0
  else if (event.key === 'End') value = state.range
  else if (event.key === 'PageDown') value = state.value + page * 0.9
  else if (event.key === 'PageUp') value = state.value - page * 0.9
  else if (event.key === (axis === 'y' ? 'ArrowDown' : 'ArrowRight')) value = state.value + 40
  else if (event.key === (axis === 'y' ? 'ArrowUp' : 'ArrowLeft')) value = state.value - 40
  else return
  event.preventDefault()
  event.stopPropagation()
  setScroll(axis, value)
}
onMounted(() => {
  refresh()
  if (typeof ResizeObserver !== 'undefined') {
    resize = new ResizeObserver(schedule)
    resize.observe(viewport.value!)
    resize.observe(content.value!)
    resize.observe(root.value!)
  }
  if (typeof MutationObserver !== 'undefined') {
    mutation = new MutationObserver(contentChanged)
    mutation.observe(content.value!, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    })
  }
  window.addEventListener('resize', schedule)
  content.value?.addEventListener('load', schedule, true)
})
onBeforeUnmount(() => {
  disposed = true
  resize?.disconnect()
  mutation?.disconnect()
  stopDrag()
  cancelAnimationFrame(frame)
  window.removeEventListener('resize', schedule)
  content.value?.removeEventListener('load', schedule, true)
})
defineExpose({ viewport, refresh })
</script>

<template>
  <div
    :id="id"
    ref="root"
    class="gis-ui-scroll-area"
    :class="{
      'has-horizontal': metrics.x.range > 1,
      'has-vertical': metrics.y.range > 1,
      'is-scrolling': dragging,
    }"
  >
    <div
      :id="viewportId"
      ref="viewport"
      class="gis-ui-scroll-viewport"
      :role="label ? 'region' : undefined"
      :aria-label="label"
      tabindex="0"
      @scroll.passive="refresh"
    >
      <div ref="content" class="gis-ui-scroll-content"><slot /></div>
    </div>
    <template v-for="axis in ['y', 'x'] as const" :key="axis">
      <div
        v-if="metrics[axis].range > 1"
        class="gis-ui-scroll-track"
        :class="`is-${axis}`"
        @pointerdown="jump($event, axis)"
      >
        <div
          class="gis-ui-scroll-thumb"
          :class="`is-${axis}`"
          role="scrollbar"
          tabindex="0"
          :aria-label="label || (axis === 'y' ? 'Vertical scroll' : 'Horizontal scroll')"
          :aria-controls="viewportId"
          :aria-orientation="axis === 'y' ? 'vertical' : 'horizontal'"
          :aria-valuemin="0"
          :aria-valuemax="Math.round(metrics[axis].range)"
          :aria-valuenow="Math.round(metrics[axis].value)"
          :style="
            axis === 'y'
              ? { height: metrics.y.size + 'px', transform: `translateY(${metrics.y.offset}px)` }
              : { width: metrics.x.size + 'px', transform: `translateX(${metrics.x.offset}px)` }
          "
          @pointerdown="begin($event, axis)"
          @keydown="keydown($event, axis)"
        />
      </div>
    </template>
  </div>
</template>
