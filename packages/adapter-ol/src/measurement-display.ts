import Overlay from 'ol/Overlay.js'
import type { FeatureLike } from 'ol/Feature.js'
import type OlMap from 'ol/Map.js'
import { asArray, isStringColor } from 'ol/color.js'
import type { Coordinate } from 'ol/coordinate.js'
import type { EventsKey } from 'ol/events.js'
import { intersects, intersectsSegment, type Extent } from 'ol/extent.js'
import type Geometry from 'ol/geom/Geometry.js'
import LineString from 'ol/geom/LineString.js'
import MultiPoint from 'ol/geom/MultiPoint.js'
import Point from 'ol/geom/Point.js'
import Polygon from 'ol/geom/Polygon.js'
import { unByKey } from 'ol/Observable.js'
import { toUserCoordinate, transform } from 'ol/proj.js'
import { getDistance } from 'ol/sphere.js'
import CircleStyle from 'ol/style/Circle.js'
import Fill from 'ol/style/Fill.js'
import Stroke from 'ol/style/Stroke.js'
import Style from 'ol/style/Style.js'

const defaultColor = '#3b82f6'
const areaColor = ([red, green, blue]: number[]) => [red!, green!, blue!, 0.16]

function angleArc(line: LineString, resolution: number) {
  const [first, vertex, third] = line.getCoordinates()
  if (!first || !vertex || !third) return
  const [x, y] = vertex as [number, number]
  const ax = first[0]! - x
  const ay = first[1]! - y
  const bx = third[0]! - x
  const by = third[1]! - y
  const radius = Math.min(18 * resolution, Math.hypot(ax, ay) * 0.45, Math.hypot(bx, by) * 0.45)
  const start = Math.atan2(ay, ax)
  const sweep = Math.atan2(ax * by - ay * bx, ax * bx + ay * by)
  if (!radius || !sweep) return

  const pointAt = (angle: number, distance: number): Coordinate => [
    x + distance * Math.cos(angle),
    y + distance * Math.sin(angle),
  ]
  return {
    geometry: () =>
      new LineString(
        Array.from({ length: 25 }, (_, index) => pointAt(start + (sweep * index) / 24, radius))
      ),
    label: (gap: number) => pointAt(start + sweep / 2, radius + gap * resolution),
  }
}

export function createMeasurementStyles() {
  const line = new Stroke({ color: defaultColor, width: 2 })
  const vertexStroke = new Stroke({ color: defaultColor, width: 2 })
  const marker = new CircleStyle({
    radius: 4,
    fill: new Fill({ color: '#fff' }),
    stroke: vertexStroke,
  })
  const fill = new Fill({ color: areaColor(asArray(defaultColor)) })
  const vertex = new Style({
    geometry: (feature) => {
      const geometry = feature.getGeometry()
      if (geometry instanceof LineString) return new MultiPoint(geometry.getCoordinates())
      if (geometry instanceof Polygon) {
        return new MultiPoint(geometry.getCoordinates().flatMap((ring) => ring.slice(0, -1)))
      }
      if (geometry instanceof Point) return geometry
    },
    image: marker,
    zIndex: 3,
  })
  const shape = new Style({ stroke: line, fill })

  return {
    setColor(color: string) {
      const colors = asArray(color)
      line.setColor(colors)
      vertexStroke.setColor(colors)
      marker.setStroke(vertexStroke)
      fill.setColor(areaColor(colors))
    },
    get(feature: FeatureLike, resolution: number, toolId: string | undefined) {
      const geometry = feature.getGeometry()
      const measured = toolId?.startsWith('measure-')
      if (geometry instanceof Point) return measured ? [vertex] : []
      if (!(geometry instanceof LineString || geometry instanceof Polygon)) return []
      if (!measured) return [vertex]
      const styles = [shape, vertex]
      if (toolId === 'measure-angle' && geometry instanceof LineString) {
        const arc = angleArc(geometry, resolution)
        if (arc) {
          styles.push(new Style({ geometry: arc.geometry(), stroke: line, zIndex: 2 }))
        }
      }
      return styles
    },
  }
}

export function watchMeasurementColor(map: OlMap, applyColor: (color: string) => void) {
  let observer: MutationObserver | undefined
  let lastColor: string | undefined
  const viewport = map.getViewport()
  const window = viewport?.ownerDocument.defaultView
  const refresh = () => {
    const root = viewport?.closest('.gis-ui-root') ?? map.getTargetElement()
    const token = root && window?.getComputedStyle(root).getPropertyValue('--gis-ui-primary').trim()
    const color = token && isStringColor(token) ? token : defaultColor
    if (color === lastColor) return
    applyColor(color)
    lastColor = color
  }
  const bind = () => {
    observer?.disconnect()
    const root = viewport?.closest('.gis-ui-root') ?? map.getTargetElement()
    if (root && window) {
      observer = new window.MutationObserver(refresh)
      observer.observe(root, { attributes: true, attributeFilter: ['class', 'style'] })
    }
    refresh()
  }
  const targetChange = map.on('change:target', bind)
  bind()
  return () => {
    observer?.disconnect()
    unByKey(targetChange)
  }
}

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })
type MeasurementUnit = 'm' | 'm²' | '°'

function formatMeasurement(value: number, unit: MeasurementUnit) {
  if (unit === 'm' && value >= 1000) return `${numberFormat.format(value / 1000)} km`
  if (unit === 'm²' && value >= 1_000_000) return `${numberFormat.format(value / 1_000_000)} km²`
  return `${numberFormat.format(value)}${unit === '°' ? '' : ' '}${unit}`
}

interface LabelContent {
  text: string
  anchor?: Coordinate
  neighbors?: Coordinate[]
  boundary?: Coordinate[][]
  remove?: () => void
}

export interface MeasurementLabels {
  overlays: Overlay[]
  positionListener?: EventsKey
}

function createLabel(map: OlMap, content: LabelContent) {
  const doc = map.getViewport()?.ownerDocument
  if (!doc) return
  const element = doc.createElement('div')
  element.className = 'gis-ui-measurement-label'
  const value = doc.createElement('span')
  element.append(value)
  const remove = content.remove
  if (remove) {
    const button = doc.createElement('button')
    button.type = 'button'
    button.className = 'gis-ui-measurement-remove'
    button.setAttribute('aria-label', '删除测量结果')
    button.textContent = '×'
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      remove()
    })
    element.append(button)
  }
  const overlay = new Overlay({
    element,
    className: 'gis-ui-measurement-overlay',
    positioning: 'center-center',
    stopEvent: !!remove,
  })
  map.addOverlay(overlay)
  return overlay
}

export function removeMeasurementLabels(map: OlMap, labels: MeasurementLabels) {
  if (labels.positionListener) unByKey(labels.positionListener)
  for (const overlay of labels.overlays) map.removeOverlay(overlay)
}

const labelDirections = [
  [0, -1],
  [0, 1],
  [1, 0],
  [-1, 0],
  [0.707, -0.707],
  [-0.707, -0.707],
  [0.707, 0.707],
  [-0.707, 0.707],
] as const

function placeLabelNearAnchor(
  map: OlMap,
  overlay: Overlay,
  element: HTMLElement,
  neighbors: Coordinate[],
  boundary: Coordinate[][] | undefined,
  occupied: Extent[]
) {
  const position = overlay.getPosition()
  const pixel = position && map.getPixelFromCoordinate(position)
  const size = map.getSize()
  const halfWidth = Math.max(element.offsetWidth / 2, 10) + 3
  const halfHeight = Math.max(element.offsetHeight / 2, 7) + 3
  let offset = boundary ? [0, 0] : [0, -halfHeight - 8]
  if (pixel && size) {
    const [x, y] = pixel as [number, number]
    const points = neighbors
      .map((point) => map.getPixelFromCoordinate(point))
      .filter((point) => !!point)
    const pixelRings = boundary?.map((ring) =>
      ring.map((point) => map.getPixelFromCoordinate(point))
    )
    let bestScore = Infinity
    let bestBounds: Extent | undefined
    const directions = boundary ? [[0, 0] as const, ...labelDirections] : labelDirections
    for (const [dx, dy] of directions) {
      const distance =
        dx || dy ? Math.min(halfWidth / Math.abs(dx), halfHeight / Math.abs(dy)) + 8 : 0
      const cx = x + dx * distance
      const cy = y + dy * distance
      const bounds = [cx - halfWidth, cy - halfHeight, cx + halfWidth, cy + halfHeight]
      const outside =
        bounds[0]! < 0 || bounds[1]! < 0 || bounds[2]! > size[0]! || bounds[3]! > size[1]!
      const coversLine =
        points.some((point) => intersectsSegment(bounds, pixel, point)) ||
        (pixelRings?.some((ring) =>
          ring.some((point, index) => {
            const previous = ring[index - 1]
            return !!(previous && point && intersectsSegment(bounds, previous, point))
          })
        ) ??
          false)
      const coversLabel = occupied.some((label) => intersects(bounds, label))
      const score =
        Number(outside) * 8 + Number(coversLine) * 4 + Number(coversLabel) * 2 + distance / 1000
      if (score >= bestScore) continue
      bestScore = score
      bestBounds = bounds
      offset = [Math.round(cx - x), Math.round(cy - y)]
    }
    if (bestBounds) occupied.push(bestBounds)
  }
  const previous = overlay.getOffset()
  if (offset[0] !== previous[0] || offset[1] !== previous[1]) overlay.setOffset(offset)
}

export function updateMeasurementLabels(
  map: OlMap,
  current: MeasurementLabels,
  geometry: Geometry,
  value: number,
  unit: MeasurementUnit,
  remove?: () => void
) {
  const projection = map.getView().getProjection()
  const text = formatMeasurement(value, unit)
  const contents: LabelContent[] = []
  if (unit === 'm' && geometry instanceof LineString) {
    const coordinates = geometry.getCoordinates()
    const lonLat = coordinates.map((point) => transform(point, projection, 'EPSG:4326'))
    const lastIndex = coordinates.length - 1
    let cumulative = 0
    for (const [index, anchor] of coordinates.entries()) {
      const neighbors = [coordinates[index - 1], coordinates[index + 1]].filter((point) => !!point)
      if (index === 0) {
        contents.push({ text: '起点', anchor, neighbors })
      } else {
        if (index === lastIndex) {
          contents.push({ text: `${remove ? '总计' : '总长'}: ${text}`, anchor, neighbors, remove })
        } else {
          const distance = getDistance(lonLat[index - 1]!, lonLat[index]!)
          cumulative += distance
          if (distance > 0)
            contents.push({ text: formatMeasurement(cumulative, 'm'), anchor, neighbors })
        }
      }
    }
  } else if (geometry instanceof Polygon) {
    const ring = geometry.getCoordinates()[0]
    const anchor = remove ? geometry.getInteriorPoint().getCoordinates().slice(0, 2) : ring?.at(-2)
    const neighbors = remove ? undefined : [ring?.at(-3), ring?.[0]].filter((point) => !!point)
    if (anchor)
      contents.push({
        text,
        anchor,
        neighbors,
        boundary: remove ? geometry.getCoordinates() : undefined,
        remove,
      })
  } else if (unit === '°' && geometry instanceof LineString) {
    contents.push({ text, remove })
  }

  if (current.positionListener) unByKey(current.positionListener)
  current.positionListener = undefined
  const positionAnchoredLabels: ((occupied: Extent[]) => void)[] = []
  for (const overlay of current.overlays.splice(contents.length)) map.removeOverlay(overlay)
  for (const [index, content] of contents.entries()) {
    let overlay: Overlay | undefined = current.overlays[index]
    if (overlay && overlay.getOptions().stopEvent !== !!content.remove) {
      map.removeOverlay(overlay)
      overlay = undefined
    }
    overlay ??= createLabel(map, content)
    const element = overlay?.getElement()
    if (!overlay || !element?.firstElementChild) continue
    current.overlays[index] = overlay
    element.firstElementChild.textContent = content.text

    if (content.anchor) {
      overlay.setPosition(toUserCoordinate(content.anchor, projection))
      const project = (point: Coordinate) => toUserCoordinate(point, projection)
      const neighbors = content.neighbors?.map(project) ?? []
      const boundary = content.boundary?.map((ring) => ring.map(project))
      positionAnchoredLabels.push((occupied) =>
        placeLabelNearAnchor(map, overlay, element, neighbors, boundary, occupied)
      )
    } else if (geometry instanceof LineString) {
      let previousResolution: number | undefined
      let previousGap: number | undefined
      const reposition = () => {
        const resolution = map.getView().getResolution()
        if (!resolution) return
        const gap = Math.max(12, Math.hypot(element.offsetWidth, element.offsetHeight) / 2 + 5)
        if (resolution === previousResolution && gap === previousGap) return
        previousResolution = resolution
        previousGap = gap
        const arc = angleArc(geometry, resolution)
        const position = arc && toUserCoordinate(arc.label(gap), projection)
        const previous = overlay.getPosition()
        if (position?.[0] !== previous?.[0] || position?.[1] !== previous?.[1])
          overlay.setPosition(position)
      }
      reposition()
      current.positionListener = map.on('postrender', reposition)
    }
  }
  if (positionAnchoredLabels.length > 0) {
    const reposition = () => {
      const occupied: Extent[] = []
      for (const place of positionAnchoredLabels) place(occupied)
    }
    reposition()
    current.positionListener = map.on('postrender', reposition)
  }
}
