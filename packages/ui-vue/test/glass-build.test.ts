// @vitest-environment node
import { expect, it } from 'vitest'
import { compile } from 'sass'
import { build } from 'vite'
import { fileURLToPath } from 'node:url'

const stylesheet = fileURLToPath(new URL('../src/styles.scss', import.meta.url))

it('preserves floating backdrop filters without animating the query and layer containers', async () => {
  const css = compile(stylesheet).css
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'glass-build-regression',
        resolveId(id) {
          if (id.endsWith('glass-entry')) return '\0glass-entry'
          if (id === 'glass.css') return '\0glass.css'
        },
        load(id) {
          if (id === '\0glass-entry') return 'import "glass.css"'
          if (id === '\0glass.css') return css
        },
      },
    ],
    build: { write: false, lib: { entry: 'glass-entry', formats: ['es'] } },
  })
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((item) =>
    'output' in item ? item.output : []
  )
  const built = outputs
    .filter((item) => item.type === 'asset' && item.fileName.endsWith('.css'))
    .map((item) => (item.type === 'asset' ? String(item.source) : ''))
    .join('')
  const styleRules = [...built.matchAll(/([^{}]+)\{([^{}]+)\}/g)]
  const rules = styleRules.filter((rule) => /-webkit-backdrop-filter\s*:/.test(rule[2]!))
  expect(rules.length).toBeGreaterThan(0)
  for (const rule of rules) expect(rule[2], rule[1]).toMatch(/(?<![-\w])backdrop-filter\s*:/)
  for (const selector of [
    '.gis-ui-title',
    '.gis-ui-panel-shell',
    '.gis-ui-search-form',
    '.gis-ui-time-picker-trigger',
    '.gis-ui-time-picker-form',
    '.gis-ui-time-placeholder',
    '.gis-ui-toolbar-root',
    '.gis-ui-status-content',
    '.gis-ui-map-status',
    '.gis-ui-multi-menu',
    '.gis-ui-select-menu',
    '.gis-ui-search-feedback',
    '.el-picker__popper',
    '.gis-ui-toolbar-menu',
    '.gis-ui-legend-style-dialog',
    '.gis-ui-tool-hint',
  ]) {
    expect(
      rules.some((rule) => rule[1]!.includes(selector)),
      selector
    ).toBe(true)
  }
  const animatedSelectors = styleRules
    .filter((rule) => /(?:^|;)\s*animation(?:-name)?\s*:/.test(rule[2]!))
    .map((rule) => rule[1]!)
    .join(',')
  expect(animatedSelectors).not.toMatch(/\.gis-ui-overlay--(?:top|left)\b/)
})

it('shares material finishes across floating menus and inset controls', () => {
  const { css } = compile(stylesheet)
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)]
  const surfaces = [
    '.gis-ui-select-menu',
    '.gis-ui-search-feedback',
    '.el-picker__popper',
    '.gis-ui-layer-row.is-hidden',
    '.gis-ui-layer-settings',
    '.gis-ui-time-picker-popup .gis-ui-switch',
    '.gis-ui-time-picker-fields .el-input__wrapper',
    '.gis-ui-time-picker-fields .gis-ui-select-trigger',
    '.gis-ui-status-content',
    '.gis-ui-map-status',
  ]
  for (const surface of surfaces) {
    expect(
      rules.some(
        ([, selector, declarations]) =>
          selector!.includes(surface) &&
          declarations!.includes('background-image: var(--gis-ui-material-image, none)') &&
          declarations!.includes('border-color: var(--gis-ui-material-border')
      ),
      surface
    ).toBe(true)
  }
})

it('paints selected switches with the primary color and animates the subtitle dot', () => {
  const { css } = compile(stylesheet)
  const selection = css.match(/\.gis-ui-switch button\.is-active\s*\{([^}]+)\}/)?.[1]
  expect(selection).toMatch(/background: var\(--gis-ui-primary, #3b82f6\);/)
  expect(selection).toMatch(/color: #fff;/)
  expect(css).toMatch(
    /\.gis-ui-brand-subtitle::before\s*\{\s*animation: gis-ui-subtitle-pulse [^;]*infinite;/
  )
})

it('shares reference panel finishes and displays the scrollbar thumb on a transparent track', () => {
  const { css } = compile(stylesheet)
  expect(css).toMatch(/--gis-ui-liquid-shadow:[^;]*0 14px 34px -6px[^;]*inset 0 -2px 8px/)
  expect(css).toMatch(/--gis-ui-liquid-shadow:[^;]*0 14px 36px -6px[^;]*inset 0 -2px 6px/)
  expect(css).toContain('--gis-ui-material-opacity: max(94%, var(--gis-ui-glass-opacity))')
  expect(css).toContain('background-image: var(--gis-ui-material-image, none)')
  expect(css).toMatch(/\.gis-ui-scroll-track\s*\{[^}]*background: transparent;/)
  expect(css).toMatch(
    /\.gis-ui-scroll-thumb\s*\{[^}]*background: (?:rgb\(148 163 184 \/ 30%\)|rgba\(148, 163, 184, 0\.3\));/
  )
})

it('keeps thinner layer and legend scrollbars interactive only when revealed', () => {
  const { css } = compile(stylesheet)
  for (const panel of ['layer-manager', 'legend']) {
    const track = `.gis-ui-panel-host--${panel} > .gis-ui-panel-shell > .gis-ui-panel-body > .gis-ui-scroll-track`
    expect(css).toContain(`${track} > .gis-ui-scroll-thumb.is-y`)
    expect(css).toContain(`${track} > .gis-ui-scroll-thumb.is-x`)
    const idle = `.gis-ui-panel-host--${panel}:not(:hover) > .gis-ui-panel-shell > .gis-ui-panel-body:not(.is-scrolling) > .gis-ui-scroll-track`
    expect(css).toContain(idle)
    expect(css).toContain(`${idle} > .gis-ui-scroll-thumb:not(:focus-visible)`)
  }
  expect(css).toMatch(/\.gis-ui-scroll-thumb\.is-y\s*\{\s*border-inline-width: 2px;/)
  expect(css).toMatch(/\.gis-ui-scroll-thumb\.is-x\s*\{\s*border-block-width: 2px;/)
  expect(css).toMatch(/\.gis-ui-scroll-track\s*\{\s*pointer-events: none;/)
  expect(css).toMatch(/\.gis-ui-scroll-thumb:not\(:focus-visible\)\s*\{\s*opacity: 0;/)
})
