<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import type { SearchResult } from '../types.js'
import { useGISApp } from '../use-gis-app.js'
import { useGISUI } from '../use-gis-ui.js'
import SvgIcon from '../components/SvgIcon.vue'

const props = withDefaults(defineProps<{
  placeholder?: string
  emptyText?: string
  maxResults?: number
  dropdown?: boolean
}>(), {
  maxResults: 8,
  dropdown: false,
})

const app = useGISApp()
const ui = useGISUI()
const providerCount = ref(app.search.listProviders().length)
const stopProviders = app.search.subscribe(() => {
  providerCount.value = app.search.listProviders().length
  if (!providerCount.value) {
    controller?.abort(); requestId++; loading.value = false; results.value = []; hasSearched.value = false
  }
})
const placeholderText = computed(() => props.placeholder ?? ui.locale.t('search.placeholder'))
const emptyText = computed(() => props.emptyText ?? ui.locale.t('search.empty'))
const keyword = ref('')
const results = ref<SearchResult[]>([])
const loading = ref(false)
const error = ref<string>()
const hasSearched = ref(false)
const root = ref<HTMLElement>()
const dropdownOpen = ref(false)
const feedbackId = `gis-search-${useId()}`
let controller: AbortController | undefined
let requestId = 0

function dismiss() { dropdownOpen.value = false }
function outsidePointer(event: PointerEvent) {
  if (event.target instanceof Node && !root.value?.contains(event.target)) dismiss()
}
function focus() {
  if (hasSearched.value || providerCount.value === 0) dropdownOpen.value = true
}
function blur(event: FocusEvent) {
  if (!(event.relatedTarget instanceof Node) || !root.value?.contains(event.relatedTarget)) dismiss()
}
watch(dropdownOpen, (open) => {
  document.removeEventListener('pointerdown', outsidePointer)
  if (open && props.dropdown) document.addEventListener('pointerdown', outsidePointer)
})
onBeforeUnmount(() => {
  stopProviders()
  controller?.abort()
  document.removeEventListener('pointerdown', outsidePointer)
})

async function search() {
  controller?.abort()
  const currentController = new AbortController()
  controller = currentController
  const currentRequest = ++requestId
  loading.value = true
  dropdownOpen.value = true
  error.value = undefined
  hasSearched.value = true
  try {
    const nextResults = await app.search.search({ keyword: keyword.value, signal: currentController.signal })
    if (currentRequest === requestId) results.value = nextResults.slice(0, props.maxResults)
  } catch (cause) {
    if (currentRequest === requestId && !currentController.signal.aborted) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      results.value = []
    }
  } finally {
    if (currentRequest === requestId) loading.value = false
  }
}

function selectResult(result: SearchResult) {
  dismiss()
  if (!app.map.isReady) return
  try { app.map.locate(result) } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); dropdownOpen.value = true }
}
</script>

<template>
  <div ref="root" class="gis-ui-search" :class="{ 'is-dropdown': dropdown }"
    @focusin="focus" @focusout="blur" @keydown.esc.stop="dismiss">
    <form class="gis-ui-search-form" role="search" :aria-busy="loading" @submit.prevent="search">
      <input v-model="keyword" :placeholder="placeholderText" aria-label="Search" type="search"
        :aria-controls="dropdown && dropdownOpen ? feedbackId : undefined">
      <button type="submit" :disabled="loading || !keyword.trim() || providerCount === 0" :aria-label="loading ? 'Searching' : 'Search'">
        <SvgIcon name="search" :size="17" />
      </button>
    </form>
    <div v-if="!dropdown || dropdownOpen" :id="feedbackId" class="gis-ui-search-feedback">
      <p v-if="loading" class="gis-ui-empty" role="status">{{ ui.locale.t('search.loading') }}</p>
      <p v-else-if="error" class="gis-ui-error" role="alert">{{ error }}</p>
      <ul v-else-if="results.length" class="gis-ui-search-results">
        <li v-for="result in results" :key="result.id">
          <button type="button" @click="selectResult(result)">
            <strong>{{ result.title }}</strong>
            <small v-if="result.subtitle">{{ result.subtitle }}</small>
          </button>
        </li>
      </ul>
      <p v-else-if="hasSearched" class="gis-ui-empty">{{ emptyText }}</p>
      <p v-else-if="providerCount === 0" class="gis-ui-empty">{{ ui.locale.t('search.noProviders') }}</p>
    </div>
  </div>
</template>
