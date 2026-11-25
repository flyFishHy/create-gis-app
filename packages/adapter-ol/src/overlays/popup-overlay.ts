import type { MapOverlayAnchor, Unsubscribe } from '@joinmap/gis-core';
import type OlMap from 'ol/Map.js';
import Overlay from 'ol/Overlay.js';
import type { EventsKey } from 'ol/events.js';
import { toUserCoordinate, transform } from 'ol/proj.js';
import { unByKey } from 'ol/Observable.js';
import { runCleanups } from '../lifecycle/run-cleanups.js';

export function createPopupOverlay(
  map: OlMap,
  element: HTMLElement,
  anchor: MapOverlayAnchor
): Unsubscribe {
  const projection = map.getView().getProjection();
  const position = toUserCoordinate(
    transform([...anchor.coordinate], anchor.projection ?? projection, projection),
    projection
  );
  const overlay = new Overlay({ element, autoPan: false, stopEvent: true, insertFirst: false });

  const margin = 8,
    gap = 10;
  const clamp = (value: number, available: number, length: number) =>
    Math.max(margin, Math.min(value, available - margin - length));
  let lastSize: number[] | undefined;
  const place = () => {
    const size = map.getSize();
    if (!size) {
      return;
    }
    const [width, height] = size as [number, number];
    if (width !== lastSize?.[0] || height !== lastSize[1]) {
      element.style.setProperty(
        '--gis-map-popup-max-width',
        `${Math.max(0, width - 2 * margin)}px`
      );
      element.style.setProperty(
        '--gis-map-popup-max-height',
        `${Math.max(0, height - 2 * margin)}px`
      );
      lastSize = [width, height];
    }
    const pixel = map.getPixelFromCoordinate(position, { wrapX: true });
    if (!pixel) {
      return;
    }
    const [pixelX, pixelY] = pixel as [number, number];
    const visible = pixelX >= 0 && pixelX <= width && pixelY >= 0 && pixelY <= height;
    element.style.visibility = visible ? '' : 'hidden';
    if (!visible) {
      return;
    }

    const { offsetWidth, offsetHeight } = element;
    const above = pixelY - gap - offsetHeight;
    const top = above >= margin || pixelY > height / 2 ? above : pixelY + gap;
    const dx = Math.round(clamp(pixelX - offsetWidth / 2, width, offsetWidth) - pixelX);
    const dy = Math.round(clamp(top, height, offsetHeight) - pixelY);
    element.style.setProperty('--gis-ui-map-popup-anchor-x', `${-dx}px`);
    element.dataset.popupTail = dy >= 0 ? 'top' : dy + offsetHeight <= 0 ? 'bottom' : 'none';
    const [lastX, lastY] = overlay.getOffset();
    if (dx !== lastX || dy !== lastY) {
      overlay.setOffset([dx, dy]);
    }
  };
  let key: EventsKey | undefined;
  let observer: ResizeObserver | undefined;
  let disposed = false;
  const destroy = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    const errors = runCleanups([
      () => observer?.disconnect(),
      () => key && unByKey(key),
      () => map.removeOverlay(overlay),
      () => overlay.setElement(undefined),
    ]);
    if (errors.length) {
      throw new AggregateError(errors, 'Could not fully remove map popup.');
    }
  };
  try {
    map.addOverlay(overlay);
    overlay.setPosition(position);
    key = map.on('postrender', place);
    observer = new ResizeObserver(place);
    observer.observe(element);
    place();
  } catch (cause) {
    const errors = runCleanups([destroy]);
    if (errors.length) {
      throw new AggregateError([cause, ...errors], 'Could not add or remove map popup.', { cause });
    }
    throw cause;
  }
  return destroy;
}
