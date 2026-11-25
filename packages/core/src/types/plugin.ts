import type { GISApp } from './app.js';
import type { Unsubscribe } from './common.js';

export interface GISPlugin<Options = unknown> {
  readonly name: string;
  readonly version?: string;
  readonly dependencies?: readonly string[];
  install(app: GISApp, options: Options | undefined, resources: ResourceScope): void;
  onInit?(app: GISApp, options: Options | undefined): void | Promise<void>;
}

export interface PluginInstance {
  readonly name: string;
  readonly version?: string;
}

export interface ResourceScope {
  readonly disposed: boolean;
  add(dispose: () => void | Promise<void>): Unsubscribe;
  dispose(): Promise<void>;
}
