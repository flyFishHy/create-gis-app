# create-gis-app：Vue UI 插件职责收敛与 AppConfig 配置架构重构

## 一、任务背景

当前项目采用三个独立模块：

- `@joinmap/gis-core`：框架无关的 GIS Runtime，负责应用生命周期、统一配置和业务能力管理。
- `@joinmap/adapter-ol`：OpenLayers 地图引擎适配器，负责地图、图层和交互能力。
- `@joinmap/ui-vue`：Vue 3 UI 实现，负责布局、面板和用户交互界面。

项目目标是：**业务应用通过统一的 `appConfig` 配置 GIS 应用，不需要直接使用 Vue 开发，也不应该依赖具体地图引擎的实现细节。**

当前示例存在以下设计：

```ts
app.use(createVueUI({
  layout: 'docked-dashboard',
  defaults: {
    layerManager: true,
    legend: true,
    search: true,
    toolbar: true,
    popup: true,
  },
  legends: [
    // 具体图例业务数据
  ],
  searchProviders: [
    // 具体搜索业务逻辑
  ],
}))
```

但是在 `app.init(appConfig)` 中，又存在：

```ts
ui: {
  layout: 'docked-dashboard',
  theme: 'light',
  panels: [
    { id: 'search', visible: true, position: 'top' },
    { id: 'layer-manager', visible: true, position: 'left' },
    { id: 'legend', visible: true, position: 'left' },
    { id: 'toolbar', visible: true, position: 'top' },
  ],
}
```

这导致 UI 插件参数与应用配置混合，配置来源不统一。

本次任务需要重新审视并优化这部分架构，而不是仅仅移动几个字段。

## 已确认的 UI 独立引用修订

后续收敛决策：createOLAdapter 默认提供绘制和测量，createOLTools 不再公开或单独安装；tools:false 可关闭能力。createVueUI 内置基础工具栏、属性选择联动和状态栏，不要求 createOLToolsUI/createPropertiesUI/OLMapStatus。ol-vue 仅保留可选高级结果列表 createOLResultsUI。下文历史示例中的独立工具安装以本条为准。

本任务按与使用方确认后的边界实施：UI 可以独立配置必要默认参数，完整应用仍以
appConfig.ui 的显式字段为优先。createVueUI({ config }) 与 AppConfig 使用同一 UIConfig；
不是禁止 UI 接收配置，而是禁止维护两种等价、优先级不明确的配置和业务状态。

保留 config、panelDefinitions、layouts、extensions、toolbarItems 和自定义渲染组件等实现入口。
移除原顶层 layout/theme/defaults/panels/legends/searchProviders/kpis；defaults 由统一面板配置
替代，业务图例归 Layer Runtime，业务搜索归 app.search。以下“统一入口”指完整应用的权威
覆盖入口，不排除 UI 默认值。预设 < UI 默认 config < AppConfig 显式字段 < 当前交互状态。

GISWorkspace 为已有 Vue 宿主复用已安装/初始化的 UI Adapter；不另建服务，不创建嵌套 Vue App。
配置在 init 前通过 createVueUI({ config }) 提供，宿主通过 props 接收 app。
纯展示 Legend 支持 props 数据输入，Runtime LegendPanel 只读取图层快照。

## 二、核心设计目标

遵循以下原则：

1. `createGISApp()` 创建独立于 Vue 和 OpenLayers 的 GIS Runtime。
2. `app.use()` 用于安装能力插件，而不是提供当前应用的业务配置。
3. `app.init(appConfig)` 是声明式应用配置的统一入口。
4. Vue UI 插件负责渲染和交互，不负责保存独立的业务配置副本。
5. 静态图例归属于图层业务元数据，来自 `appConfig`。
6. 搜索 Provider 属于运行时业务能力，不归 Vue UI 插件管理。
7. 不同 UI 实现应该能够复用相同的地图、图层、图例和搜索能力。
8. 保持 API 简洁，避免重复状态、多层包装和不必要的 Manager / Registry / Service。
9. 尽量复用现有 Core、Adapter 和 UI 基础设施，不进行无关的大规模重构。

**核心原则：配置描述应用，插件提供能力，Runtime 管理状态，Adapter 执行地图操作，UI 负责展示。**

## 三、首先分析现有代码

在修改之前，请检查项目中的实际实现：

- `createGISApp()`、GIS App 类型和插件机制。
- `app.use()`、`app.init()`、`app.mount()` 的生命周期。
- 当前 `GISAppConfig`、`LayerConfig`、`UIConfig` 的类型。
- `createVueUI()` 当前参数类型和内部使用方式。
- Docked / Overlay 布局组件的配置来源。
- Panel 的创建、默认可见性和运行时状态。
- LegendPanel、图例数据存储与图层关联逻辑。
- SearchPanel、SearchProvider 和搜索执行逻辑。
- Core 与 UI Adapter 之间的数据和事件接口。
- 当前示例、测试和设计文档。

需要明确当前有哪些能力已经存在，哪些需要补充。

不要假设下面建议的 API 已经存在；先确认现状，再按照目标进行最小必要的调整。

## 四、重新定义 createVueUI() 的职责

### 4.1 目标 API

对于普通应用，应该可以直接使用：

```ts
app.use(createOLAdapter())
app.use(createVueUI())
```

不要求在 `createVueUI()` 中提供应用布局、面板可见性、图例或搜索 Provider。

### 4.2 Vue UI 插件应该负责什么

Vue UI 插件主要负责：

- 安装 Vue UI 渲染实现。
- 注册内置面板组件。
- 提供 Docked / Overlay 布局实现。
- 建立 UI 与 Core Runtime 的连接。
- 在 `mount()` 时创建界面。
- 响应 Runtime 状态变化。
- 在 `dispose()` 时清理 Vue UI 资源。

### 4.3 Vue UI 插件不应该负责什么

以下数据不应以原顶层业务参数放入 `createVueUI()`；布局、面板、主题可以作为统一 `config: UIConfig` 的默认值：

- 当前应用使用哪一种布局。
- 当前应用哪些面板默认显示。
- 图层关联的具体图例数据。
- 当前项目的搜索业务实现。
- 地图中心点、级别、投影。
- 地图图层配置。
- 应用主题等声明式配置。

应用显式配置由 `appConfig` 管理，UI 默认配置由统一 config 提供；图层图例及搜索业务由 Runtime 管理。

### 4.4 是否保留 createVueUI(options)

允许保留可选参数，但只能用于插件实现层面的扩展，例如自定义 UI 组件注册或渲染集成能力。

不要为了保留扩展性，提前设计大量不确定的 options。

当前没有明确需求时，优先采用：

```ts
createVueUI()
```

## 五、统一 UI 配置入口

### 5.1 UIConfig 来自 appConfig

目标使用方式：

```ts
await app.init({
  map: {
    projection: 'EPSG:3857',
    center: [0, 0],
    zoom: 2,
  },
  layers: [],
  ui: {
    layout: 'docked-dashboard',
    theme: 'light',
    panels: [
      { id: 'search', visible: true },
      { id: 'layer-manager', visible: true },
      { id: 'legend', visible: true },
      { id: 'toolbar', visible: true },
      { id: 'popup', visible: true },
    ],
  },
})
```

`appConfig.ui` 是完整应用布局、主题和声明式面板配置的权威覆盖入口；UI 可以提供同结构的默认 config，初始化时统一合并。

### 5.2 删除重复的 defaults

不再要求：

```ts
defaults: {
  layerManager: true,
  legend: true,
  search: true,
}
```

因为：

```ts
ui: {
  panels: [
    { id: 'legend', visible: true },
  ],
}
```

已经能够表达相同需求。

避免同时存在 `defaults.legend` 和 `panels[id=legend].visible` 两套状态。

### 5.3 布局预设的默认值

建议保留：

```ts
layout: 'docked-dashboard'
```

以及：

```ts
layout: 'overlay-dashboard'
```

每个布局预设可以提供自己的默认面板位置和排列方式。

例如：

- Docked：面板在地图容器之外，占据布局空间。
- Overlay：面板悬浮在地图上方。

`ui.panels` 中的配置应当作为显式覆盖。

优先级：

```text
布局预设默认值
    ↓
appConfig.ui.panels 显式覆盖
    ↓
Runtime 中用户交互产生的当前状态
```

其中 Runtime 当前状态不是第二份静态配置，而是配置初始化之后产生的实时状态。

没有显式配置 `position` 时，使用布局预设位置。

例如：

```ts
{
  id: 'legend',
  visible: true,
}
```

不需要强制写：

```ts
{
  id: 'legend',
  visible: true,
  position: 'left',
}
```

需要考虑不同布局支持的面板位置可能不同，应由布局实现处理或校验，不应该将不兼容的位置静默应用到 DOM。

### 5.4 未声明的面板如何处理

需要确定明确规则，推荐：

- 默认内置面板由布局预设定义。
- `ui.panels` 作为覆盖，而不是要求枚举全部面板。
- 可以通过 `visible: false` 隐藏预设面板。
- 对于非预设但已注册的扩展面板，可以通过 `ui.panels` 显式启用。
- 未注册的面板应输出清晰诊断信息，不应直接导致整个地图初始化失败。

不能让 UI 插件与 AppConfig 各自维护一套面板默认值。

## 六、重新设计图例配置

### 6.1 图例应该来自 appConfig

当前：

```ts
app.use(createVueUI({
  legends: [
    {
      id: 'cities-legend',
      layerId: 'cities',
      title: 'Cities',
      type: 'category',
      items: [],
    },
  ],
}))
```

不合理。

图例与 Vue UI 插件没有本质依赖关系。

图例是地图图层的语义信息，即使未来使用 React、原生 HTML 或无 UI 模式，这些图例数据依然有意义。

### 6.2 推荐优先采用图层级 legend

目标配置：

```ts
const appConfig = {
  map: {
    projection: 'EPSG:3857',
    center: [0, 0],
    zoom: 2,
  },

  layers: [
    {
      id: 'states',
      type: 'geojson',
      title: 'US States',
      visible: true,

      source: {
        type: 'url',
        url: 'https://openlayers.org/data/vector/us-states.json',
      },

      legend: {
        type: 'category',
        title: 'States',
        items: [
          {
            id: 'state',
            label: 'State',
            color: '#2563eb',
            symbol: 'fill',
          },
        ],
      },
    },
  ],
}
```

上述 `legend` 类型是目标 API 示例，具体 symbol 枚举需要结合现有实现确定。

注意示例中的数据是美国州界面数据，属于 Polygon/MultiPolygon，不应该继续把它当成 City Point 展示。应当确保图例符号和实际地图样式一致。

### 6.3 为什么优先放在 LayerConfig 中

原因：

- 图例天然关联图层。
- 添加图层时可以携带图例。
- 移除图层后可以自动清理图例。
- 图层名称变化可以反映到图例。
- 图层显隐可以影响图例展示。
- 动态创建图层时可以同时创建图例。
- Core 不需要依赖 Vue 才能读取图例信息。

推荐由 Core 定义与 Vue 无关的图例数据契约。

例如：

```ts
interface LegendItem {
  id: string
  label: string
  color?: string
  symbol?: string
}

interface LegendDefinition {
  title?: string
  type: 'category' | 'continuous'
  items?: LegendItem[]
}
```

以上仅作为最小设计方向，具体类型应以现有图例实现为基础扩展。

不必为了本次任务实现所有图例类型。

### 6.4 是否需要顶层 legends

当前不强制增加：

```ts
appConfig.legends = []
```

图层级 `legend` 可以满足大部分基础场景。

如果代码库已有独立的、非图层关联图例需求，可保留顶层定义，但必须明确职责并避免同一个图例被配置两次。

不要同时要求：

```ts
layers[0].legend
```

和：

```ts
appConfig.legends
```

都必须存在。

### 6.5 图例如何传递给 UI

推荐数据流：

```text
appConfig.layers[].legend
          ↓
Core Layer Runtime
          ↓
图层状态 / 图例数据快照
          ↓
UI Adapter
          ↓
Vue LegendPanel
```

LegendPanel 不再从 `createVueUI({ legends })` 获取数据。

UI 应从 Runtime 获取图例信息，并订阅相关状态变化。

具体实现优先复用现有图层状态通知机制，避免再维护一套独立、重复的 Vue 图例数据源。

### 6.6 图例与图层状态联动

至少支持：

1. 图层添加后显示关联图例。
2. 图层移除后清理关联图例。
3. 图层显隐变化时正确更新图例展示。
4. 图层配置更新后同步图例。
5. 图例项有稳定 ID，避免无意义的组件重建。

对于不可见图层，默认建议不显示关联图例；如当前产品要求显示但置灰，应统一确定规则。

### 6.7 动态图例

考虑后续可能存在：

- 按数据分类生成图例。
- 用户切换指标后修改图例。
- 专题渲染动态改变颜色分级。
- WebGL 专题图层动态更新图例。

因此不要把图例设计成只能从初始化 JSON 读取一次。

如果现有 LayerService 已经支持图层配置更新，可以通过更新图层元数据完成动态图例更新。

如果现有机制无法支持，再考虑增加最小的运行时图例更新 API。

不要为了未来需求提前引入复杂的 LegendManager、LegendRegistry 和多层 Provider 系统。

## 七、重新设计 SearchProvider

### 7.1 当前问题

现在搜索能力通过下面方式传入：

```ts
app.use(createVueUI({
  searchProviders: [
    {
      id: 'sample-cities',
      async search({ keyword, signal }) {
        return []
      },
    },
  ],
}))
```

这实际上让 Vue UI 插件管理搜索业务。

但搜索并不是 Vue 独有的能力。

例如：

- 地图 Toolbar 可以触发搜索。
- AI Agent 可以调用搜索能力。
- 业务代码可以直接执行搜索。
- 未来可能存在 React UI。
- 没有 UI 时仍然可能需要搜索服务。

因此，搜索能力应该与 Vue UI 解耦。

### 7.2 目标方式

推荐提供 Core 层可调用的搜索接口：

```ts
app.search.registerProvider({
  id: 'sample-cities',

  async search({ keyword, signal }) {
    if (signal?.aborted || !keyword.trim()) {
      return []
    }

    return [
      {
        id: 'demo-city',
        title: `Demo result: ${keyword}`,
        coordinate: [0, 0],
      },
    ]
  },
})
```

此 API 为目标设计，并不表示当前代码中一定已经存在。

先调查是否已有搜索 Service/Provider 机制。如果已有，直接复用。

如果没有，则设计一个足够简单的接口。

### 7.3 SearchService 的职责

建议仅包含：

- 注册搜索 Provider。
- 移除搜索 Provider。
- 查询当前可用 Provider。
- 执行搜索。
- 处理取消信号。
- 按既有 Runtime 错误处理机制暴露搜索异常。

可以参考：

```ts
interface SearchProvider {
  id: string

  search(context: {
    keyword: string
    signal?: AbortSignal
  }): Promise<SearchResult[]>
}

interface SearchResult {
  id: string
  title: string
  coordinate?: [number, number]
}
```

具体类型需要结合现有实现。

尤其需要明确 `coordinate` 的投影语义：由 Provider 声明坐标系，或约定统一坐标系，再由 Adapter 处理转换。不能在不同 Provider 之间隐式混用 EPSG:4326 和 EPSG:3857。

### 7.4 SearchPanel 的职责

SearchPanel 只负责：

- 输入搜索关键词。
- 提交搜索请求。
- 显示搜索结果。
- 取消失效请求。
- 展示 Loading / Empty / Error 状态。
- 在用户点击搜索结果时请求地图定位。

搜索业务本身由 Runtime 提供。

SearchPanel 不能直接依赖某个具体业务 Provider，也不应该要求使用方直接操作 Vue 组件实例。

### 7.5 搜索结果定位

建议分离：

```text
SearchPanel
    ↓
Core SearchService
    ↓
SearchProvider
    ↓
SearchResult
    ↓
用户选择结果
    ↓
Map Adapter
    ↓
地图定位
```

搜索服务不应该直接调用 OpenLayers 的 `map.getView().animate()`。

地图定位由已有地图控制接口或 Adapter 执行。

### 7.6 不需要搜索能力时

必须允许：

```ts
app.use(createVueUI())
```

而不注册任何 SearchProvider。

如果 SearchPanel 启用但没有 Provider，应显示明确的空状态或禁用搜索操作，不能制造虚假的搜索结果。

## 八、推荐的最终使用方式

期望用户代码能收敛为下面的形式。

### 8.1 应用入口

```ts
import { createGISApp } from '@joinmap/gis-core'
import { createOLAdapter } from '@joinmap/adapter-ol'
import { createVueUI } from '@joinmap/ui-vue'
import 'ol/ol.css'
import '@joinmap/ui-vue/style.css'

const app = createGISApp({
  id: 'basic-vue-example',
  name: 'GIS Runtime Example',
})

// 安装地图能力
app.use(createOLAdapter())

// 安装 UI 实现
app.use(createVueUI())

// 注册业务搜索能力
app.search.registerProvider({
  id: 'sample-search',

  async search({ keyword, signal }) {
    if (signal?.aborted || !keyword.trim()) {
      return []
    }

    return [{
      id: 'demo-result',
      title: keyword,
      coordinate: [0, 0],
    }]
  },
})

// 加载统一应用配置
await app.init(appConfig)

// 挂载应用
await app.mount('#app')
```

如果现有 Runtime 的生命周期不允许在 `init()` 前注册搜索 Provider，需要调整注册时机或提供兼容注册接口。不得破坏已有生命周期约束。

### 8.2 appConfig

```ts
export const appConfig = {
  map: {
    projection: 'EPSG:3857',
    center: [0, 0],
    zoom: 2,
  },

  layers: [
    {
      id: 'states',
      type: 'geojson',
      title: 'US States',
      visible: true,

      source: {
        type: 'url',
        url: 'https://openlayers.org/data/vector/us-states.json',
      },

      legend: {
        type: 'category',
        title: 'States',
        items: [
          {
            id: 'state',
            label: 'State',
            color: '#2563eb',
            symbol: 'fill',
          },
        ],
      },
    },
  ],

  ui: {
    layout: 'docked-dashboard',
    theme: 'light',

    panels: [
      { id: 'search', visible: true },
      { id: 'layer-manager', visible: true },
      { id: 'legend', visible: true },
      { id: 'toolbar', visible: true },
      { id: 'popup', visible: true },
    ],
  },
}
```

这里展示的是目标 API。

实现时需要校验图层类型、图例 symbol、样式配置和搜索能力是否被现有系统支持，不能仅修改示例而不实现对应功能。

## 九、Core、Adapter、Vue UI 的边界

### Core

负责：

- 应用生命周期。
- 统一应用配置。
- 图层业务元数据和 Runtime 状态。
- 图例数据契约。
- 搜索 Provider 管理和搜索执行。
- UI 与地图能力之间必要的抽象契约。

Core 不应该直接 import Vue 或 OpenLayers。

### OpenLayers Adapter

负责：

- 创建和管理 OL Map。
- 创建实际 OL Layer / Source。
- 响应 Core 图层状态。
- 执行地图定位。
- 实现实际地图交互。

Adapter 不应该负责 Vue Panel 的创建。

图例可以与渲染样式有关，但不应该因为图例要展示到 Vue 界面，就把具体 Vue 逻辑放进 OL Adapter。

### Vue UI

负责：

- Vue 组件和面板。
- Docked / Overlay 布局。
- 主题呈现。
- 图例 UI 展示。
- 搜索输入和结果 UI。
- Runtime 状态订阅和用户交互反馈。

Vue UI 不应该成为业务配置的第二个数据中心。

## 十、生命周期要求

请结合现有插件机制确定以下执行过程：

```text
createGISApp()
    ↓
app.use(createOLAdapter())
    ↓
app.use(createVueUI())
    ↓
注册运行时业务能力
    ↓
app.init(appConfig)
    ↓
Core 解析配置并建立运行时状态
    ↓
Adapter 初始化地图能力
    ↓
UI 获取配置和运行时状态
    ↓
app.mount('#app')
    ↓
用户交互 / 状态更新
    ↓
app.dispose()
```

这里只表达目标数据流，具体初始化顺序必须服从现有生命周期契约。

额外要求：

- `app.init()` 后添加的图层需要让 LegendPanel 正确更新。
- 运行时新增或移除 SearchProvider 应能被 SearchPanel 感知。
- 应用销毁时清理搜索订阅和 UI 状态监听。
- 防止重复安装插件导致重复注册。
- 不要为了解决配置问题重新发明完整的插件生命周期。

## 十一、兼容性和迁移

当前已有：

```ts
createVueUI({
  layout,
  defaults,
  legends,
  searchProviders,
})
```

重构时请检查全部调用位置。

需要：

1. 将 `layout` 迁移到 `appConfig.ui.layout`。
2. 将 `defaults` 迁移到 `appConfig.ui.panels` 或使用布局预设。
3. 将 `legends` 迁移到对应图层的 `legend` 元数据。
4. 将 `searchProviders` 迁移到 Runtime 搜索能力注册接口。
5. 更新 Demo、类型定义和相关文档。
6. 删除不再使用的重复配置和状态代码。

如果当前已经有正式发布的 API 使用者，可提供临时兼容处理和废弃提示。

如果项目仍处于内部开发阶段，优先直接收敛 API，不需要长期保留双配置入口。

**不能把旧参数和新参数长期并存为两个等价入口。**

## 十二、测试与验收标准

完成后至少验证以下场景：

- [ ] `app.use(createVueUI())` 不传任何参数可以正常安装。
- [ ] `appConfig.ui.layout` 可以切换 Docked / Overlay 布局。
- [ ] `appConfig.ui.panels` 可以控制面板可见性。
- [ ] 不配置 `position` 时使用布局预设位置。
- [ ] UI 插件不再要求传入 `legends`。
- [ ] 图层 `legend` 可以正确显示到 LegendPanel。
- [ ] 添加、移除和更新图层时，图例状态正确同步。
- [ ] 图层显隐与图例展示遵循统一规则。
- [ ] UI 插件不再直接管理 `searchProviders`。
- [ ] 注册 SearchProvider 后 SearchPanel 可以正常搜索。
- [ ] 没有 SearchProvider 时 SearchPanel 能正确处理。
- [ ] 搜索请求支持 AbortSignal，旧请求不能覆盖新结果。
- [ ] 搜索结果的坐标系处理正确。
- [ ] Core 不依赖 Vue 和 OpenLayers。
- [ ] OpenLayers Adapter 不依赖 Vue UI。
- [ ] 普通使用者不需要自己创建 Vue App。
- [ ] 重复初始化、卸载以及失败清理不产生额外监听或资源泄漏。
- [ ] TypeScript 检查通过。
- [ ] 相关示例可正常启动和运行。

## 十三、非目标

本次不要顺带实现：

- 全新的 UI 框架。
- React UI Adapter。
- 完整的图例设计器。
- 所有类型的专题图例。
- 复杂的搜索插件市场。
- 全新的全局事件总线。
- 与本任务无关的地图工具和绘制系统。
- 对所有 OpenLayers 原生 API 的重新封装。

此次任务聚焦于配置归属、模块职责和现有 Demo 的实际可用性。

## 十四、实现要求

请按以下顺序进行：

1. 阅读现有代码并明确当前实现。
2. 列出已有能力与目标设计之间的差异。
3. 给出最小必要的 API 调整方案。
4. 调整 Core 的类型和必要运行时能力。
5. 调整 Vue UI 插件参数与数据读取逻辑。
6. 调整 LegendPanel 和 SearchPanel。
7. 更新对应 Demo 和使用示例。
8. 添加或修改必要测试。
9. 执行可用的 TypeScript 检查、测试和构建。
10. 输出最终修改说明。

实现时优先沿用项目当前的编码规范和已有抽象。

不要因为设计中出现 SearchService、LegendDefinition 等概念，就机械地为每个概念新增一个独立类或文件。

如果现有 LayerService 或 Runtime 已经可以合理承担职责，直接复用即可。

## 十五、最终需要输出

请提供：

1. **现状分析**：当前 UI 插件、AppConfig、Legend、Search 的实际实现和主要问题。
2. **最终 API**：展示重构后的应用入口与完整配置示例。
3. **职责调整**：说明 Core、OL Adapter、Vue UI 各自发生了什么变化。
4. **代码修改**：列出实际修改的文件和关键实现。
5. **迁移情况**：说明哪些旧参数被移除或迁移。
6. **验证结果**：列出已运行的检查、测试和构建结果，以及未覆盖的问题。

最终应让业务应用能够以以下方式使用：

```ts
const app = createGISApp({ id: 'demo' })

app.use(createOLAdapter())
app.use(createVueUI())

app.search.registerProvider(searchProvider)

await app.init(appConfig)
await app.mount('#app')
```

其中：

- 插件只提供能力。
- AppConfig 提供声明式应用配置。
- 图例主要来自 LayerConfig。
- 搜索由 Runtime 能力提供。
- Vue UI 自动根据配置和运行时状态渲染。

**验收的关键不是 API 看起来更短，而是消除重复配置入口，并保证 Core、Adapter、UI 之间的边界真正清晰。**
