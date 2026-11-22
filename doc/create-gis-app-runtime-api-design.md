# create-gis-app Runtime API 设计规范

> **文档状态：** Architecture Proposal / v1\
> **项目定位：** 独立的 GIS Application Runtime，官方提供 Vue 3 +
> TypeScript UI 实现\
> **核心原则：** Runtime 独立于 UI 框架；OpenLayers 通过 Adapter
> 接入；配置、插件和运行时 API 使用统一的能力模型。

------------------------------------------------------------------------

## 1. 设计目标与非目标

### 1.1 项目定位

`create-gis-app` 不是 OpenLayers 的 Vue 封装，也不是 GIS Vue
组件库。它是一个负责组织、初始化、运行、扩展和销毁 GIS 应用的
**Application Runtime**。

Runtime 提供稳定的应用能力与扩展契约；地图引擎和 UI 是可替换的实现层：

-   **Runtime
    Core**：应用生命周期、上下文、状态、服务、插件、配置、资源管理。
-   **Map Adapter**：将 Runtime 的地图能力映射到 OpenLayers 等地图引擎。
-   **UI Adapter**：将 Runtime 的面板、工具栏、弹窗等 UI 声明映射到 Vue
    等 UI 框架。
-   **Plugins**：向 Runtime 注册图层类型、工具、面板、数据处理器和服务。
-   **Application Config**：描述应用初始地图、图层、面板、工具和数据源。

### 1.2 设计目标

1.  Runtime Core 不依赖 Vue、React、DOM 或具体地图引擎。
2.  以 `createGISApp()`
    创建应用实例；插件在初始化前安装；初始化和挂载职责分离。
3.  初始配置创建的图层与运行时动态添加的图层走同一条生命周期路径。
4.  插件注册的是可复用的类型和能力，不是某个具体应用中的实例。
5.  对外 API 明确、可类型检查、可被 AI 阅读和生成。
6.  OpenLayers 对象不进入 Runtime 的通用响应式状态，也不被深度代理。
7.  资源具有明确所有者和销毁时机；重复初始化、重复挂载、销毁后调用均有定义。
8.  核心 API 尽量少而稳定，复杂能力通过服务和插件扩展。

### 1.3 非目标

-   不在 Core 中实现地图渲染、空间计算或 OpenLayers 的全部 API。
-   不把 Runtime 做成通用前端框架或完整状态管理框架。
-   不要求所有项目使用 Vue，也不要求 Core 提供 UI 组件。
-   不将所有业务数据复制进全局 State。
-   不在 v1 中承诺跨地图引擎完全一致的全部底层能力。
-   不将业务特定的 KPI、时间序列、专题分析逻辑固化为 Runtime 必选模块。

------------------------------------------------------------------------

## 2. 架构边界

``` text
Application
  |
  +-- Runtime Core
  |     +-- Lifecycle
  |     +-- AppContext
  |     +-- Config Loader / Validator
  |     +-- Plugin Host
  |     +-- Service Container
  |     +-- State
  |     +-- Layer Service
  |     +-- Data Service
  |     +-- Interaction Service
  |     +-- Event Bus
  |     +-- Resource Scope
  |
  +-- Map Adapter (e.g. OpenLayers)
  |     +-- Map / View
  |     +-- Layer / Source
  |     +-- Feature interaction
  |
  +-- UI Adapter (official: Vue 3)
  |     +-- Layout
  |     +-- Search / Legend / Layer Manager
  |     +-- Toolbar / Popup / KPI / Time Controller
  |
  +-- Plugins
        +-- Layer types
        +-- Tools
        +-- Panels
        +-- Data processors
        +-- Services
```

### 2.1 依赖规则

  模块           可以依赖                           不应依赖
  -------------- ---------------------------------- -------------------------
  Runtime Core   TypeScript、平台基础能力           Vue、React、OpenLayers
  Map Adapter    Runtime 契约、地图引擎             Vue UI 组件
  Vue UI         Runtime 公共 API、Vue              OpenLayers 内部对象实现
  Core Plugin    Runtime 公共 API                   Vue、具体 UI
  UI Plugin      Runtime UI 契约、对应 UI Adapter   Runtime 私有实现
  Application    Core、所需 Adapter、插件           Core 内部文件路径

Core 不应通过 `import { ref } from 'vue'` 实现状态。若官方 Vue UI
需要响应式订阅，应由 Vue Adapter 将 Runtime 的状态订阅转换成 Vue
响应式数据。

### 2.2 运行时对象与配置对象

必须区分：

-   **Config**：可序列化的声明，描述"希望创建什么"。
-   **Runtime Instance**：实际创建的对象，具有状态、方法和资源。
-   **Definition / Registration**：插件注册的类型定义或工厂。
-   **Service**：跨组件/插件共享的能力入口。

不要把 OpenLayers 实例、DOM 节点、函数、循环引用对象放进
`appConfig.json`。

------------------------------------------------------------------------

## 3. 包与模块建议

建议先采用单仓库、多模块边界；不必第一天就拆成多个独立 npm
包。稳定后再按发布需求拆包。

``` text
packages/
  core/
    src/
      app/
      context/
      lifecycle/
      config/
      plugin/
      services/
      state/
      events/
      resources/
      types/
      index.ts
  adapter-ol/
    src/
      map/
      layers/
      interactions/
      index.ts
  ui-vue/
    src/
      app/
      panels/
      components/
      composables/
      adapters/
      index.ts
  plugins/
    layer-geojson/
    layer-wms/
    search/
    legend/
    layer-manager/
    toolbar/
examples/
docs/
```

推荐职责：

-   `core`：不依赖 UI 和地图引擎。
-   `adapter-ol`：唯一负责把 Runtime 地图契约落实到 OpenLayers 的模块。
-   `ui-vue`：官方 UI 实现，负责面板、布局和 UI 状态呈现。
-   `plugins/*`：按能力拆分，只有确实需要独立复用/发布时才拆包。

------------------------------------------------------------------------

## 4. 核心公共 API 总览

建议 v1 的主入口保持简洁：

``` ts
const app = createGISApp(options)

app.use(plugin)
app.init(config)
app.mount(target)

app.layers.add(layerConfig)
app.layers.remove(layerId)
app.layers.get(layerId)

app.state
app.map

app.unmount()
app.dispose()
```

其中：

-   `createGISApp()`：创建 Runtime 实例，不立即创建地图或 DOM。
-   `use()`：安装插件，完成能力注册。
-   `init()`：校验配置、解析依赖、创建地图和初始运行时资源。
-   `mount()`：将 UI Adapter 挂载到目标容器。
-   `layers`：动态管理图层；初始图层也通过同一 LayerService 创建。
-   `state`：只保存需要跨模块共享的轻量应用状态。
-   `map`：访问地图抽象接口；具体引擎实例通过 Adapter 的明确扩展 API
    获取。
-   `state`：仅在需要跨模块共享订阅状态时进入 v1；否则作为内部能力延后公开。
-   `unmount()`：卸载 UI，不销毁 Runtime 核心和地图资源。
-   `dispose()`：彻底释放 Runtime 及其拥有的资源。

### 4.1 创建应用

``` ts
import { createGISApp } from '@joinmap/gis-core'

const app = createGISApp({
  id: 'network-monitor',
  name: 'Network Monitor',
  debug: false,
})
```

建议类型：

``` ts
export interface GISAppOptions {
  /** 应用唯一标识；未提供时由 Runtime 生成 */
  id?: string
  /** 应用名称 */
  name?: string
  /** 调试日志开关 */
  debug?: boolean
  /** 错误处理入口 */
  onError?: (error: GISRuntimeError) => void
}
```

不要在 `createGISApp()` 中要求 `target`。创建 Runtime 与 UI
挂载目标不是同一个概念；同一个 Runtime 应能先初始化，再由 UI Adapter
挂载。

### 4.2 安装插件

``` ts
app.use(createOLAdapter())
app.use(createVueUI())
app.use(myLayerPlugin)
```

约定：

-   插件安装只允许发生在 `created` 阶段，默认不支持初始化后动态安装。
-   同一个插件实例重复安装应报错或安全忽略；建议 v1
    报明确错误，避免静默覆盖。
-   插件通过公开注册 API 注册能力，不直接修改 Runtime 私有对象。
-   插件可以声明依赖；Runtime 检查依赖是否存在。
-   插件安装顺序应由依赖关系决定，而不是依赖调用者记住隐式顺序。
-   插件安装失败时，Runtime
    回滚该插件已经注册的资源；整个应用保持可诊断状态。

插件契约：

``` ts
export interface GISPlugin<Options = unknown> {
  /** 全局唯一插件名 */
  name: string
  /** 插件版本，可选 */
  version?: string
  /** 必须先安装的插件 */
  dependencies?: string[]
  /** 安装插件并注册能力 */
  install(app: GISApp, options: Options | undefined, resources: ResourceScope): void
  onInit?(app: GISApp, options: Options | undefined): void | Promise<void>
}
```

`app.use()` 只在 `created` 阶段同步登记插件定义。`init()` 按依赖顺序执行同步
`install()`，并传入插件专属 ResourceScope；异步准备放入 `onInit()`。这样插件
安装失败时 Core 可以等待并完成该插件及此前资源的逆序清理。

工厂函数优于在插件对象上塞入可变配置：

``` ts
const plugin = createMyPlugin({
  endpoint: '/api',
})

app.use(plugin)
```

`app.use()` 可以返回 `this`
以支持链式调用，但异步插件安装时必须明确异步语义。推荐 API 为
`app.use()` 同步注册、插件的 `install()`
只允许同步执行；需要异步准备的工作放入 `app.init()`
生命周期钩子。这样避免链式调用中隐藏
Promise。若项目确定需要异步安装，则统一改为
`await app.use()`，不要混用两种语义。

**v1 推荐：** `use()` 同步登记插件定义；`init()` 按依赖顺序调用同步
`install(app, options, resources)`，异步初始化放在可选 `onInit()` 钩子，由
`app.init()` 等待。插件注册的扩展和监听必须绑定传入的插件 ResourceScope。

### 4.3 初始化

``` ts
await app.init(appConfig)
```

`init()` 负责：

1.  检查当前生命周期状态。
2.  校验并规范化配置。
3.  检查所需 Adapter、插件和注册类型。
4.  按依赖顺序执行插件初始化钩子。
5.  创建地图实例。
6.  创建初始图层、数据资源和工具定义。
7.  初始化 State 的初始值。
8.  发出 `app:ready` 事件。

**重要：初始图层必须通过 `app.layers.add()`
对应的同一内部路径创建**，不能另写一套只用于初始化的图层创建逻辑。

### 4.4 挂载 UI

``` ts
app.mount('#app')
```

建议将 `mount()` 定义为 UI Adapter 提供的能力，而不是 Core 自己操作
DOM：

``` ts
export interface UIMountAdapter {
  mount(target: Element | string): void | Promise<void>
  unmount(): void | Promise<void>
}
```

Adapter 插件在 `install()` 阶段通过框架无关的
`app.registerUIAdapter(adapter, resources)` 注册唯一 UI Adapter；Core 不依赖
Vue 类型，Adapter dispose 回调登记到插件 ResourceScope。

如果没有安装 UI Adapter，调用 `mount()` 应抛出明确错误。Runtime 仍可在无
UI 场景中运行，例如无头数据处理、自动化测试或由宿主应用自行呈现 UI。

### 4.5 销毁

``` ts
await app.unmount()
await app.dispose()
```

-   `unmount()`：只卸载 UI，允许再次 `mount()`。
-   `dispose()`：停止任务、销毁图层和数据资源、销毁地图、卸载插件资源、清理事件监听和引用。
-   `dispose()` 应幂等；重复调用不应重复释放或抛出无意义错误。
-   `dispose()` 后禁止 `init()`、`mount()`、`layers.add()`
    等操作；如需重新运行，创建新的 Runtime 实例。

------------------------------------------------------------------------

## 5. 生命周期状态机

建议公开状态：

``` ts
export type AppStatus =
  | 'created'
  | 'initializing'
  | 'ready'
  | 'mounted'
  | 'unmounted'
  | 'disposing'
  | 'disposed'
  | 'error'
```

状态转换：

``` text
created
  | init()
  v
initializing ---- failure ----> error
  |
  v
ready
  | mount()
  v
mounted
  | unmount()
  v
unmounted
  | mount()
  v
mounted

ready / unmounted / mounted / error
  | dispose()
  v
disposing
  |
  v
disposed
```

建议约束：

  当前状态                  操作             行为
  ------------------------- ---------------- -------------------------------------
  created                   use              允许
  created                   init             允许
  initializing              use/init/mount   拒绝
  ready                     mount            允许
  mounted                   mount            拒绝或返回当前挂载结果；v1 建议拒绝
  mounted                   unmount          允许
  unmounted                 mount            允许
  ready/unmounted/mounted   dispose          允许
  disposed                  任意写操作       抛出 `APP_DISPOSED`
  error                     dispose          允许清理

异步初始化需要支持失败清理。若 `init()`
中途失败，应销毁已经创建的资源，并保留原始错误及失败阶段信息。实例进入
`error` 后不可重试；调用者只能 `dispose()` 清理，再创建新实例。所有异步
生命周期操作必须串行化或使用操作令牌，拒绝过期操作提交状态，避免
`init()`、`mount()` 与 `dispose()` 并发造成竞态。

### 5.1 生命周期执行主体与清理顺序

生命周期由 GISApp 协调，具体工作委托给 Adapter 和各自的 ResourceScope：

1. `init()`：Core 校验配置并创建 Runtime 资源；Adapter 创建地图；LayerService
   通过统一路径创建初始图层。任一步失败时，按创建顺序的逆序清理已创建资源，
   保留首个失败作为主错误，并将清理错误附加为诊断信息。
2. `mount()`：GISApp 委托已注册 UI Adapter 创建并挂载 UI。失败时清理本次
   mount 已建立的 UI 资源，生命周期状态恢复为调用前的 `ready` 或 `unmounted`，
   允许修正挂载目标后重试。
3. `unmount()`：GISApp 委托 UI Adapter 卸载 UI 并解除地图容器 target；不销毁
   Runtime、地图或图层，成功后进入 `unmounted`，允许再次 `mount()`。
4. `dispose()`：GISApp 先确保 UI 已卸载，再按依赖的逆序释放图层、地图、插件
   资源和 Core 资源，最后进入 `disposed`。该操作幂等；清理过程尽量完成全部
   释放，汇总清理错误后报告，不以单个清理失败中断后续释放。

`unmount()` 或 `dispose()` 与其他生命周期操作并发时，后续操作排队执行；
已进入 `disposing` 后拒绝新的写操作。

------------------------------------------------------------------------

## 6. GISApp 公共接口

UI 表面和字体整理仅涉及 ui-vue：两种布局共享可调玻璃背景、玻璃属性构建兼容、局部字体缩放、统一控件高度及
状态栏避让均不改变 Runtime API、AppState 或 OL 能力。配置仍使用现有 theme token，
其余细分样式由 CSS 变量覆盖，不新增展示状态或服务。

当前 Core 内部实现按职责整理：`runtime/gis-app.ts` 保留服务装配及生命周期协调，
插件依赖排序提取为纯函数；`state/` 独立快照投影与 JSON 清洗，`data/` 分离 DataSet，
`config/` 分离 JSON/UI 校验，`types/` 按领域保存公共契约，`errors.ts` 保存错误模型。
原内部入口及 `types.ts` 保留兼容转出，包根公共 API 不变；图层/图例契约暂留原文件。

业务写操作在 disposing/disposed 后拒绝，已取得的 MapView 代理也执行调用时检查。
内部清理仍可清空选择、读取现存地图及解除 target。注册必须检查资源作用域，绑定
清理失败回滚；地图注册随插件 Scope 释放，但引擎使用期间延迟解除 Adapter，保证
后续图层清理可用。地图取消监听失败仍继续销毁引擎，最终销毁会清空事件/选择监听。
各处上报的 app:error 统一通知 onError，报告器异常不覆盖主错误；工具激活失败使用
TOOL_ACTIVATION_FAILED。保持独立服务队列及只读快照，不增加通用生命周期管理器。

建议公共类型：

``` ts
export interface GISApp {
  readonly id: string
  readonly name?: string
  readonly status: AppStatus
  readonly context: AppContext
  readonly map: MapService
  readonly layers: LayerService

  use<Options>(
    plugin: GISPlugin<Options>,
    options?: Options,
  ): this

  registerMapAdapter(adapter: MapAdapter, resources: ResourceScope): void
  registerLayerType(type: string, definition: LayerTypeDefinition, resources: ResourceScope): void

  init(config: GISAppConfig): Promise<void>
  mount(target: Element | string): Promise<void>
  unmount(): Promise<void>
  dispose(): Promise<void>

}
```

以上是早期最小接口示例。当前 State 从 `app.context.state` 读取；`data`、
`interactions`、`events`、`services`、插件实例查询和其他注册快捷方法属于后续
能力，只有存在首个明确消费者后再加入公共 API。插件通过 `context` 和公开注册
契约扩展，不因预留接口而提前实现通用服务容器。

说明：

-   `context` 是插件开发和高级集成使用的共享运行时上下文。
-   `context.state`、`map`、`layers`
    等是常用能力的快捷入口，不应各自持有重复数据。
-   `layers` 应与 `context.layers` 指向同一个服务实例，不得创建两份
    LayerManager。
-   对外暴露稳定接口，不暴露 Core 内部类、私有 Registry 或初始化器。

如果 `map` 在初始化前尚不存在，`MapService`
仍可作为稳定代理对象存在；具体地图实例在 `init()` 后可用。应提供
`map.isReady` 或 `map.getInstance()` 等明确语义，避免调用者猜测 `null`
状态。

------------------------------------------------------------------------

## 7. AppContext 与服务容器

### 7.1 AppContext

`AppContext` 是同一个 Runtime
内共享的能力上下文，不是随意堆放对象的全局变量。

``` ts
export interface AppContext {
  readonly config: Readonly<GISAppConfig> | undefined
  readonly state: AppState
  readonly map: MapService
  readonly layers: LayerService
  readonly resources: ResourceScope
}
```

当前 Context 由独立 AppContextImpl 类实现，包含配置、只读 State、Map/Layer/Data/
Interaction/Event 能力和资源作用域，不反向持有 GISApp。配置初始化器仅由装配过程
持有；服务通过明确依赖读取内部状态和延迟绑定的 Context，不通过 Context 获取 App。

约定：

-   Context 由 Runtime 创建，插件通过参数获得。
-   插件可以使用公开 Service API；不能任意覆盖已有核心字段。
-   配置初始化后对外只读；运行时配置变化必须通过明确 API。
-   Context 不应保存与当前应用无关的全局单例。

### 7.2 Service Registry

服务注册用于扩展 Runtime，不等于所有对象都必须放入容器。

``` ts
export interface ServiceRegistry {
  register<T>(key: ServiceKey<T>, service: T): void
  get<T>(key: ServiceKey<T>): T
  has<T>(key: ServiceKey<T>): boolean
  unregister<T>(key: ServiceKey<T>): void
}
```

推荐使用 Symbol 或带类型的 key：

``` ts
export const HTTP_SERVICE = createServiceKey<HttpService>('http')
```

规则：

-   核心服务由 Runtime 创建并保留。
-   插件服务必须有明确 key 和所有者。
-   重复注册默认报错，除非 API 明确声明 replace。
-   插件卸载时只移除自己注册的服务。
-   不建议把 Service Registry
    当成随处查找依赖的万能容器；优先通过构造参数显式传递依赖。

------------------------------------------------------------------------

## 8. State 设计

### 8.1 State 的职责

State 只保存跨模块共享、需要订阅的轻量应用状态，例如：

-   当前激活工具。
-   当前选中要素的标识。
-   图层的显隐、顺序等 UI/应用状态（图层实体本身由 LayerService 管理）。
-   面板展开状态。
-   当前业务分析参数。
-   当前时间控制值。

State 不保存：

-   OpenLayers Map、Layer、Source、Feature 实例。
-   大规模原始 GeoJSON 或全部要素集合。
-   可由 Service 查询得到的重复数据。
-   高频 pointermove 坐标流（除非业务 UI 确实需要订阅）。
-   大型统计结果和数据处理缓存。

### 8.2 推荐接口

``` ts
export interface AppState {
  subscribe(listener: (snapshot: DeepReadonly<AppStateSnapshot>) => void): Unsubscribe
  snapshot(): DeepReadonly<AppStateSnapshot>
}
```

State 使用明确的只读领域快照，不允许组件通过任意路径写入。以下为早期结构草案，
当前公开结构以 core/src/types.ts 为准：revision、status、map、layers、data、
interactions、extensions。生命周期和交互状态由内部 State 持有；图层与数据元信息
投影自领域模型，没有第二份可独立写入的状态。UI 和 OL 工具通过受所有权约束的
registerStateSlice 接入 extensions，不向 Core 引入 Vue/OL 对象。

``` ts
export interface AppStateSnapshot {
  ui: {
    activeToolId: string | null
    selectedFeatureId: string | null
    panels: Record<string, { visible: boolean; collapsed?: boolean }>
  }
  layers: {
    visibility: Record<string, boolean>
    order: string[]
  }
  analysis: {
    activeLayerId: string | null
    time: number | string | null
  }
}
```

这只是 Runtime 的通用状态示例。业务专属字段应由业务插件定义，不要把 KPI
字段、特定网络指标等写死在 Core。

### 8.3 响应式适配

Core 不依赖 Vue。Core State 提供订阅机制；Vue UI 使用
`shallowRef`/`customRef` 或 composable 将订阅桥接为 Vue 响应式状态。

不要为了 Vue 方便而让 Core 直接返回 Vue `reactive()` 对象。这样才能保持
Runtime 可在非 Vue 环境运行。

### 8.4 高频状态

地图 pointermove、视图连续变化等高频事件不应默认写入全局
State。提供节流、采样或按需订阅机制；只有确实需要 UI
呈现的派生状态才同步到 State。

------------------------------------------------------------------------

## 9. MapService 与地图 Adapter

### 9.1 原则

Core 定义地图能力契约，Adapter 负责具体引擎实现。不要试图把 OpenLayers
的全部 API 抽象成一个过度通用的地图接口。

``` ts
export interface MapService {
  readonly isReady: boolean
  getView(): MapViewService
  getSize(): [number, number] | undefined
  updateSize(): void
  setTarget(target: HTMLElement | string | undefined): void
  getAdapter(): MapAdapter
}
```

`getAdapter()` 返回 Adapter 能力对象，不建议在通用 Core 中暴露
`getOpenLayersMap()`。OpenLayers 专属 API 由 `@joinmap/adapter-ol`
提供类型化扩展入口。

### 9.2 Adapter 契约

``` ts
export interface MapAdapter {
  readonly name: string
  create(config: MapConfig): Promise<void> | void
  destroy(): Promise<void> | void
  getView(): MapViewAdapter
  updateSize(): void
  setTarget(target: HTMLElement | string | undefined): void
}
```

Adapter 注册：

``` ts
app.use(createOLAdapter({
  // OpenLayers 专属配置
}))
```

Adapter 是地图引擎边界，不应把 UI
面板注册、业务数据处理或搜索组件塞入其中。

### 9.3 OpenLayers 扩展

``` ts
import { useOLMap } from '@joinmap/adapter-ol'

const olMap = useOLMap(app)
```

`useOLMap()` 属于 OpenLayers Adapter 包，而非 Core。返回值为真实
`ol/Map`，并明确它是引擎专属对象。

------------------------------------------------------------------------

## 10. LayerService：图层运行时 API

图层是 Runtime 最重要的领域服务之一。

### 10.1 核心职责

-   按图层类型创建图层实例。
-   维护图层实例生命周期。
-   管理增删改、显隐、顺序和分组。
-   将图层配置交给对应 Layer Type Factory。
-   协调数据加载和资源释放。
-   向 UI 提供稳定的图层描述和变更事件。

LayerService 不负责绘制图例，也不负责实现图层树 UI。

### 10.2 公共接口

``` ts
export interface LayerService {
  add(config: LayerConfig): Promise<LayerInstance>
  remove(id: string): Promise<void>
  update(id: string, patch: LayerUpdate): Promise<void>
  get(id: string): LayerInstance | undefined
  has(id: string): boolean
  list(options?: LayerListOptions): LayerInstance[]
  setVisibility(id: string, visible: boolean): void
  setOrder(ids: string[]): void
  clear(): Promise<void>
  subscribe(listener: LayerChangeListener): Unsubscribe
}
```

推荐 `add()` 返回创建完成的
LayerInstance；如图层支持后台加载，实例可以先进入 `loading`
状态，再通过状态/事件报告加载完成。不要让 API 的 Promise 语义模糊：建议
Promise 表示"实例已创建并加入运行时"，数据是否全部加载完成由 `loadState`
表示。

### 10.3 LayerConfig 与 LayerInstance

``` ts
export interface LayerConfig {
  id: string
  type: string
  title?: string
  visible?: boolean
  zIndex?: number
  source?: unknown
  options?: Record<string, unknown>
  children?: LayerConfig[]
}

export interface LayerInstance {
  readonly id: string
  readonly type: string
  readonly title?: string
  readonly status: 'created' | 'loading' | 'ready' | 'error' | 'disposed'
  readonly visible: boolean
  setVisibility(visible: boolean): void
  update(patch: LayerUpdate): Promise<void>
  dispose(): Promise<void>
  getMetadata(): Readonly<Record<string, unknown>>
}
```

类型上应进一步为不同图层类型提供泛型配置和注册映射，避免长期依赖
`unknown`/`Record<string, unknown>`。上面是最小公共形状。

### 10.4 Layer Type Registry

插件注册可复用图层类型，而不是注册具体图层实例：

``` ts
app.registerLayerType('geojson', {
  create(context, config) {
    // 创建数据资源、地图图层和运行时实例
  },
})
```

建议定义：

``` ts
export interface LayerTypeDefinition<
  Config extends LayerConfig = LayerConfig,
> {
  create(
    context: AppContext,
    config: Config,
  ): Promise<LayerInstance> | LayerInstance
}
```

注册表应由 Runtime 提供的受控注册 API 管理：

``` ts
app.registry.layers.register('geojson', definition)
```

或者：

``` ts
app.registerLayerType('geojson', definition)
```

**v1 推荐第二种快捷 API**，避免把内部 Registry
直接暴露为公共对象。底层仍可使用 Registry 实现。

### 10.5 分组图层

`GROUP` 是组合节点，负责组织子图层，不负责加载数据。创建 group
时递归调用 LayerService 的统一创建路径；子节点仍由各自 Layer Type
Factory 创建。分组显隐、顺序和销毁规则应明确，销毁 group
默认递归销毁其拥有的子图层。

### 10.6 初始图层与动态图层

``` ts
await app.init({
  map: { /* ... */ },
  layers: [
    { id: 'base', type: 'xyz', source: { /* ... */ } },
    { id: 'roads', type: 'geojson', source: { /* ... */ } },
  ],
})

// 与初始图层使用同一创建路径
await app.layers.add({
  id: 'alerts',
  type: 'geojson',
  source: { /* ... */ },
})
```

禁止在 `AppInitializer` 中另写一套图层实例化逻辑。Initializer
只负责读取配置并调用 `app.layers.add()`。

------------------------------------------------------------------------

## 11. DataService 与 DataProcessor

### 11.1 职责边界

DataService 管理数据集的加载、获取、更新和释放；DataProcessor
负责可复用的数据转换/处理。具体图层何时加载数据由图层类型决定。

-   GeoJSON、静态数据、业务 API 数据通常需要 DataService。
-   XYZ/WMTS 等由地图引擎直接请求瓦片的图层，不必强行经过 DataService。
-   DataProcessor 不应成为一个包含所有业务逻辑的万能类。
-   大型数据不应自动复制进 AppState。

### 11.2 API 草案

``` ts
export interface DataService {
  load<T = unknown>(
    source: DataSourceConfig,
    options?: DataLoadOptions,
  ): Promise<DataSet<T>>
  get<T = unknown>(id: string): DataSet<T> | undefined
  remove(id: string): Promise<void>
  clear(): Promise<void>
}
```

v1 `DataSourceConfig` 采用可序列化描述：`{ type: 'url', url, format? }` 或
`{ type: 'inline', data }`；`format` 为 `json` 或 `text`。`DataLoadOptions` 可提供
数据集 ID、AbortSignal 和已注册的处理器名称。网络加载失败时 Promise reject，
DataSet 保留 `error` 状态供诊断；调用者可移除失败数据集后重试。Core 不深度代理
数据内容。

``` ts
export interface DataSet<T = unknown> {
  readonly id: string
  readonly status: 'loading' | 'ready' | 'error'
  readonly data?: T
  readonly error?: Error
  update(data: T): void
  dispose(): Promise<void>
}
```

数据处理器：

``` ts
export interface DataProcessor<Input = unknown, Output = unknown> {
  name: string
  process(
    input: Input,
    context: AppContext,
  ): Promise<Output> | Output
}
```

注册：

``` ts
app.registerDataProcessor('geojson-normalize', processor)
```

处理器应保持输入输出明确，避免隐式修改原始数据。耗时任务可由专门 Worker
实现，但 Worker 生命周期和传输协议属于具体 Processor 的实现细节。

### 11.3 数据所有权

需要明确 DataSet 的所有者：

-   Layer Type 创建的数据集通常由该 LayerInstance 持有。
-   Layer 删除时，默认释放该图层独占的数据集。
-   多图层共享的数据集必须通过显式共享/引用计数策略管理，不能由任一图层直接销毁。
-   DataService `remove()`
    应拒绝删除仍被引用的数据，或提供明确的强制删除语义。

v1
可以先不实现复杂引用计数，但必须避免"删除一个图层误删其他图层正在使用的数据"。

------------------------------------------------------------------------

## 12. InteractionService 与 Feature 交互

InteractionService 负责管理 Runtime 级地图交互能力，不负责 Popup
的视觉实现。

OpenLayers 每个地图实例监听一次 `singleclick`，收集本地候选以及点击时的
像素、坐标、投影、分辨率和可查询图层顺序，然后调用 `pickFeatures`。
业务图层通过 `MapLayerHandle.identify` 提供定位查询，`LayerService` 补齐
图层 ID。Runtime 并发汇总本地命中和图层查询，为一次点击设定两秒期限。
自定义查询负责该图层的候选，单层失败时保留其他图层的结果。

`registerFeaturePicker` 提供一个可注销的 UI 回调。零个有效命中时清空选中，
单命中直接选中，多命中发送候选并保留当前选中。查询失败且无候选时报告失败，
保留当前选中。没有 UI 回调时多命中取首项。候选和查询状态只存在于本次交互，
仍用 `FeatureReference` 保存最终选中项。图层变化、后续点击、工具切换或组件卸载
会中断旧查询。视图变化中断进行中的查询。支持坐标浮层的 Adapter 可以在平移时
保留已完成的候选，缩放、旋转或切换投影时关闭候选。

`MapService.addPopupOverlay` 通过可选的 Adapter 能力挂载坐标浮层并返回清理函数。
OpenLayers 使用原生 `Overlay` 跟踪位置，靠近边缘时调整弹框位置，地图范围外时隐藏。
适配器负责浮层及监听器的释放。

地图点选和 GeoJSON 搜索共用要素引用。`SearchResult.feature` 可用于定位后提交
选择。引用的 `featureKey` 标识当前数据内的要素，业务 ID 继续通过 `id` 表达。
OpenLayers 适配器监听选择，用私有矢量图层绘制几何副本。图层可通过
`MapLayerHandle.canSelectFeature` 校验引用是否有效或符合当前过滤条件。时间、
图例过滤或数据更新导致要素失效时，选择、高亮和属性联动一起清除。

``` ts
export interface InteractionService {
  select(options?: SelectOptions): void
  clearSelection(): void
  getSelection(): FeatureReference | undefined
  onSelect(listener: (feature: FeatureReference | undefined) => void): Unsubscribe
  pickFeatures(pick: MapFeaturePick): Promise<void>
  registerFeaturePicker(listener: (pick: FeaturePickState | undefined) => void): Unsubscribe
  cancelFeaturePick(options?: { readonly preserveAnchoredChoices?: boolean }): void
  registerTool(id: string, definition: ToolDefinition): void
  activateTool(id: string): Promise<void>
  deactivateTool(): Promise<void>
  getActiveTool(): string | undefined
}
```

建议 Runtime 对外传递 `FeatureReference`
或稳定标识、属性快照，而不是把地图引擎 Feature 实例写入通用 State：

``` ts
export interface FeatureReference {
  id?: string | number
  layerId: string
  properties?: Readonly<Record<string, unknown>>
  geometryType?: string
}
```

如果业务需要获取真实 OpenLayers Feature，应通过 adapter-ol 的专属 API
获取。

工具定义：

``` ts
export interface ToolDefinition {
  id: string
  title?: string
  activate(context: AppContext): void | Promise<void>
  deactivate?(context: AppContext): void | Promise<void>
}
```

工具切换必须保证互斥策略明确：默认同一时刻只允许一个主工具激活；若以后支持并行工具，应通过工具组/冲突策略扩展，不要默认让多个工具同时抢占地图交互。

------------------------------------------------------------------------

## 13. EventService

事件适用于跨模块广播的事实通知，不应代替直接方法调用或 State。

### 13.1 API

``` ts
export interface EventService {
  on<K extends keyof GISAppEvents>(
    event: K,
    listener: (payload: GISAppEvents[K]) => void,
  ): Unsubscribe
  once<K extends keyof GISAppEvents>(
    event: K,
    listener: (payload: GISAppEvents[K]) => void,
  ): Unsubscribe
  emit<K extends keyof GISAppEvents>(
    event: K,
    payload: GISAppEvents[K],
  ): void
}
```

建议事件：

``` ts
export interface GISAppEvents {
  'app:ready': { appId: string }
  'app:error': { error: GISRuntimeError }
  'layer:added': { layerId: string }
  'layer:removed': { layerId: string }
  'layer:updated': { layerId: string }
  'layer:visibility-changed': {
    layerId: string
    visible: boolean
  }
  'tool:activated': { toolId: string }
  'tool:deactivated': { toolId: string }
  'feature:selected': { feature?: FeatureReference }
}
```

规则：

-   事件名使用领域前缀。
-   事件 payload 使用稳定、可序列化的数据结构。
-   订阅返回 `unsubscribe`。
-   插件销毁时必须取消自己创建的订阅。
-   不要用事件实现 `getLayer()`、`setVisibility()` 这类命令。
-   不要把高频 pointermove
    默认广播到全局事件总线；提供局部/按需地图事件订阅。

------------------------------------------------------------------------

## 14. UI Adapter 契约

UI 不属于 Core，但 Runtime 需要一套稳定的 UI 扩展契约，让 Vue UI
成为官方默认实现。

### 14.1 UI Adapter

``` ts
export interface UIAdapter {
  readonly name: string
  mount(target: Element | string): void | Promise<void>
  unmount(): void | Promise<void>
  dispose(): void | Promise<void>
}
```

Core 只知道 UI Adapter 的接口，不 import Vue。Adapter 的插件 `install()`
属于 `GISPlugin`；它通过 `app.registerUIAdapter(adapter, resources)` 注册上面的
生命周期适配器，因此 `UIAdapter` 本身没有重复的 `install(context)` 方法。

### 14.2 面板元数据契约

Core 只定义跨 UI 实现的面板元数据，不定义组件、组件 props、注册表、渲染或布局
实现。面板组件注册、Panel Registry、面板状态和布局均由 Vue UI 包负责。

例如：

``` ts
// Core：只描述面板身份和可序列化元数据
export type PanelPosition =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'floating'

export interface PanelDescriptor {
  id: string
  title?: string
  position?: PanelPosition
  order?: number
  defaultVisible?: boolean
}
```

Core 自行定义并导出 `PanelPosition`（`left | right | top | bottom | floating`），
不得引用 Vue UI 包中的类型。此类型只表达可序列化的布局元数据，不包含组件、
组件 props 或布局实现。

### 14.3 注册 UI 面板

Vue UI 插件可以提供：

``` ts
const vueUI = createVueUI({
  panels: [
    {
      id: 'search',
      component: SearchPanel,
      position: 'left',
    },
    {
      id: 'legend',
      component: LegendPanel,
      position: 'right',
    },
  ],
})

app.use(vueUI)
```

业务 UI 插件通过 Vue UI 提供的扩展 API 注册自定义组件和面板。Core Plugin
不应为了注册图层类型而被迫依赖 Vue；Core 只需允许配置引用已注册的面板 ID
及其受 schema 限制的元数据。

### 14.4 官方 UI 的职责

官方 Vue UI 可以提供：

-   SearchPanel
-   LegendPanel
-   LayerManager
-   Toolbar
-   Popup
-   KpiPanel
-   TimeController
-   PanelLayout

这些是可选 UI 能力，不是 Runtime Core 的必需组成部分。UI 组件通过公开
Service API 访问 Runtime，不直接操作 Core 私有对象或其他组件内部状态。

------------------------------------------------------------------------

## 15. 配置 API（appConfig）

UIConfig 同时用于 createVueUI({ config }) 默认值与 appConfig.ui 显式覆盖，包含 layout、
theme（模式字符串或含 mode/tokens/className 的对象）、locale、panels。Core 验证可序列化
结构，Vue 选择组件并持有当前表现状态。无需将 Vue 或 OL 类型引入 Core。

SearchService 由 App 构造，app.search === app.context.search，支持 init 前注册 Provider。
复用原搜索聚合逻辑并去除 Vue 依赖：registerProvider/listProviders/subscribe/search，
可选 ResourceScope 管理注册。各查询独立取消；UI 卸载只取消自己的请求；应用清理时取消
所有查询并释放 Provider/监听。不维护全局结果状态，也不在搜索服务中进行地图定位。

MapLocation 的 projection 省略时明确表示当前地图投影；外部 Provider 推荐显式标注。
MapService.locate 复用已有视图能力或调用 Adapter 跨投影定位，Core 无引擎投影依赖。

LayerConfig.legend 是可序列化图层业务元数据，LayerInstance.legend 和图层快照提供当前
只读图例。LayerUpdate.legend 完整替换，null 删除；解析输入克隆并冻结，使用现有更新队列
与通知。Handle.resolveLegend 可将当前样式解析为领域图例；隐藏只影响 UI 展示，移除图层
自然移除图例。不增加 LegendManager/Registry。完整实际 API 以 runtime-api.md 为准。


### 15.1 配置定位

`appConfig.json` 是声明式应用描述，不是运行时对象序列化结果。

``` ts
export interface GISAppConfig {
  version: string
  map: MapConfig
  layers?: LayerConfig[]
  ui?: UIConfig
  tools?: ToolConfig[]
  data?: Record<string, DataSourceConfig>
  state?: Partial<AppStateSnapshot>
}
```

示例：

``` json
{
  "version": "1",
  "map": {
    "projection": "EPSG:3857",
    "center": [108.94, 34.16],
    "zoom": 10,
    "minZoom": 8,
    "maxZoom": 18
  },
  "layers": [
    {
      "id": "osm",
      "type": "xyz",
      "title": "OSM",
      "visible": true,
      "source": {
        "url": "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      }
    },
    {
      "id": "cells",
      "type": "geojson",
      "title": "Cell Coverage",
      "visible": true,
      "source": {
        "type": "url",
        "url": "/data/cells.geojson"
      },
      "options": {
        "style": {
          "fill": "#2563eb",
          "stroke": "#93c5fd"
        }
      }
    }
  ],
  "ui": {
    "layout": "dashboard",
    "panels": [
      { "id": "search", "visible": true, "position": "left" },
      { "id": "legend", "visible": true, "position": "right" },
      { "id": "layer-manager", "visible": true, "position": "right" }
    ]
  }
}
```

注意：示例坐标必须与 `projection` 的坐标单位一致。若使用
EPSG:3857，中心坐标应为投影坐标；经纬度坐标应显式使用 EPSG:4326
或由配置转换策略处理。配置规范必须避免坐标系歧义。

### 15.2 配置校验

初始化前完成：

-   `version` 版本检查。
-   必填字段检查。
-   图层 `id` 唯一性检查。
-   图层 `type` 是否已注册。
-   数据源结构检查。
-   UI 面板是否有对应 UI Adapter 注册。
-   插件依赖是否满足。
-   配置值是否可序列化。

错误应包含路径，例如：

``` text
CONFIG_INVALID
path: layers[1].type
message: Layer type "heatmap-x" is not registered.
```

配置校验应与运行时创建分离：校验通过不代表网络数据已经加载成功。

------------------------------------------------------------------------

## 16. 错误模型

建议统一错误类型：

``` ts
export type GISRuntimeErrorCode =
  | 'APP_INVALID_STATE'
  | 'APP_DISPOSED'
  | 'CONFIG_INVALID'
  | 'PLUGIN_DUPLICATE'
  | 'PLUGIN_DEPENDENCY_MISSING'
  | 'PLUGIN_INSTALL_FAILED'
  | 'ADAPTER_MISSING'
  | 'LAYER_TYPE_NOT_FOUND'
  | 'LAYER_NOT_FOUND'
  | 'LAYER_CREATE_FAILED'
  | 'DATA_LOAD_FAILED'
  | 'UI_ADAPTER_MISSING'
  | 'TOOL_NOT_FOUND'

export class GISRuntimeError extends Error {
  code: GISRuntimeErrorCode
  detail?: unknown
  cause?: unknown
}
```

错误原则：

-   错误码用于程序判断，message 用于人类阅读。
-   保留原始 `cause`。
-   附带阶段、插件名、图层 ID、配置路径等诊断上下文。
-   不要只 `console.error()` 后吞掉错误。
-   `onError` 用于统一报告，不应替代 Promise reject。

------------------------------------------------------------------------

## 17. 资源与插件清理

Runtime 应有统一资源管理机制：

``` ts
export interface ResourceScope {
  add(dispose: () => void | Promise<void>): Unsubscribe
  dispose(): Promise<void>
}
```

典型资源：

-   EventService 订阅。
-   地图事件监听。
-   ResizeObserver。
-   Worker。
-   定时任务。
-   数据集。
-   图层实例。
-   UI Adapter 创建的 Vue App。
-   插件安装的扩展注册。

插件安装时应获得自己的 ResourceScope。v1 不支持运行时热卸载，但插件安装
失败回滚和 Runtime dispose 都必须释放对应 Scope；注册能力、事件监听和其他
副作用都要登记在该 Scope 中。

v1
可以只支持应用级插件安装和应用整体销毁，不必实现运行时热卸载插件。若未来增加
`unuse()`，必须先定义插件依赖、资源归属和能力被其他模块引用时的处理规则。

------------------------------------------------------------------------

## 18. 插件开发完整示例

``` ts
import type {
  GISPlugin,
  LayerConfig,
  LayerInstance,
} from '@joinmap/gis-core'

interface CsvLayerOptions {
  delimiter?: string
}

export function createCsvLayerPlugin(
  options: CsvLayerOptions = {},
): GISPlugin {
  return {
    name: 'csv-layer',

    install(app) {
      app.registerLayerType('csv', {
        async create(context, config: LayerConfig) {
          const dataSet = await context.data.load({
            type: 'url',
            url: String(config.source),
          })

          // 解析 CSV、创建地图图层并返回 LayerInstance
          return createCsvLayerInstance({
            context,
            config,
            dataSet,
            delimiter: options.delimiter ?? ',',
          })
        },
      })
    },
  }
}
```

上例为结构示意。正式类型应为每种 Layer Config 定义具体的 `source`
类型，不应在实现中长期使用 `String(config.source)` 这样的宽松转换。

应用使用：

``` ts
const app = createGISApp({
  id: 'demo',
})

app.use(createOLAdapter())
app.use(createVueUI())
app.use(createCsvLayerPlugin({
  delimiter: ',',
}))

await app.init(appConfig)
await app.mount('#app')

// 动态增加图层
await app.layers.add({
  id: 'csv-points',
  type: 'csv',
  source: {
    type: 'url',
    url: '/data/points.csv',
  },
})

// 更新图层
await app.layers.update('csv-points', {
  visible: false,
})

// 移除图层
await app.layers.remove('csv-points')

// 先卸载 UI，再销毁 Runtime
await app.unmount()
await app.dispose()
```

------------------------------------------------------------------------

## 19. API 设计取舍与明确约束

  议题                       v1 决策                      原因
  -------------------------- ---------------------------- ----------------------------
  Core 是否依赖 Vue          否                           保持 Runtime 独立
  Core 是否依赖 OpenLayers   否                           通过 Adapter 接入
  默认 UI                    Vue 3 + TS                   官方实现，不是核心依赖
  状态管理                   Core 自有订阅式 State        避免绑定 Pinia/Vue
  是否强制 Pinia             否                           当前规模不需要额外状态框架
  是否全局 EventBus          仅领域事件                   不以事件替代 Service API
  图层注册                   注册 Layer Type Definition   类型可复用，实例属于应用
  初始/动态图层              统一 LayerService 路径       避免两套创建逻辑
  GROUP                      组合节点                     不承担数据加载
  OL 实例                    由 OL Adapter 暴露           不污染 Core 类型
  DataProcessor              可注册的处理能力             业务处理可扩展
  UI 面板                    UI Adapter 注册              Core 不知道 Vue Component
  插件热卸载                 v1 暂不支持                  先保证资源所有权和清理
  配置                       JSON 可序列化声明            适合版本管理和 AI 生成

------------------------------------------------------------------------

## 20. 建议的实施顺序

不要同时实现所有服务。按依赖顺序逐步建立可运行闭环。

### Phase 1：Runtime 最小闭环

-   `createGISApp`
-   生命周期状态机
-   `AppContext`
-   插件安装与注册
-   配置校验
-   `init / dispose`
-   基础错误模型
-   ResourceScope

**验收：** 不依赖 Vue 和 OpenLayers，也能创建、初始化、销毁一个空
Runtime；插件能注册能力。

### Phase 2：OpenLayers Adapter 与 LayerService

-   Map Adapter 契约
-   OpenLayers Adapter
-   Layer Type Registry
-   LayerService
-   初始图层与动态添加共用路径
-   GROUP 组合图层
-   图层显隐、更新、删除

**验收：**
通过配置创建地图和图层；运行时可增删改图层；删除时正确释放资源。

**当前实现基线：** OpenLayers Adapter 位于 `packages/adapter-ol`，依赖 OpenLayers
10.11；Core 在 `packages/core`。当前首批图层类型为 `xyz`、`geojson` 和 Runtime
管理的 `GROUP`。XYZ/GeoJSON 使用 URL source；GROUP 递归管理子图层。TileUsageTracker
不属于本阶段的通用 Core API。

### Phase 3：数据与交互服务

-   DataService / DataSet
-   DataProcessor 注册
-   FeatureReference
-   InteractionService
-   Tool Registry
-   EventService

**验收：** 数据加载、选择要素、工具切换和事件订阅形成闭环。

**当前实现基线：** `DataService` 支持 JSON/文本 URL 和 inline 数据集、可选处理器、
DataSet 查询/更新/清理；`InteractionService` 提供 FeatureReference 选择、互斥
工具激活；`EventService` 提供领域事件订阅。appConfig 的 `data` 是以数据 ID 为键的
对象，数据源类型为 `url` 或 `inline`。GeoJSON 图层独占自己的 DataSet，并在删除时
释放；当前不实现跨图层共享数据集引用计数。瓦片仍由 OpenLayers Source 加载。处理器
与工具注册均绑定插件 ResourceScope，应用 dispose 时释放；工具切换互斥，选择对象
只通过 FeatureReference 传递。

地图视图契约包含 `fit(extent)`，供 Search 等 UI 能力通过 Runtime 定位范围；具体
地图引擎负责将范围映射到视图，不向 UI 暴露引擎对象。

### Phase 4：Vue UI Adapter

-   Vue UI Adapter
-   Layout
-   Panel Registry
-   SearchPanel
-   LegendPanel
-   LayerManager
-   Toolbar
-   Popup
-   KPI / TimeController

**验收：** UI 只通过 Runtime 公共 API 工作；卸载 UI 不销毁
Runtime；重新挂载可以恢复。

### Phase 5：开发者体验

**当前实现基线：** 已提供 `doc/runtime-api.md`、可运行的
`examples/basic-vue`、`schemas/gis-app-config.schema.json`、Core 插件模板
`templates/core-plugin`、`.agents/skills/gis-runtime/SKILL.md`，以及覆盖
ResourceScope、生命周期、Layer/Data/Interaction/Event 和配置 Schema 的测试。
根目录 `pnpm check` 执行 typecheck、Vitest 和 workspace build。插件依赖顺序和
缺失依赖仍由 Runtime 初始化时检查；JSON Schema 不替代插件注册上下文校验。

-   API 文档和插件模板
-   配置 JSON Schema
-   插件依赖校验
-   错误诊断
-   AI Coding Skill
-   示例项目

**验收：** 开发者或 AI 能根据文档独立开发一个图层插件和一个 Vue
面板插件。

------------------------------------------------------------------------

## 21. v1 API 与后续扩展

### 21.1 v1 最小公共 API

**实现核对说明：** 本节是首期核心闭环的范围说明，不是当前导出 API 的完整清单。
本仓库 v1 已实现并公开 Layer、Data、Interaction、Event 服务及其类型；当前实际
导出以 `packages/core/src/index.ts` 和 `doc/runtime-api.md` 为准。不得将下文的
“后续扩展”示例误认为这些已实现能力尚未纳入 v1。

``` ts
// Application
createGISApp(options)
app.use(plugin)
app.init(config)
app.mount(target)
app.unmount()
app.dispose()

// Runtime capabilities
app.map
app.layers
app.context

// Dynamic runtime operations
app.layers.add(config)
app.layers.get(id)
app.layers.list()
app.layers.update(id, patch)
app.layers.remove(id)
app.layers.setVisibility(id, visible)
```

`state` 可作为 v1 内部能力或最小订阅接口实现；若尚无明确消费者，不承诺完整
的通用 State API。以下能力不属于 v1 最小公共 API，按需分阶段增加：

- `DataService`、`InteractionService`、`EventService` 和通用 `ServiceRegistry`。
- `registerDataProcessor()`、`registerTool()`、插件实例查询等扩展快捷 API。
- 更完整的 State 查询、更新和选择器订阅 API。

`LayerService` 所需的 Layer Type 注册契约属于 Phase 2 的实现依赖；在确认扩展
消费者前，不必把 Registry 内部结构或多余快捷方法全部导出。

最终应遵守三个判断标准：

1.  **Core 只公开稳定、跨 UI 框架的应用能力。**
2.  **Adapter 负责具体技术实现，Plugin 负责注册可复用扩展。**
3.  **UI 通过公开 API 消费 Runtime，不反向控制 Runtime 内部实现。**

这套边界比"把所有面板做成 Vue 组件"更重要。只要 Runtime
契约设计稳定，后续 Vue UI、业务插件、AI 生成配置和自定义 GIS
应用都能在同一套运行时能力上工作。

------------------------------------------------------------------------

## 22. v1 决策与后续评审事项

### 22.1 v1 实现核对与冲突修订

本节用于消除方案草稿与现有代码之间的歧义：

- 当前公开 `GISApp` 提供 `map`、`layers`、`data`、`interactions`、`events`、
  `context`；State 通过 `app.context.state` 提供只读快照及订阅，无 app.state、
  set/patch 任意写入 API。Context 没有 app 反向引用。
- `GISAppConfig` 当前允许扩展配置字段；具体消费边界以
  `packages/core/src/types.ts` 和运行时配置规范化为准。当前 JSON Schema 位于
  `schemas/gis-app-config.schema.json`；第 15 节较完整的配置接口/JSON 是目标草案，
  不等于当前所有字段都被 Core 消费。
- 当前 `UIAdapter` 生命周期契约是 `mount`、`unmount`、`dispose`；Core Plugin 的
  `install(app, options, resources)` 负责创建并通过 `registerUIAdapter()` 注册它。
  UI Adapter 不再重复定义 `install(context)`。
- Runtime Phase 3（Data/Interaction/Event）与 Vue UI Phase 1–4 已实现，不能再
  将这些服务只描述为将来候选。导出清单见 `packages/core/src/index.ts` 与
  `doc/runtime-api.md`。
- 当前实际工程布局为 `packages/core/src`、`packages/adapter-ol/src` 和
  `packages/ui-vue/src`；第 3 节细分子目录是职责建议，不是当前必须迁移到的目录树。
- v1 工程交付包括 JSON Schema、测试、基础 Vue 示例、Core 插件模板、API 参考和
  `.agents/skills/gis-runtime/SKILL.md`。使用 `pnpm check` 执行 typecheck、测试和构建。
- `TileUsageTracker` 属于 MVT Inspector 业务能力，不纳入 Core；如需该能力，应由
  Inspector 插件/应用独立设计和测试。

以下细节按 v1 决策执行；仅实现需要支撑当前闭环的内容：

1.  `app.use()` 是否严格同步；本文建议同步注册、异步工作放到初始化钩子。
2.  `app.init()` 失败后不允许重试；清理后 dispose，并创建新实例。
3.  LayerService 的 `add()` Promise
    是创建完成还是数据完全加载；本文建议只保证实例创建完成，加载状态独立表达。
4.  多图层共享 DataSet 的引用管理；v1
    可先采用显式所有权，不急于实现复杂引用计数。
5.  UI 面板职责已确定：Core 只定义元数据契约；Vue UI 负责组件注册、状态和布局。
6.  `map` 的通用抽象范围；本文建议只抽象 Runtime
    真正需要的能力，避免复刻整个 OpenLayers API。
7.  v1 不支持插件热卸载；安装失败与应用销毁时必须通过 ResourceScope 清理资源。

v1 优先实现 GISApp、生命周期、ResourceScope、Map Adapter 和 LayerService。
DataService、InteractionService、通用 Service Registry、工具系统和 UI 扩展等
按具体消费者需求逐步增加，不因设计稿列出接口就默认进入首版实现。

`TileUsageTracker` 属于 MVT Inspector 的业务能力，不纳入 gis-core 或通用
Runtime API。若该能力需要实现，应在 MVT Inspector 或其专属适配层独立设计，
按其自身的数据定义和 OpenLayers 版本制定测试。

**结论：** 先冻结 Runtime 的职责边界、生命周期、插件契约、LayerService
和 Adapter 契约，再开始 UI 面板实现。本文是 v1
架构提案，具体命名和边界可以在实现前评审，但不要为了提前覆盖所有场景而把
Runtime 设计成过度抽象的通用框架。

### 地图控件补充约定

状态栏排版与时间控制组件属于 Vue UI。Core 不增加全局时间字段或业务时间服务；只在
MapLayerHandle/LayerInstance 上提供可选的通用时间维度与范围过滤能力，时间值统一为 epoch
毫秒，具体字段识别与地图过滤由 Adapter 实现。
级别/投影从 app.context.state 读取；鼠标位置保留为 UI 局部高频状态，比例尺
计算由 OL 包装层完成。Docked 单行；Overlay 每项上标题、下数据，五项横向排列，结果面板与状态信息分层。
Overlay 的搜索与工具栏左边缘对齐、工具栏左侧居中、图层/图例右上/右下、属性在最右侧按需显示并推动面板列左移，以及窄屏临时隐藏图层/图例列的策略属于 Vue UI。
Demo 属性扩展通过 InteractionService.onSelect 联动面板可见性，关闭面板保留选择，销毁时移除监听；Core 不管理抽屉位置或可见性。

OpenLayers Adapter 提供 `zoomControl?: boolean`，默认启用；设置为 false 仅移除
默认缩放按钮，以便使用应用工具栏。`controls: false` 仍表示关闭全部默认控件。
Demo 的级别显示订阅 View 的分辨率变化，卸载时移除订阅；Core 不引入 OL 对象。

工具栏的图标、Tooltip 与标题栏呈现属于 Vue UI；Tooltip 的定时器、视口监听与
Teleport 内容随 Vue 组件卸载清理，不新增 Core 服务或地图引擎依赖。

停靠布局的标题留白、地图上方的搜索/横向工具栏、无外框面板呈现和搜索结果浮层
均由 Vue UI 负责。默认 Search 使用已有 top 位置；unframed 是 Vue 面板定义选项，
不进入 Core 的 PanelDescriptor 或 JSON 配置契约。


### Runtime / OL 工具联动修订

- Runtime 数据加载、图层添加和工具激活在 initializing、ready、mounted、unmounted 状态可用。
- 图层创建期间预留 ID，setOrder 同步 list 顺序；组的 childIds 仅返回仍存在的子图层。组显隐覆盖子图层显隐并发出事件。
- 领域事件的观察者异常转为 app:error，不回滚已提交状态；app:error 观察者自身异常隔离。
- DataSet.subscribe 通知 update；OL GeoJSON 重新解析并刷新 Source，删除时移除订阅。失败的图层私有数据集回滚，可同 ID 重试。
- OL Adapter 将点击拾取转成 FeatureReference；激活工具时暂停拾取，隐藏/移除已选图层会清空选择。排序保留工具临时图层。
- createOLAdapter() 内部注册绘制、测量、删除及清空能力，不再公开 createOLTools；tools:false 可关闭工具安装。
- useOLTools(app) 提供 list/subscribe/cancel/undo/clear；结果包含工具 ID、几何、投影、数值和单位。cancel 保留结果，clear 清空全部结果。结果由插件持有，不随 Vue UI 卸载消失。
- 长度/面积使用当前投影，角度限定三点、按当前平面坐标计算 0–180°；它不是椭球测地夹角。
- Demo 的 Escape 取消工具，Backspace 撤销当前绘制最后一个点；输入框内不拦截。结果选择删除、修改与吸附仍是后续能力。
- SearchService 取消旧查询；部分 Provider 失败仍返回成功 Provider 的结果，全部失败才报错。Legend 订阅图层变化，隐藏/移除图层时隐藏对应图例。

### 所有权、更新与结果管理

- GROUP 子成员按实例身份判断；删除子图层后同 ID 新建实例不会被旧组显隐或删除。
- DataSet.validate 注册纯同步校验器；update 先执行全部校验再提交。校验抛错时保留旧 data/status，不通知观察者。GeoJSON Adapter 注册解析校验器；普通订阅者异常汇报 app:error，继续通知其余订阅者。
- dispose 首先禁止新建任务，取消数据请求并等待数据/图层创建任务完成清理；之后按逆依赖清理插件，再清理业务图层、地图与根作用域。自定义异步 LayerType/Processor 必须自行保证任务能结束；Runtime 不会强制终止任意 Promise。
- 图层卸载分别尝试 adapter.removeLayer 与 handle.dispose，汇总错误；实例 dispose 的并发调用共享同一个清理 Promise。
- OLToolsController 新增 get/remove/select/selected/updateGeometry/exportResults/importResults。结果 ID 与 Feature ID 一致；选中结果高亮，删除只作用于指定 ID。几何修改先校验并重新计算，导入批次先校验全部记录再提交，拒绝重复 ID 和不同于地图的投影。公开结果为拷贝。
- Draw 不再自行提交 Source：插件校验后统一写入 Source 和结果集合，再通知 UI。测量值按 m、m²、° 保存；拒绝空几何、非有限坐标、零长度线、零面积面及重复角点。
- OL 工具为折线和面渲染白色填充的圆形顶点，有效结果提交后退出当前绘制或测量工具。测距在节点标注起点和沿线累计距离，鼠标处显示实时总长，末点只保留最终总计。测角在第二个顶点绘制圆弧，将读数放在圆弧外侧。结果经普通 GeoJSON 数据集写入 LayerService 管理的图层，参与要素拾取、选择和属性查询。Overlay 随图层显隐及要素删除更新。
- `tools.draw.targets` 和 `tools.measure.targets` 按工具指定可写的 inline GeoJSON 图层 ID。每种缺省目标在首次提交有效结果时创建，并将首条要素放入初始数据。角度、距离和面积加入同一个测量结果组。默认层叠顺序是测量、绘制、业务图层。已存在的分组新增子层时沿用当前层叠位置。已配置的无效目标在激活时报错。导入结果等待目标创建，清空只删除工具生成的要素。
- LayerService 在父组和所有后代就绪后一起发布图层树，再逐个发出新增通知。`addChild(groupId, config)` 向已有分组追加子层，继承分组的显式隐藏状态。创建失败时释放已经创建的子层。
- Basic Vue 仅安装 createOLAdapter 和 createVueUI。基础工具栏、属性联动和状态栏内置；高级结果列表可显式安装 createOLResultsUI，编程结果操作保留 useOLTools。
- OL 图层 options 支持 opacity（0–1）；GeoJSON 额外支持 style 对象：fillColor、strokeColor（颜色字符串）、strokeWidth、pointRadius（正数）。style 是完整替换，缺省字段使用默认值；创建和 update 均生效，不支持的 option/style 字段明确报错。参数先全部校验再应用。统一矢量样式通过 getMetadata().style 提供给图例，线符号使用 strokeColor，其余使用 fillColor；分级/分类表达式样式仍未实现。
- 本轮测试包含 Core 异常/所有权回归与真实 OL、Vue UI 的 jsdom 集成；这些不等同于真实浏览器鼠标事件端到端回归。

### 图层更新与选择联动修订

图层异步 update 按实例串行执行，失败不阻塞后续更新；删除立即禁止新的更新提交，等待已有更新结束后释放句柄。应用销毁在清理插件前等待图层更新完成。适配器不提供 update 时，options 更新明确报错，基础标题、显隐及 zIndex 更新仍可用。自定义 update 必须能够结束，Runtime 不强制终止任意 Promise。

FeatureReference.source 可标记选择所有者；省略或 layer 表示业务图层，其他所有者负责选择失效清理。OL 工具使用 ol-tools 来源，通过统一 InteractionService 选择，业务要素和结果互斥。点击结果、列表选择、清除和删除均同步高亮及属性面板；修改选中结果几何同步属性。删除选中结果按钮在没有工具结果选择时禁用，不删除业务要素。

ui-vue 公开 FeatureDetails 和 PropertiesPanel，属性面板与 FeaturePopup 共用 FeatureRenderer 和默认字段展示；Basic Vue 保留抽屉显示策略。

### 面板尺寸与 OL/Vue 集成补充

属性抽屉开关导致的 Grid 变化只由 Vue UI 管理：宽屏图层/图例列横向避让，图例保持同一底部锚点；900px 及以下属性仍位于右侧，临时隐藏图层/图例列，关闭恢复，不涉及 Core 选择、地图状态或面板可见状态变更。

@joinmap/ol-vue 仅保留可选高级结果列表 createOLResultsUI；基础工具栏、属性联动和状态栏由默认 UI 和适配器提供，Core 与 UI 保持引擎无关。详见 doc/ol-vue-api.md。

侧栏 width 参与 Grid 占位，同侧可见面板取 CSS max；Overlay 属性抽屉独立计算，不改变图层/图例列宽度。数字尺寸转为 px，尺寸应用到 PanelHost。优先级为面板 width > left/rightPanelWidth > Overlay 的 overlayPanelWidth > panelWidth > 布局默认值；响应式宽度约束及窄屏右侧抽屉由 Vue UI 实现。主题变量映射见 doc/vue-ui-theme-tokens.md。

Toolbar 的 title 可使用 locale 字典键，也支持原始文本。面板操作及 OL 工具按钮/结果操作跟随语言切换；PanelShell 可通过 labels 覆盖操作文案，独立使用默认英文。

外观设置复用 `ui.theme.tokens` 的字符串映射。材质、主色和当前内置布局由 Vue UI 管理，交互更新通过现有 `vue-ui` 状态片段暴露。布局切换复用 Runtime 和地图实例。`title.subtitle` 是可选的配置字符串，由 Core 校验，Vue UI 在标题栏渲染。

LegendDefinition.useLayerStyle 默认不启用。仅显式启用的单项 category 图例跟随统一图层样式。分类颜色保留自定义值。continuous 按真实数值比例生成色带，interval 保持离散色块。

GeoJSON 图层公开分类规则筛选和当前规则 ID。渲染、拾取和本地搜索同时判断时间和分类条件。替换数据后清除已不存在的时间字段条件，编辑图例后清除已不存在的规则条件。Modify 编辑选中的工具结果，Snap 吸附到可见结果。更新测量几何时会校验并重算测量值。

Vue UI 的 TimeFilterPicker 根据选定的 IANA 时区计算左闭右开的 Unix 毫秒区间。已提交的值通过 Vue UI 状态片段暴露。业务可订阅并使用公开的 Runtime 接口执行更新。

### 默认 GIS 能力收敛

属性内容标题直接从只读图层快照解析；搜索结果不透明度、图层排序动画及 ScrollArea
均由 Vue UI 管理。ScrollArea 复用浏览器 overflow，通过组件内部观察器同步透明轨道上的细滑块，
图层与图例面板的悬停显隐也由 Vue UI 处理。卸载释放观察器及拖拽资源，不向 Core 增加
DOM、滚动或动画状态。

GROUP 显式 zIndex 将当前叶子按原有相对顺序布置到 [zIndex,zIndex+1)；未配置则保持
子层自身 zIndex。UI 仅对最外层做整块拖拽，调用原有 setOrder 更新实际绘制顺序和 zIndex，
Core 不增加拖拽状态或面板业务。children 继续使用现有 GROUP 配置，不引入类型名称别名。
UI 将子层作为父层设置区内的显隐列表，子项不暴露透明度/定位/拖拽入口；父层仍复用
LayerService.update 向叶子层批量提交透明度。本次呈现调整不改变 Runtime 子层能力或 API。

图层定位已实现 LayerService.getDataLocation / MapLayerHandle.getDataLocation：适配器返回当前
有限范围，GeoJSON 转换到当前视图投影，Core 仅合并投影一致的现有分组成员，空数据返回
undefined，单点转 coordinate。数据范围不复制到 AppState，仅派生 hasDataLocation 可用性。
显式 setOrder 接收后到前的全部 ID，同时归一化叶子 zIndex，避免旧 zIndex 覆盖排序。
LayerInstance.version / 快照 version 与 LayerUpdate.expectedVersion 提供可选编辑前置条件；
在串行队列内、适配器修改前比较版本，过期更新报错，不增加编辑 Manager 或 EventBus。
UI 对统一样式和图例使用一次 update 提交；init 配置保持声明式输入，保存/导出由应用负责。

搜索范围复用现有 SearchService：SearchQuery.layerId 指定图层，SearchProvider.layerIds
声明支持的图层 ID，SearchResult.layerId 标记结果归属。注册时复制冻结范围，聚合时只调用
匹配的 Provider 并过滤明确属于其他图层的结果；不传范围仍聚合所有 Provider。通用 Provider
省略 layerIds，但必须处理传入的 layerId。Core 不判断哪些 OL 类型可搜索。
OL Adapter 为每个 GeoJSON 图层注册局部属性搜索 Provider，随图层释放；读取当前矢量源，
DataSet 更新后搜索使用新要素。结果带正确投影和定位信息，最多返回 50 项；瓦片/远程搜索
由业务 Provider 提供。不新增 Manager、Registry 或全局结果状态。

图层面板的不透明度复用已有 LayerService.update(options.opacity) 和图层元数据通知；不增加第二份 Runtime 不透明度状态。分组滑块由 UI 统一提交各叶子层，Core 生命周期及更新队列保持不变。GeoJSON 和现有分组数据范围定位已实现，详见 layer-location-design.md。

createOLAdapter 内部安装绘制、测量及结果操作，不再公开 createOLTools 工厂；tools:false 表示不安装工具能力。普通应用只需 createOLAdapter + createVueUI。
UI 内置缩放和已知工具 ID 的按钮映射，以 hasTool/canActivateTool 查询可用性，UIConfig.tools 可选择显示的内置按钮。一次性删除/清空使用现有 ToolDefinition 的 mode=action，不占用激活工具状态；undoActiveTool 复用活动工具的 undo 回调，不新建 CommandBus/ToolService。
PropertiesPanel 及选择联动归 ui-vue 内置。默认选中时打开，关闭保留选择，重新选择可再次打开；显式 properties.visible=false 关闭自动打开。Status 为内置专用槽位面板，status.visible=false 隐藏面板并清理订阅。
MapAdapter/MapService.onPointerMove 仅传递 WGS84 指针经纬度，离开时传 undefined；高频数据不进入 AppState。视图快照增加 metersPerPixel，适配器完成投影相关计算；默认状态栏按 0.28mm 名义像素格式化比例尺。键盘处理归工作区，仅在工作区内且非输入控件时处理 Escape/Backspace。
状态栏忽略离开事件对坐标显示的清空，保留最后一次有限坐标；该展示策略和面板重挂载缓存只属于 UI，不改变 Core 指针事件语义或 AppState。
搜索下拉的主题化选择器、选项/结果浮层互斥以及状态栏的顺序、标题图标文字和列宽均属于 Vue UI 呈现策略，不新增 Runtime 状态或 API。
独立的 ol-vue 集成包只保留高级结果列表，不再是普通应用启动的必经步骤。

### 图层顶层样式及分类规则修订

LayerConfig/LayerUpdate.style 与 legend 同级，options 仅保留透明度等选项，
旧 options.style 明确报迁移错误。style 为完整替换；LayerInstance.style 和
snapshot.layers[].style 提供有效基础样式，Adapter 通过 getStyle 返回解析结果。
category 使用 field + items[].values 数组精确匹配标量值，一组可包含一个或多个值，
共用名称及颜色。值保留 string/number/boolean 类型，组内和跨组禁止重复，
旧 value 仅在输入入口兼容为 [value]，两种形式不能同时填写。interval 使用 field +
ranges[]（id/min/max/color/label/includeMax），默认左闭右开，有限边界、
唯一 ID、禁止重叠、允许空缺。规则色覆盖点面填充或线颜色，其余属性继承基础
style；未匹配值回退基础 style，无数据可用 noData.color。分类与时间过滤组合。
LayerInstance.getFields 通过 Adapter 可选能力读取当前字段描述，不传递引擎对象。
LayerInstance.getFieldValues(field) 通过可选 handle 能力按需读取当前源的唯一标量值，
返回冻结副本；不随地图视野、图层显隐或渲染过滤减少，不写入 AppState。数据更新后
下次读取使用新数据。OL 在规则变化时建立多值查找表，绘制时按严格类型匹配。
上述契约取代历史 options.style 与“分类渲染未实现”的描述。

Docked workbench, sidebar collapse and toolbar overflow remain presentation responsibilities in ui-vue; no Runtime or adapter API changes.

Action-row spacing, icon assets and measured More-button sizing are local ui-vue presentation changes; Runtime contracts remain unchanged.

Sidebar motion remains in ui-vue: final map geometry is committed once; independently positioned sidebars animate with transform. No per-frame map resizing, temporary map target geometry or target reattachment is introduced; Core and adapter contracts remain unchanged.

### 地图交互性能修订

OL 默认交互显式设置 onFocusOnly=false，保留 tabindex 键盘可访问性，鼠标拖动与滚轮
无需预先点击；interactions:false 语义不变。视图通知按动画帧合并，销毁/退订取消待发帧。
直接 OL View 写入在下一帧进入快照，MapService 显式写入仍同步刷新。
GeoJSON 时间维度和数据摘要按 Source change 失效缓存，覆盖要素属性/几何修改及数据替换。
AppState 按分支比较 JSON 值，复用未变的深度冻结分支，保持历史快照与可变输入隔离。

Left-sidebar position smoothing is a ui-vue compositor effect; no additional map target sizing or Runtime/adapter API is introduced.

### Docked 面板显隐约定

Docked 左侧图层/图例固定呈现，不提供整列收起；右侧属性默认显示，关闭保留选择，
再次选中要素可打开，清空选择保持已打开面板为空状态。显隐统一由 Vue UI PanelService
管理，布局仅消费 rightVisible，不增加 Core 侧栏状态。窄屏采用地图下方堆叠布局。

图层/图例面板的数量徽标、名称搜索、刷新和卡片样式归 ui-vue。搜索不修改图层集合或顺序；
刷新不请求数据源或重置 style/legend，数量派生自现有 Runtime 数据。分组隐藏继续沿用
LayerService 的递归显隐能力。分组自身的 visible 由当前子图层派生，任意后代可见时显示为可见，
切换单个子图层不会修改兄弟层。AppState 与 UI 读取同一可见值。

图层 style 增加 fillOpacity、lineDash 和 lineCap。Core 校验数值范围和枚举，OpenLayers
在基础样式和分类样式中应用填充 alpha 乘数、线型和端点。
