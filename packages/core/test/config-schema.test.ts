import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import { parseGISAppConfig } from '../src/index.js'

const schemaPath = resolve(process.cwd(), 'schemas/gis-app-config.schema.json')

describe('GIS app config JSON Schema', () => {
  it('validates the actual Basic Vue configuration', async () => {
    const schema = JSON.parse(await readFile(schemaPath, 'utf8'))
    const config = JSON.parse(await readFile(resolve(process.cwd(), 'examples/basic-vue/src/appConfig.json'), 'utf8'))
    const validate = new Ajv2020({ allErrors: true }).compile(schema)
    expect(validate(config), JSON.stringify(validate.errors)).toBe(true)
  })
  it('accepts a valid serializable GIS app config', async () => {
    const schema = JSON.parse(await readFile(schemaPath, 'utf8'))
    const ajv = new Ajv2020({ allErrors: true })
    const validate = ajv.compile(schema)
    expect(validate({
      map: { center: [0, 0], zoom: 3 },
      layers: [{ id: 'cities', type: 'geojson', source: { type: 'url', url: '/cities.json' } }],
      ui: {
        layout: 'docked-dashboard',
        theme: { mode: 'dark', tokens: { colorPrimary: '#3b82f6', panelStyle: 'liquid', panelOpacity: '72%', panelBlur: '16px', panelSpecular: '35%' } },
        panels: [{ id: 'legend', visible: true, position: 'right' }],
        timePicker: { granularities: ['hour', 'week'], defaultMode: 'range', defaultTimeZone: 'UTC', minTime: 0 },
      },
    })).toBe(true)
  })

  it('rejects unknown properties and malformed values', async () => {
    const schema = JSON.parse(await readFile(schemaPath, 'utf8'))
    const validate = new Ajv2020({ allErrors: true }).compile(schema)
    expect(validate({ map: { zoom: 'far' }, surprise: true })).toBe(false)
    expect(validate.errors?.length).toBeGreaterThan(0)
    const badSubtitle = { title: { content: 'Dashboard', subtitle: 42 } }
    expect(validate(badSubtitle)).toBe(false)
    expect(() => parseGISAppConfig(badSubtitle)).toThrow('title.subtitle must be a string')
    const badGranularities = { ui: { timePicker: { granularities: ['hour', 'hour'] } } }
    expect(validate(badGranularities)).toBe(false)
    expect(() => parseGISAppConfig(badGranularities)).toThrow('unique supported units')
    expect(() => parseGISAppConfig({ ui: { timePicker: { defaultTimeZone: 'Invalid/Zone' } } })).toThrow('IANA time zone')
    const config = (item: unknown) => ({ layers: [{ id: 'data', type: 'geojson', legend: { type: 'category', field: 'kind', items: [item] } }] })
    expect(validate(config({ id: 'a', label: 'A', values: [1, '1', false] }))).toBe(true)
    expect(validate(config({ id: 'a', label: 'A', values: [] }))).toBe(false)
    expect(validate(config({ id: 'a', label: 'A', values: [1, 1] }))).toBe(false)
    expect(validate(config({ id: 'a', label: 'A', values: [1], value: 1 }))).toBe(false)
    expect(validate(config({ id: 'a', label: 'A' }))).toBe(false)
  })
})
