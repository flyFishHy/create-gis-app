import type {
  AppContext,
  AppState,
  DataService,
  EventService,
  GISAppConfig,
  InteractionService,
  LayerService,
  MapService,
  ResourceScope,
  SearchService,
} from '../types.js';
import { GISRuntimeError } from '../errors.js';

type Services = Pick<
  AppContext,
  'map' | 'layers' | 'data' | 'interactions' | 'search' | 'events' | 'resources' | 'state'
>;
/** Application-local capability container. No GISApp back-reference. */
export class AppContextImpl implements AppContext {
  #config?: Readonly<GISAppConfig>;
  readonly state: AppState;
  readonly map: MapService;
  readonly layers: LayerService;
  readonly data: DataService;
  readonly interactions: InteractionService;
  readonly events: EventService;
  readonly resources: ResourceScope;
  readonly search: SearchService;
  private constructor(services: Services) {
    this.state = services.state;
    this.map = services.map;
    this.layers = services.layers;
    this.search = services.search;
    this.data = services.data;
    this.interactions = services.interactions;
    this.events = services.events;
    this.resources = services.resources;
    Object.freeze(this);
  }
  get config(): Readonly<GISAppConfig> | undefined {
    return this.#config;
  }
  static create(services: Services): {
    context: AppContextImpl;
    initializeConfig: (config: Readonly<GISAppConfig>) => void;
  } {
    const context = new AppContextImpl(services);
    return {
      context,
      initializeConfig: (config) => {
        if (context.#config) {
          throw new GISRuntimeError({
            code: 'APP_INVALID_STATE',
            message: 'Context configuration is already initialized.',
            stage: 'config-initialization',
          });
        }
        context.#config = config;
      },
    };
  }
}
