import { GISRuntimeError, type GISApp, type ResourceScope } from '@joinmap/gis-core';
import {
  captureWorkspaceConfig,
  rememberWorkspaceLayers,
  workspacePreferences,
} from '../workspace-config.js';

const SAVE_DELAY_MS = 250;

export function registerWorkspacePersistence(
  runtime: GISApp,
  key: string | undefined,
  resources: ResourceScope
): void {
  resources.add(runtime.events.once('app:ready', () => rememberWorkspaceLayers(runtime)));
  if (!key) {
    return;
  }
  const storageKey = key;
  let last = runtime.context.state.snapshot();
  let lastPreferences: string | undefined;
  let baseline: string | undefined;
  let pending: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function report(cause: unknown) {
    runtime.events.emit('app:error', {
      error: new GISRuntimeError({
        code: 'APP_INVALID_STATE',
        message: 'Workspace settings could not be saved.',
        cause,
      }),
    });
  }

  function flush() {
    clearTimeout(timer);
    const value = pending;
    pending = undefined;
    if (value === undefined) {
      return;
    }
    try {
      localStorage.setItem(storageKey, value);
      baseline = value;
    } catch (cause) {
      report(cause);
    }
  }

  const unsubscribe = runtime.context.state.subscribe((next) => {
    const previous = last;
    last = next;
    if (next.status !== 'ready' && next.status !== 'mounted' && next.status !== 'unmounted') {
      return;
    }
    const preferences =
      baseline !== undefined && next.extensions['vue-ui'] === previous.extensions['vue-ui']
        ? lastPreferences
        : JSON.stringify(workspacePreferences(next.extensions));
    const changed = next.layers !== previous.layers || preferences !== lastPreferences;
    lastPreferences = preferences;
    try {
      if (baseline === undefined) {
        baseline = JSON.stringify(captureWorkspaceConfig(runtime));
      } else if (changed) {
        const serialized = JSON.stringify(captureWorkspaceConfig(runtime));
        if (serialized !== pending) {
          clearTimeout(timer);
          pending = serialized === baseline ? undefined : serialized;
          if (pending !== undefined) {
            timer = setTimeout(flush, SAVE_DELAY_MS);
          }
        }
      }
    } catch (cause) {
      report(cause);
    }
    if (next.status === 'unmounted' && previous.status !== 'unmounted') {
      flush();
    }
  });
  resources.add(() => {
    unsubscribe();
    flush();
  });
}
