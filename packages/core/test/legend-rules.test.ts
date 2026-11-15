import { expect, it } from 'vitest'
import { parseGISAppConfig } from '../src/index.js'

it('validates top-level styles and typed enum matches, interval boundaries and uniqueness', () => {
  const config = (legend: unknown) => ({ layers: [{ id: 'data', type: 'geojson', style: { fillColor: '#808080' }, legend }] })
  expect(parseGISAppConfig(config({ type: 'category', field: 'kind', items: [
    { id: 'n', label: 'Number', value: 1, color: '#ff0000' }, { id: 's', label: 'String', value: '1', color: '#00ff00' },
  ] })).layers?.[0]?.style).toEqual({ fillColor: '#808080' })
  expect(() => parseGISAppConfig(config({ type: 'category', field: 'kind', items: [
    { id: 'a', label: '', value: 'same' }, { id: 'b', label: '', value: 'same' },
  ] }))).toThrow('Duplicate category')
  const ranges = [{ id: 'a', min: 0, max: 100, color: '#ff0000' }, { id: 'b', min: 100, max: 200, color: '#00ff00' }]
  expect(() => parseGISAppConfig(config({ type: 'interval', field: 'count', ranges }))).not.toThrow()
  expect(() => parseGISAppConfig(config({ type: 'interval', field: 'count', ranges: [{ ...ranges[0], includeMax: true }, ranges[1]] }))).toThrow('overlap')
  expect(() => parseGISAppConfig(config({ type: 'interval', field: 'count', ranges: [{ ...ranges[0], max: 0 }] }))).toThrow('Invalid interval')
  expect(() => parseGISAppConfig({ layers: [{ id: 'old', type: 'geojson', options: { style: {} } }] })).toThrow('Move options.style')
})
