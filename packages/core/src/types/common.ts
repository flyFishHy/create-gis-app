export type AppStatus =
  | 'created'
  | 'initializing'
  | 'ready'
  | 'mounted'
  | 'unmounted'
  | 'disposing'
  | 'disposed'
  | 'error';

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type ReadonlyJsonValue =
  JsonPrimitive | readonly ReadonlyJsonValue[] | { readonly [key: string]: ReadonlyJsonValue };

export type DeepReadonly<T> = [JsonValue] extends [T]
  ? ReadonlyJsonValue
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export type Unsubscribe = () => void;
