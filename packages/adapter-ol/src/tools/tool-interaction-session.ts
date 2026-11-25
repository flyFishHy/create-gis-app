import Collection from 'ol/Collection.js';
import type Feature from 'ol/Feature.js';
import type OlMap from 'ol/Map.js';
import Draw from 'ol/interaction/Draw.js';
import Modify from 'ol/interaction/Modify.js';
import Snap from 'ol/interaction/Snap.js';
import type Geometry from 'ol/geom/Geometry.js';
import type { EventsKey } from 'ol/events.js';
import { unByKey } from 'ol/Observable.js';
import { runCleanups } from '../lifecycle/run-cleanups.js';

export function createToolInteractionSession() {
  let active:
    | {
        map: OlMap;
        interaction: Draw | Modify;
        listeners: EventsKey[];
        snap: Snap;
        restore?: () => void;
      }
    | undefined;

  return {
    get draw(): Draw | undefined {
      return active?.interaction instanceof Draw ? active.interaction : undefined;
    },
    start(
      map: OlMap,
      interaction: Draw | Modify,
      listeners: EventsKey[],
      features: Feature[],
      restore?: () => void
    ) {
      const snap = new Snap({ features: new Collection(features) });
      active = { map, interaction, listeners, snap, restore };
      map.addInteraction(interaction);
      map.addInteraction(snap);
    },
    stop() {
      if (!active) {
        return;
      }
      const { map, interaction, listeners, snap, restore } = active;
      active = undefined;
      const errors = runCleanups([
        () => unByKey(listeners),
        () => map.removeInteraction(snap),
        () => map.removeInteraction(interaction),
        () => restore?.(),
      ]);
      if (errors.length) {
        throw new AggregateError(errors, 'Could not stop OpenLayers tool.');
      }
    },
  };
}

export function createModifyInteraction(
  feature: Feature,
  commit: (geometry: Geometry) => void,
  onError: (cause: unknown) => void
) {
  const interaction = new Modify({ features: new Collection([feature]) });
  let previous: Geometry | undefined;
  const start = interaction.on('modifystart', () => {
    previous = feature.getGeometry()?.clone();
  });
  const restore = () => {
    const geometry = previous;
    previous = undefined;
    if (geometry) {
      feature.setGeometry(geometry);
    }
  };
  const end = interaction.on('modifyend', () => {
    const geometry = feature.getGeometry();
    if (!geometry) {
      restore();
      return;
    }
    // The commit can synchronously end the session after updating the DataSet.
    const original = previous;
    previous = undefined;
    try {
      commit(geometry);
    } catch (cause) {
      if (original) {
        feature.setGeometry(original);
      }
      onError(cause);
    }
  });
  return { interaction, listeners: [start, end], restore };
}
