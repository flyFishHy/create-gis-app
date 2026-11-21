# Basic Vue example

From the repository root, run `pnpm build` and then
`pnpm --filter @joinmap/example-basic-vue dev`.

The sample fetches the public OpenLayers US States GeoJSON file at runtime.
Replace its URL with a local or organization-managed endpoint for offline use.

Open the **Time picker** next to Search to try complete periods or an exact
range in Asia/Shanghai. The committed range is available in
`app.context.state.snapshot().extensions['vue-ui'].timeSelection`.
Click a legend rule to filter its layer and
click it again to clear the rule. Select a drawing or measurement on the map and
choose **Edit selected result** from the toolbar to drag its vertices.

The Settings popover saves appearance and configured layer edits in this
browser. It can export the current configuration as JSON and import it again.
