import { expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { createGISApp } from '@joinmap/gis-core';
import { createFakeLayerDefinition, createFakeMapPlugin } from '../../core/test/fake-map.js';
import { createVueUI } from '../src/vue-ui.js';

it('filters nested layer names and keeps child visibility settings under a closed group', async () => {
  const app = createGISApp();
  app.use(createFakeMapPlugin(undefined, { test: createFakeLayerDefinition() }));
  app.use(createVueUI());
  const target = document.createElement('div');
  document.body.append(target);
  try {
    await app.init({
      layers: [
        { id: 'base', title: 'Base', type: 'test' },
        {
          id: 'group',
          title: 'Transport',
          type: 'GROUP',
          children: [
            { id: 'roads', title: 'Roads', type: 'test' },
            {
              id: 'nested',
              title: 'Places',
              type: 'GROUP',
              children: [{ id: 'stations', title: 'Stations', type: 'test' }],
            },
          ],
        },
      ],
    });
    await app.mount(target);
    await nextTick();
    const panel = target.querySelector('.gis-ui-panel-host--layer-manager')!;
    const count = () => panel.querySelector('.gis-ui-panel-count')!.textContent;
    const search = panel.querySelector<HTMLInputElement>('input[type="search"]')!;
    const filter = async (value: string) => {
      search.value = value;
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await nextTick();
      await vi.waitFor(() =>
        expect(panel.querySelector('.gis-ui-layer-sort-leave-active')).toBeNull()
      );
    };
    expect(count()).toBe('2/2');
    const heading = panel.querySelector('.gis-ui-layer-heading')!;
    expect([...heading.children].map((child) => child.className)).toEqual([
      'gis-ui-layer-visibility',
      'gis-ui-layer-name',
      'gis-ui-layer-grip',
      'gis-ui-tooltip-trigger',
      'gis-ui-icon-button gis-ui-layer-expand',
    ]);
    const originalOrder = app.layers.list().map((layer) => layer.id);
    await filter('  sTAtions ');
    expect(panel.querySelectorAll('.gis-ui-layer-row')).toHaveLength(1);
    expect(
      [...panel.querySelectorAll('.gis-ui-layer-name')].map((node) => node.textContent)
    ).toEqual(['Transport', 'Places', 'Stations']);
    expect(count()).toBe('2/2');
    await filter('transport');
    expect(panel.querySelectorAll('.gis-ui-layer-child')).toHaveLength(3);
    await filter('missing');
    expect(panel.textContent).toContain('未找到匹配的图层');
    panel.querySelector<HTMLButtonElement>('[aria-label="刷新图层管理"]')!.click();
    await nextTick();
    expect(search.value).toBe('');
    expect(panel.querySelectorAll('.gis-ui-layer-row')).toHaveLength(2);
    expect(app.layers.list().map((layer) => layer.id)).toEqual(originalOrder);
    panel.querySelector<HTMLButtonElement>('[aria-label="图层配置 Transport"]')!.click();
    await nextTick();
    const group = [...panel.querySelectorAll('.gis-ui-layer-row')].find((row) =>
      row.textContent!.includes('Transport')
    )!;
    const eye = group.querySelector<HTMLButtonElement>('.gis-ui-layer-visibility')!;
    const visibleIcon = eye.innerHTML;
    eye.click();
    await nextTick();
    expect(count()).toBe('1/2');
    expect(group.classList.contains('is-hidden')).toBe(true);
    expect(eye.innerHTML).not.toBe(visibleIcon);
    for (const id of ['group', 'roads', 'nested', 'stations'])
      expect(app.layers.get(id)!.visible).toBe(false);
    for (const child of group.querySelectorAll('.gis-ui-layer-child')) {
      expect(child.classList.contains('is-hidden')).toBe(true);
      const button = child.querySelector<HTMLButtonElement>('.gis-ui-layer-visibility')!;
      expect(button.disabled).toBe(false);
      expect(button.getAttribute('aria-pressed')).toBe('true');
    }
    const station = group.querySelector<HTMLButtonElement>(
      'button[aria-label="切换图层显隐 Stations"]'
    )!;
    station.click();
    await nextTick();
    expect(count()).toBe('1/2');
    expect(eye.getAttribute('aria-pressed')).toBe('false');
    expect(
      group.querySelector('button[aria-label="切换图层显隐 Places"]')!.getAttribute('aria-pressed')
    ).toBe('true');
    expect(station.getAttribute('aria-pressed')).toBe('false');
    expect(app.layers.get('stations')!.visible).toBe(false);
    expect(app.layers.get('roads')!.visible).toBe(false);
    eye.click();
    await nextTick();
    for (const id of ['group', 'roads', 'nested']) expect(app.layers.get(id)!.visible).toBe(true);
    expect(app.layers.get('stations')!.visible).toBe(false);
    station.click();
    await nextTick();
    expect(app.layers.get('stations')!.visible).toBe(true);
    await app.layers.remove('base');
    await nextTick();
    expect(count()).toBe('1/1');
  } finally {
    await app.dispose();
    target.remove();
  }
});

it('removes overflow on group collapse without animating the following rows', async () => {
  const app = createGISApp();
  app.use(createFakeMapPlugin(undefined, { test: createFakeLayerDefinition() }));
  app.use(createVueUI());
  const target = document.createElement('div');
  document.body.append(target);
  const computedStyle = window.getComputedStyle.bind(window);
  const style = vi.spyOn(window, 'getComputedStyle').mockImplementation((element) =>
    element.classList.contains('gis-ui-layer-sort-move')
      ? ({
          transitionProperty: 'transform',
          transitionDuration: '0.24s',
          transitionDelay: '0s',
        } as CSSStyleDeclaration)
      : computedStyle(element)
  );
  try {
    await app.init({
      layers: [
        { id: 'group', title: 'Group', type: 'GROUP', children: [{ id: 'child', type: 'test' }] },
        { id: 'following', type: 'test' },
      ],
    });
    await app.mount(target);
    const panel = target.querySelector('.gis-ui-panel-host--layer-manager')!;
    const viewport = panel.querySelector('.gis-ui-scroll-viewport')!;
    const expand = panel.querySelector<HTMLButtonElement>('[aria-label="图层配置 Group"]')!;
    const following = panel.querySelectorAll('.gis-ui-layer-row')[1]!;
    const expanded = () => expand.getAttribute('aria-expanded') === 'true';
    const moved = () => following.classList.contains('gis-ui-layer-sort-move');
    vi.spyOn(following, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, expanded() ? 130 : 50, 200, 40)
    );
    Object.defineProperties(viewport, {
      clientHeight: { get: () => 100 },
      scrollHeight: { get: () => (expanded() || moved() ? 170 : 100) },
    });
    expand.click();
    await flushPromises();
    expect(panel.querySelector('[aria-orientation="vertical"]')).not.toBeNull();
    expand.focus();
    expand.click();
    await flushPromises();
    expect(document.activeElement).toBe(expand);
    expect(moved()).toBe(false);
    expect(panel.querySelector('[aria-orientation="vertical"]')).toBeNull();
  } finally {
    style.mockRestore();
    await app.dispose();
    target.remove();
  }
});

it('counts visible legends, limits view actions, and refreshes without discarding an inline draft', async () => {
  const app = createGISApp();
  app.use(
    createFakeMapPlugin(undefined, {
      test: createFakeLayerDefinition(() => ({
        setVisible() {},
        setZIndex() {},
        dispose() {},
        getFields: () => [{ name: 'kind', type: 'string' }],
      })),
    })
  );
  app.use(createVueUI());
  const target = document.createElement('div');
  document.body.append(target);
  try {
    await app.init({
      layers: [
        {
          id: 'one',
          type: 'test',
          title: 'Land cover',
          legend: {
            type: 'category',
            field: 'kind',
            items: [{ id: 'a', value: 'wood', label: 'Woodland', color: '#00ff00' }],
          },
        },
      ],
    });
    await app.mount(target);
    await nextTick();
    const panel = target.querySelector('.gis-ui-panel-host--legend')!;
    expect(panel.querySelector('.gis-ui-panel-count')!.textContent).toBe('1');
    const heading = panel.querySelector('.gis-ui-legend-heading')!;
    expect(heading.querySelectorAll('button')).toHaveLength(2);
    expect(heading.querySelectorAll('svg')).toHaveLength(2);
    expect(panel.querySelector('.gis-ui-legend-metric')!.textContent).toBe('kind枚举');
    expect(panel.querySelector('.gis-ui-legend-metric [role="combobox"]')).toBeNull();
    panel.querySelector<HTMLButtonElement>('.gis-ui-legend-edit')!.click();
    await nextTick();
    expect(panel.querySelector('.gis-ui-legend-metric [role="combobox"]')).not.toBeNull();
    const label = panel.querySelector<HTMLInputElement>('input[name="itemLabel-0"]')!;
    label.value = 'Edited woodland';
    label.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    panel.querySelector<HTMLButtonElement>('[aria-label="刷新图例"]')!.click();
    await nextTick();
    expect(panel.querySelector('input[name="itemLabel-0"]')).toBe(label);
    expect(label.value).toBe('Edited woodland');
    expect(app.layers.get('one')!.legend!.items![0]!.label).toBe('Woodland');
    panel
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();
    expect(app.layers.get('one')!.legend!.items![0]!.label).toBe('Edited woodland');
    expect(panel.querySelector('.gis-ui-legend-metric [role="combobox"]')).toBeNull();
    app.layers.setVisibility('one', false);
    await nextTick();
    expect(panel.querySelector('.gis-ui-panel-count')!.textContent).toBe('0');
    app.layers.setVisibility('one', true);
    await nextTick();
    expect(panel.querySelector('.gis-ui-panel-count')!.textContent).toBe('1');
    await app.layers.remove('one');
    await nextTick();
    expect(panel.querySelector('.gis-ui-panel-count')!.textContent).toBe('0');
  } finally {
    await app.dispose();
    target.remove();
  }
});
