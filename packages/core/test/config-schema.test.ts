import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'

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
      ui: { layout: 'docked-dashboard', theme: 'dark', panels: [{ id: 'legend', visible: true, position: 'right' }] },
    })).toBe(true)
  })

  it('rejects unknown properties and malformed values', async () => {
    const schema = JSON.parse(await readFile(schemaPath, 'utf8'))
    const validate = new Ajv2020({ allErrors: true }).compile(schema)
    expect(validate({ map: { zoom: 'far' }, surprise: true })).toBe(false)
    expect(validate.errors?.length).toBeGreaterThan(0)
  })
})
