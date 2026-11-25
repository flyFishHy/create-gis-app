import type { DataService, DataSet, DataSourceConfig, ResourceScope } from '@joinmap/gis-core';

export function loadOwnedDataSet<T>(
  data: DataService,
  resources: ResourceScope,
  source: DataSourceConfig & { readonly id: string }
): Promise<DataSet<T>> {
  const id = source.id;
  const existing = data.get(id);
  const loading = data.load<T>(source);
  // DataService reserves the instance synchronously, even if the load later fails.
  const owned = existing === undefined ? data.get(id) : undefined;
  if (owned) {
    resources.add(() => {
      if (data.get(id) === owned) {
        return data.remove(id);
      }
    });
  }
  return loading;
}
