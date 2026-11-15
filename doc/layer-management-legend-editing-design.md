# 图层管理与图例编辑：当前实现及建议

本文是待实施方案。当前只修改状态栏，未增加图层管理操作或图例编辑器。

## 当前边界

- Core 的 LayerService 管理图层生命周期、显隐、排序、更新及图例数据；LayerInstance.legend 经 handle.resolveLegend 返回当前展示定义。
- OL Adapter 支持 XYZ、GeoJSON 和统一矢量样式（fillColor、strokeColor、strokeWidth、pointRadius），不支持属性分类/分段渲染。
- LayerManagerPanel 已接入显隐与不透明度；send 定位仍是禁用占位。现有 GROUP 支持子层和批量不透明度，不扩展组合图层。
- LegendPanel 读取可见图层快照；Legend 是可独立使用的纯展示组件。两者目前都没有编辑入口。
- LegendDefinition 是展示模型，items 没有分类值绑定，interval 的 stops 没有完整区间边界和开闭规则；visible 只影响展示样式，不过滤地图要素。

## 图层管理还应管理什么

| 能力 | 当前情况 | 建议优先级与入口 |
| --- | --- | --- |
| 显隐、不透明度 | 已完成 | 保持行内眼睛和展开滑块 |
| 定位到数据 | 仅占位 | 第一优先；落实 layer-location-design.md，先 GeoJSON |
| 绘制顺序 | Core 已有 setOrder，UI 无入口 | 下一步；先上移/下移，后拖拽，明确界面从上到下与地图绘制顺序的对应关系 |
| 矢量样式 | Adapter 已支持统一样式，UI 无入口 | 与图例符号编辑共用同一个编辑表单；颜色、线宽、点大小 |
| 比例尺/级别范围 | 未支持 | 业务需要时补配置、运行时更新与“不在显示范围”提示；与用户显隐分开 |
| 要素查询/筛选、属性表 | 搜索及点击选择已支持，完整属性表/筛选未支持 | 通过独立查询面板处理，图层行只放入口 |
| 刷新、错误重试 | DataSet 可更新，通用图层刷新契约缺失 | 有远程数据更新需求时再补，按数据源实现；不把普通 ready 显示为常驻状态 |
| 底图切换 | XYZ 可用，无底图角色和互斥组 | 后续按需提供独立底图入口，不能让所有业务图层互斥 |
| 分组、组合层 | 已有基础 GROUP | 本轮不扩展；后续明确组显隐、子层排序与批量操作语义 |

默认图层行继续保持“展开、眼睛、名称、定位”。展开区目前只保留不透明度，后续样式可用一个“样式设置”入口打开编辑器，避免在窄卡片里堆很多控件。
新增/删除图层与数据权限交给应用配置或专门的图层目录，不恢复默认删除按钮。
数据加载异常应在失败时给出明确反馈及可用的重试入口，而不是一直显示 ready。

排序需要同时确认：UI 最上层通常表示视觉最上层，而 OL 集合末项在同 zIndex 下最后绘制；已有显式 zIndex 可能覆盖集合顺序。分组也不能直接按扁平列表随意重排。实现前统一规则，不能只做 DOM 拖拽。

能力是否可编辑由实际类型和适配器支持决定；没有能力的控件不显示或明确禁用。权限判断归应用，不从图例类型或 UI 布局推断权限。本阶段不为此新增通用 Manager、Registry 或 EventBus。

## 图例“编辑”分两类

### 展示信息编辑

标题、图例项标签、排列、无数据文案等属于图例展示定义，可复用现有：

```ts
await app.layers.update(layerId, { legend: nextLegend })
```

这不应暗示地图样式发生变化。独立 Legend 的调用方自行提交数据，LegendPanel 才通过 Runtime 保存。
独立的纯展示 Legend 保持现有 props API；未来 LegendEditor 可采用 modelValue/update:modelValue 与 submit/cancel，由宿主持有草稿。

### 地图符号与分类规则编辑

用户修改色块、线宽、点大小，一般希望地图和图例同时变化。
当前只改 legend.items[].color 不会改 OL 样式；useLayerStyle=true 时，该颜色还会被真实图层样式覆盖。
因此跟随图层样式的颜色应从样式入口修改，不能在两个地方独立保存不同颜色。

第一阶段只支持已有的统一矢量样式：由同一个编辑器生成完整 options.style，并与图例文案在一次 LayerService.update 中提交。style 目前是完整替换，编辑一个字段必须保留其余已存在的字段。

```ts
// 待实现编辑器的提交方式；这两个更新字段已经是现有 Runtime API。
await app.layers.update(layerId, {
  options: { style: nextCompleteStyle },
  legend: nextLegend, // 单项 category 可显式 useLayerStyle: true
})
```

第二阶段再支持按字段分类、数值分段或连续着色。先定义可序列化的图层渲染规则：字段、匹配值、区间边界、颜色/符号、无数据规则；适配器根据规则绘制并生成 LegendDefinition。
渲染规则是地图样式的事实来源，图例是它的展示结果；不在 UI 根据标签猜分类条件，不反解图例图片，也不只改色带而不改地图。
此时再评估对 options.style 或 Core 中立类型的最小扩展，不为尚未落地的分类功能提前增加服务类。

图片图例与服务端样式生成的图例默认只读；是否支持编辑取决于对应服务的实际能力。图例项开关若要过滤地图，也必须先接入明确的渲染/过滤规则。

## UI 和保存流程

1. 每个可编辑图层的图例组提供编辑按钮；属性面板继续用于点击要素属性，避免被图层样式编辑覆盖。
2. 在现有 Legend 面板内切换到编辑视图，带返回、应用、取消；不新增长期占位的面板或第二套图例数组。
3. 编辑器复制当前值为临时草稿。默认点击应用才改变 Runtime，取消无副作用。实时预览及撤销后续再做。
4. 字段、数值、分类值、颜色及稳定项 ID 校验通过后提交；成功由 Runtime 快照刷新地图和图例，失败保留草稿并显示错误。
5. 编辑期间图层删除，阻止提交并退出；同 ID 重建也不能把旧草稿提交给新实例。外部样式变化时提示重新加载或解决冲突，不能静默覆盖。
6. Runtime 修改不等于把磁盘中的 appConfig.json 改写。持久化由应用显式保存到后端或导出配置；只序列化声明式定义，不保存 OL/Vue 对象、解析后的临时状态或鼠标位置。

## 建议实施顺序与验收

1. GeoJSON 定位：数据更新后范围正确；空数据无跳转；单点、不同投影、图层删除有明确处理。
2. 图层顺序：明确集合顺序/zIndex/分组语义，验证真实遮挡关系。
3. 统一样式 + 图例编辑：应用时地图和图例一致；取消无变化；失败、删除、外部更新不覆盖错误对象；保持独立组件用法。
4. 按需扩展分类/分段样式、图例过滤、比例尺范围及远程刷新。

参考实现：packages/core/src/layer-service.ts、packages/adapter-ol/src/ol-adapter.ts、packages/ui-vue/src/panels/LayerManagerPanel.vue、packages/ui-vue/src/panels/LegendPanel.vue、packages/ui-vue/src/components/Legend.vue。
