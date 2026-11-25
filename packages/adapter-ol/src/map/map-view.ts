import type { MapLocation, MapStateSnapshot, MapViewService, Unsubscribe } from '@joinmap/gis-core';
import type OlMap from 'ol/Map.js';
import type View from 'ol/View.js';
import { unByKey } from 'ol/Observable.js';
import { getPointResolution, transform, transformExtent } from 'ol/proj.js';

export function locateOLView(view: View, location: MapLocation): void {
  const projection = view.getProjection();
  const from = location.projection ?? projection;
  if (location.extent) {
    view.fit(transformExtent([...location.extent], from, projection), {
      padding: [24, 24, 24, 24],
      maxZoom: Math.max(view.getZoom() ?? 0, 16),
    });
  } else if (location.coordinate) {
    view.setCenter(transform([...location.coordinate], from, projection));
  }
}

export function getOLView(view: View): MapViewService {
  return {
    getCenter: () => {
      const center = view.getCenter();
      return center ? [center[0], center[1]] : undefined;
    },
    setCenter: (center) => view.setCenter([center[0], center[1]]),
    getZoom: () => view.getZoom(),
    setZoom: (zoom) => view.setZoom(zoom),
    fit: (extent) => view.fit([...extent]),
  };
}

export function getOLViewState(view: View): Omit<MapStateSnapshot, 'ready'> {
  const center = view.getCenter();
  const resolution = view.getResolution();
  const meters =
    center && resolution !== undefined
      ? getPointResolution(view.getProjection(), resolution, center, 'm')
      : NaN;
  return {
    metersPerPixel: Number.isFinite(meters) ? meters : null,
    projection: view.getProjection().getCode(),
    center: center ? [center[0]!, center[1]!] : null,
    zoom: view.getZoom() ?? null,
    resolution: view.getResolution() ?? null,
    rotation: view.getRotation(),
  };
}

export function onOLViewChange(map: OlMap, listener: () => void): Unsubscribe {
  let frame: number | undefined;
  const schedule = () => {
    if (frame !== undefined) {
      return;
    }
    frame = requestAnimationFrame(() => {
      frame = undefined;
      listener();
    });
  };
  let keys = map.getView().on(['change:center', 'change:resolution', 'change:rotation'], schedule);
  const replacement = map.on('change:view', () => {
    unByKey(keys);
    keys = map.getView().on(['change:center', 'change:resolution', 'change:rotation'], schedule);
    schedule();
  });
  return () => {
    if (frame !== undefined) {
      cancelAnimationFrame(frame);
    }
    unByKey(keys);
    unByKey(replacement);
  };
}
