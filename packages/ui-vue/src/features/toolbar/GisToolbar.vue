<script setup lang="ts">
import { computed, ref, inject, nextTick, onMounted, onBeforeUnmount, watch } from 'vue';
import { useToolbarActions } from './use-toolbar-actions.js';
import type { ToolbarItemDefinition } from '../../types.js';
import { useGISUI } from '../../use-gis-ui.js';
import SvgIcon from '../../components/SvgIcon.vue';
import Tooltip from '../../components/Tooltip.vue';
import { DockedPanelMotionKey } from '../../ui-context.js';

const props = withDefaults(
  defineProps<{ tooltipPlacement?: 'left' | 'right' | 'bottom'; maxVisibleTools?: number }>(),
  { tooltipPlacement: 'bottom' }
);
const ui = useGISUI();
const { activeTool, error, groups, isDisabled, run } = useToolbarActions();
const docked = inject(
  DockedPanelMotionKey,
  computed(() => false)
);
const root = ref<HTMLElement>(),
  measure = ref<HTMLElement>(),
  more = ref<HTMLButtonElement>(),
  menu = ref<HTMLElement>();
const moreMeasure = ref<HTMLButtonElement>();
const moreLabel = computed(() => (ui.locale.get() === 'zh' ? '更多' : 'More'));
const limit = ref(Infinity),
  menuOpen = ref(false),
  menuStyle = ref<Record<string, string>>();
const verticalSlot = computed(() => root.value?.closest<HTMLElement>('.gis-ui-overlay--toolbar'));
let frame = 0;
function scheduleFit() {
  if (!frame) {
    frame = requestAnimationFrame(() => {
      frame = 0;
      fit();
    });
  }
}
const items = computed(() => groups.value.flatMap(([, entries]) => entries));
const shownGroups = computed(() => {
  const shown = new Set(items.value.slice(0, limit.value));
  return groups.value
    .map(([group, entries]) => [group, entries.filter((item) => shown.has(item))] as const)
    .filter(([, entries]) => entries.length);
});
const overflow = computed(() => items.value.slice(limit.value));

function fitWidth(available: number, bounds: DOMRect[], moreBounds: DOMRect) {
  if (!available) {
    return Infinity;
  }
  const widths = bounds.map(({ width }) => width + 6);
  let used = 0,
    count = 0;
  const reserve =
    widths.reduce((total, width) => total + width, 0) > available ? moreBounds.width + 6 : 0;
  for (const width of widths) {
    if (used + width > available - reserve) {
      break;
    }
    used += width;
    count++;
  }
  return count;
}
function fitHeight(
  available: number,
  bounds: DOMRect[],
  moreBounds: DOMRect,
  probe: HTMLElement,
  toolbar: HTMLElement
) {
  const cap = props.maxVisibleTools ?? Infinity;
  if (!moreBounds.height || !bounds.length) {
    return cap;
  }
  const { top, bottom } = probe.getBoundingClientRect();
  const style = getComputedStyle(toolbar);
  const border =
    (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
  const paddingEnd = bottom - moreBounds.bottom;
  const last = bounds.at(-1)!;
  if (bounds.length <= cap && last.bottom - top + paddingEnd + border <= available) {
    return bounds.length;
  }
  // The probe includes all groups, with the More button after the last group.
  const reserve = moreBounds.bottom - last.bottom + paddingEnd + border;
  const firstOverflow = bounds.findIndex(
    (itemBounds) => itemBounds.bottom - top + reserve > available
  );
  return Math.min(cap, firstOverflow === -1 ? bounds.length : firstOverflow);
}
function fit() {
  const toolbar = root.value;
  const probe = measure.value;
  const moreBounds = moreMeasure.value?.getBoundingClientRect();
  if (!toolbar || !probe || !moreBounds) {
    limit.value = verticalSlot.value ? (props.maxVisibleTools ?? Infinity) : Infinity;
    return;
  }
  const bounds = Array.from(probe.querySelectorAll('.gis-ui-toolbar-measure-item'), (item) =>
    item.getBoundingClientRect()
  );
  const slot = verticalSlot.value;
  const count = slot
    ? fitHeight(slot.clientHeight, bounds, moreBounds, probe, toolbar)
    : fitWidth(toolbar.clientWidth, bounds, moreBounds);
  limit.value = count;
  if (menuOpen.value) {
    void nextTick(positionMenu);
  }
}
function positionMenu() {
  if (!menuOpen.value || !more.value || !menu.value) {
    menuOpen.value = false;
    return;
  }
  const anchor = more.value.getBoundingClientRect();
  const { width, height } = menu.value.getBoundingClientRect();
  const edge = 8;
  const gap = 4;
  let left = anchor.right - width;
  let top = anchor.bottom + gap;
  const slot = verticalSlot.value;
  if (slot) {
    const openRight =
      getComputedStyle(slot).getPropertyValue('--gis-ui-toolbar-menu-side').trim() === 'right';
    const leftSide = anchor.left - gap - width;
    const rightSide = anchor.right + gap;
    left = openRight
      ? rightSide + width <= window.innerWidth - edge
        ? rightSide
        : leftSide
      : leftSide >= edge
        ? leftSide
        : rightSide;
    top = anchor.top;
  } else if (top + height > window.innerHeight - edge) {
    top = anchor.top - gap - height;
  }
  menuStyle.value = {
    left: `${Math.max(edge, Math.min(left, window.innerWidth - width - edge))}px`,
    top: `${Math.max(edge, Math.min(top, window.innerHeight - height - edge))}px`,
  };
}
async function toggleMenu() {
  menuOpen.value = !menuOpen.value;
  if (!menuOpen.value) {
    return;
  }
  menuStyle.value = { left: '0px', top: '0px', visibility: 'hidden' };
  await nextTick();
  positionMenu();
  await nextTick();
  if (menuOpen.value && menu.value) {
    const firstEnabled = menu.value.querySelector<HTMLButtonElement>('button:not(:disabled)');
    (firstEnabled ?? menu.value).focus();
  }
}
function closeMenu() {
  menuOpen.value = false;
  more.value?.focus();
}
function outside(event: PointerEvent) {
  if (
    event.target instanceof Node &&
    !root.value?.contains(event.target) &&
    !menu.value?.contains(event.target)
  ) {
    menuOpen.value = false;
  }
}
function menuKeys(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closeMenu();
    return;
  }
  if (event.key === 'Tab') {
    menuOpen.value = false;
    return;
  }
  const buttons = Array.from(
    menu.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []
  );
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    ]?.focus();
  }
}
watch(
  [root, measure, docked, verticalSlot],
  ([toolbar, probe, horizontal, slot], _previous, onCleanup) => {
    fit();
    const available = slot ?? (horizontal ? toolbar : undefined);
    if (available && probe && typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(fit);
      observer.observe(available);
      observer.observe(probe);
      onCleanup(() => observer.disconnect());
    }
  },
  { flush: 'post' }
);
onMounted(() => {
  document.addEventListener('pointerdown', outside);
  window.addEventListener('resize', scheduleFit);
});
watch([items, () => ui.locale.get(), () => props.maxVisibleTools], scheduleFit, { flush: 'post' });
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', outside);
  window.removeEventListener('resize', scheduleFit);
  cancelAnimationFrame(frame);
});
function activate(item: ToolbarItemDefinition) {
  menuOpen.value = false;
  return run(item);
}

function activateFromMenu(item: ToolbarItemDefinition) {
  closeMenu();
  return activate(item);
}
</script>

<template>
  <div v-if="items.length" ref="root" class="gis-ui-toolbar-root">
    <div v-if="docked || verticalSlot" class="gis-ui-toolbar-measure-clip" aria-hidden="true" inert>
      <div ref="measure" class="gis-ui-toolbar-measure">
        <div v-for="[group, entries] in groups" :key="group" class="gis-ui-toolbar-group">
          <template v-for="item in entries" :key="item.id">
            <output v-if="item.display" class="gis-map-level gis-ui-toolbar-measure-item">{{
              item.display()
            }}</output>
            <button v-else type="button" class="gis-ui-toolbar-measure-item">
              <SvgIcon :name="item.icon ?? 'edit'" :size="16" /><span v-if="docked">{{
                ui.locale.t(item.title)
              }}</span>
            </button>
          </template>
        </div>
        <button ref="moreMeasure" type="button">
          <SvgIcon name="more-horizontal" :size="16" /><span
            v-if="docked"
            class="gis-ui-toolbar-more-label"
            >{{ moreLabel }}</span
          >
        </button>
      </div>
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
        type="button"
        class="gis-ui-toolbar-more"
        :aria-label="ui.locale.get() === 'zh' ? '更多工具' : 'More tools'"
        aria-haspopup="menu"
        :aria-expanded="menuOpen"
        @click="toggleMenu"
      >
        <SvgIcon name="more-horizontal" :size="16" /><span
          v-if="docked"
          class="gis-ui-toolbar-more-label"
          >{{ moreLabel }}</span
        >
      </button>
    </div>
    <Teleport v-if="menuOpen" :to="root?.closest('.gis-ui-root') ?? 'body'">
      <div
        ref="menu"
        class="gis-ui-toolbar-menu"
        role="menu"
        tabindex="-1"
        :style="menuStyle"
        @keydown="menuKeys"
      >
        <template v-for="item in overflow" :key="item.id">
          <div
            v-if="item.display"
            class="gis-ui-toolbar-menu-display"
            role="menuitem"
            aria-disabled="true"
          >
            <span>{{ ui.locale.t(item.title) }}</span><output>{{ item.display() }}</output>
          </div>
          <button
            v-else
            type="button"
            role="menuitem"
            :disabled="isDisabled(item)"
            :class="{ 'is-active': item.toolId ? activeTool === item.toolId : item.active }"
            @click="activateFromMenu(item)"
          >
            <SvgIcon :name="item.icon ?? 'edit'" :size="16" /><span>{{
              ui.locale.t(item.title)
            }}</span>
          </button>
        </template>
      </div>
    </Teleport>
    <p v-if="error" class="gis-ui-error" role="alert">{{ error }}</p>
  </div>
</template>
