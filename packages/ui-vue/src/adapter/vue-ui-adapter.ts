import { createApp, nextTick, type App as VueApp, type Component, type ShallowRef } from 'vue';
import type { GISApp, ResourceScope, UIAdapter } from '@joinmap/gis-core';
import GISUIRoot from '../GISUIRoot.vue';
import type { BuiltinLayoutName, GISUIContext } from '../types.js';

type VueUIRootProps = {
  runtime: GISApp;
  ui: GISUIContext;
  activeLayout: Readonly<ShallowRef<string>>;
  customLayout?: Component;
  changeLayout?: (layout: BuiltinLayoutName) => void;
  workspaceStorageKey?: string;
  appProps: Record<string, unknown>;
};

const adapters = new WeakMap<GISApp, VueUIAdapter>();

export function trackVueUIAdapter(app: GISApp, adapter: VueUIAdapter, resources: ResourceScope) {
  resources.add(() => {
    adapters.delete(app);
  });
  adapters.set(app, adapter);
}

export function getVueUIAdapter(app: GISApp): VueUIAdapter {
  const adapter = adapters.get(app);
  if (!adapter) {
    throw new Error('Initialize createVueUI() before rendering GISWorkspace.');
  }
  return adapter;
}

export class VueUIAdapter implements UIAdapter {
  private vueApp?: VueApp;
  private disposed = false;
  private mounted = false;
  private host?: { render: (visible: boolean) => void; target: () => Element | undefined };

  constructor(readonly rootProps: VueUIRootProps) {}

  bindHost(render: (visible: boolean) => void, target: () => Element | undefined): () => void {
    if (this.disposed || this.host || this.mounted) {
      throw new Error('A workspace already owns this Runtime UI.');
    }
    const host = { render, target };
    this.host = host;
    return () => {
      if (this.host === host) {
        this.host = undefined;
      }
    };
  }

  async mount(target: Element | string): Promise<void> {
    if (this.disposed || this.mounted) {
      throw new Error('Vue UI is disposed or already mounted.');
    }
    const element = resolveTarget(target);
    if (this.host && this.host.target() !== element) {
      throw new Error('This Runtime is bound to a GISWorkspace host target.');
    }
    this.mounted = true;
    if (this.host) {
      this.host.render(true);
      await nextTick();
      return;
    }
    this.vueApp = createApp(GISUIRoot, this.rootProps);
    this.vueApp.mount(element);
  }

  async unmount(): Promise<void> {
    if (!this.mounted) {
      return;
    }
    this.mounted = false;
    const vueApp = this.vueApp;
    this.vueApp = undefined;
    const errors: unknown[] = [];
    try {
      if (vueApp) {
        vueApp.unmount();
      } else if (this.host) {
        this.host.render(false);
        await nextTick();
      }
    } catch (error) {
      errors.push(error);
    }
    try {
      const map = this.rootProps.runtime.map;
      if (map.isReady) {
        map.setTarget(undefined);
      }
    } catch (error) {
      errors.push(error);
    }
    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Vue UI unmount failed.');
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    try {
      await this.unmount();
    } finally {
      this.host = undefined;
    }
  }
}

function resolveTarget(target: Element | string): Element {
  if (typeof target !== 'string') {
    if (!target || target.nodeType !== 1) {
      throw new Error('Vue UI mount target must be a DOM Element.');
    }
    return target;
  }
  if (typeof document === 'undefined') {
    throw new Error('Vue UI can only mount in a browser environment.');
  }
  const element = document.querySelector(target);
  if (!element) {
    throw new Error(`Vue UI mount target "${target}" was not found.`);
  }
  return element;
}
