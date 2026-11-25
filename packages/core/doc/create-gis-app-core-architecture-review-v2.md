# create-gis-app Core 架构审查与渐进式重构方案（V2）

> **评审对象**：`flyFishHy/create-gis-app` · `packages/core` 及其与最新版 `adapter-ol`、ESLint 的协作边界  
> **基线提交**：[`d549ec203bfc55d48f0d500114a81b32bf858542`](https://github.com/flyFishHy/create-gis-app/commit/d549ec203bfc55d48f0d500114a81b32bf858542)（2026-11-25，提交信息“代码重构”）  
> **对照提交**：[`ca013cafb027e7aeac3180dfc08293cdeaa43214`](https://github.com/flyFishHy/create-gis-app/commit/ca013cafb027e7aeac3180dfc08293cdeaa43214)（上次审查版本）  
> **评审性质**：GitHub 源码、目录及测试的**静态架构审查**；未在本地执行 `pnpm test/check`，未实际复现全部异常路径。  
> **重构目标**：保留 `createGISApp()`、`GISApp`、`MapAdapter`、`LayerService` 等公开契约，优先修复领域语义和一致性问题，再通过渐进式拆分降低耦合，支撑更多 GIS 图层和未来 Agent 命令入口。

---

## 0. 执行摘要：先给结论

**Core 不应推倒重写。** 它已有较成熟的基础：应用门面、无引擎依赖的 MapAdapter、LayerType 工厂、插件生命周期、资源所有权、批量状态、观察者隔离、异步图层创建的暂存与回滚、乐观版本检查和测试。

但其主要风险并不在文件格式，而在**领域规则分散、相同操作入口的行为不一致、组合图层语义、跨引擎事务边界、状态快照扩展成本**。新 `adapter-ol` 已明显模块化，Core 的抽象边界更应保持稳定，而不是迎合 OL 的内部文件结构另建 Registry/Manager。

**建议顺序**：

1. **先补行为契约与回归测试**：组显隐保持子图层偏好；实例级与 Service 级操作事件一致；故障注入；更新可见性/排序的一致性。
2. **拆分 `LayerInstance`、`LayerService` 和 Group 领域模型**：保留公开 API，但统一内部命令路径和层级可见性语义。
3. **定义 MapLayerHandle 的更新/回滚契约**：Core 管意图和提交结果，Adapter 保证自身引擎变更的可预期性；不在 Core 里实例化 OL 对象。
4. **独立优化数据、交互与状态领域**：基准驱动，不提前上 RxJS、Redux、IoC 或全局 CommandBus。
5. **把现有质量规则变成可执行门禁**：`lint:quality` 当前独立于 `pnpm check`，需分阶段消化存量警告，而不是一刀切要求零警告。

### 0.1 本次最新提交改变了什么

这次 `main` 相对上次基线向前 1 个提交，OL Adapter 的主要职责已拆分：

```text
adapter-ol/src/
├── ol-adapter.ts                   # 插件装配/注册
├── map/{ol-map-adapter,map-runtime,map-view,layer-collection}.ts
├── layers/common/{layer-binding,create-layer-handle,style-controller,...}.ts
├── layers/geojson/{geojson-layer,vector-data-sync,vector-properties,vector-search}.ts
├── layers/{xyz,wms,wmts}/...
├── interactions/{feature-hit-bridge,selection-highlight,...}.ts
├── overlays/popup-overlay.ts
└── tools/{install-ol-tools,tool-targets,tool-result-index,...}.ts
```

新增 WMS / WMTS 工厂，`LayerBinding` 将 `handle` 与 OL Layer 关联，`ResourceScopeImpl` 用于 GeoJSON 资源生命周期；这些是积极变化。与之相对，Core 仍以单个大型 `layer-service.ts`、`interaction-service.ts`、`runtime/gis-app.ts` 编排领域；此次 Core 的大量 Git diff 也包括分号、花括号与格式化，不应误认为已完成架构重构。

### 0.2 优先级定义

- **P0**：已经能从代码路径清楚推出的不一致行为，或影响图层领域语义、数据/引擎一致性的核心契约问题。**“代码路径确认”不等于已运行复现**。
- **P1**：当前扩展或性能方面的高收益优化，应配专项回归或基准后实施。
- **P2**：可维护性、命名、类型组织和未来演进储备，不宜影响当前主线交付。

---

## 1. 评审范围、依据和方法

### 1.1 核心源码

| 领域 | 主要文件（本次提交行数为近似值） | 职责 |
| --- | --- | --- |
| 应用编排 | `src/runtime/gis-app.ts`（544 行） | 依赖装配、注册、init/mount/dispose |
| 图层 | `src/layer-service.ts`（928 行） | 工厂、实例、Group、排序、可见性、更新与释放 |
| 交互 | `src/interaction-service.ts`（388 行） | 选择、拾取、Tool 生命周期 |
| 地图门面 | `src/map-service.ts`（约 274 行） | MapAdapter 生命周期和对外守卫 |
| 状态 | `src/state/app-state.ts`（199 行） | JSON 快照、缓存、观察者和扩展状态 |
| 数据 | `src/data/data-service.ts`、`data-set.ts` | 数据源、校验、订阅、更新 |
| 配置 | `src/config.ts`、`config/*.ts` | 配置验证和归一化 |
| 搜索 | `src/search-service.ts` | Provider、取消、部分失败 |
| 生命周期 | `src/resource-scope.ts`、`runtime/*` | 逆序释放、依赖排序、状态守卫 |
| 类型 | `src/types.ts`、`src/types/*.ts` | 公开契约 |

关联检查：`adapter-ol/src/ol-adapter.ts`、`map/ol-map-adapter.ts`、`layers/common/*`、`layers/geojson/*`、`eslint.config.js`、`eslint.quality.config.js`、根目录 `package.json`，以及 Core 现有测试。

### 1.2 当前测试值得保留

`packages/core/test/` 已覆盖：插件依赖和清理、异步初始化与 dispose 并发、状态快照不可变性、图层 ID 预留和 Group 原子发布、旧版本编辑阻止提交、资源释放失败处理、异步 identify 超时、搜索取消与部分失败等。**不要为了重构把集成测试改成只验证类是否存在。** 需要增加的是文末列出的**语义边界和故障注入测试**。

### 1.3 如何认定问题

报告中的“已确认”表示根据明确代码分支能推导出行为；“待复现”表示需要测试或浏览器验证；“设计选择”表示当前未必错误、但应统一契约。对生产环境问题不使用未经实测的性能数字。

---

## 2. 当前架构优点：应保留的东西

### 2.1 框架无关 Core

`Core` 未把 OpenLayers、Vue/ElementPlus 作为直接依赖；通过 `MapAdapter`、`UIAdapter`、`LayerTypeDefinition`、`MapLayerHandle` 完成对接。这是今后尝试其他地图引擎及 AI+GIS Runtime 的基础，**必须保留**。

### 2.2 服务门面与上下文

`createGISApp()` 返回 `GISApp` 门面；`AppContextImpl` 将 map、layers、data、search、interactions、state 等依赖集中成应用级能力上下文，且不反向暴露整个 `GISApp`。这比在模块中导入 Singleton Map 或全局 Pinia 更合理。

### 2.3 工厂和插件扩展点

`LayerTypeDefinition.create(context, config)` 让不同 Adapter 按类型创建图层；`resolvePluginOrder()` 用拓扑排序处理依赖；`ResourceScopeImpl` 逆序释放。既有扩展点足够支撑现有 WMS/WMTS/XYZ/GeoJSON。**暂不增加第二套 LayerFactoryRegistry、CapabilityRegistry 或大型 IoC 容器。**

### 2.4 图层创建事务的基础

`LayerService.addTree()` 有 `pending` ID 预留、`staged` 延迟发布、失败清理、`settle()` 等机制。它已经解决了不少初级架构方案没有解决的并发问题；后续应加强而不是替换成“直接数组 push”。

### 2.5 状态和错误处理

`AppState` 以不可变快照对外暴露状态；异步图层更新有版本检查；事件订阅者报错不会直接打断其他监听；初始化与销毁过程中收集部分清理错误。这些都是可保留的设计资产。

---

## 3. 整体问题矩阵

| ID | 优先级 | 定位 | 问题与证据 | 判断 | 推荐手段 |
| --- | --- | --- | --- | --- | --- |
| CORE-01 | **P0** | `layer-service.ts` | 同一图层操作同时通过 `LayerInstance` 和 `LayerService` 暴露；实例直接 `setVisibility()` / `update()` 只刷新状态，而 Service 包装层额外发布领域事件 | **代码路径确认** | 统一 Operation/事件出口 |
| CORE-02 | **P0** | `layer-service.ts` `addGroup()` | Group 的 `setVisible()` 逐个改写子图层可见性，隐藏再显示会覆盖子图层原先独立显隐偏好 | **代码路径确认** | Composite + own/effective visibility |
| CORE-03 | **P0** | `layer-service.ts` `applyUpdate()` | 调用 `handle.update(patch)` 后再次调用 `handle.setVisible()`、`setZIndex()`；不同行为入口可能重复设置，部分失败后 Core 与引擎状态分裂 | **代码路径确认 + 故障待复现** | 统一更新提交契约 |
| CORE-04 | **P0/P1** | `layer-service.ts` `createLayer()` | `addLayer()`、`removeLayer()`、`dispose()` 异常时，当前 `attached` 和 catch 处理对“部分附着”“清理再失败”没有完备恢复保证 | **待故障注入** | 分阶段 attach / best-effort cleanup / AggregateError |
| CORE-05 | **P1** | `layer-service.ts` `setOrder()` | Core 排序、MapAdapter 集合顺序、Handle zIndex 分别维护；一次排序在多个引擎操作之间可能部分成功 | **设计风险，需测试** | 定义单一排序权威和批量投影 |
| CORE-06 | **P1** | `layer-service.ts` `addGroup()` | Group 用模拟 `MapLayerHandle` 管子图层；组状态、子节点映射、领域实例混在同一 Service；动态新增/移除复杂 | **结构确认** | 私有 LayerTree / GroupNode / LayerInstance 分拆 |
| CORE-07 | **P1** | `layer-service.ts` `createLayer()` | 动态 add 的 `LayerConfig` 验证与初始化配置不完全统一；`normalizeLayerStyle()` 返回值未用于传给工厂的配置 | **代码路径确认** | 输入归一化快照和统一校验 |
| CORE-08 | **P1** | `state/app-state.ts` | 任意 refresh 重新读取 map/layers/data/extensions 并进行 JSON 投影和签名比较，层数增长后可能存在重复开销 | **结构确认、性能未测** | 先基准，后增量/dirty flags |
| CORE-09 | **P1** | `data/data-set.ts` + Adapter | DataSet 先提交再通知；观察者失败仅报告，OL VectorSource 更新可能与 DataSet 不一致 | **设计边界确认** | 数据为权威，派生视图可重建/补偿 |
| CORE-10 | **P1** | `interaction-service.ts` | Selection、FeaturePicking、Tool 注册与切换全在一个 Service，多个生命周期互相影响 | **结构确认** | 内部分离 SelectionStore / FeaturePickCoordinator / ToolController |
| CORE-11 | **P1** | `runtime/gis-app.ts` | 544 行包含构造装配、插件注册、生命周期、清理、错误报告；扩展时容易回改同类文件 | **结构确认** | 薄编排器 + 局部 coordinator / registry |
| CORE-12 | **P1** | `runtime/gis-app.ts` / `resource-scope.ts` | 根资源域、插件资源域、Map 资源域的所有权需明确文档化，避免第三方插件不经 own scope 登记 | **设计风险** | Ownership matrix / scope 约定 |
| CORE-13 | **P1** | `types.ts` `MapLayerHandle` | 可选能力增多，UI 很难可靠识别“可编辑专题样式/有字段/支持过滤” | **扩展风险** | 小范围 capability query，可先不用统一 registry |
| CORE-14 | **P1/P2** | `config.ts` | 以通用形状校验为主；插件型 LayerConfig.source 的扩展校验分散到具体工厂，错误阶段/路径不够统一 | **设计风险** | 基础 schema + type-specific validator（按需） |
| CORE-15 | **P2** | `search-service.ts` | Provider、请求取消、失败聚合、结果合并在一起；暂无归一化的业务搜索结果稳定性约束 | **可维护性风险** | 先小幅拆 request runner，非必做 |
| CORE-16 | **P2** | `types.ts` / `types/*.ts` | 领域层类型部分集中导出，`types/app.ts` 和 `types/map.ts` 又反向引用 `../types.ts` | **结构确认** | 领域契约就近定义、根文件只 re-export |
| CORE-17 | **P2** | `types/app.ts` | `GISAppOptions.debug` 类型存在，当前 Runtime 主路径中未见对应调试策略 | **待全仓验证** | 记录语义或移除未承诺能力（注意兼容） |
| CORE-18 | **P1** | `eslint.quality.config.js` | 复杂度规则存在但 `lint:quality` 不在 `pnpm check` 里，且质量检查的 warn 默认不导致非零退出 | **配置确认** | 分阶段纳入门禁/基线 |
| CORE-19 | **P1** | Core 与新 OL Adapter | 新版 WMS/WMTS、LayerBinding、资源 Scope 提升了扩展性，但 Core 的 Handle 契约对 attach/remove/update 的失败语义不够明确 | **跨包契约风险** | 集成契约测试 |
| CORE-20 | **P2** | `interaction-service.ts` | `identifyTimeout = 2000` 写死，复杂应用或慢速 identify 场景缺少可配置策略 | **代码确认、是否改变为产品决策** | 默认保留，未来配置可选 |
| CORE-21 | **P2** | `layer-service.ts` | `LayerInstance.status` 允许 created/loading/error，但当前实例主要在创建完成后直接为 ready；是否暴露中间态需明确 | **设计一致性** | 文档化延迟发布语义 |
| CORE-22 | **P2** | `LayerService.canSelectFeature()` | 未找到 Layer 时允许无 featureKey 的引用，适合部分外部来源却也可能允许无归属选中；应明确 `source` 策略 | **设计选择** | 测试 & 显式 owner 策略 |

**重要**：矩阵不是要求 22 项全部实施。建议先完成 CORE-01/02/03/04/07/18，后面的工作以实际收益判断。

---

## 4. P0 深入分析

### 4.1 CORE-01：实例 API 与 Service API 的事件语义不一致

**源码**：
- [`LayerInstanceImpl.setVisibility()`](https://github.com/flyFishHy/create-gis-app/blob/d549ec203bfc55d48f0d500114a81b32bf858542/packages/core/src/layer-service.ts#L107-L115)
- [`LayerInstanceImpl.update()` / `applyUpdate()`](https://github.com/flyFishHy/create-gis-app/blob/d549ec203bfc55d48f0d500114a81b32bf858542/packages/core/src/layer-service.ts#L184-L247)
- [`LayerServiceImpl.setVisibility()`](https://github.com/flyFishHy/create-gis-app/blob/d549ec203bfc55d48f0d500114a81b32bf858542/packages/core/src/layer-service.ts#L638-L645)
- [`LayerServiceImpl.update()`](https://github.com/flyFishHy/create-gis-app/blob/d549ec203bfc55d48f0d500114a81b32bf858542/packages/core/src/layer-service.ts#L538-L550)

当前公共 API：

```ts
app.layers.setVisibility('complaints', false);
await app.layers.update('complaints', { title: '投诉点' });

const instance = app.layers.get('complaints')!;
instance.setVisibility(false);
await instance.update({ title: '投诉点' });
```

前两条走 `LayerServiceImpl`，除了刷新状态还调用 `emit(...)`；后两条直接调用 `LayerInstanceImpl`，其内部只执行 `changed()`，**没有走同一份 LayerService 领域事件出口**。`GISAppImpl` 把 Service 的事件转发为 `layer:visibility-changed`、`layer:updated`，因此不同入口对订阅者可观察行为不同。

**建议方案（不破坏旧 API）**：在内部建立统一的修改命令通道；`LayerInstance` 继续开放原方法，但成为 Service 操作的薄委托，或注入同一个 `onCommitted(change)` 回调。禁止出现两个各自管理 `emit` 的写入路径。

```ts
// 概念示例：不是要求直接照抄的完整实现
interface LayerMutationEvent {
  layerId: string;
  kind: 'visibility' | 'update' | 'order' | 'remove';
  previousVersion: number;
  nextVersion: number;
}

class LayerServiceImpl {
  private commitMutation(event: LayerMutationEvent): void {
    this.refreshState();
    this.publishDomainEvent(event);
  }
}
```

**关键约束**：
- 每次成功变更只发布一个有明确语义的领域事件；Group 聚合操作可带 `affectedLayerIds`，无需每个子节点每次都触发全量刷新。
- 旧 `app.layers.get(id)!.update()` 与 `app.layers.update(id, ...)` 的结果、版本和通知相同。
- 用户显式传入 `visible` + `title` 的更新，如何分类事件必须先定规则。建议保留旧 visibility 事件用于兼容，同时可新增“统一 layer:changed”事件；不要悄悄减少现有事件。
- `setLegendFilter` / `setTimeFilter` 也应明确属于何种状态变更及订阅契约。

**先补回归**：分别通过两种入口操作，断言 `LayerService.subscribe()`、`AppState.subscribe()` 和 `EventService` 的通知类型、次数和版本语义一致。

### 4.2 CORE-02：Group 隐藏/显示覆盖子图层意图

**源码**：[`addGroup()` 的 setVisible 实现](https://github.com/flyFishHy/create-gis-app/blob/d549ec203bfc55d48f0d500114a81b32bf858542/packages/core/src/layer-service.ts#L818-L827)。

当前 Group 不是简单存一个自己是否可见，而是依次执行 `this.setVisibility(child.id, next)`。例：

```text
初始化：
Group(visible: true)
  ├─ A(visible: true)
  └─ B(visible: false)

隐藏 Group：A=false，B=false
重新显示 Group：A=true，B=true  ← 原来的 B=false 丢失
```

另一个细节：Group 的 `LayerInstance.visible` 通过 `children.some(child.visible)` 推断，和构造器中保存的 `currentVisible` 不是同一个维度。这会让“父节点自身关闭”与“父节点子项全部关闭”难以区分。

**推荐模型**：采用 **Composite（组合模式）**，将**用户对节点的显隐偏好**和**最终地图渲染可见性**分开。

```ts
interface LayerNodeBase {
  id: string;
  ownVisible: boolean;       // 用户希望自己显示吗？
  parentId?: string;
}

interface LayerLeaf extends LayerNodeBase {
  kind: 'layer';
  handle: MapLayerHandle;
}

interface LayerGroup extends LayerNodeBase {
  kind: 'group';
  childIds: string[];
}

function effectiveVisible(
  node: LayerNodeBase,
  nodes: ReadonlyMap<string, LayerNodeBase>
): boolean {
  if (!node.ownVisible) return false;
  if (!node.parentId) return true;
  const parent = nodes.get(node.parentId);
  return parent ? effectiveVisible(parent, nodes) : true;
}
```

**具体行为建议**：

| 操作 | ownVisible | effectiveVisible |
| --- | --- | --- |
| 单独隐藏 B | 只改 B=false | B=false |
| 隐藏 Group | 只改 Group=false | A/B 均 false，但自身偏好不变 |
| 再显示 Group | 改 Group=true | A 恢复 true；B 保持 false |
| Group 隐藏期间开启 B | B=true，但 Group=false | B 仍暂不显示，Group 打开后才显示 |
| 新建子图层 | 保留子图层配置的 ownVisible | 受父组 effectiveVisible 约束 |

**风险与兼容**：当前 UI 或插件可能把 `LayerInstance.visible` 理解为最终可见性；不应直接新增互相矛盾的两个公开字段。V1 可保留 `visible` 为有效可见，并在内部持有 `ownVisible`；如果 UI 需要三态（全开/部分/全关），再以**新增、可选**的 `getLayerVisibilityState()` 查询提供，不马上破坏已有接口。

**另外**：Group 本身是**领域节点**，不必假装它是 OpenLayers 的真实图层。其集合语义、聚合 metadata、定位和顺序投影应在 `LayerTree` 内实现，地图 Adapter 只管理叶子实际 Layer。

### 4.3 CORE-03：更新的重复调用及非原子边界

**源码**：[`applyUpdate()`](https://github.com/flyFishHy/create-gis-app/blob/d549ec203bfc55d48f0d500114a81b32bf858542/packages/core/src/layer-service.ts#L191-L247)、新版 [`createLayerHandle()`](https://github.com/flyFishHy/create-gis-app/blob/d549ec203bfc55d48f0d500114a81b32bf858542/packages/adapter-ol/src/layers/common/create-layer-handle.ts)。

当前 Core 先执行：

```ts
await handle.update?.(enginePatch);
```

然后在本地事务块中：

```ts
if (patch.visible !== undefined) handle.setVisible(patch.visible);
if (patch.zIndex !== undefined) handle.setZIndex(patch.zIndex);
```

但新 OL Adapter 的 `createLayerHandle().update()` 也会处理 `visible`、`zIndex` 和 `title`，因此对这些字段可能出现两次引擎调用、两次 OL 变化事件及双重订阅副作用。更重要的是，若 `update()` 先改了颜色再抛错，Core 未提交新状态，引擎却可能已发生部分变化。

**推荐短期契约**：

1. 将 `style/legend/options` 和 `title/visible/zIndex` 的责任分清：Core 统一编排，一个字段只能有一个实际写入点。
2. `MapLayerHandle.update()` 必须约定：失败时不留下可观察的部分更新，或者返回可执行的补偿动作（第二选择）。
3. Adapter 内部可保留 `prepareUpdate()` 预校验函数、预创建样式对象，最后同步提交；**第一阶段不增加公开的 `prepare/commit/rollback` API**。
4. Core `expectedVersion` 检查、串行队列保留；提交成功再更新版本与发事件。

**推荐内部示意**：

```ts
// 仅为表达一次性提交的方向，非现有公开契约
interface LayerUpdatePlan {
  normalizedPatch: LayerUpdate;
  previousVersion: number;
  applyEngine(): Promise<void>;
  rollbackEngine?(cause: unknown): Promise<void>;
}

async function executeLayerUpdate(plan: LayerUpdatePlan): Promise<void> {
  try {
    await plan.applyEngine();
    // 引擎完成后，才更新 Runtime 状态与发布变更
  } catch (cause) {
    await plan.rollbackEngine?.(cause);
    throw cause;
  }
}
```

**不要**把这个示例升级为全局分布式事务、两阶段提交或命令总线。OL 的样式、可见性、zIndex 大多可以在 Adapter 内以“先构造校验，后同步提交”实现。

**验收**：构建 FakeMapHandle 的计数器，`visible/zIndex` 每次更新最多一次真实操作；把 `handle.update` 故意设计成“先修改后抛异常”，明确系统按契约拒绝这种实现或能补偿；旧版序列化更新和冲突版本测试继续通过。

### 4.4 CORE-04：图层创建与释放的失败清理

**源码**：[`createLayer()`](https://github.com/flyFishHy/create-gis-app/blob/d549ec203bfc55d48f0d500114a81b32bf858542/packages/core/src/layer-service.ts#L427-L529)。

现有 `let attached = false` 在 `adapter.addLayer(handle)` 返回后才变为 true。若第三方 `MapAdapter.addLayer()` 把图层加入内部集合后再抛异常，catch 块不会执行 remove；若 remove/dispose 再抛，可能覆盖初始错误。

这不是已在 OL Adapter 中复现的生产 Bug，而是**Core 插件契约对第三方 Adapter 的故障恢复不够强**。

**建议**：

- 明确 `MapAdapter.addLayer()` 对失败的**无副作用承诺**，或者 `removeLayer()` 在部分 add 后**幂等、可安全调用**；二者至少一项必须具备。
- Core 记录 `attachAttempted`，失败时最好努力执行 remove + handle.dispose，分别捕获，不因第二个失败跳过后续清理。
- 保留最初异常为 `cause`，把清理异常收进 `cleanupErrors`；事件/调用方能区分“创建失败”和“清理失败”。
- Group 整棵树暂存失败的逆序释放保留，给父子重复释放加幂等约束。

```ts
let attachAttempted = false;
try {
  // ... handle 从工厂返回
  attachAttempted = true;
  adapter.addLayer(handle);
  // ... 发布
} catch (cause) {
  const cleanupErrors: unknown[] = [];
  if (attachAttempted) {
    try { adapter.removeLayer(handle); }
    catch (error) { cleanupErrors.push(error); }
  }
  try { await handle.dispose(); }
  catch (error) { cleanupErrors.push(error); }
  throw withCleanupErrors(cause, cleanupErrors);
}
```

**前提**：此示例依赖 `removeLayer()` 对“尚未完全 attach”的对象安全、幂等；先完善接口文档和 Adapter 实现，再按这个方向改 Core，不能直接照抄替换。

---

## 5. Layer 领域模型：推荐目标结构

### 5.1 为什么从 Layer 开始

目前 `LayerServiceImpl` 同时负责：

- 注册图层类型和调用外部 Factory；
- 异步创建、ID 预留、暂存、回滚；
- 所有 LayerInstance 的存储与生命周期；
- Group 成员与父子关系；
- visibility、legend、style、timeFilter、metadata 的变化；
- 排序、zIndex、DataLocation；
- 选择有效性判断、外部 Identify；
- 同步 AppState 和发布领域事件。

这些职责从一个文件变成多个文件，并不天然解决耦合。**应优先划分状态/行为所有者，再拆文件。**

### 5.2 目标划分（私有实现）

```text
LayerService（公开服务门面）
│
├── LayerTypeRegistry       只持有 type → definition，不额外复制 MapAdapter registry
├── LayerStore              id → LayerInstance；pending ID；提交后的顺序索引
├── LayerTree               parent/children/ownVisible/effectiveVisible
├── LayerCreation           stage / attach / rollback / publish
├── LayerMutation           update / visibility / version / domain events
├── LayerOrdering           批量顺序、zIndex 到引擎的投影
└── LayerQuery              metadata/identify/dataLocation/selection eligibility
```

**不是每个方框都要成为公开 Class。** 简单模块以函数+局部类型实现即可。不要把 `LayerStore` 误设计成另一个与 `LayerService` 平行的业务 API。

### 5.3 建议内部接口

```ts
interface LayerRecord {
  readonly id: string;
  readonly type: string;
  readonly handle?: MapLayerHandle; // GROUP 没有真正地图 Handle
  readonly config: Readonly<LayerConfig>;
  parentId?: string;
  readonly childIds: string[];
  ownVisible: boolean;
  status: 'ready' | 'disposed';
  version: number;
}

interface LayerTreeModel {
  parentOf(id: string): string | undefined;
  childrenOf(id: string): readonly string[];
  isVisible(id: string): boolean;
  setOwnVisibility(id: string, visible: boolean): readonly string[];
  addChild(parentId: string, childId: string): void;
  detach(id: string): void;
}
```

建议 `LayerRecord` 仅保留**领域状态**；对于已提交的真实图层，`LayerInstanceImpl` 可将 handle 封装在更具体的实例中。`GROUP` 可以通过 Discriminated Union 区分，而不是不断在大函数里检查 `'GROUP'`。

```ts
type LayerNode =
  | { kind: 'leaf'; id: string; handle: MapLayerHandle }
  | { kind: 'group'; id: string; childIds: readonly string[] };
```

对外层仍保持 `app.layers.get(id)` 返回 `LayerInstance`，不暴露这个 `LayerNode` 类型；上层不用更改交互。

### 5.4 Group 的位置与样式边界

- Group 只负责组合与管理，不直接拥有真实地图 Renderer。
- 叶子图层的样式和 legend 从 `MapLayerHandle` 读取/更新。
- Group 的 `setVisible()` 表示修改 Group 自己的意图，不批量覆盖所有子项自己的偏好。
- Group 的 zIndex 可以定义为聚合值或管理排列，但不能和所有叶子的真实 zIndex 双向循环写入造成冲突。
- Group `getDataLocation()` 对子图层数据范围进行聚合；不同投影的数据可继续报明确错误，未来如确有需求再通过 Adapter 投影服务转化。
- Group 可以有空子节点吗？当前初始配置不支持空 Group，但动态移除最后一个子节点后已可以存在空 Group。**保留现有行为**，不要因为建模变化强制删除父组。
- 绘制/测量工具动态创建的组继续使用相同 Service，不让 Core 专门硬编码工具结果组 ID。

### 5.5 图层顺序与 zIndex：要确立一个权威

现在的 `setOrder()`：先调用 `adapter.setLayerOrder(handles)`，再逐个 `setZIndex(index)`，最后重排 `instances` Map。Group 还支持对子叶子写入分数 zIndex。这是**集合顺序 + 绘制层序 + 组聚合**三种概念混用。

推荐渐进方案：

1. 内部以**已提交图层的逻辑顺序**作为单一权威序列；区分“树展示顺序”和“实际渲染叶子顺序”。
2. 定义 `projectRenderOrder()`：把逻辑顺序转为叶子 LayerHandle 数组和相应 zIndex，批量交给 Adapter。
3. 更新顺序前先验证所有 ID、Group 归属；实际引擎提交前准备目标顺序，避免一个 handle 失败导致半应用。
4. **兼容约束**：当前 `setOrder()` 接受全部注册 ID 的任意排列（含 GROUP）；不能直接改成只接受根节点列表，否则会破坏现有 UI 和测试。可以先保留旧输入，在内部映射为稳定序列；未来另增可选的 `moveLayer()` 或树语义操作。
5. 不要依赖 `value + index / count` 的分数 zIndex 做无限层级插入，长期可能精度或碰撞不稳定；应统一重排策略并覆盖负数、相同 zIndex、跨组拖拽等测试。

---

## 6. Core 与新版 OL Adapter 的契约配合

### 6.1 新版 Adapter 正确的地方

新版 `ol-adapter.ts` 主要做插件装配与注册，`OLMapAdapter` 分离 Map Runtime、LayerCollection、Selection、FeaturePicking 和 Popup；GeoJSON 以 `LayerBinding` + `ResourceScope` 建立私有所有权；Tools 通过单独的 result/index/session 模块组织。

这进一步证明**Core 原有契约并未失效**，不必为了新版目录将 `MapLayerHandle` 强行改成 OpenLayers Binding。

### 6.2 需要写清的四份契约

**A. LayerFactory 契约**：

```ts
interface LayerTypeDefinition {
  create(context: AppContext, config: LayerConfig):
    MapLayerHandle | Promise<MapLayerHandle>;
}
```

说明：Factory 返回 Handle 时，图层资源由谁所有？例如 GeoJSON 的 Dataset、订阅、临时 SearchProvider 应在 Handle.dispose() 中正确清理。失败返回前由 Factory 自己负责清理已经分配的资源。

**B. MapAdapter 契约**：

- addLayer 成功后才进入“已附着”；失败必须无副作用，或提供安全幂等 remove。
- removeLayer 对已经移除/未完全附着的 Handle 行为必须确定。
- destroy 只处理 Map 自己的资源；Core 将已注册业务图层逐一 dispose 后再 destroy Map。
- setLayerOrder 如果不支持原子性，应明确异常后的恢复途径。

**C. MapLayerHandle 契约**：

- `update()` 的允许字段、不可用字段和失败状态明确。
- `dispose()` 必须幂等；不再要求引用 Map 进行数据清理。
- `getMetadata()` 返回可被 Core 安全地转换为 JSON 的内容；不可混入 OL Feature、Map、Source 对象。
- 可选方法不存在不等于全部功能不可用；UI 以能力识别而不是 `type === 'geojson'` 决定入口。

**D. DataSet / Adapter 数据同步契约**：

- DataSet 是权威数据，VectorSource 是可恢复的派生视图。
- DataSet 更新先校验，提交后的同步可能失败；Adapter 应报告并提供可重建能力。
- DataSet 的所有权必须限定：外部已有 DataSet 不允许 Handle 意外删除。新版 `loadOwnedDataSet` 已通过对象同一性做保护，属于好的方向。

### 6.3 WMS / WMTS 扩展与 Core 的边界

新 OL Adapter 已注册 `xyz`、`wms`、`wmts`、`geojson`，`LayerService` 不应该增加 `if (type === 'wms')` 分支。应让各工厂完成 source 参数、网络资源、投影/Capabilities 的专用验证，Core 只校验公共 `LayerConfig` 字段和插件注册契约。

建议新增**跨包公共测试**：相同 `app.layers.add/remove/update/setOrder` 行为对 GeoJSON、XYZ、WMS、WMTS 和自定义 LayerType 一致；资源失败/加载终止的行为可预期。

### 6.4 Capability 接口是否需要新设计？

当前 `MapLayerHandle` 已有 `getFields()`、`getTimeDimensions()`、`supportsLegendFilter()`、`update()` 等可选能力。随着图层变多，UI 可能混淆“有字段”“支持按字段专题渲染”“支持改样式”三个概念。

**建议先加内部能力查询函数而非新增全局 Capability Registry**：

```ts
// 内部辅助函数示例，具体判定必须和适配器契约对齐
function canEditUniformStyle(handle: MapLayerHandle): boolean {
  return typeof handle.getStyle === 'function' &&
    typeof handle.update === 'function';
}
```

如果未来确实出现多引擎、多 UI、多种层编辑权限，再**增量**考虑 `getCapabilities(): readonly LayerCapability[]`（如 `'style'|'classification'|'time-filter'|'identify'`）。不要现在凭空增加几十个强制接口。尤其不要用 `getFields().length > 0` 推断应该展示专题图例。

---

## 7. App Runtime 与资源生命周期

### 7.1 当前生命周期正确的部分

`init()` 的阶段顺序为：配置归一化 → 插件拓扑排序与安装 → 插件 onInit → 预置数据 → 地图创建 → 初始图层创建 → ready；失败时进入 error 并清理。`dispose()` 使用队列串行化；先卸载 UI/停止 Tool，再清理插件、图层、地图与数据。

值得保留的行为：失败 init 不原地重试；用户需要新 App 实例；UI `unmount/remount` 不销毁 Runtime；插件资源逆依赖顺序释放。

### 7.2 `GISAppImpl` 仍过大，应怎么拆

**推荐只提取“能形成稳定小闭环”的模块**：

```text
runtime/
├── gis-app.ts                # 公开门面和 init/mount/dispose 的调用入口
├── app-assembly.ts           # 构造 Service、连接 Context/State
├── plugin-registry.ts        # use/getPlugin/order/install/registrations 的内部协作
├── cleanup-coordinator.ts   # 各资源域的分层释放
├── lifecycle.ts             # 当前状态守卫/状态迁移函数
└── plugin-order.ts          # 现有拓扑排序
```

但是：如果 `plugin-registry.ts` 仅负责包一层 `Map`，实际没有减少业务决策，那么不拆。建议先把 `app-assembly.ts` 和 `cleanup-coordinator.ts` 两块高收益功能抽出来。

### 7.3 资源所有权矩阵

| 资源 | 所有者 | 创建入口 | 清理入口 | 约束 |
| --- | --- | --- | --- | --- |
| GISApp 级资源 | App root scope | Runtime | `dispose()` | 不应由插件私有化 |
| 插件注册项（工具、LayerType、UI 等） | Plugin `ResourceScope` | `plugin.install()` | 对应插件 scope | 只在允许阶段注册 |
| 真实地图对象 | MapService/MapAdapter | `map.create()` | `map.destroy()` | 晚于图层释放 |
| 真实图层/Handle | LayerService | Layer Factory | `LayerInstance.dispose()` | 一次创建，一次所有权移交 |
| GeoJSON Dataset/订阅 | 工厂返回的 Handle 或数据服务 | GeoJSON Factory | Handle/资源 scope | 外部数据不可误删 |
| 图例和时间过滤状态 | LayerInstance / Handle | 图层更新 | 图层销毁 | Core/Adapter 各有单一真相 |
| FeaturePick 的 AbortController | FeaturePickCoordinator | click/identify | 取消/超时/关闭 | 后来请求替代前一个 |
| UI Panel DOM | UIAdapter | mount | unmount/dispose | Core 不依赖 DOM 细节 |

特别检查 `AppContext.resources`：它暴露的是应用级资源域，插件应优先使用 `install(app, options, resources)` 收到的**插件专属 scope**。如果未来允许插件通过 AppContext 注册大量资源，可能需要显式文档或拥有者上下文，避免所有者混淆。

### 7.4 状态模式需不需要？

不需要实现 `CreatedState/InitializingState/ReadyState/...` 十多个类。现有 `AppStatus + assertRuntimeStatus()` 就是足够轻量的 State 思想。建议将有效迁移整理为一张表和单个内部函数，只有实际出现重复的跨状态迁移逻辑再继续拆。

---

## 8. 状态管理：保留轻量快照，优化刷新成本

### 8.1 现状

`state/app-state.ts` 的 `refresh()` 每次读取 `map/layers/data`，加上 `interactions/extensions` 做 `stateValue()` 转换、`JSON.stringify` 签名判断，复用未变化的冻结分支，最后通知订阅者。这是清晰、可预测的结构，并非错误实现。

**主要风险**：地图平移高频时，Layer 列表和 Metadata 可能在每次刷新都重新读取、序列化，业务图层数上升时成本随之增加。现在尚无基准，因此**不可声称性能已不达标**。

### 8.2 两步优化

**阶段 A：基准（必做）**：固定 LayerCount、MetadataSize、subscriberCount，测量 100 / 500 / 1000 个图层下，每次 map view change、图层显隐和插件状态更新的 P50/P95 耗时；比较 GC 量和 UI 渲染耗时。测试应使用同一浏览器环境，避免微基准冒充实际帧率。

**阶段 B：确有瓶颈才实施**：

```ts
type StateDomain = 'status' | 'map' | 'layers' | 'data' | 'interactions' | 'extensions';

interface StateInvalidator {
  invalidate(domain: StateDomain): void;
  batch<T>(fn: () => T): T;
}
```

以每领域 revision/dirty flag 决定是否重建快照；`AppState.snapshot()` 仍返回统一不可变对象。`map` 变化时复用上一次的 `layers`、`data`、`extensions` 分支，不重复读取 `getMetadata()`。应保留旧快照不变、订阅者异常隔离、批量提交只通知一次等已验证行为。

### 8.3 不建议采用的方案

不把 Pinia、Vue ref、RxJS Subject、Redux Store 作为 Core 的基础依赖；它们并不能天然修复状态一致性，反而提高非 Vue Adapter 的接入门槛。UI 层可以按自身框架订阅 Core 的快照。

---

## 9. Data 与 Search 的职责

### 9.1 DataSet 是否应该事务化？

`DataSetImpl.update()` 当前先运行校验器，再 `setReady` 和通知所有监听者；监听者异常由报告器隔离。此契约适合**权威数据 + 派生消费者**，但不是跨 OL VectorSource、搜索索引、UI 三方的原子事务。

建议：

- 不让 DataSet 等待“所有渲染订阅者成功”才认为数据已更新；否则有一个消费者失败，整个应用可能陷入不可维护的分布式回滚。
- Adapter 对源同步失败可标记 `syncError`、调度完整重建或继续下次更新；最初保留明确的 `app:error` 事件，新增恢复逻辑要配故障测试。
- 考虑动态数据 `data.update()` 调用方再次修改同一个原始对象的风险：如果允许数据可变共享，需要说明“不直接修改已提交数据”；如要保证严格所有权，可在 DataSet 提交时冻结/结构化克隆，**但先评估大数据成本**。
- `DataService.load()` 保留可中止请求、Processor 和统一数据加载边界；不要为了 WMS/WMTS 再做一套无关的 HTTP 管理器。

### 9.2 SearchService

当前 Provider 注册、并行搜索、按 layerId 过滤、AbortController、部分失败返回成功结果等能力比较完整。建议仅在 `search-service.ts` 继续膨胀时抽出 `runSearchQuery()`；不新增 `SearchStrategyFactory`，已有 `SearchProvider` 本质就是策略对象。

未来 Agent 的 GIS 搜索和地名搜索可作为 Provider 接入，并与其他 SearchProvider 一起执行；需要基于权限和使用场景另行设计，不应在 Core 现阶段硬编码任何在线地理编码平台。

---

## 10. Interaction 领域：拆内部协调器，不改公开入口

当前 `InteractionServiceImpl` 同时承担：

1. 当前选中要素、选择订阅与失效；
2. 多图层 Identify + 点击拾取 + 异步等待 + 超时/取消 + Popup choices；
3. Tool 注册、激活、反激活、undo、动作工具处理。

这些功能对外仍属于 `app.interactions`，但**内部状态机和资源所有权不同**，适合按职责拆：

```text
interactions/
├── interaction-service.ts          # 现有对外 Facade
├── selection-controller.ts         # 选择对象与监听
├── feature-pick-coordinator.ts     # identify、超时、Abort、候选排序
└── tool-controller.ts              # 激活、停用、Action、undo、迁移队列
```

建议先拆 FeaturePickCoordinator：现有 `pickFeatures()` 已包含 timeout、Promise.race、state 订阅、前后请求取消和 UI choices，独立测试收益高。

**工具状态边界**：`activateTool` 遇到前一工具 `deactivate()` 失败时，下一工具不能被视作已激活；失败后 activeToolId 和引擎交互对象可能需要同步恢复。V1 先增加失败注入测试与明确状态约定，再决定是否需要补偿操作。

**Command 模式**：当前 ToolDefinition 已有 activate/deactivate/undo，完全不需要为了“设计模式”再包装一个抽象 ToolCommand 层。未来 Agent 真需要 `execute/validate/undo/serialize` 的可审核 GIS 操作时，再单独引入 Command API；与**鼠标工具状态**分属不同领域。

---

## 11. 配置模型和 Schema 扩展

### 11.1 现状

`normalizeConfig()` 对应用配置做 JSON 检查、复制和冻结；`config.ts` 负责 Map、Layers、Tools、Data、Legend 和 LayerStyle 的结构验证；UI 有独立的 `ui-config.ts`。对于 V1 是合适的，但 Validator 数量和新图层类型增多后，`config.ts` 仍易膨胀。

### 11.2 建议拆分

```text
config/
├── normalize-config.ts
├── validate-app-config.ts
├── validate-layer-config.ts
├── validate-legend.ts
├── validate-layer-style.ts
├── ui-config.ts
└── json.ts
```

不是让每个 validator 都新增 class；优先函数式组合。保持原来的 `parseGISAppConfig` / `normalizeConfig` 导出。

### 11.3 类型专属数据源校验如何分工

- **Core**：全局 ID、type、children、legend、style、options 的通用结构；非 JSON 值和循环引用；已知字段的基础格式。
- **Adapter factory**：XYZ 的 URL、WMS 的服务参数、WMTS 的 capabilities/matrixSet、GeoJSON 的 source 格式；使用统一的 `GISRuntimeError` 路径与阶段。
- **业务插件**：业务自有 `source` 或扩展数据；不可强迫 Core 认识业务字段。

如果以后必须在 `init()` 创建图层前先完成所有插件型配置校验，可让 `LayerTypeDefinition` **可选**提供 `validate(config)`；但这会改变公开契约，应在需求出现时单独设计，不是本轮 P0。

### 11.4 动态 add 配置的快照问题

当前 `createLayer()` 校验 `normalizeLayerStyle(config.style)`，但未将返回的冻结/规范化值写回传给 LayerFactory 的 config。动态 `app.layers.add(config)` 也可以收到调用方继续修改的对象，异步 Factory 阶段可能读到变化后的内容。

建议统一 `normalizeLayerInput(config)`：在进入异步阶段之前为公共字段做只读快照；确保用户代码在 `layers.add()` 后修改原对象不影响已排队创建；**具体 source 的拷贝方式要考虑大型 GeoJSON 的内存成本**，可采用 ownership contract / 深拷贝仅 JSON 配置 / 明确不可变输入中的一种，先定契约再优化。

---

## 12. ESLint 与工程化改进（基于最新提交）

### 12.1 本次已经改了什么

最新仓库：

- 根 `eslint.config.js`：JS/TS/Vue 推荐规则，并新增 Core 禁止直接导入 `vue`/`ol`/UI Adapter 包、UI 层禁止直接导入 `ol` 和 Adapter 的边界规则。
- 新增 `eslint.quality.config.js`：复杂度 20、深度 4、函数 100 行、命名、参数数目、strict eq、`curly`、`semi`、no-shadow 等质量约束。
- `.prettierrc.json` 改为 `semi: true`，与 quality 检查的 `semi: always` 风格相符。
- `package.json` 新增 `lint:quality`，但 `check` 仍是 `lint → format:check → typecheck → test → build`，**没有包含 lint:quality**。

### 12.2 建议落地方式

- **保留根目录唯一 ESLint Flat Config**，不在每个 package 重建相同规则。
- Core 的“禁止地图引擎/UI 反向依赖”规则应进一步覆盖 `element-plus`、`maplibre-gl`、`leaflet` 等真实引擎库（按引入情况逐步扩），但不要对合法的 `type` import 误杀。
- Adapter 自身可增加“不得依赖 ui-vue”的包边界规则；UI 继续通过 Core API 访问引擎能力，除专用 OL UI 扩展包。
- `lint:quality` 应先作为**观察报告**运行，统计警告基线；当前大量大方法在引入 `max-lines-per-function: 100` 后可能报警，不能直接推断所有都必须拆。
- 对关键新文件/改造后文件逐步启用零新增警告；分层降低存量警告后，再让 `pnpm check` 包含 quality 门禁，或用逐步收紧的 `--max-warnings`。
- `id-length` 对空间坐标 `x/y/z`、遍历索引 `i/j` 并不合适，建议取消全仓强制或合理允许特殊名；降低无意义改名。
- `max-params` 可鼓励多参数改为明确 `Options`，但不要仅为满足规则把语义不同的依赖塞进巨大 Context。
- `complexity` / `max-depth` 适合作为重构提示，**不是架构正确性的证明**。

### 12.3 可执行的检查命令

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build

# 当前仓库新增的独立质量报告
pnpm lint:quality

# 复查生效规则
pnpm exec eslint --print-config packages/core/src/layer-service.ts
```

**注意**：`eslint.quality.config.js` 中的 `warn` 默认不会使进程非零退出，且当前未接入 `check`；如果希望“质量检查必须通过”，需要明确将警告变为失败条件或建立只检查新增代码的方案。

---

## 13. 推荐设计模式：该用的用，不要硬套

| 模式/原则 | Core 当前状况 | 推荐实施位置 | 必要性 |
| --- | --- | --- | --- |
| **Facade（门面）** | `GISApp`、各 Service 已具备 | 保留，暴露稳定统一入口 | **保留** |
| **Adapter（适配器）** | Map / UI Adapter 已具备 | 保持 Core 引擎无关 | **保留** |
| **Factory Method（工厂）** | `LayerTypeDefinition` 已具备 | 图层创建、扩展自定义类型 | **保留** |
| **Composite（组合）** | Group 目前半实现 | `LayerTree` + Group own/effective visibility | **重点加强** |
| **Observer（观察者）** | State/Event/Layer 订阅已具备 | 统一变更事件语义 | **重点加强** |
| **Strategy（策略）** | SearchProvider、ToolDefinition 等已有 | 按需要添加新的 Provider / LayerType | **沿用** |
| **Unit of Work（工作单元）** | addTree staged、update queue 部分具备 | 图层创建、更新与批量排序 | **局部引入** |
| **State（状态）** | AppStatus + 守卫已具备 | 生命周期转移规则表、轻量协调器 | 按需，不新增状态类层级 |
| **Command（命令）** | Tool 具备部分 Command 思想 | 未来 Agent GIS Runtime 的审计/执行操作 | **后续独立设计** |
| **Repository（仓储）** | `LayerService` Map 维护实例 | 可抽 `LayerStore` 纯内部容器 | 只要能减少职责即可 |
| **DI / IoC** | Context 轻量注入已具备 | 保留 `AppContext`，不引入全局容器 | 不建议新增框架 |
| **Event Sourcing** | 当前不具备 | 无明确审计/回放需求 | **不引入** |
| **CQRS** | 读快照/写 Service 已有部分分离 | 可借鉴查询与写入边界，不新建基础设施 | 不建议正式引入 |

**准则**：先有明确痛点、行为契约和测试，再选择模式；不因为“需要架构感”强行发明 `BaseAbstractLayerFactory`、`DefaultCoreContextFactory`、`GenericCapabilityManager` 等层次。

---

## 14. 推荐目录设计：按领域组织，逐步迁移

### 14.1 目标目录（建议版）

```text
packages/core/
├── src/
│   ├── index.ts
│   ├── errors.ts
│   │
│   ├── runtime/
│   │   ├── gis-app.ts                 # 公开 facade，薄编排
│   │   ├── app-assembly.ts            # 组装 service/context/state
│   │   ├── lifecycle.ts               # 当前状态守卫
│   │   ├── plugin-order.ts            # 保留现有拓扑排序
│   │   ├── plugin-registry.ts         # 条件成熟后抽离
│   │   └── cleanup-coordinator.ts     # 分阶段清理和错误收集
│   │
│   ├── context/
│   │   ├── app-context.ts
│   │   └── service-dependencies.ts
│   │
│   ├── layers/
│   │   ├── layer-service.ts           # 对外 facade，协调操作
│   │   ├── layer-instance.ts          # 单层对象/版本/状态
│   │   ├── layer-store.ts             # id 映射、pending、顺序
│   │   ├── layer-tree.ts              # 父子关系、有效显隐
│   │   ├── layer-creation.ts          # staged + rollback
│   │   ├── layer-mutation.ts          # 统一操作/事件出口
│   │   ├── layer-ordering.ts          # 逻辑顺序 → render order
│   │   └── layer-types.ts             # 内部类型注册
│   │
│   ├── map/
│   │   └── map-service.ts
│   │
│   ├── interactions/
│   │   ├── interaction-service.ts     # facade
│   │   ├── selection-controller.ts
│   │   ├── feature-pick-coordinator.ts
│   │   └── tool-controller.ts
│   │
│   ├── data/
│   │   ├── data-service.ts
│   │   └── data-set.ts
│   │
│   ├── search/
│   │   └── search-service.ts
│   │
│   ├── state/
│   │   ├── app-state.ts
│   │   ├── read-snapshot.ts
│   │   └── json-value.ts
│   │
│   ├── config/
│   │   ├── normalize-config.ts
│   │   ├── validate-app-config.ts
│   │   ├── validate-layer-config.ts
│   │   ├── validate-legend.ts
│   │   ├── validate-layer-style.ts
│   │   ├── ui-config.ts
│   │   └── json.ts
│   │
│   ├── events/
│   │   └── event-service.ts
│   │
│   ├── resources/
│   │   └── resource-scope.ts
│   │
│   └── types/
│       ├── app.ts
│       ├── map.ts
│       ├── layer.ts                 # 从 types.ts 的领域类型渐进抽离
│       ├── data.ts
│       ├── interaction.ts
│       ├── search.ts
│       ├── state.ts
│       ├── events.ts
│       ├── plugin.ts
│       ├── ui.ts
│       └── common.ts
│
└── test/
    ├── layers/
    │   ├── group-visibility.test.ts
    │   ├── layer-events.test.ts
    │   ├── layer-create-rollback.test.ts
    │   ├── layer-update-atomicity.test.ts
    │   └── layer-ordering.test.ts
    ├── runtime/
    │   └── lifecycle-ownership.test.ts
    ├── interactions/
    │   ├── feature-pick.test.ts
    │   └── tool-transition.test.ts
    └── state/
        └── app-state-benchmark.test.ts
```

**这个目录是目标信息架构，不是必须一次性创建的空文件清单。** 建议每次 PR 只创建确实承担一个稳定职责的文件，减少导出层层转发。

### 14.2 公共 API 保持稳定

```ts
// 使用者不变
import { createGISApp } from '@joinmap/gis-core';
import { createOLAdapter } from '@joinmap/adapter-ol';

const app = createGISApp().use(createOLAdapter());
await app.init({ map: { projection: 'EPSG:3857' } });
await app.layers.add({ id: 'a', type: 'geojson', source: { type: 'inline', data: {} } });
await app.layers.update('a', { visible: false });
await app.dispose();
```

上方 `data: {}` 仅演示 API 形状，**不是有效 GeoJSON**；实际测试需要合法 FeatureCollection。

不要求调用方知道内部 `LayerTree`、`LayerStore`、`LayerMutation`，更不应暴露 `OLLayerCollection` 为 Core 公共依赖。

### 14.3 导入依赖规则

```text
runtime/gis-app          → context、services、types、resource
layers/*                 → core types/context/map facade
interactions/*           → core types/context/events
map/map-service          → core MapAdapter contract
state/*                  → core readonly snapshot types
config/*                 → core JSON types

Core 任何模块      ✗ 不能 import ol、vue、element-plus
Core              ✗ 不能 import adapter-ol、ui-vue、ol-vue
Adapter-OL         ✓ 可以 import @joinmap/gis-core
UI-Vue             ✓ 可以 import @joinmap/gis-core
UI-Vue             ✗ 不应直接依赖 OpenLayers 具体对象
```

建议避免 `types/map.ts → ../types.ts → types/map.ts` 这类回环导入：TypeScript `import type` 通常不会产生运行时循环，但会降低契约定位清晰度。把 `LayerConfig`、`LayerInstance`、`MapLayerHandle` 等归属到 `types/layer.ts`，根 `types.ts` 与 `index.ts` 仅做 re-export（延后 P2）。

---

## 15. 分阶段迁移计划（建议 PR 路线）

### PR-00：锁定行为契约与基线（必须先做）

**目标**：不改生产源码，只补测试和一份可执行 API 行为契约。

- 固定当前提交 SHA；保存 `pnpm check`、`pnpm lint:quality` 的**实际执行结果**（本报告未执行）。
- 补 `LayerInstance` / `LayerService` 双入口事件一致性测试（预计当前有用例失败）。
- 补 Group 隐藏 → 显示 → 恢复子层可见性测试（预计当前有用例失败）。
- 补更新中的 `setVisible` / `setZIndex` 调用计数、故障回滚、部分 attach 清理测试。
- 比较 Core 的快照、图层顺序、工具结果组行为是否与 UI/Adapter 现有测试兼容。

**验收**：明确“当前失败用例”（红灯）与“已经通过的历史用例”（绿灯）；不靠改断言掩盖旧问题。

### PR-01：拆 `LayerInstance`，合并写入口和事件

- 移出 `LayerInstanceImpl` 到 `layers/layer-instance.ts`，保留行为不变作为第一小步。
- 引入统一 `LayerMutation` 回调/协调函数，让两种公开入口发同一种领域事件。
- 解决 `update()` 对 `visible/zIndex` 双写问题；版本和状态提交顺序明确。

**验收**：双入口通知一致，所有原有图层测试通过，不改对外方法签名。

### PR-02：Group Composite 与 LayerTree

- 提取 Group 的父子关系、成员身份保护（同 ID 重建不被旧 Group 错误接管）。
- 引入 own/effective visibility，保留子层偏好。
- 将 Group 领域节点与 MapLayerHandle 区分，暂时保留兼容 facade。
- 修改 LayerManager/Toolbar 相关测试以适应**有意修正的显隐语义**。

**验收**：嵌套 Group、多层隐藏、动态加子、删子、删父、空组、同 ID 重建均有测试；Core 和 UI 状态一致。

### PR-03：创建/更新的事务与生命周期

- `layer-creation.ts` 提取 staged/pending/commit/rollback。
- 明确 MapAdapter attach/detach 幂等或失败无副作用契约。
- 实现 best-effort cleanup + primary cause / cleanupErrors；修复 double dispose 风险。
- 对齐 OL Adapter 的 `createGeoJSONLayer` / `LayerBinding` / Dataset Scope。

**验收**：创建失败、remove 抛错、dispose 抛错、异步创建遇到 App.dispose、同 ID 重试，均无遗留 Handle、Dataset 或 Provider。

### PR-04：排序与层级投影

- 单一排序权威，清晰区分树展示顺序/渲染顺序。
- 保留当前 `setOrder(ids)` 兼容；处理 Group drag 后的 zIndex。
- 批量投影减少不必要的独立 setZIndex 调用。

**验收**：跨组/组内/负 zIndex/相同 zIndex/工具结果动态插入可测试；新 OL Adapter 和 FakeMapAdapter 均通过。

### PR-05：Interaction 分离

- `interaction-service.ts` 保留对外 facade；提取 FeaturePickCoordinator，再评估 ToolController。
- 保护选中状态与弹窗 choices 的异步取消语义。

**验收**：已有 2 秒超时、后来点击覆盖早先结果、拖动保留锚定选项、切换工具取消选择等用例继续通过。

### PR-06：Runtime 装配/清理及边界

- 精简 `GISAppImpl` 的构造和释放分支，保留原有插件次序和错误码。
- `context.resources` / plugin scope 所有权文档化；补跨包清理顺序测试。
- 不额外引入 DI 容器。

**验收**：Init 失败、UI Mount 失败、卸载重挂、并发 dispose、插件 install 失败和 cleanup 聚合行为不变。

### PR-07：State 性能基准驱动的优化

- 先跑 100/500/1000 图层的状态刷新基准。
- 仅在测试证明有瓶颈时引入 dirty-domain/revision；必要时做 UI render 边界测量。

**验收**：快照不可变性、分支引用稳定性、订阅次数不回退；性能结果报告可重复。

### PR-08：Config/Types/ESLint 收尾

- 拆配置校验文件和 `types/layer.ts`；保留根导出。
- 让动态 add 的配置公共字段归一化与 init 路径一致。
- 收紧 Core/Adapter/UI import 边界，设定 lint:quality 基线。

**验收**：公开 API 导出对比、TypeScript 类型测试、示例编译、ESLint/Prettier/全量测试通过。

### 推荐优先级

```text
必要：PR-00 → PR-01 → PR-02 → PR-03
较高收益：PR-04 → PR-05 → PR-06
条件性：PR-07（基准证明瓶颈才改）→ PR-08（随实际变更整理）
```

每个 PR **只完成当前阶段**，不要一次生成整个目标目录并搬迁所有文件。

---

## 16. 回归与故障注入测试矩阵

| 用例 | 当前覆盖情况（从测试源码看） | 新测试重点 | 所属 PR |
| --- | --- | --- | --- |
| LayerService 与 LayerInstance 两个入口修改显隐 | 未见专门等价性断言 | 状态/事件/版本相同 | PR-00/01 |
| LayerService 与 Instance 两个入口更新样式/标题 | 已覆盖版本串行与错误，但不覆盖等价通知 | 无双重真实 Handle 操作 | PR-00/01 |
| 父组关→开，子图层原先隐藏 | 现有组测试验证传播，不验证偏好恢复 | 保留子项 ownVisible | PR-00/02 |
| 嵌套 GROUP 显隐 | 有递归组基础覆盖 | 多层 effectiveVisible | PR-02 |
| Group 全部孩子隐藏 | 状态可能依赖 `children.some` | 区分 Group 自身开关与空/部分 | PR-02 |
| 动态追加组孩子 | 已有 | 父隐藏期间创建后恢复 | PR-02 |
| 删除组子节点后同 ID 重新创建 | 有身份保护测试 | 新 Layer 不被旧 Group 接管 | PR-02 |
| 异步 add 同 ID 并发 | 已有 | 恢复和 parent dispose 竞态 | PR-03 |
| addLayer 半附着后抛错 | 未见精确覆盖 | remove + dispose 安全清理 | PR-03 |
| removeLayer 抛错 | 已有 handle dispose 覆盖 | 原因与聚合错误完整 | PR-03 |
| Handle.update 部分改动后抛错 | 未见精确覆盖 | Adapter 更新原子/补偿合同 | PR-03 |
| patch 同时含 visible/zIndex/style | 已有部分更新测试 | 每个引擎属性不重复写入 | PR-01/03 |
| setOrder 中途失败 | 未见专门故障注入 | 回滚或明确失败后收敛路径 | PR-04 |
| 工具结果动态分组 + 重排 | OL Adapter 有集成测试 | 与新 Group/排序同一语义 | PR-04 |
| FeaturePicker 2s timeout 与取消 | 有 | 拆模块后保持原结果顺序 | PR-05 |
| Tool deactivate 失败 | 有 activation 失败用例 | 前后 Tool 一致性与错误恢复 | PR-05 |
| 并发 init/dispose | 有 | 架构重构后仍保留 | PR-06 |
| DataSet validator 抛错 | 有 | 保留旧数据和没有通知 | PR-06 |
| VectorSource 同步失败 | 未见精确覆盖 | DataSet 与派生视图恢复 | 跨包 PR |
| 500/1000 图层移动地图 | 有少量性能测试但非 Core 大规模基准 | 快照耗时、GC、UI 订阅 | PR-07 |
| 新版 WMS/WMTS 添加、更新、清理 | Adapter 新增对应测试 | Core 跨包适配行为不回退 | 全阶段 |

### 16.1 建议新增测试片段：双入口通知

```ts
it('publishes equivalent events for service and instance mutations', async () => {
  // 准备 FakeMapAdapter + 一个最小图层
  const events: unknown[] = [];
  const stop = app.layers.subscribe((event) => events.push(event));

  app.layers.setVisibility('a', false);
  const byService = events.splice(0);

  app.layers.get('a')!.setVisibility(true);
  const byInstance = events.splice(0);

  // 不直接比较 visible 的 true/false，应比较事件类型、次数和 ID
  expect(byService.map((event: any) => event.type))
    .toEqual(byInstance.map((event: any) => event.type));
  stop();
});
```

**提醒**：这是用来描述目标行为的测试草案，预计当前实现会失败；不要为通过测试而简单删除 `LayerInstance.setVisibility()` 公开 API。

### 16.2 建议新增测试片段：Group 偏好保持

```ts
it('keeps child visibility preference when toggling its parent group', async () => {
  // Group G 下：A=true, B=false
  app.layers.setVisibility('G', false);
  expect(app.layers.get('A')?.visible).toBe(false);
  expect(app.layers.get('B')?.visible).toBe(false);

  app.layers.setVisibility('G', true);
  expect(app.layers.get('A')?.visible).toBe(true);
  expect(app.layers.get('B')?.visible).toBe(false);
});
```

### 16.3 测试原则

- 单测用 FakeMapAdapter / FakeHandle 测纯 Core 语义；OL 集成测试验证真实引擎行为。
- 为异常路径提供确定性 Promise 控制器和 spy，不依赖等待真实网络。
- 新增测试不要弱化老测试；有意修改 Group 语义时，明确升级需求和受影响用户行为。
- 测试清理要严格，尽量每用例 `finally { await app.dispose() }`。
- 先观察失败，再实现，再回归；避免一条 Codex 指令改几千行。

---

## 17. 非目标与避免过度设计

本轮 Core 重构明确**不包括**：

- 新增第二个 GIS Runtime、第二套 LayerService 或层层套娃的 LayerManager；
- 把 OpenLayers 具体类型带入 Core；
- 改写 `createGISApp()` 的公共用法；
- 为 Leaflet、MapLibre、Cesium 一次写完全部 Adapter；
- 重做现有 LegendEditor、Vue Panel 或时间轴 UI；
- 在 Core 中引入 Redux、RxJS、DI 容器或全局 Event Sourcing；
- 在 Core 中直接实现完整 AI Agent；
- 无基准就批量做性能优化；
- 只为满足 max-lines 规则拆出大量无意义单行函数。

未来 AI+GIS Runtime 需要的 Command Layer，建议在这些底层操作契约稳定后单独设计：命令校验、权限、可审计日志、执行、撤销、批处理等，使用公开 `GISApp` 服务进行操作，不让 Agent 调用 OL 内部类。

---

## 18. 给 Codex 的分阶段执行提示词

### 18.1 PR-00：锁定现状与补测试（建议先复制这一段）

```text
请在仓库 flyFishHy/create-gis-app 最新 main 分支上，基于文档
create-gis-app-core-architecture-review-v2.md 执行 PR-00。

范围仅限 packages/core/test 和必要的测试辅助文件。
1. 核对当前 LayerInstance 与 LayerService 的 setVisibility/update 通知差异。
2. 增加 Group 隐藏再显示保留子图层自身 visibility 的目标行为测试。
3. 增加 handle.update 对 visible/zIndex 的重复调用检测。
4. 增加 adapter.addLayer 部分成功后抛错和 cleanup 再抛错的故障注入测试。
5. 将测试结果分为当前通过、目标行为当前失败（expected fail）、待讨论语义。

不要修改 Core 公开 API，不要实现全部修复，不要动 UI/adapter-ol。
完成后给出文件列表、测试命令、结果、风险与下一阶段建议。
```

### 18.2 PR-01：统一事件与 LayerInstance

```text
根据 PR-00 新测试，只实现 Core LayerInstance 与 LayerService 的统一写操作/通知路径。
保持 app.layers.get(id).setVisibility/update 和 app.layers.setVisibility/update 两种现有 API 均可用。
拆出 packages/core/src/layers/layer-instance.ts，尽可能保持业务行为不变。
确保 patch.visible 和 patch.zIndex 不会被同一个 update 重复应用到 MapLayerHandle。
保留 expectedVersion 版本校验和原有更新串行队列。
不得引入 IoC、CommandBus、OL 对象或大规模目录迁移；运行 pnpm check。
```

### 18.3 PR-02：Group Composite 与 visibility

```text
根据 PR-00 的 Group 目标测试，实现内部分层可见性 ownVisible/effectiveVisible。
先定义 LayerTree 的父子关系，再让 Group.setVisible 只修改 Group 自身意图，
不覆盖子图层自身显隐设置。
保留 GROUP 类型配置、app.layers.addChild、getMetadata().childIds、setOrder 的公开兼容行为。
补嵌套 Group、父关闭时动态增子、删除最后一子、同 ID 重建等回归。
Core 不能依赖 OpenLayers 和 Vue，UI 行为变化要列在迁移说明里。
```

### 18.4 PR-03：事务/资源清理

```text
根据 PR-00 故障测试收敛 Core Layer Factory、MapAdapter、MapLayerHandle 的失败契约。
先写契约文档，再调整 Core createLayer 的 attach/rollback/cleanup 顺序。
保证最初 cause 不被二次清理错误覆盖，支持 AggregateError 或 GISRuntimeError.cleanupErrors。
用 FakeMapAdapter 测试半 attach、remove 抛错、handle.dispose 抛错，
再用 adapter-ol 的 LayerBinding/GeoJSON Dataset 测试跨包释放顺序。
本 PR 不修改图层排序、FeaturePicker 或整体目录；运行 pnpm check。
```

---

## 19. 完成定义（Definition of Done）

一个阶段完成应满足：

1. **API 兼容**：`@joinmap/gis-core` 根导出的既有函数和类型没有无意删除，示例可编译。
2. **功能正确**：Group own/effective 显隐符合约定，实例/Service 入口通知一致，重复引擎调用消除。
3. **资源安全**：异常路径不遗留可访问的图层、Provider、Dataset、Observer，生命周期终态确定。
4. **异常可诊断**：原始错误和清理错误都能定位，不伪造失败原因为“配置错误”。
5. **跨包兼容**：新版 `adapter-ol` 的 XYZ/WMS/WMTS/GeoJSON、工具结果组和 FeaturePicker 集成不回退。
6. **测试保护**：新增边界测试与旧测试均通过；若故意改变 Group 语义，变更在文档中清晰说明。
7. **质量门禁**：`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`、`pnpm build` 均通过，并记录 `lint:quality` 的基线差异。
8. **可维护性**：每个新抽取的类/模块都有明确单一职责；没有只为行数达标而创建的空抽象。
9. **文档**：明确状态可见性、Layer 生命周期、Handle.update 失败策略和搜索/工具资源所有权契约。
10. **审查报告**：记录改变前后的测试、风险、迁移说明和受影响模块，便于分 PR 回滚。

---

## 20. 可追溯源码链接

以下全部为本次固定提交 `d549ec2` 的链接，避免日后 `main` 更新造成审查引用错位。

### Core 实现

- [GISApp Runtime](https://github.com/flyFishHy/create-gis-app/blob/d549ec203bfc55d48f0d500114a81b32bf858542/packages/core/src/runtime/gis-app.ts)
- [LayerService](https://github.com/flyFishHy/create-gis-app/blob/d549ec203bfc55d48f0d500114a81b32bf858542/packages/core/src/layer-service.ts)
- [InteractionService](https://github.com/flyFishHy/create-gis-app/blob/d549ec203bfc55d48f0d500114a81b32bf858542/packages/core/src/interaction-service.ts)
- [MapService](https://github.com/flyFishHy/create-gis-app/blob/d549ec203bfc55d48f0d500114a81b32bf858542/packages/core/src/map-service.ts)
- [AppState](https://github.com/flyFishHy/create-gis-app/blob/d549ec203bfc55d48f0d500114a81b32bf858542/packages/core/src/state/app-state.ts)
- [DataSet](https://github.com/flyFishHy/create-gis-app/blob/d549ec203bfc55d48f0d500114a81b32bf858542/packages/core/src/data/data-set.ts)
- [DataService](https://github.com/flyFishHy/create-gis-app/blob/d549ec203bfc55d48f0d500114a81b32bf858542/packages/core/src/data/data-service.ts)
- [ResourceScope](https://github.com/flyFishHy/create-gis-app/blob/d549ec203bfc55d48f0d500114a81b32bf858542/packages/core/src/resource-scope.ts)
- [Config](https://github.com/flyFishHy/create-gis-app/blob/d549ec203bfc55d48f0d500114a81b32bf858542/packages/core/src/config.ts)
- [Core Types](https://github.com/flyFishHy/create-gis-app/blob/d549ec203bfc55d48f0d500114a81b32bf858542/packages/core/src/types.ts)
- [Map Adapter Contract](https://github.com/flyFishHy/create-gis-app/blob/d549ec203bfc55d48f0d500114a81b32bf858542/packages/core/src/types/map.ts)

### 新 OL Adapter 对照

- [Plugin Registration](https://github.com/flyFishHy/create-gis-app/blob/d549ec203bfc55d48f0d500114a81b32bf858542/packages/adapter-ol/src/ol-adapter.ts)
- [OLMapAdapter](https://github.com/flyFishHy/create-gis-app/blob/d549ec203bfc55d48f0d500114a81b32bf858542/packages/adapter-ol/src/map/ol-map-adapter.ts)
- [LayerBinding](https://github.com/flyFishHy/create-gis-app/blob/d549ec203bfc55d48f0d500114a81b32bf858542/packages/adapter-ol/src/layers/common/layer-binding.ts)
- [LayerHandle](https://github.com/flyFishHy/create-gis-app/blob/d549ec203bfc55d48f0d500114a81b32bf858542/packages/adapter-ol/src/layers/common/create-layer-handle.ts)
- [GeoJSON Factory](https://github.com/flyFishHy/create-gis-app/blob/d549ec203bfc55d48f0d500114a81b32bf858542/packages/adapter-ol/src/layers/geojson/geojson-layer.ts)
- [VectorDataSync](https://github.com/flyFishHy/create-gis-app/blob/d549ec203bfc55d48f0d500114a81b32bf858542/packages/adapter-ol/src/layers/geojson/vector-data-sync.ts)

### ESLint 与现有测试

- [eslint.config.js](https://github.com/flyFishHy/create-gis-app/blob/d549ec203bfc55d48f0d500114a81b32bf858542/eslint.config.js)
- [eslint.quality.config.js](https://github.com/flyFishHy/create-gis-app/blob/d549ec203bfc55d48f0d500114a81b32bf858542/eslint.quality.config.js)
- [Layer Tests](https://github.com/flyFishHy/create-gis-app/blob/d549ec203bfc55d48f0d500114a81b32bf858542/packages/core/test/layer-service.test.ts)
- [Layer Update Tests](https://github.com/flyFishHy/create-gis-app/blob/d549ec203bfc55d48f0d500114a81b32bf858542/packages/core/test/layer-updates.test.ts)
- [Ownership Tests](https://github.com/flyFishHy/create-gis-app/blob/d549ec203bfc55d48f0d500114a81b32bf858542/packages/core/test/ownership.test.ts)
- [Runtime Boundaries Tests](https://github.com/flyFishHy/create-gis-app/blob/d549ec203bfc55d48f0d500114a81b32bf858542/packages/core/test/runtime-boundaries.test.ts)
- [AppState Tests](https://github.com/flyFishHy/create-gis-app/blob/d549ec203bfc55d48f0d500114a81b32bf858542/packages/core/test/app-state.test.ts)
- [OL Tile Layers Tests](https://github.com/flyFishHy/create-gis-app/blob/d549ec203bfc55d48f0d500114a81b32bf858542/packages/adapter-ol/test/layers/tile-layers.test.ts)

---

## 21. 最终决策建议

> **Core 的重构方向应当是“减少领域状态的歧义 + 统一操作和事件契约 + 强化 Adapter 失败语义”，而不是“再造一套更复杂的框架”。**

这次新版 `adapter-ol` 已经把引擎实现拆出了比较明确的职责层，下一步 Core 应优先稳固图层领域本身。建议立即着手 **PR-00（测试与契约）**，随后依次推进 **PR-01（双入口事件与更新）**、**PR-02（Group 可见性）**、**PR-03（失败回滚与资源清理）**。这些阶段完成后，Core 的扩展性会比“添加更多基类/Registry”有更实际的提升。

**再强调一次评审边界**：本报告未运行任何测试，故应将它作为“代码审查结论 + 可执行重构计划”，而不是声称发现了已复现的线上生产故障。所有 P0 首先用目标行为测试复核，随后才修改实现。
