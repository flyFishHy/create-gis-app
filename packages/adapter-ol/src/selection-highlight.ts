import Feature, { type FeatureLike } from 'ol/Feature.js'
import type OlMap from 'ol/Map.js'
import type { EventsKey } from 'ol/events.js'
import VectorLayer from 'ol/layer/Vector.js'
import { unByKey } from 'ol/Observable.js'
import VectorSource, { type VectorSourceEvent } from 'ol/source/Vector.js'
import Style from 'ol/style/Style.js'
import Stroke from 'ol/style/Stroke.js'
import Fill from 'ol/style/Fill.js'
import CircleStyle from 'ol/style/Circle.js'
import type { FeatureReference, GISApp, Unsubscribe } from '@joinmap/gis-core'
import { findVectorFeature } from './feature-reference.js'

const accent = '#0284c7'
const highlightStyle = [
  new Style({
    stroke: new Stroke({ color: '#fff', width: 7 }),
    image: new CircleStyle({ radius: 10, stroke: new Stroke({ color: '#fff', width: 6 }) }),
  }),
  new Style({
    stroke: new Stroke({ color: accent, width: 3 }),
    fill: new Fill({ color: '#0284c733' }),
    image: new CircleStyle({ radius: 10, stroke: new Stroke({ color: accent, width: 3 }) }),
  }),
]

/** An unmanaged vector layer is rendered above business layers and stays out of their order. */
export class OLSelectionHighlight {
  private readonly marker = new Feature()
  readonly layer = new VectorLayer({
    source: new VectorSource({ features: [this.marker] }),
    style: highlightStyle,
  })
  private sourceListeners: EventsKey[] = []
  private readonly stopSelection: Unsubscribe

  constructor(
    private readonly map: OlMap,
    private readonly app: Pick<GISApp, 'interactions' | 'layers'>
  ) {
    this.layer.setMap(map)
    this.stopSelection = app.interactions.onSelect((feature) => this.select(feature))
    this.select(app.interactions.getSelection())
  }

  dispose(): void {
    this.stopSelection()
    this.select(undefined)
    this.layer.setMap(null)
  }

  private select(reference: FeatureReference | undefined): void {
    unByKey(this.sourceListeners)
    this.sourceListeners = []
    this.marker.setGeometry(undefined)
    if (!reference || (reference.source && reference.source !== 'layer')) return

    const layer = this.map
      .getLayers()
      .getArray()
      .find((item) => item.get('gisLayerId') === reference.layerId)
    if (!(layer instanceof VectorLayer)) return
    const source = layer.getSource()
    const feature = findVectorFeature(source, reference)
    if (!source || !feature) return

    const syncGeometry = () => {
      if (!source.hasFeature(feature) || !this.app.layers.canSelectFeature(reference)) {
        this.app.interactions.clearSelection()
        return
      }
      this.marker.setGeometry(feature.getGeometry()?.clone())
    }
    const syncSelected = (event: VectorSourceEvent<FeatureLike>) => {
      if (event.feature === feature) syncGeometry()
    }
    this.sourceListeners = [
      source.on('changefeature', syncSelected),
      source.on('removefeature', syncSelected),
      source.on('clear', syncGeometry),
      layer.on('change:source', () => this.app.interactions.clearSelection()),
    ]
    this.marker.setGeometry(feature.getGeometry()?.clone())
  }
}
