import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { createGISApp } from '@joinmap/gis-core';
import { createVueUI } from '../src/vue-ui.js';
import { createFakeLayerDefinition, createFakeMapPlugin } from '../../core/test/fake-map.js';

describe('Dashboard controls', () => {
  it('places unframed Search and tools above the map, dismisses search results, and toggles layer visibility icons', async () => {
    const app = createGISApp();
    const search = vi.fn(async () => [{ id: 'found', title: 'Found feature' }]);
    const action = vi.fn();
    app.use(createFakeMapPlugin(undefined, { test: createFakeLayerDefinition() }));
    app.use(
      createVueUI({
        config: { panels: [{ id: 'properties', visible: true }] },
        toolbarItems: [{ id: 'save', title: 'Save', icon: 'save', onClick: action }],
        panelDefinitions: [
          {
            id: 'properties',
            title: 'Properties',
            position: 'right',
            defaultVisible: true,
            component: defineComponent({ render: () => h('p', 'Select a feature') }),
          },
        ],
      })
    );
    app.search.registerProvider({ id: 'test', search });
    const target = document.createElement('div');
    document.body.append(target);
    try {
      await app.init({ layers: [{ id: 'sample', title: 'Sample', type: 'test' }] });
      await app.mount(target);
      const searchPanel = target.querySelector(
        '.gis-ui-map-actions .gis-ui-panel-region--top .gis-ui-panel-host--search'
      )!;
      expect(searchPanel).not.toBeNull();
      expect(searchPanel.querySelector('header')).toBeNull();
      expect(searchPanel.querySelector('.gis-ui-panel-shell')).toBeNull();
      expect(target.querySelector('.gis-ui-left-region .gis-ui-panel-host--search')).toBeNull();
      const submit = searchPanel.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      expect(submit.textContent?.trim()).toBe('');
      expect(submit.querySelector('svg')).not.toBeNull();
      const input = searchPanel.querySelector<HTMLInputElement>('input')!;
      input.value = 'road';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await nextTick();
      submit.click();
      await flushPromises();
      expect(search).toHaveBeenCalledWith(expect.objectContaining({ keyword: 'road' }));
      expect(searchPanel.textContent).toContain('Found feature');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await nextTick();
      expect(searchPanel.querySelector('.gis-ui-search-feedback')).toBeNull();
      const layerSelect = searchPanel.querySelector<HTMLButtonElement>('[role="combobox"]')!;
      layerSelect.focus();
      await nextTick();
      expect(searchPanel.querySelector('.gis-ui-search-feedback')).toBeNull();
      layerSelect.click();
      await nextTick();
      expect(searchPanel.querySelector('[role="listbox"]')).not.toBeNull();
      expect(searchPanel.querySelector('.gis-ui-search-feedback')).toBeNull();
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      await nextTick();
      expect(searchPanel.querySelector('[role="listbox"]')).toBeNull();
      input.focus();
      await nextTick();
      expect(searchPanel.textContent).toContain('Found feature');
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      await nextTick();
      expect(searchPanel.querySelector('.gis-ui-search-feedback')).toBeNull();
      input.blur();
      input.focus();
      await nextTick();
      searchPanel.querySelector<HTMLButtonElement>('.gis-ui-search-results button')!.click();
      await nextTick();
      expect(searchPanel.querySelector('.gis-ui-search-feedback')).toBeNull();

      const eye = target.querySelector<HTMLButtonElement>('.gis-ui-layer-visibility')!;
      expect(eye.getAttribute('aria-pressed')).toBe('true');
      const visibleIcon = eye.querySelector('svg')!.outerHTML;
      eye.click();
      await nextTick();
      expect(app.layers.get('sample')?.visible).toBe(false);
      expect(eye.getAttribute('aria-pressed')).toBe('false');
      expect(eye.querySelector('svg')!.outerHTML).not.toBe(visibleIcon);
      eye.click();
      await nextTick();
      expect(app.layers.get('sample')?.visible).toBe(true);

      const tool = target.querySelector<HTMLButtonElement>('button[aria-label="Save"]')!;
      expect(tool.textContent?.trim()).toBe('Save');
      expect(tool.getAttribute('aria-label')).toBe('Save');
      expect(tool.querySelector('svg')).not.toBeNull();
      tool.click();
      await flushPromises();
      expect(action).toHaveBeenCalledOnce();
      expect(
        target.querySelector(
          '.gis-ui-panel-region--right .gis-ui-panel-host--properties .gis-ui-panel-body'
        )?.textContent
      ).toContain('Select a feature');
    } finally {
      await app.dispose();
      target.remove();
    }
  });
});
