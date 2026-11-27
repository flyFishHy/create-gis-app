<script setup lang="ts">
import { computed, provide, shallowRef } from 'vue';
import { useGISUI } from '../use-gis-ui.js';
import PanelShell from './PanelShell.vue';
import { cssSize } from '../panels/panel-size.js';
import { PanelHeaderKey } from '../ui-context.js';
import SvgIcon from './SvgIcon.vue';

const props = defineProps<{ id: string; animate?: boolean }>();
const ui = useGISUI();
const badge = shallowRef(''),
  refresh = shallowRef<() => void>();
provide(PanelHeaderKey, { badge, refresh });
const definition = computed(() => ui.panels.get(props.id));
const state = computed(() => ui.panels.getState(props.id));
const displayTitle = computed(() => {
  const title = definition.value?.title;
  return title ? ui.locale.t(title) : undefined;
});
const panelStyle = computed(() => {
  const current = state.value;
  if (!current) {
    return undefined;
  }
  return {
    width:
      current.position === 'left' || current.position === 'right' ? '100%' : cssSize(current.width),
    height: cssSize(current.height),
    flex: current.height === undefined ? undefined : '0 1 auto',
    minWidth:
      definition.value?.minWidth === undefined
        ? undefined
        : `min(100%, ${cssSize(definition.value.minWidth)})`,
    maxWidth:
      definition.value?.maxWidth === undefined
        ? undefined
        : `min(100%, ${cssSize(definition.value.maxWidth)})`,
    minHeight: cssSize(definition.value?.minHeight),
    maxHeight: cssSize(definition.value?.maxHeight),
  };
});
</script>

<template>
  <Transition name="gis-ui-panel" :css="animate">
    <div
      v-if="definition && state && (state.visible || definition.keepMounted)"
      v-show="state.visible"
      class="gis-ui-panel-host"
      :style="panelStyle"
      :class="[
        `gis-ui-panel-host--${id}`,
        { 'is-unframed': definition.unframed, 'is-hidden': !state.visible },
      ]"
    >
      <div v-if="definition.unframed" v-show="!state.collapsed" class="gis-ui-panel-content">
        <component :is="definition.component" v-bind="definition.props" />
      </div>
      <PanelShell
        v-else
        :title="displayTitle"
        :icon="definition.icon"
        :collapsed="state.collapsed"
        :collapsible="definition.collapsible ?? true"
        :closable="definition.closable ?? true"
        :keep-mounted="definition.keepMounted"
        :labels="{
          expand: ui.locale.t('action.expand'),
          collapse: ui.locale.t('action.collapse'),
          close: ui.locale.t('action.closePanel'),
        }"
        @collapse="state.collapsed ? ui.panels.expand(id) : ui.panels.collapse(id)"
        @close="ui.panels.hide(id)"
      >
        <template v-if="definition.icon || badge" #title>
          <SvgIcon v-if="definition.icon" :name="definition.icon" :size="16">
            <span aria-hidden="true">{{ definition.icon }}</span>
          </SvgIcon>
          {{ displayTitle }}
          <span
            v-if="badge"
            class="gis-ui-panel-count"
            :aria-label="
              definition.header?.badgeLabel ? ui.locale.t(definition.header.badgeLabel) : undefined
            "
            >{{ badge }}</span
          >
        </template>
        <template v-if="refresh || definition.header?.refreshLabel" #actions>
          <button
            type="button"
            class="gis-ui-panel-refresh"
            :disabled="!refresh"
            :aria-label="ui.locale.t(definition.header?.refreshLabel ?? 'action.refresh')"
            :title="ui.locale.t(definition.header?.refreshLabel ?? 'action.refresh')"
            @click="refresh?.()"
          >
            <SvgIcon name="refresh" :size="16" />
          </button>
        </template>
        <component :is="definition.component" v-bind="definition.props" />
      </PanelShell>
    </div>
  </Transition>
</template>
