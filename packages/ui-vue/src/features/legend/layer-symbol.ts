export function layerSymbol(geometry: unknown): 'line' | 'circle' | 'fill' {
  if (typeof geometry === 'string') {
    if (/LineString$/.test(geometry)) {
      return 'line';
    }
    if (/Point$/.test(geometry)) {
      return 'circle';
    }
  }
  return 'fill';
}
