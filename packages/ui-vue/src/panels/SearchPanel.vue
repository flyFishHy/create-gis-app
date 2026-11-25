<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, useId, watch } from 'vue';
import type { SearchResult } from '../types.js';
import { useGISApp } from '../use-gis-app.js';
import { useGISUI } from '../use-gis-ui.js';
import { useAppState } from '../use-app-state.js';
import SvgIcon from '../components/SvgIcon.vue';
import GisSelect from '../components/GisSelect.vue';
import ScrollArea from '../components/ScrollArea.vue';

const props = withDefaults(
  defineProps<{
    placeholder?: string;
    emptyText?: string;
    maxResults?: number;
    dropdown?: boolean;
  }>(),
  {
    maxResults: 8,
    dropdown: false,
  }
);

const app = useGISApp();
const ui = useGISUI();
const snapshot = useAppState((state) => state.layers);
const providers = shallowRef(app.search.listProviders());
const providerCount = computed(() => providers.value.length);
const selectedLayer = ref('');
const searchableLayers = computed(() =>
  snapshot.value.filter(
    (layer) =>
      layer.type !== 'GROUP' &&
      providers.value.some((provider) => !provider.layerIds || provider.layerIds.includes(layer.id))
  )
);
const generalSearch = computed(
  () => snapshot.value.length === 0 && providers.value.some((provider) => !provider.layerIds)
);
const layerOptions = computed(() =>
  searchableLayers.value.map((layer) => ({ value: layer.id, label: layer.title || layer.id }))
);
const canSearch = computed(() => !!selectedLayer.value || generalSearch.value);
const placeholderText = computed(() => props.placeholder ?? ui.locale.t('search.placeholder'));
const emptyText = computed(() => props.emptyText ?? ui.locale.t('search.empty'));
const keyword = ref('');
const results = ref<SearchResult[]>([]);
const loading = ref(false);
const error = ref<string>();
const hasSearched = ref(false);
const root = ref<HTMLElement>();
const dropdownOpen = ref(false);
const feedbackId = `gis-search-${useId()}`;
let controller: AbortController | undefined;
let requestId = 0;

function resetSearch() {
  controller?.abort();
  requestId++;
  loading.value = false;
  results.value = [];
  hasSearched.value = false;
  error.value = undefined;
  dropdownOpen.value = false;
}
const stopProviders = app.search.subscribe(() => {
  providers.value = app.search.listProviders();
  resetSearch();
});
watch(
  searchableLayers,
  (layers) => {
    if (!layers.some((layer) => layer.id === selectedLayer.value)) {
      selectedLayer.value = layers[0]?.id ?? '';
    }
  },
  { immediate: true, flush: 'sync' }
);
watch(selectedLayer, resetSearch, { flush: 'sync' });
watch(
  () => snapshot.value.find((layer) => layer.id === selectedLayer.value)?.version,
  resetSearch,
  { flush: 'sync' }
);

function dismiss() {
  dropdownOpen.value = false;
}
function outsidePointer(event: PointerEvent) {
  if (event.target instanceof Node && !root.value?.contains(event.target)) {
    dismiss();
  }
}
function focus() {
  if (hasSearched.value || providerCount.value === 0) {
    dropdownOpen.value = true;
  }
}
function blur(event: FocusEvent) {
  if (!(event.relatedTarget instanceof Node) || !root.value?.contains(event.relatedTarget)) {
    dismiss();
  }
}
watch(dropdownOpen, (open) => {
  document.removeEventListener('pointerdown', outsidePointer);
  if (open && props.dropdown) {
    document.addEventListener('pointerdown', outsidePointer);
  }
});
onBeforeUnmount(() => {
  stopProviders();
  controller?.abort();
  document.removeEventListener('pointerdown', outsidePointer);
});

async function search() {
  if (!canSearch.value || !keyword.value.trim()) {
    return;
  }
  controller?.abort();
  const currentController = new AbortController();
  controller = currentController;
  const currentRequest = ++requestId;
  loading.value = true;
  dropdownOpen.value = true;
  error.value = undefined;
  hasSearched.value = true;
  try {
    const nextResults = await app.search.search({
      keyword: keyword.value,
      layerId: selectedLayer.value || undefined,
      signal: currentController.signal,
    });
    if (currentRequest === requestId) {
      results.value = nextResults.slice(0, props.maxResults);
    }
  } catch (cause) {
    if (currentRequest === requestId && !currentController.signal.aborted) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      results.value = [];
    }
  } finally {
    if (currentRequest === requestId) {
      loading.value = false;
    }
  }
}

function selectResult(result: SearchResult) {
  dismiss();
  if (!app.map.isReady) {
    return;
  }
  try {
    app.map.locate(result);
    if (result.feature) {
      app.interactions.select({ feature: result.feature });
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
    dropdownOpen.value = true;
  }
}
</script>

<template>
  <div
    ref="root"
    class="gis-ui-search"
    :class="{ 'is-dropdown': dropdown }"
    @focusout="blur"
    @keydown.esc.stop="dismiss"
  >
    <form class="gis-ui-search-form" role="search" :aria-busy="loading" @submit.prevent="search">
      <GisSelect
        v-model="selectedLayer"
        class="gis-ui-search-layer"
        :options="layerOptions"
        :label="ui.locale.t('search.layer')"
        :placeholder="ui.locale.t(generalSearch ? 'search.general' : 'search.noLayers')"
        :disabled="!searchableLayers.length"
        @open="dismiss"
      />
      <input
        v-model="keyword"
        :placeholder="placeholderText"
        aria-label="Search"
        type="search"
        :aria-controls="dropdown && dropdownOpen ? feedbackId : undefined"
        @focus="focus"
      />
      <button
        type="submit"
        :disabled="loading || !keyword.trim() || !canSearch"
        :aria-label="loading ? 'Searching' : 'Search'"
      >
        <SvgIcon name="search" :size="16" />
      </button>
    </form>
    <ScrollArea
      v-if="!dropdown || dropdownOpen"
      :id="feedbackId"
      class="gis-ui-search-feedback"
      :label="ui.locale.t('panel.search')"
    >
      <p v-if="loading" class="gis-ui-empty" role="status">{{ ui.locale.t('search.loading') }}</p>
      <p v-else-if="error" class="gis-ui-error" role="alert">{{ error }}</p>
      <ul v-else-if="results.length" class="gis-ui-search-results">
        <li
          v-for="result in results"
          :key="`${result.layerId ?? ''}:${result.feature?.featureKey ?? result.id}`"
        >
          <button type="button" @click="selectResult(result)">
            <strong>{{ result.title }}</strong>
            <small v-if="result.subtitle">{{ result.subtitle }}</small>
          </button>
        </li>
      </ul>
      <p v-else-if="hasSearched" class="gis-ui-empty">{{ emptyText }}</p>
      <p v-else-if="providerCount === 0" class="gis-ui-empty">
        {{ ui.locale.t('search.noProviders') }}
      </p>
      <p v-else-if="!canSearch" class="gis-ui-empty">{{ ui.locale.t('search.noLayers') }}</p>
    </ScrollArea>
  </div>
</template>
