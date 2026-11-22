import { expect, it } from 'vitest'
import { parseGISAppConfig } from '../src/index.js'

it('validates top-level styles and typed enum matches, interval boundaries and uniqueness', () => {
  const config = (legend: unknown) => ({
    layers: [{ id: 'data', type: 'geojson', style: { fillColor: '#808080' }, legend }],
  })
  expect(
    parseGISAppConfig(
      config({
        type: 'category',
        field: 'kind',
        items: [
          { id: 'n', label: 'Number', value: 1, color: '#ff0000' },
          { id: 's', label: 'String', value: '1', color: '#00ff00' },
        ],
      })
    ).layers?.[0]?.style
  ).toEqual({ fillColor: '#808080' })
  expect(() =>
    parseGISAppConfig(
      config({
        type: 'category',
        field: 'kind',
        items: [
          { id: 'a', label: '', value: 'same' },
          { id: 'b', label: '', value: 'same' },
        ],
      })
    )
  ).toThrow('Duplicate category')
  const ranges = [
    { id: 'a', min: 0, max: 100, color: '#ff0000' },
    { id: 'b', min: 100, max: 200, color: '#00ff00' },
  ]
  expect(() =>
    parseGISAppConfig(config({ type: 'interval', field: 'count', ranges }))
  ).not.toThrow()
  expect(() =>
    parseGISAppConfig(
      config({
        type: 'interval',
        field: 'count',
        ranges: [{ ...ranges[0], includeMax: true }, ranges[1]],
      })
    )
  ).toThrow('overlap')
  expect(() =>
    parseGISAppConfig(
      config({ type: 'interval', field: 'count', ranges: [{ ...ranges[0], max: 0 }] })
    )
  ).toThrow('Invalid interval')
  expect(() =>
    parseGISAppConfig({ layers: [{ id: 'old', type: 'geojson', options: { style: {} } }] })
  ).toThrow('Move options.style')
})

it('normalizes legacy values and validates multi-value groups without mutating input', () => {
  const input = {
    layers: [
      {
        id: 'data',
        type: 'geojson',
        legend: {
          type: 'category',
          field: 'kind',
          items: [
            { id: 'urban', label: 'Urban', values: ['urban', 'suburban'] },
            { id: 'legacy', label: 'Legacy', value: false },
          ],
        },
      },
    ],
  }
  const parsed = parseGISAppConfig(input)
  expect(parsed.layers?.[0]?.legend?.items).toEqual([
    { id: 'urban', label: 'Urban', values: ['urban', 'suburban'] },
    { id: 'legacy', label: 'Legacy', values: [false] },
  ])
  expect(input.layers[0]!.legend.items[1]!.value).toBe(false)
  expect(Object.isFrozen(parsed.layers?.[0]?.legend?.items?.[0]?.values)).toBe(true)
  const config = (items: unknown[]) => ({
    layers: [{ id: 'data', type: 'geojson', legend: { type: 'category', field: 'kind', items } }],
  })
  for (const values of [[], [null], [{}], [1, 1]])
    expect(() => parseGISAppConfig(config([{ id: 'a', label: 'A', values }]))).toThrow()
  expect(() => parseGISAppConfig(config([{ id: 'a', label: 'A', values: [1], value: 1 }]))).toThrow(
    'not both'
  )
  expect(() =>
    parseGISAppConfig(
      config([
        { id: 'a', label: 'A', values: ['x', 'y'] },
        { id: 'b', label: 'B', values: ['y'] },
      ])
    )
  ).toThrow('Duplicate category')
  expect(() =>
    parseGISAppConfig(config([{ id: 'a', label: 'A', values: [1, '1', false, 'false'] }]))
  ).not.toThrow()
})
