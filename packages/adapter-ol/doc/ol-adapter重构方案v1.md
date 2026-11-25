# create-gis-app · adapter-ol 架构重构详细设计

**版本：V2.0**

**适用范围：** `@joinmap/adapter-ol`

**设计目标：** 在保留当前功能、公开 API 和 Core 契约的基础上，重新组织 OpenLayers 适配层，实现职责清晰、模块独立、能力可组合、易于扩展的架构。

---

# 1. 背景与现状

## 1.1 当前目录

```text
adapter-ol/src/
├── index.ts
├── ol-adapter.ts
├── ol-tools.ts
├── tool-targets.ts
├── measurement-display.ts
├── selection-highlight.ts
└── feature-reference.ts
```

目前主要存在以下问题：

1. `ol-adapter.ts` 同时承担地图创建、图层创建、图层能力、数据处理、地图事件等职责。
2. XYZ、GeoJSON 等图层实现集中在一个文件中，增加图层类型需要持续修改这个文件。
3. GeoJSON 的数据装载、字段、时间、搜索、数据同步等逻辑耦合在 `createVectorHandle()` 中。
4. `ol-tools.ts` 同时承担绘制、测量、交互管理、结果存储、结果同步和导入导出。
5. 图层内部能力难以复用，未来增加普通 Vector、WMS、WMTS、VectorTile 时容易出现重复代码。
6. 生命周期和订阅资源分散，容易出现重复监听和销毁不完整的问题。
7. 业务功能虽然已经拆出部分文件，但整体依赖关系尚未形成清晰边界。

**本次重构的核心不是增加更多抽象，而是将已经存在的职责合理分离。**

## 1.2 当前已有能力

必须保留以下功能。

### 地图能力

- Map 创建与销毁。
- View 管理。
- 地图定位。
- 地图尺寸管理。
- 地图事件监听。
- 图层增删与排序。
- Popup Overlay。
- 原生 OL Map 访问。

### 图层能力

- XYZ 图层。
- GeoJSON 图层。
- Group 图层组织。
- 图层显隐、透明度、zIndex。
- 图层样式。
- 图例过滤。
- 数据装载。
- 数据刷新与缓存失效。
- 字段能力。
- 时间维度与过滤。
- 元数据。
- 图层范围与定位。
- 数据同步。
- 要素搜索。
- 要素选择。

### 交互能力

- Feature HitTest。
- FeatureReference。
- Selection。
- SelectionHighlight。
- FeaturePicker Popup 定位。

### 工具能力

- 绘制点、线、面。
- 测量距离、面积、角度。
- Draw、Modify、Snap。
- 工具结果管理。
- 工具结果图层化。
- 目标图层解析。
- 默认结果 Group 自动创建。
- 测量标签显示。
- 结果导入导出。
- 结果删除、修改、清空。

---

# 2. 总体架构原则

## 2.1 保持三层职责

```text
@joinmap/gis-core
       │
       │ 定义契约、应用状态、图层管理
       ▼
@joinmap/adapter-ol
       │
       │ 实现 OpenLayers 地图和图层能力
       ▼
OpenLayers
```

`ui-vue` 通过 Core 的能力与 Adapter 协作，不应直接依赖 OpenLayers 内部实现。

### gis-core

负责：

- GIS Runtime。
- AppConfig。
- LayerService。
- LayerHandle 公共契约。
- 图层配置及状态。
- Selection。
- Search 契约。
- 时间能力契约。
- 工具命令及状态契约。

### adapter-ol

负责：

- OpenLayers Map、View。
- OL Layer、Source。
- OL 图层渲染。
- 数据装载和投影转换。
- OpenLayers 事件适配。
- 字段、时间、搜索等契约的引擎实现。
- HitTest、FeatureReference。
- 高亮渲染。
- 绘制和测量交互。
- OpenLayers Overlay 定位。

### ui-vue

负责：

- LayerManager。
- PropertiesPanel。
- FeaturePicker。
- Toolbar。
- Timeline。
- 其他 Vue UI 组件。

## 2.2 LayerHandle 是公共契约，不是内部管理器

LayerHandle 用于向 Core 暴露图层能力。

不应该把所有内部实现都放到 Handle 上。

例如：

```ts
handle.getFields?.()
handle.getTimeDimensions?.()
handle.search?.()
```

这些公共方法是否存在、名称和参数类型，以当前 Core 契约为准。

而以下内容不应该因为内部模块化就暴露到 Handle：

```ts
handle.invalidateFieldCache()
handle.rebuildSearchIndex()
handle.attachSourceEvents()
handle.getInternalFilterState()
```

它们属于 Adapter 内部实现。

**公共能力与内部实现必须区分。**

## 2.3 图层类型与图层能力分离

图层类型决定：

- 使用什么 OL Layer。
- 使用什么 OL Source。
- 如何加载数据。
- 支持哪些能力。

能力模块负责：

- 具体能力实现。
- 内部状态。
- 订阅与资源释放。

图层工厂负责组合它们。

不为每个能力创建独立的插件注册体系。

## 2.4 优先组合，不依赖继承层级

不建议设计：

```text
BaseLayer
  └── DataLayer
       └── VectorLayer
            └── SearchableLayer
                 └── TimeAwareLayer
                      └── GeoJSONLayer
```

推荐：

```text
GeoJSONLayerFactory
       │
       ├── BaseHandle
       ├── VectorSource
       ├── Fields
       ├── Time
       ├── Filters
       ├── Search
       └── Sync
```

以普通函数和内部对象组合为主。

---

# 3. 推荐目录结构

```text
adapter-ol/
└── src/
    ├── index.ts
    ├── ol-adapter.ts

    ├── map/
    │   ├── ol-map-adapter.ts
    │   ├── map-view.ts
    │   └── map-events.ts
    │
    ├── layers/
    │   ├── common/
    │   │   └── layer-handle.ts
    │   │
    │   ├── xyz/
    │   │   └── xyz-layer.ts
    │   │
    │   ├── geojson/
    │   │   ├── geojson-layer.ts
    │   │   └── geojson-source.ts
    │   │
    │   └── vector/
    │       ├── vector-runtime.ts
    │       ├── vector-fields.ts
    │       ├── vector-time.ts
    │       ├── vector-filters.ts
    │       ├── vector-search.ts
    │       └── vector-sync.ts
    │
    ├── interaction/
    │   ├── hit-test.ts
    │   ├── feature-reference.ts
    │   └── selection-highlight.ts
    │
    ├── overlay/
    │   └── popup-overlay.ts
    │
    └── tools/
        ├── ol-tools.ts
        ├── draw-tool.ts
        ├── measure-tool.ts
        ├── tool-results.ts
        ├── tool-targets.ts
        └── measurement-display.ts
```

**注意：以上是目标职责目录，不要求机械地创建所有文件。**

拆分原则：

1. 文件有明确独立职责。
2. 模块之间存在合理依赖方向。
3. 能够独立测试。
4. 有复用价值，或者原文件复杂度确实需要拆分。
5. 避免为了减少文件行数而制造大量只有几行代码的文件。

此外：

- 如果当前 Group 仅由 Core 管理，不需要单独新增 `group-layer.ts`。
- 如果某种数据加载方式并不复杂，可以将 `geojson-source.ts` 合并到 `geojson-layer.ts`。
- 不要求所有图层目录都具有完全相同的文件结构。

---

# 4. 模块依赖关系

推荐依赖方向：

```text
ol-adapter.ts
      │
      ▼
map/ol-map-adapter.ts
      │
      ├── map-view.ts
      ├── map-events.ts
      │
      ├── layers/
      │     ├── common/
      │     ├── xyz/
      │     ├── geojson/
      │     └── vector/
      │
      ├── interaction/
      │     ├── hit-test
      │     ├── feature-reference
      │     └── selection-highlight
      │
      └── overlay/
            └── popup-overlay


tools/ol-tools.ts
      │
      ├── draw-tool
      ├── measure-tool
      ├── tool-results
      ├── tool-targets
      └── measurement-display
```

必须遵守：

- `layers/` 不依赖 `tools/`。
- `layers/` 不依赖 `ui-vue`。
- `interaction/` 不依赖 Vue UI。
- `tools/` 可以通过已有接口访问图层，但不反向修改图层实现。
- `map/` 负责协调，不包含具体图层业务算法。
- `gis-core` 不依赖 OpenLayers。
- 避免通过各目录的 `index.ts` 间接形成循环依赖。

---

# 5. ol-adapter.ts：插件装配入口

## 5.1 职责

`ol-adapter.ts` 只负责：

1. `createOLAdapter()`。
2. 插件安装。
3. 注册现有图层类型。
4. 创建 OLMapAdapter。
5. 按现有机制安装绘制和测量工具。
6. 保持 `useOLMap()` 等访问入口。

不再负责：

- 直接创建 XYZ Source。
- 解析 GeoJSON。
- 字段推断。
- 时间计算。
- 图层搜索。
- HitTest。
- Popup 定位。
- 绘制和测量实现。

## 5.2 装配方式

示意代码：

```ts
export function createOLAdapter(
  options: OLAdapterOptions = {}
) {
  return {
    install(app: GISApp) {
      // 注册地图适配器
      registerOLMapAdapter(app, options)

      // 注册已有图层类型
      registerXYZLayer(app)
      registerGeoJSONLayer(app)

      // 按当前既有机制注册工具
      installOLToolsIfNeeded(app)
    }
  }
}
```

示例中的函数仅表达职责，实际应复用当前注册接口。

不需要新增一个通用的 `OLPluginRegistry`。

---

# 6. map/：地图适配器设计

## 6.1 OLMapAdapter

`OLMapAdapter` 继续实现 Core 的 `MapAdapter` 接口。

保留现有方法：

- `create()`。
- `destroy()`。
- `locate()`。
- `getView()`。
- `getViewState()`。
- `onViewChange()`。
- `getSize()`。
- `updateSize()`。
- `setTarget()`。
- `addLayer()`。
- `removeLayer()`。
- `setLayerOrder()`。
- `addPopupOverlay()`。
- `onPointerMove()`。
- `getMap()`。
- `getWritableVectorLayer()`。

但大部分具体逻辑委托给对应模块。

例如：

```ts
class OLMapAdapter implements MapAdapter {
  locate(location: MapLocation) {
    return locateOLView(this.map, location)
  }

  addPopupOverlay(
    element: HTMLElement,
    anchor: Coordinate
  ) {
    return createPopupOverlay(
      this.map,
      element,
      anchor
    )
  }
}
```

具体签名必须以现有 Core 契约为准。

## 6.2 map-view.ts

负责：

- 创建 View。
- 投影和初始中心。
- 缩放限制。
- 获取 View 状态。
- 定位坐标或范围。
- View 变化订阅。
- rAF 节流。

图层定位不需要再次实现地图 View 逻辑。

推荐调用关系：

```text
LayerManager
    │
    ▼
获取图层 extent
    │
    ▼
app.map.locate(extent)
    │
    ▼
OLMapAdapter
    │
    ▼
map-view.ts
```

## 6.3 map-events.ts

负责：

- 地图单击。
- PointerMove。
- View 变化相关事件。
- 地图交互状态检查。
- 监听注册和解除。

地图点击时：

```text
地图点击
   │
   ▼
检查工具是否占用交互
   │
   ├── 是 → 由当前工具处理
   │
   └── 否
         │
         ▼
       HitTest
         │
         ▼
       Core Selection / 候选选择流程
```

地图事件模块不应直接操作 Vue 组件。

---

# 7. layers/：图层系统

这是本次重构的重点。

推荐结构：

```text
layers/
├── common/
│   └── layer-handle.ts
│
├── xyz/
│   └── xyz-layer.ts
│
├── geojson/
│   ├── geojson-layer.ts
│   └── geojson-source.ts
│
└── vector/
    ├── vector-runtime.ts
    ├── vector-fields.ts
    ├── vector-time.ts
    ├── vector-filters.ts
    ├── vector-search.ts
    └── vector-sync.ts
```

## 7.1 common/layer-handle.ts

只负责所有图层通用的基础行为。

例如：

- 图层 ID。
- 图层可见性。
- 透明度。
- zIndex。
- 基础状态。
- 基础元数据。
- 生命周期。

示意：

```ts
function createBaseLayerHandle(
  context: LayerContext,
  layer: BaseLayer,
  config: LayerConfig
): LayerHandle {
  // 映射当前 Core 的通用 LayerHandle 方法
}
```

特别注意：

**不要继续把字段、时间、搜索、数据同步、图例过滤等逻辑全部加入 `createBaseLayerHandle()`。**

否则只是换了一个文件继续维护巨型函数。

## 7.2 xyz/xyz-layer.ts

负责：

- 创建 XYZ Source。
- 创建 TileLayer。
- 加载 URL 配置。
- 应用已有图层通用配置。
- 数据源刷新。
- 生命周期释放。

XYZ 不需要：

- 字段推断。
- 要素搜索。
- Vector 数据同步。
- 时间字段识别。

不要为了统一结构给 XYZ 挂载空的字段、搜索方法。

## 7.3 geojson/geojson-layer.ts

负责：

1. 创建 GeoJSON 对应的 VectorSource。
2. 创建 VectorLayer。
3. 创建基础 LayerHandle。
4. 组合所需 Vector 能力。
5. 将能力映射到已有 Core 接口。
6. 统一管理图层资源释放。

这里是图层能力的主要装配入口。

不应该直接包含大量字段分析、时间计算和数据同步代码。

## 7.4 geojson/geojson-source.ts

仅负责 GeoJSON 数据源相关实现：

- URL 加载。
- Inline 数据初始化。
- GeoJSON 解析。
- 投影转换。
- 数据加载状态。
- 加载失败处理。
- 重新加载远程数据。

需要明确区别：

**远程 GeoJSON 数据源和内存绘制数据源的刷新语义不同。**

对内存绘制结果，不能因为调用刷新接口就清空用户已经绘制的数据。

---

# 8. Vector 能力采用什么设计模式？

## 8.1 最终选择：独立能力对象 + 显式装配

本次不强制采用：

```ts
handle = attachFields(handle)
handle = attachTime(handle)
handle = attachSearch(handle)
```

也不禁止函数式 attach。

推荐优先采用：

```ts
const fields = createVectorFields(context)

const filters = createVectorFilters(context)

const time = createVectorTime({
  ...context,
  fields,
  filters
})

const search = createVectorSearch({
  ...context,
  fields
})
```

能力模块独立创建内部 API。

最后由图层工厂将需要公开的方法映射到 LayerHandle。

## 8.2 为什么不全部使用 attach？

主要原因：

1. 不希望能力模块任意修改同一个 Handle。
2. 避免不同能力覆盖同一个方法。
3. 能力之间应通过显式 API 通信。
4. 内部方法不应该全部暴露给 Core。
5. 生命周期和初始化顺序需要可追踪。
6. 独立能力对象更容易测试。

## 8.3 允许使用 attach 的情况

如果只是向已有 Handle 增加少量确定的方法，可以使用：

```ts
attachPublicVectorMethods(handle, {
  fields,
  time,
  search
})
```

但这个函数仅负责公共接口映射，不实现字段、时间和搜索业务逻辑。

不要再开发：

- CapabilityRegistry。
- CapabilityManager。
- CapabilityProvider。
- 自动依赖注入容器。
- 能力动态发现系统。

当前普通 TypeScript 函数已经足够。

---

# 9. VectorRuntime 内部上下文

建议为多个 Vector 能力提供统一的内部上下文。

示意：

```ts
interface VectorRuntimeContext {
  layerId: string

  layer: VectorLayer

  source: VectorSource

  config: VectorLayerConfig

  app: GISApp
}
```

以上类型仅作说明，不要求照搬。

设计要求：

1. 只包含能力真正需要的依赖。
2. 不要通过全局变量查找 Map 或 App。
3. 不要把整个 OLMapAdapter 实例传给所有模块。
4. 能力模块之间通过明确的内部 API 依赖。
5. 不使用 `any` 规避类型检查。

如果某个模块只需要 Source 和配置，应使用更小的参数结构，而不是强制依赖完整 Context。

---

# 10. vector-fields.ts：字段能力

## 10.1 职责

字段能力负责：

- 读取显式字段定义。
- 推断 GeoJSON 属性字段。
- 提供字段名称和类型。
- 支持字段别名。
- 管理字段信息缓存。
- 数据变化后必要的字段信息更新。

## 10.2 推荐实现

```ts
function createVectorFields(
  source: VectorSource,
  config: VectorLayerConfig
) {
  function getFields() {
    // 读取配置或推断字段
  }

  function invalidate() {
    // 清理内部字段推断缓存
  }

  return {
    getFields,
    invalidate
  }
}
```

这里：

- `getFields()` 可以映射到 Core 现有接口。
- `invalidate()` 仅为内部方法。

## 10.3 设计要求

- 优先采用显式 Schema。
- 没有显式 Schema 时按当前规则推断。
- 不要每次调用都扫描全部 Feature。
- 不要每次地图渲染都做字段推断。
- 数据增加或清空时按实际情况使缓存失效。
- 保留现有字段结果与类型推断语义。

字段定义如果完全不依赖 OpenLayers，应尽量提取为纯数据函数；只有 Feature 属性读取和 Source 监听留在 Adapter。

---

# 11. vector-time.ts：时间能力

## 11.1 职责

负责：

- 时间字段识别。
- 时间维度推断。
- 时间值解析。
- 时间范围计算。
- 时间过滤条件管理。
- 与当前 Core 时间契约对接。

保留当前已有的：

- `timestampValue()`。
- `detectTimeDimensions()`。

可根据职责迁移到时间模块。

## 11.2 不负责

不负责：

- Timeline Vue UI。
- TimePicker Vue UI。
- 复杂播放控制器。
- 独立地图时钟。
- 时间任务调度框架。

## 11.3 推荐结构

```ts
function createVectorTime(options: {
  source: VectorSource
  fields: VectorFields
  filters: VectorFilters
  config: VectorLayerConfig
}) {
  function getDimensions() {
    // 返回时间维度
  }

  function applyTime(time: number) {
    // 更新本图层的时间过滤条件
  }

  return {
    getDimensions,
    applyTime
  }
}
```

如果 Core 已经有其他时间方法，使用已有契约映射，不要新增重复 API。

## 11.4 关键原则

**时间能力不应该直接覆盖 Layer 的 StyleFunction。**

原因是同一个图层还可能启用：

- 图例过滤。
- 字段过滤。
- 业务样式。

时间过滤应该通过统一的过滤模块组合，而不是和图例过滤互相覆盖。

---

# 12. vector-filters.ts：统一过滤机制

这是本次能力拆分中需要重点考虑的模块。

## 12.1 为什么需要？

一个 GeoJSON 图层可能同时支持：

- 时间过滤。
- 图例过滤。
- 业务条件过滤。

如果每个能力独立执行：

```ts
layer.setStyle(...)
```

就容易出现后设置的样式覆盖前面的样式。

所以应该统一管理过滤状态和最终渲染判断。

## 12.2 推荐设计

内部维护过滤条件：

```ts
interface VectorFilterState {
  time?: (feature: Feature) => boolean

  legend?: (feature: Feature) => boolean

  custom?: (feature: Feature) => boolean
}
```

示意：

```ts
function createVectorFilters() {
  const filters: VectorFilterState = {}

  function matches(feature: Feature) {
    return (
      (!filters.time || filters.time(feature)) &&
      (!filters.legend || filters.legend(feature)) &&
      (!filters.custom || filters.custom(feature))
    )
  }

  return {
    filters,
    matches
  }
}
```

这里的 `matches` 仅表示过滤组合逻辑。

实际渲染时应复用现有样式系统，在统一的 StyleFunction 中进行过滤判断。

不要让多个能力分别覆盖图层的 StyleFunction。

## 12.3 注意事项

过滤可以有不同语义：

1. 只影响地图渲染。
2. 同时影响 HitTest。
3. 同时影响要素搜索。
4. 同时影响属性统计。

不能默认所有操作都必须使用同一过滤结果。

V1 应优先保持当前项目已有的图例、时间和搜索过滤语义，不因为重构而改变业务行为。

如果后续需要统一“当前可见要素”的概念，再明确其公共契约。

## 12.4 性能要求

过滤函数可能在渲染过程中高频执行。

因此：

- 不要在每个 Feature 的 StyleFunction 中重新解析时间字段定义。
- 不要每次过滤都重新扫描全部数据。
- 条件变化时只更新必要状态。
- 尽量复用已有 Style 对象和字段解析结果。
- 不要创建大量临时对象。

---

# 13. vector-search.ts：要素搜索

## 13.1 职责

负责已加载 VectorSource 内的要素查询。

例如：

- 按名称搜索。
- 按字段匹配。
- 返回标准化 Feature 引用。
- 返回搜索结果标题和必要属性。
- 结合当前配置选择可搜索字段。

## 13.2 推荐实现

```ts
function createVectorSearch(options: {
  source: VectorSource
  fields: VectorFields
}) {
  function search(keyword: string) {
    // 根据现有搜索契约执行查询
  }

  return {
    search
  }
}
```

## 13.3 与 Core Search 的关系

需要区别：

**图层搜索**

```text
GeoJSON VectorSource
       │
       ▼
Vector Search
       │
       ▼
FeatureSearchResult
```

**外部搜索**

```text
app.search
    │
    ▼
SearchProvider
    │
    ▼
地名服务 / 业务 API
```

图层搜索与外部搜索可以通过现有 Core 搜索契约协作，但不应在 Adapter 中重新创建一套 SearchManager。

## 13.4 性能要求

- 不在每次输入变化时无条件扫描几十万个 Feature。
- 支持现有的结果数量限制。
- 遵循当前异步搜索和取消约定（如果已有）。
- 对大规模数据是否建立索引，应根据实际数据规模决定。
- 不为 V1 强制引入新的全文搜索库。

---

# 14. vector-sync.ts：数据同步

这是本次重构风险最高的模块之一。

## 14.1 当前问题

目前 `ol-tools.ts` 包含：

- `sync()`。
- `attach()`。
- `write()`。
- 结果数据同步。
- GeoJSON 数据集写回。

需要明确这些逻辑与普通 Vector 图层的数据订阅之间是否重复。

## 14.2 设计目标

统一管理 VectorSource 与 Runtime 数据之间的变更同步。

但不允许直接假设所有图层都需要双向同步。

不同图层可能有不同数据所有权：

### 远程 GeoJSON

通常从远程数据装载，OL Source 保存当前加载的 Feature。

### 内存绘制图层

用户操作会直接修改 VectorSource。

### Runtime 数据集图层

如果当前 Core Dataset 是权威数据源，OL Source 应根据 Dataset 更新。

**必须先从现有代码确认数据所有权，不能在重构过程中擅自改变。**

## 14.3 推荐职责

`vector-sync.ts` 负责：

- Source 变更监听。
- 必要的数据变更通知。
- 数据集写回。
- 避免重复回写。
- 订阅解除。
- 结果数据与图层状态同步。

OpenLayers VectorSource 可监听：

```ts
source.on('addfeature', ...)
source.on('removefeature', ...)
source.on('changefeature', ...)
source.on('clear', ...)
```

实际使用时还需要考虑数据批量加载、Source 清空和异步替换。

## 14.4 防止循环同步

必须避免：

```text
OL Source 更新
      │
      ▼
Runtime Dataset 更新
      │
      ▼
OL Source 再次更新
      │
      ▼
Runtime Dataset 再次更新
```

推荐原则：

1. 首先确认每种图层的数据权威来源。
2. 将外部更新与内部回写区分开。
3. 尽量复用已有同步与批量更新机制。
4. 不用简单的全局布尔锁掩盖异步竞争。
5. 数据变化通知不能造成重复添加 Feature。
6. 订阅必须能随图层销毁解除。

如当前已存在可靠的数据同步机制，优先迁移和复用，而不是重写。

## 14.5 不扩大公开接口

不要为了拆分同步代码，直接向 LayerHandle 增加：

```ts
handle.sync()
handle.attachDataset()
handle.writeBack()
```

这些是否需要公开，应由 Core 已有数据契约决定。

内部同步模块可以只返回：

```ts
{
  dispose()
}
```

---

# 15. 数据装载、刷新与缓存失效

这三者不能简单视为同一种能力。

## 15.1 数据装载

负责：

- 创建 Source。
- 读取 URL 或 Inline 数据。
- 解析数据。
- 投影转换。
- 加载状态与错误处理。

应主要由具体 Source 模块实现。

## 15.2 数据刷新

负责重新获取或重新计算当前数据。

不同 Source 的处理方式不同：

- XYZ：刷新当前瓦片数据源。
- 远程 GeoJSON：重新加载数据。
- WMS：重新请求地图图像。
- 内存 Vector：需要明确刷新语义，不能误删数据。

尤其注意，OpenLayers `VectorSource.refresh()` 会清除当前 Feature 并根据加载策略重新加载，不能直接用它刷新内存绘制结果。

## 15.3 缓存失效

缓存可能包含：

- 浏览器 HTTP Cache。
- OpenLayers 内部 Tile Cache。
- 自定义 Cache Storage。
- IndexedDB。
- 应用层数据缓存。

调用 `source.refresh()` 不等于所有缓存都被清理。

建议：

**当前 adapter-ol 只负责已有数据源的刷新语义，具体持久化缓存策略由对应 Source 或缓存模块管理。**

不要把缓存失效做成所有图层必须支持的通用装饰器。

---

# 16. 元数据能力

元数据不建议独立设计为一个 `attachMetadata()` 模块。

## 16.1 静态元数据

例如：

- 图层 ID。
- 名称。
- 描述。
- 类型。
- 图层配置。

应使用 Core 中已有图层模型和 AppConfig。

## 16.2 动态元数据

例如：

- Feature 数量。
- 实际数据范围。
- 字段统计。
- 时间范围。
- 数据源加载状态。

由对应 Adapter 图层实现提供。

## 16.3 设计原则

不要在 Core 和 Adapter 中分别维护一套可以独立修改的图层元数据。

如果现有 LayerHandle 已经有 Metadata 方法，应继续沿用，并明确静态配置与动态计算结果的来源。

---

# 17. 图层定位能力

图层定位可以拆成两个职责。

## 17.1 图层提供范围

例如普通 VectorSource：

```ts
const extent = source.getExtent()
```

需要注意：

- 空数据源可能没有有效范围。
- 部分数据源可能没有完整数据范围。
- 瓦片图层不一定能够提供适合定位的业务范围。

## 17.2 Map 执行定位

继续使用：

```ts
app.map.locate(...)
```

不要在每种 Layer 内重复实现 View.fit、View.animate。

推荐：

```text
Layer.getExtent()
       │
       ▼
MapAdapter.locate()
       │
       ▼
OpenLayers View
```

实际方法名称遵循已有 Core API。

---

# 18. 图层工厂的最终装配方式

以 GeoJSON 为例。

## 18.1 目标

`createGeoJSONLayerHandle()` 只负责组织模块，而不是实现所有能力算法。

## 18.2 推荐伪代码

```ts
function createGeoJSONLayerHandle(
  ctx: LayerContext,
  config: GeoJSONLayerConfig
): LayerHandle {
  // 创建 Source 和 Layer
  const source = createGeoJSONSource(ctx, config)

  const layer = createOLVectorLayer(
    source,
    config
  )

  // 基础图层能力
  const base = createBaseLayerHandle(
    ctx,
    layer,
    config
  )

  // 内部数据能力
  const fields = createVectorFields(
    source,
    config
  )

  const filters = createVectorFilters()

  const time = createVectorTime({
    source,
    config,
    fields,
    filters
  })

  const search = createVectorSearch({
    source,
    fields
  })

  const sync = createVectorSync({
    ctx,
    source,
    config
  })

  // 映射至 Core 已有 LayerHandle 接口
  // 只映射当前公共契约中实际存在的方法
  const handle = createVectorPublicHandle({
    base,
    fields,
    time,
    search,
    filters
  })

  // 统一管理内部生命周期
  registerLayerCleanup(handle, [
    sync.dispose,
    time.dispose,
    filters.dispose,
  ])

  return handle
}
```

以上属于架构伪代码。

其中 `createVectorPublicHandle()` 和 `registerLayerCleanup()` 是职责示意，不要求新增同名函数。

如果现有 `createHandle()` 可以直接完成映射和清理，就复用现有实现。

## 18.3 装配原则

- Source 先创建。
- 基础 Handle 随图层创建。
- 字段模块先于依赖字段的能力。
- 过滤机制先于时间和图例过滤。
- 搜索可以显式依赖字段能力。
- 数据同步根据当前数据所有权决定初始化时机。
- 所有模块必须纳入同一个图层生命周期。
- 初始化失败需要清理已创建资源。

## 18.4 不要求所有 Vector 图层完全相同

例如普通内存 VectorLayer：

```ts
createVectorFields(...)
createVectorSearch(...)
createVectorSync(...)
```

可能不需要远程加载能力。

GeoJSON 图层：

```ts
createGeoJSONSource(...)
createVectorFields(...)
createVectorTime(...)
createVectorSearch(...)
```

根据当前配置选择能力。

XYZ 图层不需要创建这些 Vector 模块。

**不要通过一个巨型 `if/else` 自动装配所有图层能力。**

---

# 19. interaction/：地图要素交互

## 19.1 hit-test.ts

负责：

- 地图点击命中检测。
- 排除不可选择的图层。
- 排除内部高亮图层。
- 关联业务图层 ID。
- 候选去重。
- 转换 FeatureReference。
- 返回标准候选数据。

不负责：

- Vue Popup。
- 右侧 PropertiesPanel。
- 选中高亮样式。

## 19.2 feature-reference.ts

继续保留现有：

- `featureReferenceKey()`。
- `FeatureReferenceResolver`。
- `describeFeature()`。
- `findVectorFeature()`。

重点保证：

- 没有业务 ID 的 Feature 可以被引用。
- 避免不同图层的 Feature ID 冲突。
- 引用生命周期明确。
- 要素删除后不返回已失效的引用。
- VectorTile 等特殊数据不能简单假设存在稳定 `getId()`。

不要在各图层和工具模块中重复实现 Feature 查找逻辑。

## 19.3 selection-highlight.ts

继续使用当前 `OLSelectionHighlight`。

设计原则：

- Core Selection 是选中状态唯一来源。
- 使用独立 OL 高亮图层。
- 不直接覆盖业务 Feature 原始 Style。
- 高亮图层不参与普通业务图层排序。
- 高亮图层不参与 HitTest。
- 要素删除或不可选择时，按现有规则清除高亮。
- 释放时解除订阅和图层关联。

不新增第二套 SelectionManager。

---

# 20. overlay/：Popup Overlay

## 20.1 职责

保留当前：

```ts
addPopupOverlay(element, anchor)
```

并将具体 OpenLayers Overlay 定位实现放入：

```text
overlay/popup-overlay.ts
```

负责：

- 创建 OL Overlay。
- 绑定 DOM。
- 设置地图坐标。
- 边界避让。
- 更新位置。
- 隐藏和销毁。

## 20.2 与 FeaturePicker 的关系

```text
adapter-ol
  └── OpenLayers Overlay 定位

ui-vue
  └── FeaturePicker.vue
       └── 候选列表及用户操作
```

FeaturePicker 不应直接导入：

```ts
import Overlay from 'ol/Overlay.js'
```

Adapter 不应导入 Vue 组件。

## 20.3 不实现

- PopupManager。
- PopupRegistry。
- PopupProvider。
- 通用弹窗状态中心。

现有 Overlay 能力足够时，不新增类似接口。

---

# 21. tools/：绘制与测量工具

推荐目录：

```text
tools/
├── ol-tools.ts
├── draw-tool.ts
├── measure-tool.ts
├── tool-results.ts
├── tool-targets.ts
└── measurement-display.ts
```

## 21.1 ol-tools.ts

仅负责：

- `installOLTools()`。
- 工具注册。
- 工具激活与停用的协调。
- OLToolsController 装配。
- 工具生命周期。

保留现有公开工具：

- `measure-area`。
- `measure-angle`。
- `measure-distance`。
- `draw-point`。
- `draw-line`。
- `draw-polygon`。
- `modify-result`。
- `delete-result`。
- `clear-results`。

## 21.2 draw-tool.ts

负责：

- Draw Interaction。
- Modify Interaction。
- Snap Interaction。
- 绘制开始与完成。
- 几何修改。
- 交互停止与释放。

不负责：

- 创建 Group。
- 图层配置管理。
- 工具结果导入导出。
- PropertiesPanel。

## 21.3 measure-tool.ts

负责：

- 距离测量。
- 面积测量。
- 角度测量。
- 测量值计算。
- 几何修改后重新量算。

测量计算必须继续遵循当前投影和量算规则。

## 21.4 measurement-display.ts

沿用当前：

- `createMeasurementStyles()`。
- `watchMeasurementColor()`。
- `updateMeasurementLabels()`。
- `removeMeasurementLabels()`。
- 角度弧线。
- 分段测量标签。
- 标签位置避让。

**本次属于架构重构，不强制把现有 Overlay 测量标签改为 Vector Text Style。**

如果后续需要优化标签渲染，作为独立任务处理。

必须保证：

- 隐藏测量图层时测量标签的行为与图层一致。
- 删除测量结果时对应标签被清理。
- 修改几何后标签正确更新。
- 销毁地图时不遗留 Overlay。

## 21.5 tool-results.ts

负责现有工具结果：

- 查询。
- 选择。
- 删除。
- 修改几何。
- 结果同步。
- 导入导出。
- 数据集写回。
- 结果变化订阅。

继续保留当前 `OLToolsController` 对外 API。

需要特别核对 `OLToolsController.selected/select` 与 Core Selection 的关系，不允许出现两个互相冲突的权威选中状态。

## 21.6 tool-targets.ts

继续保留现有 `toolTargets(app, getLayer)`。

负责：

- 读取 `tools.draw.targets`。
- 读取 `tools.measure.targets`。
- 解析目标图层。
- 校验可写 VectorSource。
- 自动创建默认 Group。
- 自动创建默认结果子图层。
- 避免重复创建。
- 按当前约定处理错误。

没有指定 `targets` 时，按需创建：

```text
绘制结果
├── 绘制点
├── 绘制线
└── 绘制面

测量结果
├── 距离测量
└── 面积测量
```

保留现有内部默认 ID：

```text
ol-tools:draw
ol-tools:measure
```

以及实际已有的子图层 ID 规则。

工具结果图层继续使用普通图层体系，不创建独立的 ResultLayerManager。

## 21.7 避免重复添加 Feature

如果 OpenLayers Draw 已指定：

```ts
new Draw({
  source: targetSource,
  type: 'Polygon'
})
```

绘制完成时，不应再次调用：

```ts
targetSource.addFeature(feature)
```

`drawend` 可以用于补充 ID、元数据和完成前的必要处理；要注意其触发时机早于 Draw 自动将 Feature 加入目标 Source。

最终应确保一个绘制结果只写入一次。

---

# 22. 统一生命周期管理

这是架构重构必须解决的基础问题。

## 22.1 资源所有权

| 资源 | 所有者 |
|---|---|
| OL Map、View | OLMapAdapter |
| 地图事件监听 | Map Events |
| OL Layer、Source | 对应 LayerHandle |
| Vector 字段、时间、搜索订阅 | 对应图层内部模块 |
| Source 与 Dataset 同步 | Vector Sync |
| Draw、Modify、Snap | OL Tools |
| SelectionHighlightLayer | SelectionHighlight |
| Popup Overlay | Overlay Handle |
| Measurement Overlay | Measurement Display |

原则：

**谁创建长期资源，谁负责提供释放能力；由上层实际所有者决定最终释放时机。**

## 22.2 模块内部返回清理方法

例如：

```ts
function createVectorSync(options: SyncOptions) {
  const keys = registerSourceListeners(options)

  return {
    dispose() {
      unByKey(keys)
    }
  }
}
```

能力模块不需要继承共同的基类。

## 22.3 图层销毁

推荐：

```text
LayerHandle.dispose()
       │
       ├── 解除数据同步
       ├── 解除字段/时间监听
       ├── 清理缓存与临时资源
       ├── 释放内部能力
       └── 释放 OL Layer 相关资源
```

要求：

1. dispose 幂等。
2. 不重复释放共享资源。
3. 单个清理操作出错时，其余资源仍应尽量释放。
4. 异步任务在销毁后不能继续写入已释放对象。
5. 初始化中途失败，应回滚已创建资源。

可以使用内部清理函数数组，不需要 CapabilityManager。

## 22.4 Map 销毁

确保：

- 所有交互停止。
- 地图事件解除。
- rAF 取消。
- Overlay 清理。
- 高亮图层移除。
- 图层生命周期正常结束。
- 临时资源释放。
- Map Target 解除。

多次 mount/unmount 不应出现重复事件。

---

# 23. 性能设计要求

当前架构应避免引入不必要的运行时开销。

## 23.1 字段

- 优先显式配置。
- 推断结果缓存。
- 数据变化后按需失效。

## 23.2 时间

- 时间值避免在每帧重复解析。
- 过滤条件变化时更新必要状态。
- 不为静态图层安装无意义时间监听。

## 23.3 搜索

- 避免每次搜索都重新构建字段结构。
- 不在地图渲染回调中执行搜索。
- 大规模数据按实际情况引入索引。

## 23.4 数据同步

- 避免重复变更事件。
- 合理处理批量导入。
- 尽量避免全量重建 Source。
- 不在每次 Feature 变化时做无关的全量统计。

## 23.5 渲染

- 避免多个能力重复设置 StyleFunction。
- 过滤状态统一组合。
- 不在高频渲染路径创建大量临时对象。
- 高亮继续使用独立渲染图层。

**注意：本次重构的目标首先是保持性能不退化，而不是顺带重写大数据渲染方案。**

---

# 24. 扩展新图层类型的规范

未来新增：

- WMS。
- WMTS。
- VectorTile。
- Heatmap。
- 其他自定义图层。

应遵循以下原则。

## 24.1 每个图层有自己的创建入口

例如：

```ts
createWMSLayerHandle()
createWMTSLayerHandle()
createVectorTileLayerHandle()
```

实际名称遵循项目命名规范。

## 24.2 复用通用基础能力

例如：

- 显隐。
- 透明度。
- zIndex。
- 基础元数据。
- 生命周期。

## 24.3 可选择性复用其他能力

例如 WMS 可能具备：

- TIME 请求参数。
- GetFeatureInfo。
- Source Refresh。

但这些实现不一定能够复用 Vector 的时间过滤和本地要素搜索。

因此：

**复用共同契约，不强制复用不适合的实现。**

## 24.4 不修改地图生命周期代码

正常新增一种图层，应该主要修改：

1. 新图层的实现文件。
2. 图层类型注册入口。
3. 必要的测试。

不应要求修改 `OLMapAdapter` 的地图生命周期逻辑。

---

# 25. 公开 API 兼容要求

必须保留：

```ts
createOLAdapter
createOLLayerHandle
useOLMap
useOLTools
olTools
```

以及当前公开的：

```ts
OLAdapterOptions
OLToolResult
OLToolsController
```

注意：

- 这些 API 的现有类型、参数和行为应保持兼容。
- `createOLAdapter()` 的使用方式不变。
- 已有 LayerHandle 契约不随意扩展。
- 已有图层 Schema 不因拆文件而变更。
- 已有工具 ID 不变。
- 已有 FeatureReference 语义不变。
- 已有 Popup、Selection、高亮逻辑不变。
- 已有 `targets` 和默认结果图层逻辑不变。

内部实现可以移动，但从 `@joinmap/adapter-ol` 的既有导入路径应继续正常工作。

---

# 26. 分阶段重构计划

不要一次性重写整个 adapter-ol。

## 阶段 0：现状梳理和基线测试

先阅读：

- `gis-core` LayerHandle 契约。
- MapAdapter 契约。
- 当前 LayerService。
- 当前图层 Schema。
- `ol-adapter.ts`。
- `ol-tools.ts`。
- `tool-targets.ts`。
- 相关测试及 Demo。

输出：

1. 当前文件职责。
2. 现有能力清单。
3. 当前内部依赖关系。
4. 可复用代码。
5. 实际需要迁移的函数。
6. 当前测试和构建基线。

此阶段不改变公共 API。

## 阶段 1：基础地图与图层拆分

目标：

- 提取 `map/`。
- 提取 `layers/common/`。
- 提取 XYZ 创建逻辑。
- 提取 GeoJSON 创建逻辑。

验收：

- XYZ 正常显示。
- GeoJSON 正常加载。
- 地图生命周期正常。
- 图层显隐与排序正常。
- `ol-adapter.ts` 不再包含具体图层创建细节。

## 阶段 2：Vector 能力模块化

目标：

- 拆分 Fields。
- 拆分 Time。
- 拆分 Filters。
- 拆分 Search。
- 拆分 Sync。

采用独立内部能力对象和显式装配。

验收：

- 字段读取一致。
- 时间维度一致。
- 时间过滤正常。
- 图例过滤正常。
- 时间和图例过滤可以同时生效。
- 搜索结果一致。
- 数据同步无重复写入。
- 内存绘制数据不会被错误刷新清空。

## 阶段 3：交互与 Popup

目标：

- 拆分 HitTest。
- 保留 FeatureReference。
- 保留 SelectionHighlight。
- 独立 Popup Overlay 定位逻辑。

验收：

- 单要素点击正常。
- 多要素 FeaturePicker 正常。
- 高亮正常。
- Popup 位置正确。
- 不可选图层不会误触发选择。
- 组件销毁后无遗留资源。

## 阶段 4：绘制与测量

目标：

- 拆分工具装配。
- 拆分 Draw/Modify/Snap。
- 拆分量算。
- 拆分结果管理。
- 保留目标图层解析。
- 保留 MeasurementDisplay。

验收：

- 点线面绘制正常。
- 测距、测面积、测角正常。
- 结果正确写入目标图层。
- 默认 Group 按需创建。
- 工具结果可以选择、高亮和查看属性。
- 结果导入导出正常。
- 修改几何后结果正确更新。
- 停止工具不清空历史结果。

## 阶段 5：架构验证与收尾

执行：

- TypeScript 类型检查。
- 单元测试。
- 项目构建。
- 现有 Demo 验证。
- 循环依赖检查。
- 公共 API 兼容性检查。
- 资源释放检查。

删除迁移后不再使用的旧代码。

不为了文件数量继续过度拆分。

---

# 27. 测试设计

## 27.1 图层基础测试

- 创建 XYZ 图层。
- 创建 GeoJSON 图层。
- Inline 数据加载。
- URL 数据加载。
- 图层显隐。
- 透明度变化。
- zIndex 变化。
- 动态添加和删除图层。
- Group 子图层管理。
- 图层重复创建和销毁。

## 27.2 Vector 能力测试

- 显式字段定义。
- 字段推断。
- 字段缓存失效。
- 时间字段识别。
- 时间维度计算。
- 时间过滤。
- 图例过滤。
- 多条件组合过滤。
- 要素搜索。
- 数据增加和删除。
- Dataset 同步。
- 避免同步循环。
- 异步数据加载失败。

## 27.3 交互测试

- 空白地图点击。
- 单要素点击。
- 重叠要素点击。
- 不可选择图层。
- FeatureReference 查找。
- SelectionHighlight。
- 要素删除后清理选中。
- Popup 显示、隐藏和销毁。

## 27.4 工具测试

- 绘制点。
- 绘制线。
- 绘制面。
- 测量距离。
- 测量面积。
- 测量角度。
- Modify。
- Snap。
- 撤销上一点。
- 结果删除和清空。
- 结果导入导出。
- 显式 targets。
- 缺省 targets。
- 目标图层不可写。
- 不重复添加结果 Feature。
- 测量标签生命周期。

## 27.5 生命周期测试

至少验证：

1. 连续创建和销毁 Map。
2. 连续添加和移除 VectorLayer。
3. 重复激活和停止工具。
4. 卸载后不再接收 OL 事件。
5. 异步加载期间移除图层。
6. 数据订阅不重复注册。
7. Popup、SelectionHighlight 和 MeasurementOverlay 正确销毁。

---

# 28. 明确不做的事情

本次不做：

- 重写 `gis-core`。
- 修改 UI 布局系统。
- 重构 LayerManager。
- 新增 CapabilityRegistry。
- 新增 CapabilityManager。
- 新增复杂依赖注入容器。
- 新增第二套 LayerService。
- 新增 PopupManager。
- 新增 ResultLayerManager。
- 将所有能力强制改写为 attach 装饰器。
- 重新设计 Selection。
- 重新设计 FeaturePicker。
- 重写测量标签系统。
- 重写当前工具对外 API。
- 引入新的数据持久化体系。
- 为未来引擎预先设计复杂的跨引擎实现层。

本次核心任务是**现有代码的模块化与职责解耦**。

---

# 29. 最终架构决策

| 设计问题 | 决策 |
|---|---|
| 是否继续使用一个巨型 `ol-adapter.ts` | 否 |
| 是否按地图、图层、交互、工具划分目录 | 是 |
| 是否通过类继承实现所有图层 | 否 |
| 是否全面使用函数式 attach | 否 |
| 是否使用独立能力对象 | 是 |
| 是否允许简单 attach | 是 |
| 是否使用 CapabilityRegistry | 否 |
| 是否保留 LayerHandle 契约 | 是 |
| 是否让图层工厂负责能力装配 | 是 |
| 是否将数据装载视为 Source 职责 | 是 |
| 是否让时间和图例共享过滤机制 | 是 |
| 是否将 Sync 主要作为内部模块 | 是 |
| 是否复用 Core Selection | 是 |
| 是否复用普通图层管理工具结果 | 是 |
| 是否保持现有 API 兼容 | 是 |

最终结构：

```text
createOLAdapter()
       │
       ▼
OLMapAdapter
       │
       ├── Map / View
       ├── Map Events
       ├── Layer Management
       ├── Interaction
       └── Overlay


Layer Factories
       │
       ├── BaseLayerHandle
       │
       ├── XYZLayer
       │
       └── GeoJSONLayer
              │
              ├── Source
              ├── Fields
              ├── Filters
              ├── Time
              ├── Search
              └── Sync
                    │
                    ▼
            Core LayerHandle


OL Tools
       │
       ├── Draw
       ├── Measure
       ├── Modify / Snap
       ├── Result Management
       └── Target Resolution
                    │
                    ▼
             Existing Layers
```

---

# 30. Codex 实施指令

请基于当前 `create-gis-app` 代码仓库，按照本文档对 `@joinmap/adapter-ol` 进行实际架构重构。

## 执行要求

1. 先阅读真实源码、Core 契约、AppConfig Schema 和现有测试。
2. 当前设计文档是目标架构，不代表所有文件或接口已经存在。
3. 发现设计文档与真实代码不一致时，以保持现有契约和最小改动为优先原则。
4. 首先拆分地图与基础图层，其次拆分 Vector 能力，再拆分交互和工具。
5. 优先迁移现有实现，不要重新编写已有的稳定业务逻辑。
6. 使用独立内部能力对象和显式装配，不强制所有模块直接修改 LayerHandle。
7. 不创建 CapabilityManager、Registry 或重复状态中心。
8. 保持现有公共 API 和行为兼容。
9. 每个阶段完成后运行相关检查，避免一次性大规模修改。
10. 删除重构后无用的旧代码、重复实现和无效订阅。
11. 保持项目现有 TypeScript 和代码风格规范。
12. 不要顺带增加本次重构范围之外的新功能。

## 最终输出

完成后提供：

- 实际重构后的目录树。
- 原文件到新文件的主要迁移关系。
- 每个模块的职责说明。
- 当前 LayerHandle 能力装配方式。
- 公共 API 兼容情况。
- 类型检查、测试和构建结果。
- 尚未解决的问题和潜在风险。

**最终目标：让 adapter-ol 从集中式实现，演进为职责清晰、图层能力可复用、内部依赖明确、方便持续扩展的 OpenLayers 适配层，同时保持 create-gis-app 的整体架构简洁。**