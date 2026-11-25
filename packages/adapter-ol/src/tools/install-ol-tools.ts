import Draw from 'ol/interaction/Draw.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { createEditingStyle, type StyleFunction, type default as Style } from 'ol/style/Style.js';
import Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import type Projection from 'ol/proj/Projection.js';
import { equivalent } from 'ol/proj.js';
import { getLength } from 'ol/sphere.js';
import type OlMap from 'ol/Map.js';
import type { GISApp, ResourceScope } from '@joinmap/gis-core';
import type { JsonValue } from '@joinmap/gis-core';
import { GISRuntimeError } from '@joinmap/gis-core';
import { runCleanups } from '../lifecycle/run-cleanups.js';
import type { WritableVectorTarget } from '../layers/common/layer-binding.js';
import { describeFeature } from '../interactions/feature-reference.js';
import { toolTargets, type ToolId } from './tool-targets.js';
import {
  createMeasurementStyles,
  removeMeasurementLabels,
  updateMeasurementLabels,
  watchMeasurementColor,
  type MeasurementLabels,
} from './measurement-display.js';
import type { EventsKey } from 'ol/events.js';
import { unByKey } from 'ol/Observable.js';
import { olTools, type OLToolResult } from './tool-definitions.js';
import { calculateToolMetric } from './tool-measurement.js';
import { createResultFeature, writeToolFeatures } from './tool-data.js';
import { createToolResultIndex } from './tool-result-index.js';
import {
  createModifyInteraction,
  createToolInteractionSession,
} from './tool-interaction-session.js';

export interface OLToolsController {
  list(): readonly OLToolResult[];
  get(id: string): OLToolResult | undefined;
  remove(id: string): void;
  select(id?: string): void;
  selected(): string | undefined;
  updateGeometry(id: string, geometry: Readonly<Record<string, unknown>>): void;
  exportResults(): readonly OLToolResult[];
  importResults(results: readonly OLToolResult[]): Promise<void>;
  subscribe(listener: () => void): () => void;
  clear(): Promise<void>;
  cancel(): Promise<void>;
  undo(): void;
}
const controllers = new WeakMap<GISApp, OLToolsController>();
export function useOLTools(app: GISApp): OLToolsController {
  const controller = controllers.get(app);
  if (!controller) {
    throw new Error('OpenLayers tools are not installed (createOLAdapter({ tools: false })).');
  }
  return controller;
}

/** Adapter-owned tools write through the same dataset as ordinary GeoJSON layers. */
export function installOLTools(
  app: GISApp,
  resources: ResourceScope,
  dependencies: {
    getMap: () => OlMap;
    getWritableTarget: (id: string) => WritableVectorTarget | undefined;
  }
): void {
  const targets = toolTargets(app, dependencies.getWritableTarget);
  const pendingTargets = new Set<ReturnType<typeof targets.resolve>>();
  const attached = new Map<string, { target: WritableVectorTarget; stop: () => void }>();
  let map: OlMap | undefined;
  const session = createToolInteractionSession();
  let activeTarget: WritableVectorTarget | undefined;
  let editingId: string | undefined;
  let sequence = 0;
  let disposed = false;
  const labels = new Map<string | undefined, MeasurementLabels>();
  const measurementStyles = createMeasurementStyles();
  let unwatchColor: (() => void) | undefined;
  let sketchListener: EventsKey | undefined;
  const removeLabel = (id: string | undefined) => {
    const group = labels.get(id);
    if (map && group) {
      removeMeasurementLabels(map, group);
    }
    labels.delete(id);
  };
  const clearLabels = () => {
    for (const id of labels.keys()) {
      removeLabel(id);
    }
  };
  const clearSketch = () => {
    if (sketchListener) {
      unByKey(sketchListener);
    }
    sketchListener = undefined;
    removeLabel(undefined);
  };
  const paintLabel = (
    id: string | undefined,
    geometry: Geometry,
    metric: Pick<OLToolResult, 'value' | 'unit'>
  ) => {
    if (!map || metric.value === undefined || !metric.unit) {
      return;
    }
    const group = labels.get(id) ?? { overlays: [] };
    updateMeasurementLabels(
      map,
      group,
      geometry,
      metric.value,
      metric.unit,
      id === undefined ? undefined : () => controller.remove(id)
    );
    labels.set(id, group);
  };
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (cause) {
        app.events.emit('app:error', {
          error: new GISRuntimeError({
            code: 'APP_INVALID_STATE',
            message: 'Tool result observer failed.',
            cause,
          }),
        });
      }
    }
  };
  const assertActive = () => {
    if (disposed) {
      throw new Error('OL tools have been disposed.');
    }
  };
  const editingStyles = createEditingStyle() as Record<string, Style[]>;
  const format = new GeoJSON();
  const results = createToolResultIndex(format, {
    updated({ target, feature, result }, changedFeature) {
      if (changedFeature) {
        const style: StyleFunction = (item, resolution) => {
          const base = target.layer.getStyleFunction()?.(item, resolution);
          if (!base) {
            return [];
          }
          if (result.toolId === 'measure-angle') {
            return measurementStyles.get(item, resolution, result.toolId);
          }
          return [
            ...(Array.isArray(base) ? base : [base]),
            ...measurementStyles.get(item, resolution, undefined),
          ];
        };
        feature.setStyle(style);
      }
      const geometry = feature.getGeometry();
      if (geometry && target.layer.getVisible()) {
        paintLabel(result.id, geometry, result);
      } else {
        removeLabel(result.id);
      }
    },
    removed: removeLabel,
    changed: notify,
  });

  const useMap = () => {
    map = dependencies.getMap();
    unwatchColor ??= watchMeasurementColor(map, (color) => {
      measurementStyles.setColor(color);
      for (const { target } of attached.values()) {
        target.layer.changed();
      }
      session.draw?.getOverlay().changed();
    });
    return map;
  };

  const stop = () => {
    activeTarget = undefined;
    editingId = undefined;
    const errors = runCleanups([clearSketch, session.stop]);
    if (errors.length) {
      throw new AggregateError(errors, 'Could not fully stop OpenLayers tool.');
    }
  };

  const toolError = (message: string, cause: unknown) =>
    app.events.emit('app:error', {
      error: new GISRuntimeError({ code: 'CONFIG_INVALID', message, cause }),
    });

  const finishTool = (toolId: string) => {
    stop();
    void app.interactions
      .deactivateTool(toolId)
      .catch((cause) => toolError('Completed tool could not be deactivated.', cause));
  };

  const watchViewProjection = (targetMap: OlMap, projection: Projection, toolId: string) =>
    targetMap.on('change:view', () => {
      if (!equivalent(targetMap.getView().getProjection(), projection)) {
        finishTool(toolId);
      }
    });

  const selection = () => {
    const selected = app.interactions.getSelection();
    if (!selected || selected.id === undefined) {
      return;
    }
    const entry = results.get(String(selected.id));
    if (entry?.target.id === selected.layerId) {
      return entry;
    }
  };

  function assertWritable(target: WritableVectorTarget) {
    if (targets.writable(target.id) !== target) {
      throw new Error(`Target layer "${target.id}" is no longer writable.`);
    }
  }

  function attach(target: WritableVectorTarget) {
    assertWritable(target);
    if (attached.get(target.id)?.target === target) {
      return;
    }
    useMap();
    const sync = () => results.sync(target, target.projection.getCode());
    const stopData = target.data.subscribe(sync);
    const visibility = target.layer.on('change:visible', sync);
    attached.set(target.id, {
      target,
      stop: () => {
        stopData();
        unByKey(visibility);
      },
    });
    sync();
  }

  resources.add(app.interactions.onSelect(notify));
  resources.add(
    app.layers.subscribe((event) => {
      if (event.id === undefined) {
        return;
      }
      if (event.type === 'add' && targets.isConfigured(event.id)) {
        const target = targets.writable(event.id);
        if (target) {
          attach(target);
        }
      }
      if (event.type !== 'remove') {
        return;
      }
      const entry = attached.get(event.id);
      if (!entry) {
        return;
      }
      const { target } = entry;
      entry.stop();
      attached.delete(event.id);
      if (activeTarget?.layer === target.layer) {
        const tool = app.interactions.getActiveTool();
        if (tool) {
          finishTool(tool);
        }
      }
      results.removeTarget(target);
    })
  );

  function assertGeometryProjection(projection: Projection, target?: WritableVectorTarget) {
    const view = dependencies.getMap().getView().getProjection();
    if (equivalent(view, projection) && (!target || equivalent(target.projection, projection))) {
      return;
    }
    throw new GISRuntimeError({
      code: 'CONFIG_INVALID',
      stage: 'tool-write',
      message: 'Tool geometry projection must match the map view and target source projections.',
      detail: {
        geometryProjection: projection.getCode(),
        viewProjection: view.getCode(),
        sourceProjection: target?.projection.getCode(),
        layerId: target?.id,
      },
    });
  }

  const geoJSONOptions = (projection: Projection) => ({
    featureProjection: projection,
    dataProjection: 'EPSG:4326',
  });

  const write = (
    target: WritableVectorTarget,
    features: Feature[],
    removed: readonly string[] = [],
    projection = target.projection
  ) => {
    assertWritable(target);
    if (features.length) {
      assertGeometryProjection(projection, target);
    }
    writeToolFeatures(format, geoJSONOptions(target.projection), target, features, removed);
  };

  const getEntry = (id: string) => {
    const entry = results.get(id);
    if (!entry) {
      throw new Error(`Result "${id}" not found.`);
    }
    return entry;
  };

  const clearResults = async () => {
    if (editingId) {
      stop();
    }
    if (pendingTargets.size) {
      await Promise.allSettled([...pendingTargets]);
    }
    const byTarget = new Map<WritableVectorTarget, string[]>();
    for (const {
      target,
      result: { id },
    } of results.values()) {
      const ids = byTarget.get(target) ?? [];
      ids.push(id);
      byTarget.set(target, ids);
    }
    for (const [target, ids] of byTarget) {
      write(target, [], ids);
    }
  };

  const controller: OLToolsController = {
    list: () => [...results.values()].map(({ result }) => structuredClone(result)),
    get: (id) => {
      const entry = results.get(id);
      return entry && structuredClone(entry.result);
    },
    selected: () => selection()?.result.id,
    select: (id) => {
      assertActive();
      if (id === undefined) {
        if (selection()) {
          app.interactions.clearSelection();
        }
        return;
      }
      const { target, feature } = getEntry(id);
      app.interactions.select({ feature: describeFeature(feature, target.id) });
    },
    remove: (id) => {
      assertActive();
      const { target } = getEntry(id);
      if (editingId === id) {
        finishTool('modify-result');
      }
      write(target, [], [id]);
    },
    updateGeometry: (id, data) => {
      assertActive();
      const { target, result, feature } = getEntry(id);
      assertGeometryProjection(target.projection, target);
      const geometry = format.readGeometry(data);
      if (!geometry) {
        throw new Error('Geometry is required.');
      }
      const metric = calculateToolMetric(result.toolId, geometry, result.projection);
      const next = feature.clone();
      next.setId(id);
      next.setGeometry(geometry);
      if (metric.value !== undefined) {
        next.setProperties(metric);
      }
      const selected = selection()?.result.id === id;
      write(target, [next], [id]);
      if (selected) {
        controller.select(id);
      }
    },
    exportResults: () => controller.list(),
    importResults: async (incoming) => {
      assertActive();
      const projection = useMap().getView().getProjection();
      const code = projection.getCode();
      const ids = new Set<string>();
      const staged = incoming.map((result) => {
        if (!result.id?.trim() || ids.has(result.id) || results.has(result.id)) {
          throw new Error('Duplicate or empty result ID.');
        }
        ids.add(result.id);
        if (result.projection !== code) {
          throw new Error('Result projection must match map projection.');
        }
        const geometry = format.readGeometry(result.geometry);
        if (!geometry) {
          throw new Error('Geometry is required.');
        }
        const metric = calculateToolMetric(result.toolId, geometry, code);
        return createResultFeature({ ...result, ...metric }, geometry);
      });
      const grouped = new Map<string, { target: WritableVectorTarget; features: Feature[] }>();
      for (const feature of staged) {
        const { target } = await targets.resolve(feature.get('gisToolId') as ToolId);
        assertActive();
        assertGeometryProjection(projection, target);
        attach(target);
        const id = String(feature.getId());
        if (results.has(id) || target.source.getFeatureById(id)) {
          throw new Error(`Feature ID "${id}" already exists.`);
        }
        let batch = grouped.get(target.id);
        if (!batch) {
          batch = { target, features: [] };
          grouped.set(target.id, batch);
        }
        batch.features.push(feature);
      }
      for (const { target, features } of grouped.values()) {
        if (
          features.some(
            (feature) =>
              results.has(String(feature.getId())) || target.source.getFeatureById(feature.getId()!)
          )
        ) {
          throw new Error('A result ID already exists.');
        }
      }
      const rollback: (() => void)[] = [];
      try {
        for (const { target, features } of grouped.values()) {
          const previous = target.data.data;
          write(target, features, [], projection);
          if (previous !== undefined) {
            rollback.push(() => target.data.update(previous));
          }
        }
      } catch (cause) {
        const errors = runCleanups(rollback.reverse());
        if (errors.length) {
          throw new AggregateError([cause, ...errors], 'Could not fully roll back tool import.', {
            cause,
          });
        }
        throw cause;
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear: async () => {
      assertActive();
      await app.interactions.deactivateTool();
      await clearResults();
    },
    cancel: () => app.interactions.deactivateTool(),
    undo: () => session.draw?.removeLastPoint(),
  };
  controllers.set(app, controller);
  app.registerStateSlice(
    'ol-tools',
    {
      snapshot: () =>
        ({
          selectedId: controller.selected() ?? null,
          results: controller.list(),
        }) as unknown as JsonValue,
      subscribe: (listener) => controller.subscribe(listener),
    },
    resources
  );

  const snapFeatures = (projection: Projection, except?: Feature) =>
    [...results.values()]
      .filter(
        ({ target, feature }) =>
          target.layer.getVisible() &&
          feature !== except &&
          equivalent(target.projection, projection)
      )
      .map(({ feature }) => feature);

  olTools.forEach((tool) => {
    app.registerTool(
      tool.id,
      {
        id: tool.id,
        title: tool.title,
        undo: () => session.draw?.removeLastPoint(),
        activate() {
          const drawMap = useMap();
          const drawProjection = drawMap.getView().getProjection();
          const target = targets.existing(tool.id);
          assertActive();
          if (target) {
            assertGeometryProjection(drawProjection, target);
            attach(target);
          }
          activeTarget = target;
          const measured = tool.id.startsWith('measure-');
          const interaction = new Draw({
            type: tool.type,
            stopClick: true,
            style: (feature, resolution) => {
              const styles = measurementStyles.get(feature, resolution, tool.id);
              if (measured) {
                return styles;
              }
              return [...(editingStyles[feature.getGeometry()?.getType() ?? ''] ?? []), ...styles];
            },
            ...(tool.id === 'measure-angle' ? { minPoints: 3, maxPoints: 3 } : {}),
          });
          const drawListeners: EventsKey[] = [
            watchViewProjection(drawMap, drawProjection, tool.id),
          ];
          if (measured) {
            drawListeners.push(
              interaction.on('drawstart', ({ feature }) => {
                clearSketch();
                const geometry = feature.getGeometry()!;
                const update = () => {
                  const projection = drawProjection.getCode();
                  try {
                    assertGeometryProjection(drawProjection, target);
                    const metric =
                      tool.id === 'measure-distance'
                        ? { value: getLength(geometry, { projection }), unit: 'm' as const }
                        : calculateToolMetric(tool.id, geometry, projection);
                    paintLabel(undefined, geometry, metric);
                  } catch {
                    removeLabel(undefined);
                  }
                };
                sketchListener = geometry.on('change', update);
                update();
              }),
              interaction.on('drawabort', clearSketch)
            );
          }
          drawListeners.push(
            interaction.on('drawend', async ({ feature }) => {
              if (session.draw !== interaction || !interaction.getActive()) {
                return;
              }
              clearSketch();
              let destination = target;
              let creating: ReturnType<typeof targets.resolve> | undefined;
              try {
                const geometry = feature.getGeometry()!;
                assertGeometryProjection(drawProjection, destination);
                const projection = drawProjection.getCode();
                const metric = calculateToolMetric(tool.id, geometry, projection);
                destination ??= targets.existing(tool.id);
                let id: string;
                do {
                  id = `sketch-${++sequence}`;
                } while (results.has(id) || destination?.source.getFeatureById(id));
                const completed = createResultFeature(
                  {
                    id,
                    toolId: tool.id,
                    projection,
                    ...metric,
                  },
                  geometry.clone()
                );
                let seeded = false;
                if (!destination) {
                  const firstFeature = format.writeFeatureObject(
                    completed,
                    geoJSONOptions(drawProjection)
                  );
                  interaction.setActive(false);
                  creating = targets.resolve(tool.id, firstFeature as unknown as JsonValue);
                  pendingTargets.add(creating);
                  const resolved = await creating;
                  destination = resolved.target;
                  seeded = resolved.seeded;
                  assertActive();
                }
                attach(destination);
                if (!seeded) {
                  if (destination.source.getFeatureById(id)) {
                    throw new Error(`Feature ID "${id}" already exists.`);
                  }
                  write(destination, [completed], [], drawProjection);
                }
                if (session.draw === interaction) {
                  finishTool(tool.id);
                }
              } catch (cause) {
                if (session.draw === interaction) {
                  interaction.setActive(true);
                }
                toolError(
                  destination
                    ? `Could not save the drawing to "${destination.id}".`
                    : 'Could not save the drawing result.',
                  cause
                );
              } finally {
                if (creating) {
                  pendingTargets.delete(creating);
                }
              }
            })
          );
          session.start(drawMap, interaction, drawListeners, snapFeatures(drawProjection));
        },
        deactivate: stop,
      },
      resources
    );
  });
  app.registerTool(
    'modify-result',
    {
      id: 'modify-result',
      canActivate: () => !!selection(),
      activate() {
        const entry = selection();
        if (!entry) {
          return;
        }
        const { target, result, feature } = entry;
        assertGeometryProjection(target.projection, target);
        activeTarget = target;
        editingId = result.id;
        const {
          interaction,
          listeners: modifyListeners,
          restore,
        } = createModifyInteraction(
          feature,
          (geometry) => {
            controller.updateGeometry(
              result.id,
              format.writeGeometryObject(geometry) as unknown as Record<string, unknown>
            );
            finishTool('modify-result');
          },
          (cause) => toolError('Invalid edited geometry.', cause)
        );
        const modifyMap = useMap();
        modifyListeners.push(watchViewProjection(modifyMap, target.projection, 'modify-result'));
        session.start(
          modifyMap,
          interaction,
          modifyListeners,
          snapFeatures(target.projection, feature),
          restore
        );
      },
      deactivate: stop,
    },
    resources
  );
  app.registerTool(
    'delete-result',
    {
      id: 'delete-result',
      mode: 'action',
      canActivate: () => !!selection(),
      activate: () => {
        const entry = selection();
        if (entry) {
          controller.remove(entry.result.id);
        }
      },
    },
    resources
  );
  app.registerTool(
    'clear-results',
    { id: 'clear-results', mode: 'action', activate: clearResults },
    resources
  );
  resources.add(() => {
    disposed = true;
    const errors = runCleanups([
      stop,
      clearLabels,
      () => unwatchColor?.(),
      ...[...attached.values()].reverse().map(({ stop: stopTarget }) => stopTarget),
    ]);
    attached.clear();
    results.clear();
    listeners.clear();
    controllers.delete(app);
    if (errors.length) {
      throw new AggregateError(errors, 'Could not fully release OpenLayers tools.');
    }
  });
}
