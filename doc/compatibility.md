# Compatibility and version policy

This repository is a v1 workspace. These ranges describe the current source
compatibility; package publication and long-term support windows are not yet
declared.

| Surface | Current requirement |
| --- | --- |
| Node.js | `>=20.19.0` (strict engine check) |
| pnpm | `>=12.14.0`; lockfile generated with pnpm 12.14.0 |
| TypeScript | 5.7 or newer; packages emit ESM and declarations |
| Vue | Vue 3.5 (`@joinmap/ui-vue` peer range `^3.5.0`) |
| OpenLayers | OpenLayers 10 (`@joinmap/adapter-ol` range `^10.11.0`) |
| Browser DOM | Required by Vue UI and OL/Vue integration when mounted; Core can run headlessly |

Core is framework-neutral and its package entry exports ESM plus declarations.
The Vue package exposes its root API and `./style.css`; the OpenLayers package
exposes its root API. Internal `src` paths are not supported imports.

`@joinmap/ol-vue` exposes optional createOLResultsUI. Normal tools/properties/status
need only createOLAdapter and createVueUI. createOLTools, createOLToolsUI and
OLMapStatus are removed; the adapter installs tools unless tools:false. Core and
generic Vue UI remain independent of the optional OL results integration.

During v1, changes to exported types, lifecycle behavior, plugin registration,
and config fields must be checked against both design documents and the test
suite. Before publishing stable packages, adopt semantic versioning: breaking
public API or serialized config changes require a major version; additive
backward-compatible changes use a minor version; compatible fixes use patch.
There is no promise of cross-major compatibility for OpenLayers objects or
internal CSS selectors.
