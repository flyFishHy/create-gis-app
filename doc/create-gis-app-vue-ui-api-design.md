# create-gis-app Vue UI API 设计规范

> **文档状态：** Architecture Proposal / v1\
> **适用模块：** `@joinmap/ui-vue`\
> **前置架构：** 独立 GIS Application Runtime；Core 不依赖
> Vue；地图引擎通过 Adapter 接入\
> **官方 UI 技术栈：** Vue 3 + TypeScript + CSS\
> **设计目标：** 为 Runtime 提供默认、可扩展、可定制的 Vue UI
> 实现，而不是把 GIS Runtime 变成 Vue 组件库。

------------------------------------------------------------------------

## 1. 定位与设计原则

视觉表面修订：玻璃 mixin 按 -webkit-backdrop-filter、backdrop-filter 顺序声明，
构建后验证两者都保留。Overlay 的 Header、搜索、时间、工具栏、面板共享玻璃背景和
阴影，默认 16px 模糊、72% 背景占比。Docked 的连续外层和设置浮层共用参考页的材质，液态玻璃区分深浅主题。下拉浮层使用较实的底色。
工具栏外层滚动容器统一承担背景、圆角与阴影；属性面板祖先
允许阴影溢出，内容由 PanelShell 按圆角裁切。字体通过局部 .875rem 基础字号与派生变量缩放，采用系统中英文字体、
400/500/600/700 字重，数字使用等宽字体；不更改宿主 html。控件最小高度统一为
2.75rem，状态栏相应放宽列宽及换列阈值。保留已有面板位置与容器响应式布局。

Core 内部模块整理不改变 Vue UI 接入 API：仍通过包根契约、`app.context` 与只读
State 连接 Runtime。组件销毁须继续取消自己创建的订阅；Runtime 最终销毁也会释放
事件/选择监听。保留的 MapView 代理在执行写操作时检查生命周期，UI 不应在 shutdown
后继续提交地图操作。卸载期间解除 target 与必要读取仍可执行。Core 的类型拆分、
错误模型、DataSet/配置/快照模块均为内部组织调整，不引入 Vue 依赖或第二份 UI 状态。

### 1.1 Vue UI 的定位

`@joinmap/ui-vue` 是 GIS Application Runtime 的官方 Vue UI
Adapter。它负责将 Runtime 暴露的应用能力呈现为 Vue
界面，并提供面板、工具栏、弹窗、布局和 UI 扩展机制。

它不负责：

-   创建或管理 OpenLayers Map、Layer、Source、Feature。
-   实现图层数据加载、图层工厂、数据处理和 GIS 业务算法。
-   直接修改 Runtime 私有状态。
-   取代 Runtime 的 Plugin System、Service Registry 或 State。
-   强制业务应用采用某个 UI 组件库。

### 1.2 核心原则

1.  **Core 无 Vue 依赖**：Vue 包依赖 Runtime 公共契约，反向依赖禁止。
2.  **UI 消费 Runtime**：组件通过 composables 和公开 Services 操作应用。
3.  **面板可选**：Search、Legend、LayerManager
    等不是强制内置在每个应用中的固定 DOM。
4.  **默认开箱即用，允许替换**：默认 Layout
    和面板可直接使用，也可完全自定义。
5.  **业务组件与框架组件分离**：通用容器、PanelHost、Toolbar 等属于 UI
    基础设施；具体 Search、Legend 等属于官方 UI 功能。
6.  **配置可描述，组件可扩展**：JSON 配置描述面板
    ID、位置、可见性和顺序；Vue Component 由代码注册，不放进 JSON。
7.  **状态单一来源**：业务状态归 Runtime Service/State；纯 UI 临时状态归
    Vue UI。
8.  **生命周期明确**：卸载 UI 不销毁 Runtime；销毁 UI 资源不误删 Runtime
    资源。
9.  **不过度抽象**：v1
    只提供确实需要的扩展点，不实现完整的通用低代码页面引擎。

------------------------------------------------------------------------

## 2. 包结构与依赖关系

建议初期单仓库多模块，成熟后再按发布需求拆分 npm 包。

``` text
packages/
  core/
    src/                    # 与 Vue 无关的 Runtime
  adapter-ol/
    src/                    # OpenLayers Adapter
  ui-vue/
    src/
      adapter/
      app/
      layout/
      panel/
      toolbar/
      popup/
      components/
      panels/
      composables/
      styles/
      types/
      index.ts
```

### 2.1 依赖规则

``` text
@joinmap/ui-vue
   ├── Vue 3
   └── @joinmap/gis-core (public API only)

@joinmap/adapter-ol
   ├── OpenLayers
   └── @joinmap/gis-core (public API only)

@joinmap/gis-core
   └── TypeScript / platform APIs
```

`ui-vue` 不应直接依赖 `adapter-ol`。UI 需要地图能力时，调用 Core 的
`MapService`、`LayerService`、`InteractionService`
等；需要引擎专属能力时，应由业务插件或明确的 OL 扩展包处理。

### 2.2 建议导出入口

``` ts
// 主入口
import {
  createVueUI,
  useGISApp,
  useGISState,
  useMap,
  useLayers,
  usePanel,
} from '@joinmap/ui-vue'

// 官方面板按需导入
import {
  SearchPanel,
  LegendPanel,
  LayerManagerPanel,
  Toolbar,
} from '@joinmap/ui-vue/panels'

// 样式
import '@joinmap/ui-vue/style.css'
```

不要让用户依赖 `@joinmap/ui-vue/src/...`
这样的内部路径。需要稳定的公共导出和明确的 package exports。

------------------------------------------------------------------------

## 3. 与 Runtime 的集成模型

### 3.1 使用方式

推荐应用入口：

``` ts
import { createGISApp } from '@joinmap/gis-core'
import { createOLAdapter } from '@joinmap/adapter-ol'
import { createVueUI } from '@joinmap/ui-vue'

const app = createGISApp({
  id: 'network-monitor',
  name: 'Network Monitor',
})

app.use(createOLAdapter())
app.use(createVueUI({ config: { layout: 'docked-dashboard' } }))

await app.init(appConfig)
await app.mount('#app')
```

`createVueUI()` 返回 Runtime 可识别的 UI Plugin/Adapter。它只注册 UI
能力和默认 UI 定义；真正创建 Vue App 和 DOM 应发生在 `mount()` 阶段。

### 3.2 UI Plugin 契约

建议 Core 定义最小 UI Adapter 契约，Vue 包实现它：

``` ts
export interface UIAdapter {
  readonly name: string
  install(context: AppContext): void | Promise<void>
  mount(target: Element | string): void | Promise<void>
  unmount(): void | Promise<void>
  dispose(): void | Promise<void>
}
```

如果 Runtime 的插件协议统一为 `GISPlugin`，Vue UI 可以实现普通
Plugin，并在安装时向 Core 注册 UI Adapter。不要让 Core import Vue 的
`App`、`Component` 或 `VNode` 类型。

### 3.3 挂载职责

生命周期状态机、失败语义、并发规则和总体清理顺序以 Runtime 设计稿第 5.1 节为
唯一规范。Vue UI Adapter 只负责其拥有的 Vue App、DOM、组件订阅和面板注册资源：
`mount()` 创建并挂载 UI；`unmount()` 卸载 UI、解除 map target；`dispose()` 清理
Adapter 自有资源。GISApp 按 Runtime 约定调用这些方法并协调全局清理。

`mount()` 必须支持 `Element | string`。目标不存在、重复挂载或 UI Adapter
未安装时，抛出明确错误。

------------------------------------------------------------------------

## 4. createVueUI API

### 4.1 配置与实现扩展

`createVueUI({ config, panelDefinitions, layouts, extensions, toolbarItems, toolbarComponent, statusComponent, appProps })`：
config 使用 Core UIConfig，提供 UI 默认布局、主题、语言和面板配置。它与 appConfig.ui
共享结构；按内置预设、UI 默认配置、AppConfig 显式字段顺序解析一次，随后由用户交互更新
当前状态。面板按 ID/字段合并，主题 Token 按键合并。不存在第二个 defaults 开关。

panelDefinitions 注册 Vue 组件；layouts 将名字绑定到 Vue 组件，由 UIConfig.layout 选择。
组件、回调和 Renderer 留在代码中；图层图例和搜索 Provider 不作为 Vue UI 插件业务参数。
原顶层 layout/theme/defaults/panels/legends/searchProviders/kpis 参数被替代；完整契约见
[Vue UI API](vue-ui-api.md)。

### 4.2 内置控件与独立引用

插件通过 `ui.panels` 管理 Search、Time、LayerManager、Legend、Toolbar、Properties
和 Status。Toolbar 保留专用槽位，可见性由 PanelRegistry 控制。Toolbar 和 Time 支持
top，Status 支持 bottom。不兼容位置输出诊断并回退。要素候选选择器由地图区域内置。

已初始化 Runtime 的宿主 Vue 项目可以渲染 `<GISWorkspace :app="app" />`，复用同一个
UI Adapter、Context 和当前状态；组件通过 Runtime mount/unmount 协调生命周期，保留宿主
provide/inject，不创建嵌套 Vue App。同一 Runtime 不能由两个工作区争用地图 target。
宿主卸载只卸载 UI，Runtime dispose 才清理服务和插件；配置默认值仍在 init 前传入。

纯展示 Legend 接收 definitions/titles/emptyText，不依赖 Runtime；LegendPanel 是读取图层
快照的连接组件。PanelShell、Tooltip 等基础组件可通过 props/slots 独立使用。

------------------------------------------------------------------------

## 5. Vue UI 根组件与布局

### 5.1 根组件职责

官方根组件 `GISUIRoot` 负责：

-   建立 UI Context。
-   渲染地图容器。
-   渲染 Layout。
-   渲染 PanelHost、ToolbarHost、PopupHost。
-   监听 UI 生命周期。
-   提供统一主题变量和基础样式。

它不应实现具体图层管理、搜索请求或图例计算逻辑。

### 5.2 默认布局

布局属于 `ui-vue`：它负责页面区域的编排、响应式尺寸和面板槽位，不属于
Runtime Core 或 OpenLayers Adapter。参考 `gis-dashboard-layout` 的 Docked 和
Overlay 两种页面组织方式，v1 可提供两个官方 Layout：`docked-dashboard` 与
`overlay-dashboard`。二者复用相同的面板定义、PanelHost 和 MapViewport，差异只
在布局组件与样式；不要复制面板业务逻辑。

参考实现中的 `TitlePanel`、`SearchPanel`、`LayerPanel`、`LegendPanel`、
`ToolbarPanel`、`PropertyPanel`、`StatusPanel` 是示例面板。正式实现时分别归入
Vue UI 的 `panels/`，按需注册；不能把这些业务面板写死在 Core Layout 中。
`MapViewport` 是 Vue UI 提供的宿主组件，负责提供 DOM target 并连接 Runtime 的
MapService；实际地图对象仍由 Map Adapter 创建和管理。参考项目的地图仅为占位，
没有 OpenLayers API 可直接移植。

布局配置应选择已由代码注册的布局名，不接受 JSON 中的组件路径或任意代码：

``` ts
createVueUI({ layout: 'docked-dashboard' })
createVueUI({ layout: 'overlay-dashboard' })
```

布局提供 MapViewport 和面板槽位：

``` text
GISUIRoot
└── DockedDashboardLayout | OverlayDashboardLayout
    ├── MapViewport
    │   └── map target element
    ├── ToolbarHost
    ├── PanelRegion (left)
    ├── PanelRegion (right)
    ├── PanelRegion (top)
    ├── PanelRegion (bottom)
    ├── FloatingPanelRegion
    └── PopupHost
```

布局区域由 Layout 决定如何排列；PanelRegion 根据 Vue UI 注册信息和配置渲染面板，
不把某个具体业务面板固定绑定到某个 Layout。布局可包含标题栏、工具栏、状态栏等
专用槽位；若这些区域承载可插拔业务功能，应仍经 Vue UI 注册机制提供内容。

### 5.2.1 Docked Dashboard 具体布局

Docked 模式使用带外部留白的标题卡片，下方是三列 Grid 工作区：

``` text
┌──────────────────────────────────────────────────────────┐
│ Title                                        Theme / Lang│
└──────────────────────────────────────────────────────────┘
┌─────────────┐  ┌───────────────────────────┐  ┌────────────┐
│ Layer       │  │ Search      Toolbar       │  │ Property   │
│             │  ├───────────────────────────┤  │            │
├─────────────┤  │ Map                       │  │            │
│ Legend      │  ├───────────────────────────┤  │            │
│             │  │ Status                    │  │            │
└─────────────┘  └───────────────────────────┘  └────────────┘
```

- 标题卡片高约 52px；页面外部留白、标题与工作区间隔、区域间距统一使用
  `--gis-ui-gap`，默认 12px。标题采用与其他面板相同的边框、圆角和阴影。
- 工作区为左侧栏、地图列、右侧属性栏三列，参考侧栏宽度为 320px / 320px；
  两侧栏贯穿操作行、地图和状态栏的完整高度，Layers 和 Legend 平分左侧高度。
- 地图列从上至下为操作行、弹性地图、状态栏。操作行是独立容器，不覆盖地图；
  `top` 插槽左对齐，`toolbar` 插槽右对齐，不将具体业务组件绑定到布局。
- 默认 Search 注册到 `top`，使用 `VuePanelDefinition.unframed: true`，
  仅渲染搜索框和图标；PanelHost 保留显示、位置、顺序和尺寸状态，不渲染面板外壳。
  搜索结果是输入框下方的浮层；Escape、焦点移出、点击外部或选择结果时关闭，
  不撑开操作行。`SearchPanel.dropdown` 默认为 false，默认注册开启此呈现模式。
- 工具栏横向按缩放、测量/绘制、删除分组，按钮保留图标和 Tooltip，无标题。
  Tooltip 使用 `placement="bottom"`，视口下方空间不足时翻转到上方。
- 操作行按可用宽度换行，不缩小按钮。中等视口缩窄侧栏；800px 及以下将操作行、
  地图、状态栏和左右侧栏改为可滚动的单列布局，保证地图最小可用高度。
- 尺寸与间距属于 Vue UI 样式，不新增 Core 配置契约。显式配置的面板位置优先于默认位置。

### 5.2.2 Overlay Dashboard 具体布局

Overlay 模式中，地图作为完整工作画布，搜索、图层、图例、属性、工具栏和状态栏以
浮层覆盖地图；标题栏仍占据顶部独立行：

``` text
┌──────────────────────────────────────────────────────────┐
│ Title                                                    │
├──────────────────────────────────────────────────────────┤
│ Layers      Search + Layer time              Properties│
│ 左上                                      按需抽屉    │
│                                      ┌──┐             │
│                  Map                 │工│             │
│ Legend                               │具│             │
│ 左下                                 └──┘             │
│                Status: 上标题 / 下数据                  │
└──────────────────────────────────────────────────────────┘
```

- 标题栏约 60px；地图工作区填满剩余高度并作为浮层定位容器。
- 图层管理位于左上，图例位于左下；搜索浮层从图层列右侧开始，时间控件跟随搜索右侧，空间不足换行。
- 工具栏位于剩余地图区域右侧正中，使用纵向图标组，提示自动避让视口边缘。
- 属性面板为右侧按需抽屉，选中要素后打开；关闭只隐藏面板，不清除选择，下一次选择重新打开。
  左侧图层/图例保持原位，属性抽屉占用独立右侧轨道。选择联动由内置 Vue UI 负责，不进入 Core 或 OL Adapter。
- 图层、图例和属性默认同宽 300px，通过 --gis-ui-overlay-panel-width 统一覆盖。
  - 状态栏位于底部中央，Overlay 每项上方为标题、下方为数据，经纬度合并后四项固定列宽排列；Docked 使用紧凑单行。
  地图级别由 AppState 提供，在状态栏显示，不再占据工具栏。
- 搜索右侧使用 LayerTimePanel。它通过公开 LayerInstance 时间能力读取 GeoJSON 图层的离散
  独立的 TimeFilterPicker，可选小时、天、ISO 周、月、年和精确起止时间。组件输出标准化查询范围，由业务决定如何查询。
  默认启用，可通过 `ui.panels[id=time].visible` 覆盖。
- 浮层使用统一 Grid，根据地图容器宽度避让：1100px 及以下状态栏独占底部行，
  900px 及以下属性仍位于右侧，打开时临时隐藏图层/图例列，关闭即恢复，不改写面板可见状态。
  工具栏及面板内部滚动，空白网格不拦截地图事件。Grid 列宽及抽屉显隐过渡遵循 reduced-motion。
- MapStatusPanel 属于 ui-vue，依赖只读快照及可选 coordinate/scale props；
  Demo 的 OL 包装层负责鼠标坐标与按投影/中心位置计算比例尺。结果列表独立于状态栏。

以上尺寸和断点是 `gis-dashboard-layout` 示例的起始参考值。正式实现应结合面板内容、
地图最小可用尺寸和实际容器宽度微调，并通过 CSS Variables 或布局选项覆盖。

布局区域：

  区域       典型用途               默认行为
  ---------- ---------------------- --------------------
  left       搜索、业务筛选         可折叠
  right      图例、图层管理、属性   可折叠
  top        顶部工具栏、标题       高度由内容决定
  bottom     时间轴、状态栏         可折叠
  floating   浮动分析面板           可拖动能力后续评估

地图容器应填充可用空间。面板展开/收起后调用
`map.updateSize()`，但应做合并或 requestAnimationFrame 调度，避免连续
resize 导致大量同步更新。

### 5.3 自定义 Layout

允许传入自定义 Vue 组件：

``` ts
createVueUI({
  layout: MyGISLayout,
})
```

自定义 Layout 通过 UI composables 获取 Runtime 和面板描述，不直接读取 UI
包内部 Store。

建议提供可选插槽组件：

``` vue
<template>
  <div class="my-layout">
    <MapViewport />
    <PanelRegion position="left" />
    <PanelRegion position="right" />
    <ToolbarHost />
    <PopupHost />
  </div>
</template>
```

`MapViewport`、`PanelRegion` 等是 UI
包提供的布局组件。它们负责宿主区域，不负责业务面板内容。

------------------------------------------------------------------------

## 6. 面板系统

### 6.1 设计目标

面板系统是 Vue UI 的核心扩展点。它应支持：

-   注册官方面板和业务自定义面板。
-   左、右、上、下、浮动区域。
-   显示/隐藏、折叠/展开、排序。
-   标题、图标、尺寸约束。
-   组件 props。
-   面板实例访问 Runtime。
-   通过 `appConfig.json` 配置面板布局。
-   在不修改 Runtime Core 的情况下增加新面板。

### 6.2 Panel Definition

Core 只定义与 UI 框架无关的 `PanelDescriptor` 元数据。Vue UI 定义 Vue
组件类型：

``` ts
import type { Component } from 'vue'
import type { PanelDescriptor, PanelPosition } from '@joinmap/gis-core'

export interface VuePanelDefinition extends PanelDescriptor {
  icon?: string
  component: Component
  defaultCollapsed?: boolean
  width?: number | string
  minWidth?: number | string
  maxWidth?: number | string
  height?: number | string
  minHeight?: number | string
  maxHeight?: number | string
  resizable?: boolean
  collapsible?: boolean
  closable?: boolean
  keepAlive?: boolean
  props?: Record<string, unknown>
}
```

注意：`component` 只存在于 Vue UI 层，绝不进入 JSON 配置。

### 6.3 注册方式

通过 `createVueUI()` 初始注册：

``` ts
createVueUI({
  panels: [
    {
      id: 'search',
      title: 'Search',
      component: SearchPanel,
      position: 'left',
      defaultVisible: true,
      width: 320,
    },
    {
      id: 'legend',
      title: 'Legend',
      component: LegendPanel,
      position: 'right',
      defaultVisible: true,
      width: 280,
    },
  ],
})
```

运行时注册应通过 UI 扩展 API，而不是直接修改 PanelHost：

``` ts
const ui = useGISUI(app)

ui.panels.register({
  id: 'asset-analysis',
  title: 'Asset Analysis',
  component: AssetAnalysisPanel,
  position: 'right',
})
```

v1 唯一的 UI 扩展安装入口是 `createVueUI({ extensions })`。扩展在 UI Adapter
安装阶段收到 `GISUIContext`，并通过 `ui.panels`、`ui.toolbar` 等公开 API 注册；
扩展返回的清理函数由 UI Adapter 保存到自己的 ResourceScope，在安装失败回滚或
GISApp dispose 时执行。v1 不支持运行时热安装或热卸载 UI 扩展。Runtime Plugin
仍负责 Core 能力与依赖，不直接注册 Vue Component。

### 6.4 Panel Runtime State

面板定义和面板运行时状态分开：

``` ts
export interface PanelState {
  id: string
  visible: boolean
  collapsed: boolean
  position: PanelPosition
  order: number
}
```

Panel Registry 保存不可变定义；Panel State 保存可变 UI
状态。不要直接修改 Definition 对象来表示用户折叠或隐藏面板。

### 6.5 Panel API

``` ts
export interface PanelService {
  register(definition: VuePanelDefinition): Unsubscribe
  get(id: string): VuePanelDefinition | undefined
  list(position?: PanelPosition): VuePanelDefinition[]
  show(id: string): void
  hide(id: string): void
  toggle(id: string): void
  collapse(id: string): void
  expand(id: string): void
  setOrder(ids: string[], position?: PanelPosition): void
  getState(id: string): PanelState | undefined
}
```

重复 ID 默认报错。`register()` 返回的 Unsubscribe
用于撤销该注册；如果面板正在显示，撤销时应先卸载对应面板并清理相关 UI
资源。

### 6.6 Panel 组件约定

面板组件应尽量保持普通 Vue 组件，不要求继承基类：

``` vue
<script setup lang="ts">
import { useLayers } from '@joinmap/ui-vue'

const { layers, setVisibility } = useLayers()
</script>

<template>
  <section class="layer-manager">
    <!-- 面板内容 -->
  </section>
</template>
```

PanelHost
负责外层标题栏、关闭按钮、折叠、尺寸和布局；业务面板负责内部内容。避免每个面板重复实现一套外壳。

如果面板需要自定义 Header，可通过 `PanelShell` 的 slot 或定义
`headerComponent` 扩展，不要让业务面板绕过统一布局系统。

### 6.7 面板配置

`appConfig.json` 只配置已注册面板的状态和布局：

``` json
{
  "ui": {
    "panels": [
      {
        "id": "search",
        "visible": true,
        "position": "left",
        "order": 10,
        "width": 320
      },
      {
        "id": "legend",
        "visible": true,
        "position": "right",
        "order": 20,
        "collapsed": false
      }
    ]
  }
}
```

组件、回调函数、VNode、插槽不能放入 JSON。

------------------------------------------------------------------------

## 7. 官方面板 API

官方面板应是独立、可选的 Vue 组件。它们使用 Runtime
Services，而不是自己创建业务状态副本。

### 7.1 SearchPanel

职责：

-   输入关键字和搜索条件。
-   显示搜索结果。
-   选择结果并定位地图。
-   允许业务自定义搜索 Provider。
-   管理 loading、empty、error 状态。

不负责：具体后端接口、地理编码服务或业务数据权限。

建议 Provider 契约：

``` ts
export interface SearchQuery {
  keyword: string
  filters?: Record<string, unknown>
  signal?: AbortSignal
}

export interface SearchResult<T = unknown> {
  id: string
  title: string
  subtitle?: string
  coordinate?: [number, number]
  extent?: [number, number, number, number]
  data?: T
}

export interface SearchProvider {
  id: string
  search(query: SearchQuery): Promise<SearchResult[]>
}
```

Provider 由 Runtime 所有，可在 init 前或运行时注册；UI 卸载不清理业务 Provider。各查询通过自己的 AbortSignal 取消，UI 管理旧请求失效。注册 Provider：

``` ts
app.search.registerProvider({
  id: 'asset-search',
  async search({ keyword, signal }) {
    return api.searchAssets(keyword, { signal })
  },
})
```

选择结果后的地图定位应调用 Runtime 的 `MapService`/定位能力；若当前
MapService 尚无 fit/animate API，应在 Core Map Contract
中补充明确能力，不要让 SearchPanel 直接拿 OpenLayers Map。

组件 Props 建议：

``` ts
interface SearchPanelProps {
  placeholder?: string
  debounce?: number
  emptyText?: string
  maxResults?: number
}
```

### 7.2 LegendPanel

职责：

-   展示图层对应的图例。
-   支持分类、连续、分段、无数据项。
-   支持折叠和按图层分组。
-   支持图例项开关（仅当图例定义声明支持交互）。

图例数据结构由 Core 导出的、与 UI 框架无关的 Legend 契约提供；LegendPanel
只接收并渲染定义：

``` ts
import type { LegendDefinition, LegendItem, LegendStop } from '@joinmap/gis-core'
```

不要让 LegendPanel 自己根据原始 GeoJSON
计算统计值和分类规则。图例生成应由数据/样式能力提供，面板只负责呈现。

### 7.3 LayerManagerPanel

职责：

-   展示图层树和分组。
-   显隐切换。
-   排序和拖拽（作为可选能力）。
-   展开/折叠分组。
-   显示图层状态。
-   提供图层操作入口。

所有操作通过 `LayerService`：

``` ts
const layers = useLayers()

layers.setVisibility(id, visible)
await layers.remove(id)
await layers.update(id, patch)
```

拖拽排序调用 `setOrder()`，必须保证传入 ID
集合和分组约束有效。不要通过直接移动 DOM 改变地图图层顺序。

### 7.4 Toolbar

Toolbar 由可注册的 Toolbar Item 构成：

``` ts
export interface ToolbarItemDefinition {
  id: string
  title: string
  icon?: string
  group?: string
  order?: number
  disabled?: boolean | (() => boolean)
  active?: boolean
  shortcut?: string
  onClick?: () => void | Promise<void>
  toolId?: string
}
```

如果项目工具由 Runtime `InteractionService` 管理，Toolbar Item
应优先声明 `toolId`，点击后调用 `activateTool()`；普通 UI 命令才使用
`onClick`。

Toolbar 不应把地图交互实现写在按钮组件里。

### 7.5 要素选择器与属性展示

`FeaturePicker.vue` 由 `GISUIRoot` 的地图槽统一挂载。Runtime 汇总一次点击的
本地和图层查询结果后，只有多命中才在点击位置打开候选列表。列表显示要素名称和
图层标题，靠近视口边缘时调整位置。用户选择一项后关闭列表，通过现有选中状态
打开右侧 Properties。单命中直接进入 Properties。Escape 取消选择器并保留已有
选中项。旧 `ui.panels` 中的 `popup` 配置被忽略。

Properties 和独立导出的 `FeaturePopup` 继续共用默认字段展示、自定义组件和
Feature Detail Renderer。候选选择器只展示当前点击对应的候选。

建议 Renderer：

``` ts
export interface FeatureRendererDefinition {
  id: string
  match(feature: FeatureReference): boolean
  component: Component
  priority?: number
}
```

OpenLayers 的选择器通过 MapService 挂到原生 `Overlay`，以点击坐标为锚点。
平移时跟随锚点，靠近边缘时调整弹框位置。缩放或旋转时关闭候选。其他适配器使用
点击像素。

地图点选、选择器确认以及带 `SearchResult.feature` 的搜索结果点击都提交同一个
选中状态。右侧 Properties 展示该状态，OpenLayers 适配器为本地矢量要素绘制高亮。
关闭属性面板保留选择。图层隐藏、数据替换和过滤导致选择失效时同步清理高亮。

### 7.6 KpiPanel 与 TimeController

这两个面板偏业务能力，建议作为官方可选示例/扩展，不作为 Runtime
必需模块。

KPI 数据通过业务 Service 或数据集提供。TimeController 可独立接收数值范围或离散时间值；
内置 LayerTimePanel 通过通用 LayerInstance 时间能力控制图层过滤。Core 不持有全局业务时钟，
也不固化某个项目的指标字段或时间序列数据格式。

------------------------------------------------------------------------

## 8. Composables API

Composables 是 Vue UI 访问 Runtime 的推荐入口。组件不应到处 `inject()`
私有 key，也不应直接操作 AppContext 内部实现。

### 8.1 useGISApp

``` ts
export function useGISApp(): GISApp
```

获取当前 Vue UI 所属 Runtime。只能在组件 setup 或合法的 Vue
注入上下文中调用；缺少 Provider 时抛出明确错误。

### 8.2 useGISState

``` ts
export function useGISState<T>(
  selector: (state: AppStateSnapshot) => T,
): Readonly<Ref<T>>
```

将 Core State 订阅桥接为 Vue Ref。建议按 selector 订阅，避免每次 State
变化都让所有组件更新。返回只读 Ref，修改状态必须调用 Runtime State API
或对应 Service。

示例：

``` ts
const activeToolId = useGISState(
  state => state.ui.activeToolId,
)
```

### 8.3 useMap

``` ts
export function useMap(): {
  isReady: Readonly<Ref<boolean>>
  updateSize(): void
  setTarget(target: HTMLElement | undefined): void
  getView(): MapViewService
}
```

只暴露通用地图能力。不要在 Core composable 中返回 `ol/Map`。

### 8.4 useLayers

``` ts
export function useLayers(): {
  layers: Readonly<Ref<LayerSummary[]>>
  get(id: string): LayerInstance | undefined
  add(config: LayerConfig): Promise<LayerInstance>
  update(id: string, patch: LayerUpdate): Promise<void>
  remove(id: string): Promise<void>
  setVisibility(id: string, visible: boolean): void
  setOrder(ids: string[]): void
}
```

`layers` 是轻量摘要快照，不能把大量底层 Feature 或地图对象转换成 Vue
深层响应式数据。

### 8.5 useInteractions

``` ts
export function useInteractions(): {
  selectedFeature: Readonly<Ref<FeatureReference | undefined>>
  activeToolId: Readonly<Ref<string | undefined>>
  activateTool(id: string): Promise<void>
  deactivateTool(): Promise<void>
  clearSelection(): void
}
```

### 8.6 useGISUI

``` ts
export function useGISUI(): GISUIContext
```

访问 Vue UI 自身能力，例如
PanelService、ToolbarService、ThemeService。它不是 Core 的替代品。

### 8.7 usePanel

``` ts
export function usePanel(id: string): {
  state: Readonly<Ref<PanelState | undefined>>
  show(): void
  hide(): void
  toggle(): void
  collapse(): void
  expand(): void
}
```

### 8.8 Composable 规则

-   只在 setup 上下文调用，除非明确设计为显式传入 app 的纯函数 API。
-   返回只读 Ref；写操作走方法。
-   订阅在组件卸载时自动清理。
-   不把整个 Runtime 深度 `reactive()`。
-   避免一个 `useGIS()` 返回所有功能的巨型对象；按领域拆分。
-   需要在组件外使用时，提供 `getGISUI(app)` 等显式参数 API，不伪装成
    composable。

------------------------------------------------------------------------

## 9. UI Context 与状态边界

### 9.1 两类状态

**Runtime State：**

-   激活工具 ID。
-   选中 Feature 引用。
-   图层可见性和顺序。
-   业务分析参数。
-   地图领域状态。

**Vue UI State：**

-   面板是否折叠。
-   当前打开的菜单。
-   输入框临时内容。
-   下拉列表展开状态。
-   当前焦点、hover。
-   面板拖动尺寸（若由 UI 管理）。

判断规则：多个 UI 或插件需要共享、影响 GIS 行为的状态归
Runtime；纯展示状态归 Vue UI。

### 9.2 Vue UI Context

``` ts
export interface GISUIContext {
  readonly app: GISApp
  readonly panels: PanelService
  readonly toolbar: ToolbarService
  readonly theme: ThemeService
  readonly overlays: OverlayService
}
```

Vue UI Context 由 UI Adapter 创建，并通过 Vue `provide/inject`
提供。不要将 Vue `Ref` 放入 Core 的 AppContext。

### 9.3 更新性能

-   地图高频事件不要直接导致整个 UI Root 重渲染。
-   图层列表订阅应使用摘要数据和细粒度更新。
-   大数据使用 shallowRef、分页、虚拟列表或按需查询。
-   复杂面板使用局部组件边界。
-   地图 resize 更新应合并。
-   UI 只订阅自己关心的 State 片段。

------------------------------------------------------------------------

## 10. 主题与样式 API

### 10.1 主题目标

官方 UI 应有一致的默认视觉规范，但不能把颜色和尺寸写死在组件内。建议使用
CSS Variables + SCSS。

``` ts
export interface ThemeOptions {
  mode?: 'light' | 'dark' | 'system'
  tokens?: Partial<ThemeTokens>
  className?: string
}
```

主题 Token 示例：

``` ts
export interface ThemeTokens {
  colorBackground: string
  colorSurface: string
  colorSurfaceElevated: string
  colorText: string
  colorTextMuted: string
  colorBorder: string
  colorPrimary: string
  colorHover: string
  panelRadius: string
  panelShadow: string
  panelWidth: string
  toolbarHeight: string
  spacingUnit: string
  fontFamily: string
  fontSize: string
}
```

默认暗色主题可采用深蓝黑背景、低对比边界和局部渐变层次，但具体值应集中在
Token，不散落到各组件。

### 10.2 CSS 变量

``` scss
:root {
  --gis-color-background: #040a21;
  --gis-color-surface: #101b3e;
  --gis-color-surface-highlight: #132662;
  --gis-color-text: #e8eefc;
  --gis-color-text-muted: #94a3bd;
  --gis-color-border: rgb(148 163 189 / 16%);
  --gis-panel-radius: 10px;
  --gis-toolbar-height: 44px;
}
```

这些是主题默认值示例，不应被视为所有项目必须使用的固定色板。

### 10.3 样式隔离

-   类名统一使用 `gis-` 前缀。
-   不对 `button`、`input`、`div` 等全局标签做无作用域覆盖。
-   组件样式优先 scoped 或基于命名空间。
-   允许用户覆盖 CSS Variables。
-   不强制引入 Element Plus 等 UI 组件库。
-   暴露 `styles` 入口，允许用户选择是否导入默认样式。

------------------------------------------------------------------------

## 11. 组件 API 与插槽规范

### 11.1 组件约定

-   Props 只表达输入配置。
-   Emits 表达用户交互或状态变化通知。
-   Runtime 写操作调用 Service，不通过大量 emit 层层向上传递。
-   插槽用于局部视觉定制，不替代插件注册机制。
-   复杂组件提供无头逻辑 composable 或基础子组件。

### 11.2 PanelShell

建议公共外壳：

``` vue
<PanelShell
  title="Legend"
  :visible="visible"
  :collapsible="true"
  @close="hide"
>
  <LegendPanelContent />
</PanelShell>
```

Slots：

-   `title`：标题区。
-   `actions`：标题栏右侧操作。
-   `default`：面板主体。
-   `footer`：面板底部。

### 11.3 LayerManager 插槽示例

``` vue
<LayerManagerPanel>
  <template #layer="{ layer }">
    <MyLayerRow :layer="layer" />
  </template>

  <template #empty>
    暂无图层
  </template>
</LayerManagerPanel>
```

插槽参数必须有明确 TypeScript
类型；不要为每个细节无限增加插槽，优先覆盖真实定制需求。

------------------------------------------------------------------------

## 12. UI 插件扩展

### 12.1 扩展类型

UI 插件可注册：

-   Panel。
-   Toolbar Item。
-   Feature Renderer。
-   Search Provider。
-   Theme Token。
-   自定义布局组件（受控扩展）。

不应让 UI 插件直接修改其他插件内部组件状态。

### 12.2 Vue UI Plugin

``` ts
export interface VueUIPlugin {
  name: string
  install(ui: GISUIContext): void | (() => void)
}
```

示例：

``` ts
const assetPanelPlugin: VueUIPlugin = {
  name: 'asset-panel',

  install(ui) {
    const unregister = ui.panels.register({
      id: 'asset-analysis',
      title: 'Asset Analysis',
      component: AssetAnalysisPanel,
      position: 'right',
      defaultVisible: true,
    })

    return unregister
  },
}
```

Core 只定义不含 Vue 类型的 `PanelDescriptor` 元数据契约。Vue UI 独立管理
Vue 组件注册、Panel Registry、面板运行时状态、渲染和布局。需要 Runtime Plugin
依赖与资源管理的扩展可由 Runtime Plugin 安装，并通过 Vue UI 公共扩展 API
登记组件；两侧共享 GISApp 的生命周期和 ResourceScope 清理规则。

### 12.3 注册时机

面板定义在 `createVueUI({ panels })` 创建时静态提供；扩展在
`createVueUI({ extensions })` 创建时提供，并在 UI Adapter install 阶段运行。
v1 不提供其他注册时机，避免多个 Registry 或无法确定清理所有者。

v1 不支持任意时刻热卸载 Vue UI 插件。注册函数返回的清理回调必须在插件安装
失败回滚和 GISApp dispose 时执行；不能因没有热卸载而遗留注册项或监听器。

------------------------------------------------------------------------

## 13. appConfig 与 Vue UI 的映射

### 13.1 JSON 只描述实例配置

``` json
{
  "ui": {
    "layout": "docked-dashboard",
    "theme": "dark",
    "panels": [
      {
        "id": "search",
        "visible": true,
        "position": "left",
        "order": 10
      },
      {
        "id": "legend",
        "visible": true,
        "position": "right",
        "order": 20
      },
      {
        "id": "layer-manager",
        "visible": true,
        "position": "right",
        "order": 30
      }
    ],
    "toolbar": {
      "visible": true,
      "position": "top"
    }
  }
}
```

### 13.2 配置与代码注册的关系

布局配置优先级固定为：`appConfig.ui.layout` > `createVueUI({ layout })` >
默认值 `docked-dashboard`。appConfig 只允许选择已经注册的内置布局名；自定义
Vue Layout Component 只能通过代码传入 `createVueUI({ layout: Component })`，
不能写入 JSON。若 appConfig 指定未知布局，初始化配置校验应报错并包含字段路径。

启动过程：

1.  Vue UI 插件注册可用面板定义。
2.  Runtime 读取 appConfig。
3.  UI Adapter 读取 `ui` 配置。
4.  根据 panel ID 查找已注册面板。
5.  合并默认值和应用配置。
6.  创建 Panel State。
7.  Layout 渲染可见面板。

配置中出现未注册的面板
ID，不能凭空加载任意模块或执行代码。应给出可诊断错误或警告。

### 13.3 配置校验

校验：

-   `layout` 是否可用。
-   panel ID 是否已注册。
-   position 是否合法。
-   width/height 是否为合法尺寸。
-   order 是否有效。
-   是否存在重复 panel ID。
-   toolbar item 是否已注册（若配置允许指定）。

------------------------------------------------------------------------

## 14. 弹窗、Overlay 与地图容器

### 14.1 MapViewport

`MapViewport` 负责提供地图 DOM 容器，并把元素引用交给 Runtime
MapService：

``` vue
<div ref="mapElement" class="gis-map-viewport" />
```

挂载时设置 target；卸载时应解除 target，但 UI `unmount()`
是否保留地图对象由 Runtime
生命周期定义。若支持卸载后重新挂载，MapService 必须允许重新设置 target。

### 14.2 PopupHost 与 Overlay

Popup 内容属于 Vue UI，地图位置和坐标映射属于 Map Adapter。建议通过
`OverlayService` 统一桥接：

``` ts
export interface OverlayService {
  open(options: OverlayOptions): string
  close(id: string): void
  closeAll(): void
}
```

Vue UI 将 Overlay Descriptor 渲染为 Vue Component。Core 不应保存 Vue
VNode 或 Component 实例。

### 14.3 安全性

-   不使用 `v-html` 直接渲染不可信属性或服务端文本。
-   用户自定义组件必须由代码显式注册。
-   JSON 配置不能包含任意表达式、脚本或 import 路径。
-   Popup 属性展示应对文本进行正常插值转义。
-   URL、图片和链接内容应按业务安全策略校验。

------------------------------------------------------------------------

## 15. 无头模式与自定义 UI

Runtime 应允许不安装 Vue UI：

``` ts
const app = createGISApp()
app.use(createOLAdapter())
await app.init(config)

// 通过 Runtime API 执行任务，不创建 Vue App
await app.layers.add(layerConfig)
```

自定义 UI 可以使用 Runtime API，而无需 `@joinmap/ui-vue`。Vue UI
是官方默认实现，不是 Runtime 的运行前提。

如果用户只想使用官方某个 composable
或面板，也应允许按需导入；但要确保对应组件依赖的基础 CSS、UI Context
和服务已正确安装。

------------------------------------------------------------------------

## 16. 错误处理与诊断

建议 UI 错误码：

``` ts
export type GISUIErrorCode =
  | 'UI_ALREADY_MOUNTED'
  | 'UI_NOT_INSTALLED'
  | 'UI_TARGET_NOT_FOUND'
  | 'UI_PANEL_DUPLICATE'
  | 'UI_PANEL_NOT_FOUND'
  | 'UI_LAYOUT_NOT_FOUND'
  | 'UI_PLUGIN_INSTALL_FAILED'
  | 'UI_CONTEXT_MISSING'
```

原则：

-   注册冲突在开发阶段明确报错。
-   配置错误包含 `ui.panels[i]` 路径。
-   组件内部异常交给 Vue `errorHandler`，并附带 panel ID。
-   不吞掉异步事件处理器异常。
-   Runtime 错误由 Core 负责，UI 错误由 UI 包负责；跨层错误保留
    `cause`。

------------------------------------------------------------------------

## 17. 性能与可访问性

### 17.1 性能

-   面板按需渲染；隐藏面板默认可卸载，需保留状态时使用 `keepAlive`。
-   大量图层使用虚拟列表。
-   图层 UI 使用轻量 `LayerSummary`，不深度代理地图对象。
-   Search 输入使用 debounce 和 AbortController 取消过期请求。
-   高频地图事件不触发根组件整体更新。
-   面板 resize 合并调用 MapService `updateSize()`。
-   重型业务面板可异步组件加载，但只允许从代码注册的组件定义加载。

### 17.2 可访问性

-   Toolbar 按钮提供可读 label、tooltip 和键盘焦点。
-   面板标题使用正确的语义结构。
-   展开/折叠按钮提供 `aria-expanded`。
-   Dialog/Popup 正确管理焦点和 Escape 行为。
-   颜色不是唯一的信息表达方式。
-   支持减少动态效果的系统偏好。

### 17.3 响应式布局

优先使用 CSS Grid、Flexbox、container queries 和 `minmax()` 等 CSS
能力。媒体查询仍可用于真正的断点布局；不要为了追求"无媒体查询"而牺牲可读性。

------------------------------------------------------------------------

## 18. 测试策略

### 18.1 单元测试

-   Panel Registry 注册、重复 ID、注销。
-   配置合并与校验。
-   Toolbar Registry。
-   Theme Token 合并。
-   Composable 订阅和清理。
-   Search Provider 注册与取消请求。

### 18.2 组件测试

-   PanelShell 展开、折叠、关闭。
-   LayerManager 显隐、排序、空状态。
-   Legend 分类和连续图例。
-   Search loading/error/empty/success。
-   Toolbar active/disabled 状态。

### 18.3 集成测试

-   Runtime + Vue UI 挂载。
-   Runtime unmount 后再次 mount。
-   UI dispose 后无残留监听。
-   Runtime dispose 时 UI 正确释放。
-   无 Vue UI 时 Runtime 仍可运行。
-   自定义 UI 插件注册面板。

------------------------------------------------------------------------

## 19. 推荐源码目录

``` text
ui-vue/src/
  adapter/
    createVueUI.ts
    VueUIAdapter.ts
    UIContext.ts
    install.ts

  app/
    GISUIRoot.vue

  layout/
    DockedDashboardLayout.vue
    OverlayDashboardLayout.vue
    layoutRegistry.ts
    MapViewport.vue
    PanelRegion.vue
    ToolbarHost.vue
    PopupHost.vue

  panel/
    PanelShell.vue
    PanelHost.vue
    PanelRegistry.ts
    PanelService.ts
    types.ts

  toolbar/
    Toolbar.vue
    ToolbarItem.vue
    ToolbarRegistry.ts
    types.ts

  panels/
    title/
      TitlePanel.vue
    search/
      SearchPanel.vue
      useSearch.ts
      types.ts
    legend/
      LegendPanel.vue
      LegendItem.vue
      types.ts
    layer-manager/
      LayerManagerPanel.vue
      LayerTree.vue
      LayerNode.vue
      useLayerManager.ts
    property/
      PropertyPanel.vue
    status/
      StatusPanel.vue
    popup/
      FeaturePopup.vue
    kpi/
      KpiPanel.vue
    time-controller/
      TimeController.vue

  composables/
    useGISApp.ts
    useGISState.ts
    useMap.ts
    useLayers.ts
    useInteractions.ts
    useGISUI.ts
    usePanel.ts

  theme/
    ThemeService.ts
    tokens.ts

  styles/
    index.scss
    variables.scss
    layout.scss
    components.scss

  types/
    index.ts

  index.ts
```

不要机械地为每个目录都创建 Manager/Registry
类。只有存在独立职责、多个消费者或明确扩展需求时才抽取服务；简单逻辑保留为模块内函数。

------------------------------------------------------------------------

## 20. 分阶段实施

### UI 分阶段实施（依赖 Runtime Phase 1 与 2）

本节 Phase 编号仅描述 Vue UI 自身，不覆盖 Runtime 文档中的全局实施阶段。

### UI Phase 1：Vue Adapter 最小闭环

-   `createVueUI()`
-   UI Adapter 生命周期
-   Vue Root
-   Runtime 注入
-   MapViewport
-   DockedDashboardLayout 与 OverlayDashboardLayout
-   mount/unmount/dispose

**验收：** Vue UI 能挂载 Runtime；UI 卸载后 Runtime
仍然存在；可以再次挂载。

**实现基线：** `packages/ui-vue` 已提供 `createVueUI()`、Runtime 注入与
`useGISApp()`、`MapViewport`、Docked/Overlay 两种布局和自定义布局入口。
Runtime 支持 UI unmount 后重新 mount。Panel Registry 随 UI Phase 2 接入；官方业务
面板仍在后续阶段实现。

### UI Phase 2：Panel System

-   Panel Definition
-   Panel Registry / Service
-   PanelHost / PanelRegion / PanelShell
-   appConfig 面板配置映射
-   默认主题
-   自定义面板注册

**验收：** 可通过代码注册自定义 Vue 面板，并通过 JSON
配置其位置和可见性。

**当前实现基线：** `ui-vue` 提供 VuePanelDefinition、PanelService、PanelRegion、
PanelHost、PanelShell；内置布局按位置渲染注册面板。Core 只校验并保留可序列化的
PanelDescriptor/PanelConfig。运行时可通过 `useGISUI().panels` 控制显示、隐藏、
折叠、展开和排序；官方业务面板仍属于 UI Phase 3。

### UI Phase 3：核心 GIS 面板

-   LayerManager
-   Legend
-   Search Provider
-   Toolbar
-   Feature Popup

**验收：** 所有 GIS 操作经由 Runtime
Services；面板不直接操作地图引擎实例。

**当前实现基线：** 提供 LayerManager、Legend、Search、Toolbar、Properties 和地图要素选择器。
LayerManager 通过 LayerService 增删显隐图层；Legend 只呈现 Core LegendDefinition；
Search Provider 通过 Vue UI 注册，结果定位通过 MapViewService；Toolbar 经
InteractionService 切换工具。FeaturePicker 在地图点击位置展示多命中候选，Properties
通过选中的 FeatureReference 展示详情。

### UI Phase 4：扩展与业务面板

-   Vue UI Plugin
-   Feature Renderer
-   KpiPanel
-   TimeController
-   自定义 Layout
-   主题扩展

**验收：** 业务插件可独立提供面板、工具项和要素渲染器。

**当前实现基线：** `VueUIPlugin` 在 UI Adapter install 阶段通过 `GISUIContext`
注册面板、Search Provider、Toolbar Item、Theme 和 Feature Renderer；返回的清理函数
按逆序在 UI dispose 或安装回滚时执行。主题支持 light/dark/system 与 CSS Token 覆盖；
appConfig 的 layout/theme 覆盖代码默认值。提供通用 `KpiPanel` 和 `TimeController`
展示组件；内置 `LayerTimePanel` 消费图层公开时间维度，具体 KPI 与跨图层业务时间仍由应用定义。

### UI Phase 5：工程质量

**当前实现基线：** UI 测试位于 `packages/ui-vue/test`，包含 Panel Registry、
PanelShell 和 Runtime+Vue mount/unmount/remount 的组件及集成测试；Core 的
生命周期、资源、服务和配置 Schema 测试位于 `packages/core/test`。使用
`pnpm test` 执行测试，`pnpm check` 执行类型检查、测试和构建。Vue API、CSS Token、
兼容范围、可运行示例和 Runtime 插件模板分别见 `doc/vue-ui-api.md`、
`doc/vue-ui-theme-tokens.md`、`doc/compatibility.md`、`examples/basic-vue` 和
`templates/core-plugin`；仓库 AI Coding Skill 位于 `.agents/skills/gis-runtime`。

-   单元与集成测试
-   API 文档
-   组件示例
-   CSS Token 文档
-   AI Coding Skill
-   兼容性和版本策略

------------------------------------------------------------------------

## 21. v1 API 冻结建议

第一版优先稳定以下 API：

``` ts
// Adapter
createVueUI(options)

// Vue UI Context
useGISUI()
useGISApp()

// Runtime composables
useGISState(selector)
useMap()
useLayers()
useInteractions()

// Panel
ui.panels.register(definition)
ui.panels.get(id)
ui.panels.list(position)
ui.panels.show(id)
ui.panels.hide(id)
ui.panels.toggle(id)
ui.panels.collapse(id)
ui.panels.expand(id)

// Toolbar
ui.toolbar.register(item)
ui.toolbar.unregister(id)

// Theme
ui.theme.set(theme)
ui.theme.get()

// Components
GISUIRoot
DockedDashboardLayout
OverlayDashboardLayout
MapViewport
PanelRegion
PanelShell
ToolbarHost
PopupHost
SearchPanel
LegendPanel
LayerManagerPanel
Toolbar
```

以上是候选 UI 公共 API，不表示全部进入 v1。v1 先公开 `createVueUI()`、
两种内置布局、MapViewport/PanelRegion、面板注册与状态操作所需的最小 API；
composables、Toolbar、Theme、Popup 和各官方面板按实现阶段和实际消费者逐项导出。
PanelRegistry、内部 Store 和实现类保持私有。

------------------------------------------------------------------------

## 22. 关键架构决策总结

  问题                                v1 决策
  ----------------------------------- ---------------------------------------
  Vue 是否属于 Runtime Core           否
  Vue UI 是否官方默认实现             是
  是否强制 Element Plus               否
  UI 是否单独包                       是，至少保持独立模块边界
  Core 是否知道 Vue Component         否
  面板定义是否放进 JSON               只放 ID 和布局状态，组件在代码注册
  面板是否必须全部默认启用            否
  面板业务逻辑是否直接操作 OL         否，通过 Runtime Service
  Runtime State 是否用 Vue reactive   否，由 Vue Adapter 订阅桥接
  UI State 是否全部进 Runtime         否，纯展示状态留在 UI
  是否支持自定义 Layout               是
  是否支持无 UI Runtime               是
  UI unmount 是否销毁地图             否
  是否需要多个 Vue App                否，一个 Runtime 对应一个 UI Root App
  是否需要热卸载 UI 插件              v1 暂不要求

------------------------------------------------------------------------

## 23. 已确定的 v1 决策与后续扩展

以下边界作为 v1 约定；不属于最小闭环的能力按实际需求再评审：

1.  **UI Adapter 的注册路径**：沿用 `app.use(createVueUI())`，生命周期由
    GISApp 协调。
2.  **Panel Registry 的归属**：属于 Vue UI；Core 只定义面板元数据契约。
3.  **面板运行时状态持久化**：v1 先保存在 UI Context；若需要跨 UI
    实现或刷新持久化，再定义通用 UI State Contract。
4.  **Popup Overlay 桥接**：需要 Core Map Adapter 提供定位能力，不能让
    Vue UI 直接依赖 OpenLayers Overlay。
5.  **Search/Legend Provider 的归属**：Search Provider 属于 UI
    搜索能力；Legend 数据模型应尽量属于 GIS 领域契约，避免图例定义被 Vue
    包独占。
6.  **Panel 组件 props 与配置合并**：禁止 JSON
    任意覆盖组件函数或组件实例，只允许覆盖 schema
    明确允许的可序列化字段。
7.  **组件库策略**：v1 先使用 Vue 原生组件 + SCSS Token，避免过早绑定
    Element Plus；需要复杂控件时再引入可替换的依赖。

**最终建议：** 先完成 Runtime 生命周期、ResourceScope、Adapter 和
LayerService 的最小闭环，再按需实现 Vue UI。Core 保持框架无关，只定义必要的
面板元数据；Vue UI 独立管理组件和布局。不要把本设计稿列出的所有 Service、
面板和扩展 API 一次性纳入 v1。

------------------------------------------------------------------------

## 24. v1 实现核对与冲突修订

Context/State 补充：Core 使用独立 AppContextImpl 和 AppStateImpl 类，入口为
app.context.state，Context 不反向持有 App。UI 使用 useAppState() 将快照映射为
只读 computed ref，卸载时取消订阅；工具栏的激活态读取快照。PanelRegistry、
ThemeService、LocaleService 仍负责自己的领域写入，并通过 extensions['vue-ui']
提供 JSON 快照分片；不向 Core 写入 Vue 对象，也不提供跨服务任意 State.set。

本节描述当前代码，不再把已经实现的能力写成候选或计划：

- Core 仅定义可序列化的 `PanelDescriptor` / `PanelConfig`；Vue 组件注册、
  Panel Registry、面板状态、渲染和布局均归 `ui-vue`。
- 当前 UI Adapter 接口只有 `mount`、`unmount`、`dispose`；插件 `install`
  属于 `GISPlugin`，通过 `registerUIAdapter()` 完成登记。
- 当前 `GISUIContext` 提供 `app`、`panels`、`search`、`toolbar`、`theme`、
  `featureRenderers`，没有 `OverlayService`。
- `FeaturePicker.vue` 内置于地图区域，通过适配器浮层显示候选，并支持像素定位回退。`FeaturePopup` 继续作为
  独立导出组件呈现选中的 FeatureReference，可在自定义布局中使用。
- 公开入口见 `packages/ui-vue/src/index.ts`：包根入口和 `./style.css`。没有
  `/panels`、`/styles` 子路径，也没有 `useGISState`、`useMap`、`useLayers`、
  `useInteractions`、`usePanel` composable。此前文中的这些候选导出不属于当前 API。
- 当前样式源码使用 SCSS，构建后导出 CSS；Theme Token 到 CSS Variable 的映射见
  `doc/vue-ui-theme-tokens.md`。
- 当前自动化覆盖基线为 `pnpm test`；已包含 Runtime 生命周期/清理/服务测试、
  JSON Schema 测试、Panel Registry、PanelShell 和 Runtime+Vue 挂载/重挂载集成测试。
  未覆盖的组件状态用例仍可随组件功能补充，不能视作已验证。
- v1 工程交付与运行命令见 `doc/vue-ui-api.md`、`doc/compatibility.md` 和根目录
  `pnpm check`。源码实际布局见 `packages/ui-vue/src`；第 19 节是逻辑职责建议，
 不是要求立即按其路径拆分源码。

### 停靠布局与图标补充约定

- `SvgIcon` 从包根入口导出，name 对应 `src/assets/svg` 中不带扩展名的文件名。
  工具栏无面板标题栏，按钮只显示 SVG，通过 aria-label 与 Tooltip 提供说明。
  Tooltip 从包根入口导出，悬浮延迟 180ms、聚焦立即显示，使用 Teleport 避免裁切；
  支持视口边缘避让、Escape 关闭，并在卸载时清理定时器和窗口监听。
- Search 位于地图上方，仅呈现输入框与 search.svg；图层显隐使用
  eye.svg / eye-off.svg。
- 停靠布局只有 Header 与 Workspace 两行；左栏的 PanelRegion 填满高度，Search 位于地图上方操作行，Layers 和 Legend 平分左侧高度。右侧属性面板通过 PanelRegion、
  PanelHost、PanelShell 逐层伸展，占据地图及状态栏对应的完整高度，正文内部滚动。
- Demo 的地图级别为只读显示，缩放按钮及地图手势均更新级别；默认 OL 缩放控件关闭。


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
- Basic Vue 仅安装 createOLAdapter 和 createVueUI。基础工具栏、属性联动和状态栏内置；高级结果列表可显式安装 createOLResultsUI，编程结果操作保留 useOLTools。
- OL 图层 options 支持 opacity（0–1）；GeoJSON 额外支持 style 对象：fillColor、strokeColor（颜色字符串）、strokeWidth、pointRadius（正数）。style 是完整替换，缺省字段使用默认值；创建和 update 均生效，不支持的 option/style 字段明确报错。参数先全部校验再应用。统一矢量样式通过 getMetadata().style 提供给图例，线符号使用 strokeColor，其余使用 fillColor；分级/分类表达式样式仍未实现。
- 本轮测试包含 Core 异常/所有权回归与真实 OL、Vue UI 的 jsdom 集成；这些不等同于真实浏览器鼠标事件端到端回归。

### 图层更新与选择联动修订

图层异步 update 按实例串行执行，失败不阻塞后续更新；删除立即禁止新的更新提交，等待已有更新结束后释放句柄。应用销毁在清理插件前等待图层更新完成。适配器不提供 update 时，options 更新明确报错，基础标题、显隐及 zIndex 更新仍可用。自定义 update 必须能够结束，Runtime 不强制终止任意 Promise。

FeatureReference.source 可标记选择所有者；省略或 layer 表示业务图层，其他所有者负责选择失效清理。OL 工具使用 ol-tools 来源，通过统一 InteractionService 选择，业务要素和结果互斥。点击结果、列表选择、清除和删除均同步高亮及属性面板；修改选中结果几何同步属性。删除选中结果按钮在没有工具结果选择时禁用，不删除业务要素。

ui-vue 公开 FeatureDetails 和 PropertiesPanel，属性面板与 FeaturePopup 共用 FeatureRenderer 和默认字段展示；Basic Vue 保留抽屉显示策略。

### 面板尺寸与 OL/Vue 集成补充

Overlay 图层/图例默认位于右上/右下；属性抽屉从最右侧出现时整列左移。宽于 1100px 时图层/图例列延伸到底部，1100px 及以下统一预留状态行，图例底部锚点不随抽屉显隐跳动。900px 及以下采用右侧属性覆盖与图层/图例临时隐藏策略，关闭恢复原面板状态，不再使用底部抽屉。

@joinmap/ol-vue 仅保留可选高级结果列表 createOLResultsUI；基础工具栏、属性联动和状态栏由默认 UI 和适配器提供，Core 与 UI 保持引擎无关。详见 doc/ol-vue-api.md。

侧栏 width 参与 Grid 占位，同侧可见面板取 CSS max；Overlay 属性抽屉单独计算宽度，不影响图层/图例列。数字尺寸转为 px，尺寸应用到 PanelHost。优先级为面板 width > left/rightPanelWidth > Overlay 的 overlayPanelWidth > panelWidth > 布局默认值；响应式布局限制宽度，窄屏属性仍位于右侧。主题变量映射见 doc/vue-ui-theme-tokens.md。

Toolbar 的 title 可使用 locale 字典键，也支持原始文本。面板操作及 OL 工具按钮/结果操作跟随语言切换；PanelShell 可通过 labels 覆盖操作文案，独立使用默认英文。

LegendDefinition.useLayerStyle 默认不启用。仅显式启用的单项 category 图例跟随统一图层样式。分类颜色保留自定义值。continuous 按真实数值比例生成色带，interval 保持离散色块。

停靠和浮动布局切换时移动查询区和左侧面板实例，图例草稿和重置基准随面板保留。TimeFilterPicker 可独立挂载，也可通过 `ui.timePicker` 配置内置 `time` 面板。完整周期范围包含最后选中的周期，精确范围按输入边界提交。两种范围都以所选 IANA 时区计算并输出左闭右开的毫秒区间。图层版本变化时清理对应搜索的结果和在途请求。图例支持从字段值生成分类或等宽区间草稿，点击已保存的分类行切换对应筛选。

工作台可选浏览器本地存储。应用在初始化前读取配置，Vue UI 保存外观、语言、布局和已配置图层的编辑结果。设置面板可导出 JSON 和导入后重载。工具栏可激活 Adapter 注册的结果编辑工具。

### 默认 GIS 能力收敛

搜索结果和 Select 菜单跟随当前面板材质，浮层底色至少保持 80% 不透明度以保证文字清晰。
浏览器不支持 backdrop-filter 时采用不透明底色。属性内容增加当前所选图层的 title
标题，订阅 Runtime（含 children），无对应图层时回退 layerId。图层根项使用 TransitionGroup
实现排序后的 240ms 位移过渡，配合拖动透明度和插入高亮，不改变原排序数据流。
ScrollArea 公开导出并接入 PanelShell 正文、搜索结果和 Select 菜单。保留原生内容滚动，
自绘覆盖式轨道/滑块，不挤占布局宽度；支持拖动、轨道点击、方向/Page/Home/End 键，
并同步滚轮、触摸、原生编程滚动。ResizeObserver 与合帧内容观察刷新几何，卸载释放观察器、
帧与拖拽监听。溢出时使用透明轨道与细滑块，高对比回退原生滚动条。图层与图例面板的
滑块宽 3px，支持悬停的设备在鼠标移入对应面板时显示，拖拽或滑块获得键盘焦点时保持可见。

图层管理职责修订：移除样式/图例入口，图例编辑统一放在 LegendPanel。GROUP 的 children
随父节点展开并嵌入父层 gis-ui-layer-settings，子项只显示名称和显隐开关，不提供展开、
拖拽、透明度或定位；支持嵌套，父层透明度统一作用于叶子层。按实际 zIndex 从高到低展示，
最外层才有 grip-vertical 手柄，支持拖到目标行上/下方，整组移动不改变父子归属；手柄也支持
上下方向键。透明度行仅图标、滑块、无边框百分比横排，保留无障碍标签。

图层/图例完善已实施：十字准星定位接入 Runtime，空/不支持数据禁用；展开区保留不透明度，
增加兄弟层上移/下移和样式与图例入口。列表按前到后显示，组作为整体移动，子层只在组内
排序；Runtime 仍接收后到前顺序。图例组使用纯 Legend 的 group-actions 插槽提供编辑入口。
图例入口使用连接组件 LayerEditor 与纯表单 LegendEditor。表单通过初始 legend/layerStyle/
labels 和 submit/cancel 使用，独立使用不需要 Runtime；草稿不改地图，应用时提交完整样式
和图例，单项 useLayerStyle 图例颜色派生自地图。图例标题、标签、独立色块和既有项顺序
属于展示编辑，不隐含分类渲染。expectedVersion 防止队列内旧草稿覆盖，外部修改需重载，
删除/同 ID 替换禁止提交，失败保留草稿；不占用要素属性面板，不自动写回 appConfig.json。

Docked 左侧固定常显，属性面板默认显示、允许关闭，右列显隐直接更新 Grid 占位；清空选择保留 Docked 面板，Overlay 仍按需隐藏。搜索、时间和工具栏为地图上方三个独立面板表面，搜索与时间靠左，工具栏靠右，宽度不足换行。
图层行采用可展开卡片，根图层显示显隐、拖动、十字准星定位和展开按钮。透明度滑块调用 LayerService.update，并统一应用到分组的所有叶子图层。百分比使用无边框文本，子层数值不同时显示短横线。定位使用当前数据范围，空数据禁用，详见 layer-location-design.md。

搜索将主题化 GisSelect 与 input 放在同一表面，名称来自 Runtime 图层 title（初始为 appConfig.layers.title），
按 Provider.layerIds 排除不支持搜索的图层及 GROUP。选择通过 SearchQuery.layerId 传给 Runtime；
切换或移除图层取消旧请求并清理本地结果，不复制应用图层状态。GeoJSON 局部属性搜索由 Adapter
提供，Demo 不再返回固定假结果。无图层的独立使用场景仍允许通用 Provider。
GisSelect 是 ui-vue 内部的受控组件，下拉使用主题变量、选中/活动态、圆角与阴影；支持
方向键、Home/End、Enter/Space、按文字跳转和 Escape/Tab/外部关闭，保留 combobox/listbox
语义。搜索结果只由输入框焦点恢复；打开图层下拉关闭搜索结果，两种浮层互斥。
标题栏使用 `title.subtitle` 渲染主标题右侧的胶囊副标题。透明齿轮旋转并展开非模态设置浮层，外观组包含主题、材质、主色和内置布局，语言单独成组。内置布局共用稳定的标题栏和设置浮层，切换后把现有地图挂到新的工作区，地图视图和业务状态继续由 Runtime 管理。选中的分段按钮统一使用白字，深色主题的两个主题标签均为白色，配置仍兼容 system。用户启用减少动态效果时关闭设置动效。
状态栏顺序为级别、比例尺、投影、经纬度；固定列宽、数字等宽、溢出截断。
Overlay 列宽为 76/128/116/184px，最大面板宽度 560px；内部宽度不超过 520px 时，
级别、比例尺和投影在首行，经纬度独占下一行。四项使用 scan、scale、global、location
图标（含无障碍标题）；两种布局均显示图标与文字，Overlay 上标题下数据，Docked 坐标左对齐。坐标以五位小数的单个文本
`139.12550,26.25500` 显示，不加度数和独立分隔元素。初始化显示 `--`，离开地图保留最后位置；
面板重挂载复用按应用隔离的 WeakMap 展示缓存，不新增 AppState 或隐藏期间的订阅。

createOLAdapter 内部安装绘制、测量及结果操作，不再公开 createOLTools 工厂；tools:false 表示不安装工具能力。普通应用只需 createOLAdapter + createVueUI。
UI 内置缩放和已知工具 ID 的按钮映射，以 hasTool/canActivateTool 查询可用性，UIConfig.tools 可选择显示的内置按钮。一次性删除/清空使用现有 ToolDefinition 的 mode=action，不占用激活工具状态；undoActiveTool 复用活动工具的 undo 回调，不新建 CommandBus/ToolService。
PropertiesPanel 及选择联动归 ui-vue 内置。默认选中时打开，关闭保留选择，重新选择可再次打开；显式 properties.visible=false 关闭自动打开。Status 为内置专用槽位面板，status.visible=false 隐藏面板并清理订阅。
MapAdapter/MapService.onPointerMove 仅传递 WGS84 指针经纬度，离开时传 undefined；高频数据不进入 AppState。视图快照增加 metersPerPixel，适配器完成投影相关计算；默认状态栏按 0.28mm 名义像素格式化比例尺。键盘处理归工作区，仅在工作区内且非输入控件时处理 Escape/Backspace。
独立的 ol-vue 集成包只保留高级结果列表，不再是普通应用启动的必经步骤。

### 图例卡片查看态与原位编辑修订

图例面板默认直接展示每层图例卡片：标题、编辑/重置，
条目为颜色符号与名称或实际区间。线使用横条、面使用方形、点使用圆点。
编辑态保持卡片位置，标题始终是不可编辑的图层标题；枚举/区间为字段行右侧文字，
不提供类型切换。字段行不显示“指标”题目，查看态为普通文本，编辑态原位换为字段选择器。
枚举每组为颜色、多选匹配值、显示名称、删除；区间显式展示 [min,max) 并可编辑是否
包含上限。预览指标使用次级文字色，条目小于标题，字段分类的末行用“未匹配值”表示回退色。
统一样式只展示常规色块，编辑字段选择器使用“不按字段分类”。
Grid 分配规则列，窄卡片内部换行。独立 GisMultiSelect 保留标量类型，支持搜索、连续
多选、清空、键盘，其他分组占用的值禁选；当前数据缺少的已选值保留并提示。
弹层在同主题根节点下定位，避免被面板滚动区裁剪，靠近底部向上展开，卸载清理监听。
编辑动作保留保存和关闭，保存按钮仅改变图标颜色。卡片底部“更多”打开图层级样式弹窗，
按面、线、点显示填充不透明度、描边、线型、端点或半径设置。应用更新当前草稿，
保存一次提交顶层 style 和 legend。关闭取消草稿，查看态重置恢复卡片初次加载定义。


Docked workbench revision: Header spans the full width. Layers and Legend share one continuous left aside with a divider and independent scrolling; Properties occupies the right aside. Search/time and icon+text tools share a single center action row, with status below the center map. Docked regions use continuous surfaces with square corners. Overlay uses separate floating surfaces. The left rail stays presented without collapse/restore controls. Properties is initially visible, can be closed without clearing selection, and reopens on a new selection through PanelService. There is no separate sidebar collapse state. Toolbar overflow is measured with ResizeObserver and localized labels; trailing actions move into a keyboard-operable More menu using the same tool definitions. At 800px and below, panels stack below the map in a scrollable workspace without covering it.

Docked alignment: layer and property headers track the measured action-row height (minimum 48px). Built-in headers use SVG icons; Properties provides a close button; Layers and Legend have no sidebar collapse control. Centered icon/title/description empty states are shared by Properties, Layers and Legend. Toolbar and Search share the small typography token and 16px icons. Map grid backgrounds remain intact.

Docked surface polish: action-row horizontal padding is 16px (10px on narrow screens); Search/time controls use 10px corners and toolbar buttons 8px. More uses a three-dot SVG and localized label, hidden visually on narrow screens while retaining its accessible name. Overflow reserves the measured More-button width. The Legend title icon follows the primary color. The empty-state illustration keeps its symbol colors.


### 地图交互期间的 UI 更新

useAppState 支持 selector，使用 Object.is 比较选择结果，仍在卸载时清理订阅。
图层、图例、时间、搜索和属性组件订阅所需冻结分支/标量；地图平移缩放不触发图层树
重排或时间维度重扫。全量订阅保持兼容，地图状态栏仍读取视图更新。

### 图层与图例面板参考稿调整

两面板共用标题栏视觉：主题色 SVG、数量徽标、右侧刷新。徽标分别为可见根图层数/
根图层总数与可见图例总数，不随搜索减少。PanelHost 提供局部注入，内容注册 computed
数量和刷新回调，卸载自动清理，不添加 Core 状态。刷新仅重读 Runtime 当前数据；
图层面板同时清空搜索，不重置显隐、顺序或样式，图例面板保留未保存草稿。
图层搜索按名称忽略大小写，子层命中保留祖先，父层命中保留完整子树，自动展开搜索结果；
排序仍使用完整 Runtime 树。根行顺序为 eye、标题、drag、定位、展开。隐藏分组沿用 Core
递归显隐。子层可独立开启；全部子层隐藏时，父层切为 eye-off。两面板使用 4px 窄轨道
和对称的 10px body 留白。图层列表只在根图层重新排序时应用位移动画，
展开或收起时直接更新行位置，避免动画期间旧位置暂时撑大可滚动区域。
样式依赖 gis-ui 主题变量，同时适配 Docked 和 Overlay。
