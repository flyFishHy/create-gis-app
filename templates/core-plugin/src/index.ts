import type { GISPlugin } from '@joinmap/gis-core'

export interface ExamplePluginOptions {
  readonly prefix?: string
}

/** Registers a data processor and scopes its registration to the plugin. */
export function createExamplePlugin(): GISPlugin<ExamplePluginOptions> {
  return {
    name: 'example-data-plugin',
    install(app, options, resources) {
      const prefix = options?.prefix ?? 'normalized'
      app.registerDataProcessor(
        `${prefix}:identity`,
        {
          process(input) {
            return input
          },
        },
        resources
      )
    },
  }
}
