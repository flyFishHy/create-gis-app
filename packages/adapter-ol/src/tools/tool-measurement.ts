import GeoJSON from 'ol/format/GeoJSON.js';
import LineString from 'ol/geom/LineString.js';
import type Geometry from 'ol/geom/Geometry.js';
import { getArea, getLength } from 'ol/sphere.js';
import { olTools, type OLToolResult } from './tool-definitions.js';

const format = new GeoJSON();

export function calculateToolMetric(toolId: string, geometry: Geometry, projection: string) {
  const tool = olTools.find((entry) => entry.id === toolId);
  if (!tool || geometry.getType() !== tool.type) {
    throw new Error('Geometry does not match its tool.');
  }
  if (!geometry.getExtent().every(Number.isFinite)) {
    throw new Error('Geometry is empty or invalid.');
  }
  if (geometry instanceof LineString && getLength(geometry, { projection }) <= 0) {
    throw new Error('Line must contain distinct points.');
  }
  if (geometry.getType() === 'Polygon' && getArea(geometry, { projection }) <= 0) {
    throw new Error('Polygon must have positive area.');
  }
  const coordinates = format.writeGeometryObject(geometry).coordinates;
  const numbers = JSON.stringify(coordinates);
  if (!numbers || numbers.includes('null')) {
    throw new Error('Geometry contains non-finite coordinates.');
  }
  let value: number | undefined;
  let unit: OLToolResult['unit'];
  if (toolId === 'measure-distance') {
    value = getLength(geometry, { projection });
    unit = 'm';
  }
  if (toolId === 'measure-area') {
    value = getArea(geometry, { projection });
    unit = 'm²';
  }
  if (toolId === 'measure-angle' && geometry instanceof LineString) {
    const points = geometry.getCoordinates();
    if (points.length !== 3) {
      throw new Error('An angle requires exactly three points.');
    }
    const [first, vertex, third] = points as [number[], number[], number[]];
    if (
      Math.hypot(first[0]! - vertex[0]!, first[1]! - vertex[1]!) === 0 ||
      Math.hypot(third[0]! - vertex[0]!, third[1]! - vertex[1]!) === 0
    ) {
      throw new Error('Angle points must be distinct.');
    }
    const delta =
      (Math.abs(
        Math.atan2(first[1]! - vertex[1]!, first[0]! - vertex[0]!) -
          Math.atan2(third[1]! - vertex[1]!, third[0]! - vertex[0]!)
      ) *
        180) /
      Math.PI;
    value = Math.min(delta, 360 - delta);
    unit = '°';
  }
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new Error('Measurement must be positive and finite.');
  }
  return { value, unit };
}
