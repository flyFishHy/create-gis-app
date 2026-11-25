export type GISRuntimeErrorCode =
  | 'APP_INVALID_STATE'
  | 'APP_DISPOSED'
  | 'CONFIG_INVALID'
  | 'PLUGIN_DUPLICATE'
  | 'PLUGIN_DEPENDENCY_MISSING'
  | 'PLUGIN_INSTALL_FAILED'
  | 'APP_INITIALIZATION_FAILED'
  | 'APP_DISPOSE_FAILED'
  | 'UI_ADAPTER_MISSING'
  | 'ADAPTER_MISSING'
  | 'LAYER_DUPLICATE'
  | 'LAYER_TYPE_NOT_FOUND'
  | 'LAYER_TYPE_DUPLICATE'
  | 'LAYER_NOT_FOUND'
  | 'DATASET_NOT_FOUND'
  | 'DATASET_DUPLICATE'
  | 'DATA_LOAD_FAILED'
  | 'SEARCH_FAILED'
  | 'DATA_PROCESSOR_NOT_FOUND'
  | 'DATA_PROCESSOR_DUPLICATE'
  | 'TOOL_NOT_FOUND'
  | 'TOOL_DUPLICATE'
  | 'TOOL_ACTIVATION_FAILED';

export class GISRuntimeError extends Error {
  readonly code: GISRuntimeErrorCode;
  readonly stage?: string;
  readonly detail?: unknown;
  override readonly cause?: unknown;
  readonly cleanupErrors?: readonly unknown[];

  constructor(options: {
    code: GISRuntimeErrorCode;
    message: string;
    stage?: string;
    detail?: unknown;
    cause?: unknown;
    cleanupErrors?: readonly unknown[];
  }) {
    super(options.message, { cause: options.cause });
    this.name = 'GISRuntimeError';
    this.code = options.code;
    this.stage = options.stage;
    this.detail = options.detail;
    this.cause = options.cause;
    this.cleanupErrors = options.cleanupErrors;
  }
}
