---
name: gis-runtime
description: Use when implementing or reviewing this repository's GIS Runtime, OpenLayers adapter, Vue UI, plugins, app configuration, or lifecycle/resource behavior.
---

# GIS Runtime repository guide

## Before changing code

- Read the applicable API reference in `doc/runtime-api.md` or `doc/vue-ui-api.md`.
- Read the corresponding design document when a change affects architecture,
  lifecycle, package boundaries, or a public API.
- Core (`packages/core`) must remain independent of Vue and OpenLayers.
- Core owns serializable panel metadata only. Vue UI owns component registration,
  panel state, rendering, and layouts.

## Runtime invariants

- Install plugins before `init()`. `install()` is synchronous; async setup goes
  in `onInit()`.
- Register plugin-owned resources with the `ResourceScope` supplied to install.
- Lifecycle order is `init -> mount -> unmount -> dispose`; init failure cleans
  up and cannot be retried on that instance. Dispose, then create a new app.
- Keep cleanup idempotent, reverse ordered, and continue after cleanup errors.
- Route initial and dynamic layer creation through `LayerService`.
- Never put live map-engine objects or Vue objects into JSON config/Core state.

## Vue UI invariants

- Use only public Core services; do not import adapter-ol internals.
- Register Vue UI extensions through `createVueUI({ extensions })`; return a
  cleanup callback for registrations and listeners.
- Config chooses built-in layouts by name; custom Vue layout components are
  passed in code.
- Keep style overrides under the `gis-ui` CSS variable namespace.

## Validation

- Add a focused test for behavior changes. Runtime tests belong under
  `packages/core/test`; Vue UI tests belong under `packages/ui-vue/test`.
- Update API references and both design documents when observable contracts
  change. Validate JSON config changes against `schemas/gis-app-config.schema.json`.
- Run `pnpm check` before completing implementation work.
