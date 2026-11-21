# create-gis-app Canvas 时间轴 Vue 组件详细设计

> 文档名称：Canvas Timeline Component Design  
> 项目：create-gis-app  
> 设计版本：V1.0  
> 技术栈：Vue 3 + TypeScript + Canvas 2D + OpenLayers  
> 组件所属包：`@joinmap/ui-vue`  
> 状态：设计方案，待开发  
> 目标：实现专业级、可缩放、可平移、可扩展的 GIS 时空时间轴组件

---

# 1. 项目背景

## 1.1 当前架构

create-gis-app 采用三个核心包：

```text
create-gis-app
│
├── @joinmap/gis-core
│   ├── GISApp
│   ├── AppConfig
│   ├── LayerService
│   ├── Tool Runtime
│   └── TimeController（待新增）
│
├── @joinmap/adapter-ol
│   ├── OpenLayers Adapter
│   ├── Layer Adapter
│   └── Temporal Layer（后续）
│
└── @joinmap/ui-vue
    ├── Layout
    ├── LayerManager
    ├── PropertiesPanel
    ├── Toolbar
    ├── StatusPanel
    └── TimelinePanel（本次设计）
```

现有布局包括：

- Docked Dashboard
- Overlay

本次时间轴需要兼容两种布局，并遵循现有的配置驱动、Runtime 与 UI 分离的架构原则。

## 1.2 为什么采用 Canvas

基础时间进度条可以使用 HTML Slider。

但专业 GIS 时间轴需要：

1. 多时间粒度刻度。
2. 连续缩放。
3. 鼠标锚点缩放。
4. 拖拽平移。
5. 当前时间指针。
6. 自定义播放区间。
7. 多个时间轨道。
8. 时间事件标记。
9. 大规模时间数据展示。
10. 时间与像素的精确双向转换。

如果完全采用 DOM，会增加大量刻度元素、布局计算及交互管理复杂度。

因此本次采用：

**Canvas 2D + Vue DOM 的混合架构。**

Canvas 负责大量图形绘制，Vue 负责面板、按钮、输入和其他常规 UI。

## 1.3 核心设计原则

1. 时间轴组件不依赖 OpenLayers。
2. 时间轴组件不直接依赖 GISApp。
3. 时间轴组件不自己维护播放计时器。
4. 时间轴内部允许维护独立的可见时间范围。
5. Runtime 当前时间是唯一的播放时间数据源。
6. Canvas 不需要每帧全量重绘。
7. 支持 HiDPI。
8. 支持容器动态 Resize。
9. 不因面板隐藏而销毁 TimeController。
10. 不提前引入 OffscreenCanvas、WebGL 等复杂技术。
11. 不提前创建 TimelineManager、TimelineRegistry、TimelineEventBus。
12. 基础组件可以脱离 GIS 应用独立使用。
13. 专业轨道和事件能力通过数据驱动扩展。
14. 所有时间计算内部统一使用 Unix 毫秒时间戳。

---

# 2. 功能定位

## 2.1 两个 UI 层次

本次设计明确拆分：

```text
TimelinePanel
    │
    ├── PlaybackControls
    │
    ├── Timeline
    │
    └── TimelineSettings
```

其中：

### Timeline

基础时间轴组件。

负责：

- 时间刻度。
- 时间轴缩放。
- 时间轴平移。
- 播放指针。
- 时间选择。
- 时间区间。
- 时间轨道。
- 事件标记。
- Canvas 绘制。
- 指针交互。

不负责：

- 播放时钟。
- 倍速推进。
- GIS 图层更新。
- 网络请求。
- 业务轨迹插值。

### TimelinePanel

create-gis-app 的 GIS 工作台时间面板。

负责：

- 播放按钮。
- 暂停按钮。
- 停止按钮。
- 倍速选择。
- 循环模式。
- 时间轴展开和收起。
- 与 `app.time` 同步。
- Docked / Overlay 布局适配。

## 2.2 V1 功能范围

首版实现：

- [ ] Canvas 时间刻度。
- [ ] 秒、分钟、小时、天、月、年自动粒度。
- [ ] 主刻度和次刻度。
- [ ] 时间标签。
- [ ] 当前时间指针。
- [ ] 点击跳转。
- [ ] 指针拖拽。
- [ ] 鼠标滚轮缩放。
- [ ] 鼠标拖拽平移。
- [ ] 缩放至全部时间范围。
- [ ] 播放时间范围显示。
- [ ] 时间范围选择。
- [ ] HiDPI 适配。
- [ ] ResizeObserver。
- [ ] 亮色和深色主题。
- [ ] Docked / Overlay。
- [ ] 播放控制条。
- [ ] TimeController 绑定。
- [ ] 组件销毁清理。

## 2.3 V1.1 功能范围

- [ ] 多时间轨道。
- [ ] 时间区间条。
- [ ] 时间事件标记。
- [ ] 轨道显隐。
- [ ] 轨道点击。
- [ ] 轨道折叠。
- [ ] 事件 Tooltip。
- [ ] 事件与 GIS 对象联动。
- [ ] 离散帧刻度和吸附。
- [ ] 轨道内容裁剪和可见范围过滤。

## 2.4 V2 功能范围

- [ ] 轨道纵向虚拟化。
- [ ] 大规模事件聚合。
- [ ] 时间区间编辑。
- [ ] 轨道分组。
- [ ] 异步加载时间数据。
- [ ] 时间轴概览条。
- [ ] 多播放区间。
- [ ] 多轨迹统计可视化。
- [ ] 键盘高级交互。
- [ ] 导出时间轴可视化。
- [ ] 必要时引入 OffscreenCanvas。

**要求：V1 必须有合理的扩展接口，但不实现 V2 的完整功能。**

---

# 3. 整体架构

## 3.1 分层设计

```text
┌──────────────────────────────────────┐
│             TimelinePanel            │
│              Vue + DOM               │
│                                      │
│  ┌────────────────────────────────┐  │
│  │        PlaybackControls        │  │
│  └────────────────────────────────┘  │
│                                      │
│  ┌────────────────────────────────┐  │
│  │            Timeline            │  │
│  │                                │  │
│  │  ┌──────────────────────────┐  │  │
│  │  │ TimelineViewport         │  │  │
│  │  │ 时间与像素映射           │  │  │
│  │  └──────────────────────────┘  │  │
│  │                                │  │
│  │  ┌──────────────────────────┐  │  │
│  │  │ TimelineRenderer         │  │  │
│  │  │ Canvas 2D                │  │  │
│  │  └──────────────────────────┘  │  │
│  │                                │  │
│  │  ┌──────────────────────────┐  │  │
│  │  │ TimelineInteraction      │  │  │
│  │  │ Pointer / Wheel          │  │  │
│  │  └──────────────────────────┘  │  │
│  │                                │  │
│  │  ┌──────────────────────────┐  │  │
│  │  │ TimeTickGenerator        │  │  │
│  │  │ 时间刻度算法             │  │  │
│  │  └──────────────────────────┘  │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
                  │
                  │ Props / Emits
                  ▼
┌──────────────────────────────────────┐
│         GIS Core TimeController      │
│                                      │
│  currentTime / range / status        │
│  play / pause / stop / seek          │
│  speed / loop / frame subscription   │
└──────────────────────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────┐
│          OpenLayers Adapter          │
│                                      │
│  TrajectoryLayer                     │
│  TemporalVectorLayer                 │
│  TemporalRasterLayer                 │
└──────────────────────────────────────┘
```

## 3.2 数据流

播放过程：

```text
TimeController
      │
      │ currentTime
      ▼
TimelinePanel
      │
      ▼
Timeline
      │
      ▼
更新播放指针位置
```

同时：

```text
TimeController
      │
      ▼
Temporal Layer
      │
      ▼
更新地图内容
```

用户拖动时间轴：

```text
PointerMove
     │
     ▼
TimelineInteraction
     │
     ▼
TimelineViewport.xToTime()
     │
     ▼
Timeline emit seek
     │
     ▼
TimelinePanel
     │
     ▼
app.time.seek(time)
     │
     ├── Timeline 更新
     │
     └── GIS 地图更新
```

时间轴不能绕开 TimeController 直接操作地图。

---

# 4. 包和目录设计

## 4.1 推荐目录

```text
packages/
│
├── gis-core/
│   └── src/
│       └── time/
│           ├── types.ts
│           ├── TimeController.ts
│           └── index.ts
│
├── ui-vue/
│   └── src/
│       ├── components/
│       │   └── timeline/
│       │       ├── Timeline.vue
│       │       ├── TimelinePanel.vue
│       │       ├── PlaybackControls.vue
│       │       ├── TimelineCanvas.vue
│       │       │
│       │       ├── core/
│       │       │   ├── types.ts
│       │       │   ├── TimelineViewport.ts
│       │       │   ├── TimeTickGenerator.ts
│       │       │   ├── TimelineRenderer.ts
│       │       │   └── TimelineInteraction.ts
│       │       │
│       │       └── composables/
│       │           └── useTimelinePlayback.ts
│       │
│       └── styles/
│           └── timeline.css
│
└── adapter-ol/
    └── src/
        └── temporal/
            └── ...
```

以上目录为建议结构。

如果现有项目使用不同的组件组织方式，应与当前项目保持一致。

不要求每个文件都对应一个 Class。

## 4.2 文件职责

### Timeline.vue

- 基础组件入口。
- 接收 Props。
- 发出 Emits。
- 组织 Canvas 与必要 DOM。
- 管理可见时间范围。
- 调用绘制和交互模块。

### TimelineCanvas.vue

- 管理 Canvas 元素。
- 监听容器大小。
- 处理 DPR。
- 管理重绘调度。

如果实现后发现这一层只是薄包装，可以直接合并到 Timeline.vue，不必为了目录结构而增加组件。

### TimelineViewport.ts

- 时间与像素坐标转换。
- 缩放。
- 平移。
- 可见时间范围。
- 边界约束。

### TimeTickGenerator.ts

- 时间粒度选择。
- 生成主次刻度。
- 日期标签格式化。

### TimelineRenderer.ts

- Canvas 图形绘制。
- 刻度。
- 网格。
- 播放区间。
- 时间轨道。
- 时间事件。

### TimelineInteraction.ts

- 鼠标。
- 触摸。
- Pointer Events。
- 滚轮缩放。
- 平移。
- 指针拖动。
- 播放区间选择。

### PlaybackControls.vue

- Play / Pause / Stop。
- 倍速选择。
- 循环控制。
- 时间显示。

### TimelinePanel.vue

- 对接 GIS Runtime。
- 控制展开收起。
- 管理面板布局。
- 提供完整播放交互。

---

# 5. 核心数据模型

## 5.1 时间类型

```ts
export type Timestamp = number
```

单位：Unix 毫秒。

例如：

```ts
const timestamp = Date.parse(
  '2026-11-21T10:30:00+08:00',
)
```

内部计算不使用格式化日期字符串。

## 5.2 TimeRange

```ts
export interface TimeRange {
  start: number
  end: number
}
```

要求：

```text
start 和 end 必须为有限数字

start <= end
```

对于单点时间范围，Timeline 应展示单一时刻状态并禁止除零计算。

## 5.3 三种时间范围

这是最核心的设计之一。

```ts
export interface TimelineTimeState {
  // 全部数据覆盖的时间
  dataRange: TimeRange

  // 实际播放区间
  playRange: TimeRange

  // 画布当前可见时间
  viewRange: TimeRange

  // 当前播放时间
  currentTime: number
}
```

### dataRange

数据完整时间范围。

例如：

```text
2026-11-21 00:00:00
~
2026-11-22 00:00:00
```

### playRange

播放实际起止时间。

例如：

```text
2026-11-21 08:00:00
~
2026-11-21 18:00:00
```

### viewRange

时间轴画布当前可见时间。

例如：

```text
2026-11-21 10:00:00
~
2026-11-21 11:00:00
```

用户放大、缩小、平移时间轴，只改变 `viewRange`。

不应该自动改变 `playRange`。

`currentTime` 由 TimeController 统一维护。

## 5.4 时间范围关系

基本约束：

```text
dataRange 是完整数据范围。

playRange 通常位于 dataRange 内。

viewRange 默认显示 dataRange 或 playRange。

currentTime 位于当前有效播放区间内。
```

允许 `viewRange` 只显示 `playRange` 的一部分。

默认不允许时间轴平移到完全超出 `dataRange` 的位置。

后续如需显示数据范围外的空白时间，可增加明确配置。

---

# 6. Timeline 组件 API

## 6.1 Props

```ts
export interface TimelineProps {
  /**
   * 当前播放时间
   * Unix milliseconds
   */
  modelValue: number

  /**
   * 数据总时间范围
   */
  dataRange: TimeRange

  /**
   * 播放时间范围
   */
  playRange?: TimeRange

  /**
   * 时间轴可见时间范围
   * 不传则组件内部维护
   */
  viewRange?: TimeRange

  /**
   * 是否允许缩放
   */
  zoomable?: boolean

  /**
   * 是否允许平移
   */
  pannable?: boolean

  /**
   * 是否允许拖动当前时间指针
   */
  seekable?: boolean

  /**
   * 是否允许选择播放区间
   */
  rangeSelectable?: boolean

  /**
   * 是否显示时间刻度
   */
  showTicks?: boolean

  /**
   * 是否显示网格
   */
  showGrid?: boolean

  /**
   * 是否显示播放时间指针
   */
  showPlayhead?: boolean

  /**
   * 时间显示时区
   */
  timeZone?: string

  /**
   * 时间轴模式
   */
  mode?: 'compact' | 'advanced'

  /**
   * 时间轨道
   */
  tracks?: readonly TimelineTrack[]

  /**
   * 离散帧时间
   */
  frames?: readonly number[]

  /**
   * 是否吸附离散帧
   */
  snapToFrames?: boolean

  /**
   * 最大可见时间跨度，单位 ms
   */
  maxVisibleDuration?: number

  /**
   * 最小可见时间跨度，单位 ms
   */
  minVisibleDuration?: number
}
```

注意：

- `modelValue`、`dataRange` 是核心必填输入。
- 其他参数具有合理默认值。
- `tracks`、`frames` 是扩展能力，V1 不要求完整实现。
- `mode` 是展示模式，不是时间引擎的播放模式。

## 6.2 Emits

建议：

```ts
export interface TimelineEmits {
  (
    e: 'update:modelValue',
    time: number,
  ): void

  (
    e: 'update:viewRange',
    range: TimeRange,
  ): void

  (
    e: 'update:playRange',
    range: TimeRange,
  ): void

  (
    e: 'scrub-start',
    time: number,
  ): void

  (
    e: 'scrub-end',
    time: number,
  ): void

  (
    e: 'track-click',
    trackId: string,
  ): void

  (
    e: 'event-click',
    event: TimelineEvent,
  ): void
}
```

建议将低频的时间轴交互事件与播放时间推进分开。

Timeline 不能反向发出播放时钟的每一帧。

只有用户主动操作时才发出对应的时间更新。

## 6.3 使用示例

```vue
<script setup lang="ts">
import { ref } from 'vue'

const currentTime = ref(Date.now())

const dataRange = {
  start: Date.parse('2026-11-21T08:00:00+08:00'),
  end: Date.parse('2026-11-21T18:00:00+08:00'),
}

function handleSeek(time: number) {
  currentTime.value = time
}
</script>

<template>
  <Timeline
    :model-value="currentTime"
    :data-range="dataRange"
    :zoomable="true"
    :pannable="true"
    :seekable="true"
    time-zone="Asia/Shanghai"
    @update:model-value="handleSeek"
  />
</template>
```

独立使用时，上层可以自行提供时间值。

在 create-gis-app 内使用时，时间值来自 `app.time`。

---

# 7. TimelineViewport 设计

TimelineViewport 是时间轴最重要的底层模块。

## 7.1 职责

负责：

- 记录可见时间范围。
- 记录时间绘制区域宽度。
- 将时间转换为像素。
- 将像素转换为时间。
- 以指定位置缩放。
- 按像素平移。
- 适配容器变化。
- 限制时间范围越界。

不负责：

- Canvas 绘制。
- DOM 事件。
- 播放状态。
- GIS 图层。

## 7.2 基础接口

```ts
export interface TimelineViewportOptions {
  dataRange: TimeRange
  viewRange: TimeRange
  width: number
  minDuration: number
  maxDuration: number
}

export class TimelineViewport {
  constructor(
    options: TimelineViewportOptions,
  )

  getViewRange(): TimeRange

  setViewRange(
    range: TimeRange,
  ): void

  setDataRange(
    range: TimeRange,
  ): void

  setWidth(
    width: number,
  ): void

  timeToX(
    time: number,
  ): number

  xToTime(
    x: number,
  ): number

  zoomAt(
    x: number,
    factor: number,
  ): void

  pan(
    deltaX: number,
  ): void

  fitRange(
    range: TimeRange,
  ): void

  reset(): void
}
```

正式实现需要明确 `setDataRange()` 后的视口夹取规则。

## 7.3 时间转像素

设：

```text
viewStart = 可见开始时间
viewEnd   = 可见结束时间
width     = 时间绘图区宽度
time      = 输入时间
```

公式：

```text
duration = viewEnd - viewStart

ratio = (time - viewStart) / duration

x = ratio * width
```

代码：

```ts
function timeToX(
  time: number,
  range: TimeRange,
  width: number,
): number {
  const duration = range.end - range.start

  if (duration <= 0 || width <= 0) {
    return 0
  }

  return (
    (time - range.start) /
    duration *
    width
  )
}
```

## 7.4 像素转时间

公式：

```text
ratio = x / width

time = viewStart + ratio * duration
```

代码：

```ts
function xToTime(
  x: number,
  range: TimeRange,
  width: number,
): number {
  const duration = range.end - range.start

  if (width <= 0 || duration <= 0) {
    return range.start
  }

  return (
    range.start +
    (x / width) * duration
  )
}
```

默认保留浮点时间精度，输出到 Runtime 前可以取整为毫秒。

## 7.5 时间坐标与 DOM 坐标分离

时间绘制区域可能并不从 Canvas 的 X=0 开始。

例如：

```text
┌─────────────┬─────────────────────────────┐
│ 轨道名称栏  │ 时间绘制区域                │
│ 120px       │ 剩余宽度                    │
└─────────────┴─────────────────────────────┘
```

因此需要区分：

```ts
interface TimelineLayout {
  width: number
  height: number

  gutterWidth: number

  plotX: number
  plotWidth: number
}
```

`TimelineViewport` 只处理 plot 内的局部 X。

Canvas 事件进入 Viewport 前，需要扣除 `plotX`。

不能把整个面板宽度直接当作时间轴宽度。

---

# 8. 时间轴缩放设计

## 8.1 缩放交互

推荐：

- 鼠标滚轮向上：放大。
- 鼠标滚轮向下：缩小。
- 工具按钮支持放大、缩小。
- Fit 按钮恢复完整时间范围。

默认缩放系数：

```ts
const ZOOM_BASE = 1.12
```

定义：

```text
factor > 1 表示放大。

factor < 1 表示缩小。
```

放大意味着时间跨度变小。

## 8.2 鼠标锚点缩放

必须支持：

**鼠标所指向的时间点，在缩放前后保持相同的屏幕 X 位置。**

例如：

```text
时间轴显示 08:00–18:00

鼠标位于 10:30

滚轮放大

新的时间轴仍然让 10:30 位于鼠标位置
```

否则连续缩放时会产生明显的跳动感。

## 8.3 数学公式

设：

```text
start = 当前可见开始时间
end   = 当前可见结束时间

duration = end - start

x = 鼠标相对时间绘图区的位置
width = 时间绘图区宽度

factor = 缩放系数
```

锚点比例：

```text
ratio = x / width
```

锚点时间：

```text
anchorTime = start + ratio * duration
```

新时间跨度：

```text
newDuration = duration / factor
```

新范围：

```text
newStart = anchorTime - ratio * newDuration

newEnd = newStart + newDuration
```

## 8.4 参考实现

```ts
function zoomRangeAt(
  range: TimeRange,
  x: number,
  width: number,
  factor: number,
): TimeRange {
  if (
    width <= 0 ||
    !Number.isFinite(factor) ||
    factor <= 0
  ) {
    return range
  }

  const duration = range.end - range.start

  if (duration <= 0) {
    return range
  }

  const ratio = Math.max(
    0,
    Math.min(1, x / width),
  )

  const anchorTime =
    range.start + ratio * duration

  const newDuration =
    duration / factor

  const newStart =
    anchorTime - ratio * newDuration

  return {
    start: newStart,
    end: newStart + newDuration,
  }
}
```

以上为基础算法。

正式实现还必须加入：

- 最小时间跨度。
- 最大时间跨度。
- 数据范围边界约束。
- 无效缩放比例处理。
- 浮点误差处理。

## 8.5 缩放范围限制

建议默认：

```ts
const MIN_VISIBLE_DURATION = 1000

const MAX_VISIBLE_DURATION = 1000 * 60 * 60 * 24 * 365 * 10
```

分别表示：

- 最小可见跨度：1 秒。
- 最大可见跨度：约 10 年。

以上是初始建议值，应允许业务配置。

对于毫秒级遥测应用，可以允许更小跨度。

对于多年影像分析，可以允许更大跨度。

如果数据总范围本身不足最小跨度，需要提供合理的显示填充范围，但不能把虚构的时间加入原始 dataRange。

## 8.6 滚轮处理

建议：

```ts
function handleWheel(event: WheelEvent) {
  if (!props.zoomable) return

  event.preventDefault()

  const factor =
    event.deltaY < 0
      ? 1.12
      : 1 / 1.12

  viewport.zoomAt(
    pointerX,
    factor,
  )

  scheduleRender()
}
```

这只是交互核心示例。

正式实现应：

- 使用非 passive 的 wheel 监听器，确保允许阻止页面滚动。
- 归一化不同 `deltaMode` 的滚轮输入。
- 对触控板连续滚动采用平滑缩放处理。
- 使用 rAF 合并高频变化。
- 避免每个 wheel 事件重复执行昂贵的绘制。
- 对已触及缩放边界的事件明确是否允许页面继续滚动。

如果时间轴没有获得用户交互焦点，不建议无条件拦截整个页面的滚轮。

---

# 9. 时间轴平移设计

## 9.1 操作方式

推荐：

- 在时间刻度背景按住鼠标左键拖动。
- 指针区域拖动时优先执行 seek。
- 时间事件点击时不触发平移。
- 空白区域支持平移。
- 复杂模式可以支持空格 + 拖动。

需要明确不同命中区域的操作优先级。

## 9.2 平移公式

设：

```text
deltaX = 本次鼠标移动像素距离

duration = 当前可见时间跨度

width = 时间绘图区宽度
```

时间偏移：

```text
deltaTime = deltaX / width * duration
```

新的可见范围：

```text
newStart = start - deltaTime

newEnd = end - deltaTime
```

## 9.3 参考实现

```ts
function panRange(
  range: TimeRange,
  deltaX: number,
  width: number,
): TimeRange {
  if (width <= 0) {
    return range
  }

  const duration =
    range.end - range.start

  const deltaTime =
    (deltaX / width) * duration

  return {
    start: range.start - deltaTime,
    end: range.end - deltaTime,
  }
}
```

正式实现需要将结果限制在允许的最大可见区域内。

## 9.4 边界行为

推荐：

- 默认不允许整个视口离开数据有效范围。
- 当 viewRange 与 dataRange 一样宽时，不允许继续平移。
- 允许短暂的视觉边界提示，但 V1 不实现惯性平移。
- 当数据范围变化时，校正当前可见范围。

---

# 10. TimeTickGenerator 设计

TimeTickGenerator 负责生成合理时间刻度。

这是 Canvas 时间轴最复杂的模块之一。

## 10.1 输入

```ts
export interface TimeTickOptions {
  viewRange: TimeRange

  width: number

  targetMajorTickPx?: number

  timeZone?: string
}
```

## 10.2 输出

```ts
export interface TimeTick {
  time: number

  x: number

  major: boolean

  label?: string
}
```

注意：刻度的时间值和绘制 X 坐标也可以分离。如果刻度生成器只返回时间，由 Renderer 负责转换坐标，同样合理。

推荐优先保持 `TimeTickGenerator` 的职责纯粹。

## 10.3 时间粒度

推荐支持以下粒度：

```ts
type TimeUnit =
  | 'millisecond'
  | 'second'
  | 'minute'
  | 'hour'
  | 'day'
  | 'week'
  | 'month'
  | 'year'
```

常见间隔：

| 粒度 | 可选间隔 |
|---|---|
| 毫秒 | 100、200、500 |
| 秒 | 1、2、5、10、15、30 |
| 分钟 | 1、2、5、10、15、30 |
| 小时 | 1、2、3、6、12 |
| 天 | 1、2、7 |
| 周 | 1、2 |
| 月 | 1、2、3、6 |
| 年 | 1、2、5、10 |

不要仅用固定毫秒数计算所有日历粒度。

尤其：

- 不同月份天数不同。
- 闰年存在 2 月 29 日。
- 不同时间区存在夏令时。
- 一天不一定永远是 24 个本地小时。
- 一年不是固定 365 天。

小时以下的连续间隔可以按绝对时间处理；天、周、月、年需要使用明确时区下的日历边界。

## 10.4 自动选择间隔

输入：

```text
可见时间跨度

画布宽度

期望主刻度间距
```

默认：

```ts
const TARGET_MAJOR_TICK_PX = 100
```

计算：

```text
目标主刻度数量 = width / 100

目标时间间隔 = duration / 目标主刻度数量
```

从候选时间间隔中选择与目标间隔相近、且不会造成标签拥挤的粒度。

例如：

```text
可见 1 小时
画布宽度 800px

目标主刻度数量约 8

每格目标时长 7.5 分钟

可以选择 10 分钟主刻度
```

## 10.5 刻度生成流程

```text
viewRange
    │
    ▼
计算时间跨度
    │
    ▼
根据宽度估算主刻度间隔
    │
    ▼
选择时间粒度
    │
    ▼
对齐到时间边界
    │
    ▼
生成可见范围内的刻度
    │
    ▼
格式化主刻度标签
    │
    ▼
返回刻度数据
```

## 10.6 时间标签格式

推荐根据可见时间跨度自动改变标签。

例如：

```text
毫秒级：
10:30:12.250

秒级：
10:30:12

分钟级：
10:30

小时级：
10:00

天级：
11-21

月级：
2026-11

年级：
2026
```

建议使用：

```ts
Intl.DateTimeFormat
```

并缓存相同配置的格式化器。

对于多日、多月、多年的时间轴，可以增加上下两层时间标签：

```text
2026年11月
─────────────────────────────
21日  22日  23日  24日  25日
```

V1 先做单层标签。

V1.1 再增加多级时间刻度。

## 10.7 文字碰撞

必须避免标签重叠。

例如：

```text
10:00 10:05 10:10 10:15
```

如果画布太窄，不能强制绘制全部文本。

推荐：

```text
生成主刻度
    │
    ▼
测量文字宽度
    │
    ▼
判断与上一个标签是否碰撞
    │
    ▼
绘制或跳过标签
```

使用：

```ts
ctx.measureText(label)
```

测量宽度。

至少保留 6–10px 的文字间距。

注意，跳过标签不代表跳过刻度线。

---

# 11. Canvas Renderer 设计

## 11.1 绘制内容

V1 包括：

1. 时间轴背景。
2. 主刻度线。
3. 次刻度线。
4. 时间标签。
5. 纵向网格。
6. 播放区间背景。
7. 播放区间边界。
8. 空状态提示。

V1.1 增加：

9. 时间轨道。
10. 时间区间。
11. 事件标记。
12. 离散帧标记。

## 11.2 Renderer 接口

```ts
export interface TimelineRenderState {
  width: number
  height: number
  dpr: number

  viewRange: TimeRange
  dataRange: TimeRange
  playRange: TimeRange

  ticks: readonly TimeTick[]

  tracks?: readonly TimelineTrack[]

  theme: TimelineTheme
}

export class TimelineRenderer {
  constructor(
    canvas: HTMLCanvasElement,
  )

  render(
    state: TimelineRenderState,
  ): void

  dispose(): void
}
```

V1 可使用一个 Canvas。

不需要一开始建立大型的渲染器插件系统。

## 11.3 HiDPI 处理

Canvas 需要根据设备像素比调整实际分辨率。

```ts
function resizeCanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  const dpr = Math.max(
    1,
    window.devicePixelRatio || 1,
  )

  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)

  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`

  ctx.setTransform(
    dpr,
    0,
    0,
    dpr,
    0,
    0,
  )
}
```

绘制逻辑继续使用 CSS 像素。

需要注意：

- 不要重复叠加 `ctx.scale()`。
- 每次画布尺寸改变后重置 Transform。
- 实际 DPR 变化时需要重新设置画布。
- 处理 DPR 变化不能只依赖窗口尺寸变化。

## 11.4 渲染方法

```ts
class TimelineRenderer {
  render(
    state: TimelineRenderState,
  ) {
    this.clear(state)

    this.drawBackground(state)

    this.drawPlayRange(state)

    this.drawGrid(state)

    this.drawTicks(state)

    this.drawLabels(state)

    this.drawTracks(state)
  }
}
```

这是逻辑划分，并不要求每个步骤都成为独立类。

## 11.5 图层绘制顺序

推荐：

```text
Background
    ↓
PlayRange
    ↓
Grid
    ↓
Track Background
    ↓
Track Intervals / Events
    ↓
Time Ticks
    ↓
Labels
    ↓
Playhead
```

注意播放指针可以独立于 Canvas，由 DOM Overlay 绘制。

如果 Playhead 使用 DOM，那么 Renderer 不绘制最后一层。

---

# 12. 播放指针设计

## 12.1 推荐实现

V1 推荐：

**Canvas 绘制静态内容 + DOM 绘制动态 Playhead。**

例如：

```html
<div class="timeline">
  <canvas class="timeline-canvas"></canvas>

  <div class="timeline-playhead">
    <div class="timeline-playhead-handle"></div>
    <div class="timeline-playhead-line"></div>
  </div>
</div>
```

组件实现时使用 Vue 模板，不需要直接拼接 HTML 字符串。

## 12.2 为什么独立

播放时：

```text
currentTime 持续变化
```

但是：

```text
时间刻度不变

网格不变

大部分轨道内容不变
```

如果每帧重绘全部 Canvas，会产生不必要的开销。

分离后：

```text
当前时间变化
    │
    ▼
计算 Playhead X
    │
    ▼
更新 DOM Transform
```

静态画布不必重绘。

## 12.3 位置计算

```ts
const x = viewport.timeToX(
  currentTime,
)
```

更新：

```ts
playhead.style.transform =
  `translate3d(${x}px, 0, 0)`
```

需要处理 `plotX` 偏移。

当当前时间位于可见时间范围外：

- 默认隐藏 Playhead。
- 不自动强制滚动时间轴。
- 用户可以点击“定位到当前时间”。

可选增加自动跟随播放指针的模式。

## 12.4 指针拖动

拖动 Playhead：

```text
pointerdown
    ↓
进入 seeking 状态
    ↓
pointermove
    ↓
xToTime
    ↓
emit update:modelValue
    ↓
Runtime seek
    ↓
pointerup
    ↓
退出 seeking
```

建议使用 `setPointerCapture()`，保证拖动过程中指针离开组件后依然能收到相应事件。

需要处理：

- `pointerup`
- `pointercancel`
- `lostpointercapture`
- 组件卸载
- 窗口失焦

不能让组件一直停留在拖动状态。

## 12.5 播放中拖动

推荐：

- 开始拖动时暂时暂停播放推进。
- 拖动时根据指针位置实时 seek。
- 释放后恢复拖动前的播放状态。
- 如果拖动前是暂停，则释放后继续保持暂停。

实际暂停和恢复由 TimelinePanel 协调 TimeController，不应由基础 Timeline 自己启动或停止时钟。

---

# 13. TimelineInteraction 设计

## 13.1 交互状态

```ts
export type TimelineInteractionMode =
  | 'idle'
  | 'panning'
  | 'seeking'
  | 'selecting-range'
```

其中：

- `idle`：无交互。
- `panning`：拖动时间视口。
- `seeking`：调整当前时间。
- `selecting-range`：选择时间区间。

## 13.2 交互优先级

推荐：

```text
播放指针命中
    ↓
Seeking

时间范围手柄命中
    ↓
Range Selection / Resize

事件标记命中
    ↓
Event Click

空白区域拖动
    ↓
Panning

空白区域点击
    ↓
Seek
```

必须避免一个 PointerDown 同时触发多个操作。

## 13.3 点击和拖动区别

不能把所有 PointerDown 都认为是拖动。

建议引入移动阈值：

```ts
const DRAG_THRESHOLD_PX = 4
```

如果移动小于阈值：

```text
Click
```

超过阈值：

```text
Drag
```

这可以避免用户点击时间轴时发生轻微平移。

## 13.4 推荐实现方式

```ts
interface PointerState {
  pointerId: number

  startX: number
  startY: number

  lastX: number
  lastY: number

  mode: TimelineInteractionMode
}
```

根据命中区域决定模式。

不要在每个事件处理器中分别保存一套相互冲突的拖拽状态。

## 13.5 Hover

鼠标移动时：

- 计算悬停时间。
- 展示时间 Tooltip。
- 命中事件时展示事件信息。
- 在指针可拖动位置显示对应光标。

Hover 交互不应持续修改 TimeController。

---

# 14. 时间范围选择设计

## 14.1 目标

允许用户在时间轴上选择一段播放范围。

例如：

```text
数据时间：
08:00 ───────────────────── 18:00

播放范围：
          10:00 ─── 12:00
```

## 14.2 操作

推荐：

- 打开时间范围选择模式。
- 在时间轴上拖动选择区间。
- 显示半透明选择背景。
- 允许拖动开始和结束边界。
- 确认后更新 playRange。

V1 可以先实现拖动选区。

V1.1 再实现边界调整手柄。

## 14.3 重要约束

必须保证：

```text
playRange.start <= playRange.end
```

默认要求播放区间位于 dataRange 内。

同时不能与 viewRange 混淆。

用户缩放时间轴不应该修改播放区间。

---

# 15. 时间轨道设计

本章为 V1.1 的重点设计。

## 15.1 轨道用途

时间轨道用于展示不同数据在时间上的分布。

例如：

```text
车辆 A01     [======================]

车辆 A02          [==============]

投诉事件      •    •   •      •

覆盖栅格     [1][2][3][4][5][6]

设备告警           [====]     [===]
```

时间轨道不负责控制 GIS 图层的渲染逻辑。

它只是对应时间数据的可视化表达。

## 15.2 轨道类型

建议：

```ts
export type TimelineTrackType =
  | 'interval'
  | 'event'
  | 'frame'
```

### interval

展示有效时间区间。

适用于：

- 轨迹存在时间。
- 设备在线时间。
- 告警持续时间。

### event

展示离散事件点。

适用于：

- 投诉。
- 停留事件。
- 告警发生。
- 轨迹异常。

### frame

展示离散时间帧。

适用于：

- 气象栅格。
- 卫星影像。
- 周期性指标。

## 15.3 轨道数据模型

```ts
export interface TimelineTrack {
  id: string

  title: string

  type: TimelineTrackType

  color?: string

  visible?: boolean

  intervals?: readonly TimelineInterval[]

  events?: readonly TimelineEvent[]

  frames?: readonly number[]

  metadata?: Record<string, unknown>
}
```

时间区间：

```ts
export interface TimelineInterval {
  id: string

  start: number

  end: number

  color?: string

  label?: string

  metadata?: Record<string, unknown>
}
```

事件：

```ts
export interface TimelineEvent {
  id: string

  time: number

  title?: string

  color?: string

  metadata?: Record<string, unknown>
}
```

## 15.4 数据示例

```ts
const tracks: TimelineTrack[] = [
  {
    id: 'vehicle-a01',
    title: '车辆 A01',
    type: 'interval',
    color: '#38bdf8',

    intervals: [
      {
        id: 'vehicle-a01-active',
        start: startTime,
        end: endTime,
      },
    ],
  },

  {
    id: 'alarms',
    title: '设备告警',
    type: 'event',
    color: '#ef4444',

    events: [
      {
        id: 'alarm-001',
        time: alarmTime,
        title: '设备离线',
      },
    ],
  },
]
```

## 15.5 不应该将所有 GIS Feature 直接传入 Timeline

时间轴不需要知道：

```text
Feature Geometry
```

也不需要知道：

```text
OL Layer
```

只需要时间相关的轻量数据。

例如：

```ts
interface TimelineEvent {
  id: string
  time: number
}
```

地图定位交互可以使用事件 ID、轨迹 ID 交给业务层处理。

## 15.6 轨道布局

建议：

```ts
interface TimelineTrackLayout {
  headerHeight: number

  trackHeight: number

  gutterWidth: number

  trackGap: number
}
```

默认：

```ts
const layout = {
  headerHeight: 44,
  trackHeight: 32,
  gutterWidth: 120,
  trackGap: 2,
}
```

时间轨道纵向排列。

大量轨道时，需要滚动。

V1.1 可以先使用普通滚动容器。

V2 再加入纵向虚拟化。

---

# 16. 时间轨道渲染

## 16.1 区间裁剪

假设当前可见时间：

```text
10:00–11:00
```

某区间：

```text
09:30–10:30
```

不应该绘制完整区间的屏幕长度。

需要裁剪：

```ts
const visibleStart = Math.max(
  interval.start,
  viewRange.start,
)

const visibleEnd = Math.min(
  interval.end,
  viewRange.end,
)
```

如果：

```ts
visibleStart >= visibleEnd
```

则该区间不参与绘制。

## 16.2 转换为矩形

```ts
const x1 = viewport.timeToX(
  visibleStart,
)

const x2 = viewport.timeToX(
  visibleEnd,
)

const width = x2 - x1
```

然后：

```ts
ctx.fillRect(
  x1,
  trackY,
  width,
  trackHeight,
)
```

## 16.3 事件绘制

时间事件转换：

```ts
const x = viewport.timeToX(
  event.time,
)
```

只绘制位于视口附近的事件。

例如：

```ts
if (x < -10 || x > width + 10) {
  return
}
```

## 16.4 密集事件

如果事件数量特别多，可能出现：

```text
5000 个事件集中在 100px
```

不应该简单绘制 5000 个重叠圆点。

V1.1 可以优先进行可见范围过滤。

V2 实现像素分桶：

```text
每个像素桶统计事件数量
```

将密集事件绘制成数量标记或热度条。

---

# 17. 时间轴命中检测

## 17.1 需要命中的对象

- Playhead。
- 播放范围手柄。
- 时间事件。
- 时间区间。
- 轨道背景。

## 17.2 命中检测策略

对于 V1：

直接根据指针与 Playhead X 的距离判断即可。

```ts
const PLAYHEAD_HIT_WIDTH = 8
```

例如：

```ts
Math.abs(
  pointerX - playheadX,
) <= PLAYHEAD_HIT_WIDTH
```

对于 V1.1：

时间事件可以使用时间排序和可见范围查找。

不能为了一个事件点击功能就建立庞大的空间索引系统。

如果事件数量较少，直接遍历可见事件即可。

## 17.3 区间命中

需要判断：

```text
pointerX 位于 interval 的 x1 与 x2 之间

pointerY 位于对应轨道区域内
```

命中结果可以包含：

```ts
interface TimelineHitResult {
  type:
    | 'playhead'
    | 'interval'
    | 'event'
    | 'track'
    | 'empty'

  trackId?: string

  itemId?: string

  time?: number
}
```

这个类型为内部使用。

不必将完整命中系统暴露给普通业务开发者。

---

# 18. Canvas 重绘调度

## 18.1 不应该每次状态更新都立即绘制

不推荐：

```ts
function onPointerMove() {
  viewport.pan(...)

  renderer.render(...)
}
```

如果一次动画帧内触发多个 PointerMove，将重复绘制。

推荐使用统一调度：

```ts
let renderFrameId: number | null = null

function scheduleRender() {
  if (renderFrameId !== null) {
    return
  }

  renderFrameId = requestAnimationFrame(() => {
    renderFrameId = null

    renderTimeline()
  })
}
```

## 18.2 需要重绘的情况

- 首次挂载。
- Canvas 尺寸变化。
- DPR 变化。
- viewRange 变化。
- 主题变化。
- dataRange 变化。
- playRange 变化。
- tracks 变化。
- 时间事件变化。
- 时间轴布局变化。

## 18.3 不需要全量重绘的情况

仅仅：

```text
currentTime 改变
```

且 Playhead 由 DOM 单独渲染时，不需要重绘整个 Canvas。

只更新 Playhead 位置即可。

## 18.4 重绘策略

推荐：

```text
Static Canvas
  ├── Background
  ├── Ticks
  ├── Grid
  ├── PlayRange
  └── Tracks

Dynamic DOM
  ├── Playhead
  └── Tooltip
```

V1 使用一个 Canvas 即可。

不要提前实现多层 Canvas 管线。

---

# 19. Vue 响应式设计

## 19.1 不要让每帧重建组件树

如果播放时间每秒更新 60 次：

```text
60 FPS
```

不应该使整个 TimelinePanel 每秒执行 60 次复杂响应式更新。

建议区分：

- 低频状态：按钮状态、倍速、循环、时间范围。
- 高频状态：当前时间与 Playhead X。

## 19.2 低频状态

可以正常使用：

```ts
ref()
computed()
watch()
```

例如：

```ts
const playing = ref(false)

const speed = ref(1)

const loop = ref(false)
```

## 19.3 高频时间更新

推荐在 `TimelinePanel` 中订阅 TimeController 的高频帧通知。

然后直接更新 Playhead 的视觉位置。

例如：

```ts
function onTimeFrame(time: number) {
  timelineRef.value?.setPlayheadTime(time)
}
```

`setPlayheadTime()` 是建议的内部高频接口，可通过 Vue `defineExpose()` 暴露给父组件。

时间轴基础组件仍应支持普通的 `modelValue` 响应式更新。

两种路径应使用相同的 Playhead 更新逻辑，避免产生两套时间状态。

## 19.4 显示时间字符串

时间字符串不必每帧重新格式化。

例如：

```text
10:24:36
```

只有显示精度对应的时间单位改变时，才更新 DOM。

对于秒级显示，可以按秒更新。

如果业务要求毫秒精度，则按实际精度调整。

---

# 20. TimelinePanel 与 TimeController 集成

## 20.1 Core 最小时间接口

建议：

```ts
export interface TimeControllerAPI {
  play(): void

  pause(): void

  stop(): void

  seek(time: number): void

  setSpeed(speed: number): void

  setLoop(loop: boolean): void

  setRange(range: TimeRange): void

  getState(): TimeControllerState

  subscribe(
    listener: () => void,
  ): () => void

  onFrame(
    listener: (time: number) => void,
  ): () => void
}
```

这是目标接口。

应复用当前 Runtime 已有状态订阅和生命周期机制。

不必因为这个接口再新增 EventBus。

## 20.2 TimeControllerState

```ts
export interface TimeControllerState {
  status:
    | 'idle'
    | 'ready'
    | 'playing'
    | 'paused'
    | 'ended'

  currentTime: number

  range: TimeRange | null

  speed: number

  loop: boolean
}
```

需要注意：

```text
TimeController.range
```

对应当前播放区间。

Timeline 的 `dataRange` 可以由业务时间数据计算得到。

两者不一定相同。

## 20.3 UI 集成流程

```text
app.time
    │
    ├── subscribe()
    │       │
    │       ▼
    │   PlaybackControls
    │
    └── onFrame()
            │
            ▼
        Timeline Playhead
```

用户操作：

```text
Timeline seek
    │
    ▼
app.time.seek(time)
```

## 20.4 Vue Composable

建议：

```ts
useTimelinePlayback()
```

该 Composable 负责：

- 从现有 UI Context 获取 GISApp。
- 读取 TimeController。
- 订阅播放状态。
- 订阅播放帧。
- 调用 Play/Pause/Stop/Seek。
- 组件卸载时解绑。

不要让每个按钮直接自行获取 GISApp。

## 20.5 释放订阅

必须在组件卸载时执行：

```ts
onUnmounted(() => {
  unsubscribeState()
  unsubscribeFrame()
})
```

实际实现需要考虑组件多次挂载、Runtime 销毁和异步初始化状态。

---

# 21. 播放控制组件设计

## 21.1 PlaybackControls

播放控制应与 Timeline 分离。

```ts
export interface PlaybackControlsProps {
  status: TimeControllerState['status']

  speed: number

  loop: boolean

  currentTime: number

  range: TimeRange | null

  disabled?: boolean
}
```

建议事件：

```ts
type PlaybackControlEvent =
  | 'play'
  | 'pause'
  | 'stop'
  | 'previous'
  | 'next'
  | 'speed-change'
  | 'loop-change'
```

## 21.2 控件列表

- 播放。
- 暂停。
- 停止。
- 跳转起点。
- 跳转终点。
- 上一步。
- 下一步。
- 倍速。
- 循环。
- 当前时间显示。

## 21.3 步进语义

V1 连续模式中：

```text
上一单位
下一单位
```

建议由明确的步长配置决定。

例如：

```ts
stepMs: 1000
```

不要把“上一帧”解释为上一浏览器 rAF 帧。

V1.1 离散模式中：

```text
上一有效数据时间
下一有效数据时间
```

---

# 22. UI 布局集成

## 22.1 Docked Dashboard

推荐：

```text
┌───────────────────────────────────────────┐
│ TitlePanel                                │
├───────────┬──────────────────┬────────────┤
│ Search    │                  │            │
│           │                  │ Properties │
│ Layer     │       Map        │            │
│ Manager   │                  │            │
│           │                  │            │
│ Legend    │                  │            │
├───────────┼──────────────────┼────────────┤
│           │  TimelinePanel   │            │
│           │  时间轴 + 控件   │            │
├───────────┴──────────────────┴────────────┤
│ StatusPanel                               │
└───────────────────────────────────────────┘
```

TimelinePanel 位于地图工作区下方。

默认高度建议：

```text
compact：88px

advanced：220px
```

允许折叠。

不强制让时间轴横跨左右两个侧栏。

## 22.2 Docked 布局技术要求

地图区域建议使用：

```css
.gis-main {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.gis-map-container {
  flex: 1;
  min-height: 0;
}

.gis-timeline-panel {
  flex: 0 0 auto;
}
```

Timeline 展开、收起时：

- 地图区域高度发生变化。
- 必须确保 OpenLayers 更新地图容器尺寸。
- 优先使用现有 ResizeObserver / Map Resize 机制。
- 不应让 TimelinePanel 自己直接依赖 OL Map。

## 22.3 Overlay

推荐：

```text
┌───────────────────────────────────────────┐
│ Search                           Properties│
│ LayerManager                              │
│                                           │
│                  Map                      │
│                                    Toolbar│
│                                           │
│                                     Legend│
│                                           │
│       TimelinePanel（浮动，可折叠）       │
│                                           │
│                StatusPanel                │
└───────────────────────────────────────────┘
```

默认：

```text
compact：高度约 64–80px

advanced：高度约 180–220px
```

建议：

- 底部居中。
- 位于 StatusPanel 上方。
- 与 LegendPanel 保持间距。
- 支持展开收起。
- 时间轴内容区域设置合理最大宽度。
- 小屏幕优先显示简洁模式。

Overlay 模式不改变地图 Canvas 的布局尺寸。

## 22.4 禁用时序功能

如果：

```ts
time: {
  enabled: false,
}
```

则：

- 不初始化 TimeController 动画任务。
- 不创建 TimelinePanel。
- 不创建相关订阅。
- 不占用额外布局空间。

如果仅：

```ts
ui: {
  panels: [
    {
      id: 'timeline',
      visible: false,
    },
  ],
}
```

则只隐藏 UI。

TimeController 可以继续运行。

---

# 23. AppConfig 设计

## 23.1 Runtime 配置

```ts
const appConfig = {
  time: {
    enabled: true,

    range: {
      start: startTime,
      end: endTime,
    },

    currentTime: startTime,

    speed: 1,

    loop: false,

    autoPlay: false,
  },
}
```

这是目标配置形式，需要与现有 GISAppConfig 统一。

## 23.2 UI 配置

```ts
const appConfig = {
  ui: {
    layout: 'docked-dashboard',

    panels: [
      {
        id: 'timeline',

        visible: true,

        options: {
          mode: 'compact',

          collapsible: true,

          zoomable: true,

          pannable: true,

          rangeSelectable: true,

          showGrid: true,
        },
      },
    ],
  },
}
```

面板配置遵循现有 UI Config 体系。

如果现有项目使用对象映射而非数组，不应为了时间轴强行修改整个面板配置结构。

## 23.3 配置职责

```text
appConfig.time
    │
    └── 时间引擎设置
```

```text
appConfig.ui
    │
    └── 时间轴展示设置
```

不要在 `createVueUI()` 中再次传入另一套时间配置。

---

# 24. 主题设计

## 24.1 CSS 变量

建议：

```css
.gis-timeline {
  --timeline-bg: #17212e;

  --timeline-surface: #1e293b;

  --timeline-border: rgba(148, 163, 184, 0.18);

  --timeline-text: #e2e8f0;

  --timeline-muted: #94a3b8;

  --timeline-grid: rgba(148, 163, 184, 0.18);

  --timeline-tick: #64748b;

  --timeline-playhead: #38bdf8;

  --timeline-range: rgba(59, 130, 246, 0.15);
}
```

这些变量应尽量映射现有 `gis-ui` 主题 Token。

避免让时间轴形成一套完全独立的主题系统。

## 24.2 深色主题

建议：

- 深蓝灰背景。
- 较细网格。
- 主刻度清晰。
- 次刻度弱化。
- 播放指针使用强调色。
- 播放区间使用半透明底色。
- 避免大量发光阴影。

## 24.3 浅色主题

建议：

- 使用浅灰背景。
- 网格为低对比度灰色。
- 时间指针仍使用主色。
- 轨道背景和播放区间明确区分。

Canvas Renderer 不直接写死主题颜色。

应通过传入的 Theme 数据绘制。

## 24.4 毛玻璃

Overlay 时间轴容器可以使用毛玻璃样式。

但是：

- 玻璃效果属于面板容器。
- Canvas 时间刻度最好绘制在清晰、稳定的背景上。
- 不建议对整个 Canvas 进行 `backdrop-filter`。
- 不建议每条时间轨道使用模糊效果。

---

# 25. 性能设计

## 25.1 性能目标

性能目标为测试基准，不作为未验证的性能承诺。

建议：

- 鼠标拖动响应流畅。
- 缩放和平移操作接近 60 FPS。
- Canvas 不发生明显闪烁。
- 静止时不持续调度绘制。
- 播放指针更新不触发整张 Canvas 重绘。
- 图层数据量较大时，时间轴仍能独立响应。

## 25.2 重绘控制

仅在绘制数据变化时：

```ts
scheduleRender()
```

不要每帧无条件执行：

```ts
renderAll()
```

## 25.3 可见范围过滤

对于事件数据：

```text
仅处理 viewRange 附近的数据
```

区间数据先判断是否与可见范围相交。

## 25.4 缓存

可以缓存：

- 当前刻度集合。
- 文本测量结果。
- 日期格式化器。
- 轨道可见区间。
- 绘制主题。

缓存失效条件必须清楚。

例如时间轴缩放、宽度改变后，刻度缓存应重新生成。

## 25.5 大数据策略

V1.1：

- 可见范围过滤。
- 二分查询事件时间。
- 区间裁剪。

V2：

- 轨道虚拟化。
- 事件像素分桶。
- 增量加载。
- 必要时 Worker 预处理。

不要在 V1 就引入额外高性能渲染依赖。

---

# 26. 生命周期设计

## 26.1 Mount

组件挂载后：

1. 获取 Canvas。
2. 获取 Canvas 2D Context。
3. 初始化 TimelineViewport。
4. 初始化 Renderer。
5. 绑定 Pointer Events。
6. 绑定 Wheel。
7. 启动 ResizeObserver。
8. 获取当前 DPR。
9. 执行首次绘制。

## 26.2 Props 更新

当以下 Props 变化：

```text
dataRange

playRange

viewRange

tracks

theme

mode
```

应更新对应内部状态。

并按需触发 Canvas 重绘。

`modelValue` 变化则优先只更新播放指针。

## 26.3 Unmount

组件卸载时：

- 移除 Pointer Events。
- 移除 Wheel。
- 停止 ResizeObserver。
- 取消未执行的 rAF。
- 释放 Pointer Capture。
- 清理 Tooltip。
- 清理内部缓存。
- 解除 Runtime 订阅（由 Panel 层负责）。

## 26.4 重复挂载

需要保证：

```text
mount
unmount
mount
unmount
```

不会产生重复监听。

也不会留下旧 Canvas 引用。

---

# 27. 边界条件

以下场景必须处理：

## 27.1 空数据

没有有效时间范围时：

```text
暂无时序数据
```

停止缩放、平移和 seek 操作。

## 27.2 单时间点

如果：

```ts
start === end
```

展示单时刻状态。

不要发生除零。

## 27.3 极短时间范围

例如：

```text
1 秒以内
```

应使用毫秒级刻度。

## 27.4 极长时间范围

例如：

```text
10 年
```

应使用月或年级刻度。

## 27.5 时间轴被隐藏

不可见且宽度为 0 时：

- 暂停绘制。
- 不丢失时间数据。
- 重新显示后重新测量并绘制。

## 27.6 播放时间超出 viewRange

默认隐藏指针或在边缘显示提示。

不强制每帧改变 viewRange。

可增加：

```ts
followPlayhead: boolean
```

实现自动跟随。

建议 V1 默认关闭。

## 27.7 时间轴缩放中播放

允许播放继续。

缩放只影响时间轴视图。

不影响 TimeController 的当前时间推进。

## 27.8 主题变化

主题变化后重新绘制 Canvas。

## 27.9 浏览器缩放

确保：

- CSS 像素坐标正确。
- DPR 正确。
- Pointer 坐标与 Canvas 内容对齐。

## 27.10 多组件实例

一个页面可以存在多个 Timeline。

每个 Timeline 有独立 Viewport、Canvas 和事件监听。

但连接同一个 GISApp 时，可共用 `app.time` 当前时间。

---

# 28. 可访问性

Canvas 适合绘图，但其内部内容不能天然作为普通 DOM 控件被键盘和辅助技术识别。

建议：

- 播放按钮使用原生 button。
- 时间输入使用可访问的 DOM 控件。
- 支持键盘跳转时间。
- 为 Canvas 提供简短的可访问说明。
- 对事件和轨道提供必要的文本替代信息。
- 不依赖颜色单独表达事件状态。
- 触摸设备上的时间指针需要足够大的命中区域。

V1 可以先提供：

```text
ArrowLeft：向前一个时间步长

ArrowRight：向后一个时间步长

Home：播放区间起点

End：播放区间终点
```

键盘事件仅在对应组件获得焦点时生效。

不要影响整个页面的快捷键。

---

# 29. 测试方案

## 29.1 TimelineViewport 单元测试

- [ ] timeToX 正确。
- [ ] xToTime 正确。
- [ ] 时间转坐标再转时间误差满足毫秒精度要求。
- [ ] 鼠标锚点缩放。
- [ ] 放大。
- [ ] 缩小。
- [ ] 向左平移。
- [ ] 向右平移。
- [ ] 边界夹取。
- [ ] 数据范围缩小。
- [ ] 最小时间跨度。
- [ ] 最大时间跨度。
- [ ] 零宽度。
- [ ] 单时间点范围。

## 29.2 TimeTickGenerator 测试

- [ ] 毫秒刻度。
- [ ] 秒刻度。
- [ ] 分钟刻度。
- [ ] 小时刻度。
- [ ] 天刻度。
- [ ] 周刻度。
- [ ] 月刻度。
- [ ] 年刻度。
- [ ] 跨月。
- [ ] 跨年。
- [ ] 闰年。
- [ ] 夏令时变化。
- [ ] 时区格式化。
- [ ] 标签不重叠。
- [ ] 主次刻度正确。

## 29.3 交互测试

- [ ] 点击时间轴 seek。
- [ ] 拖动 Playhead。
- [ ] 鼠标锚点缩放。
- [ ] 鼠标拖拽平移。
- [ ] 缩放范围限制。
- [ ] 平移范围限制。
- [ ] 点击与拖拽区分。
- [ ] PointerCancel。
- [ ] 失焦。
- [ ] 拖动结束。
- [ ] 时间范围选择。
- [ ] 触摸操作。

## 29.4 Canvas 测试

- [ ] 首次绘制。
- [ ] HiDPI。
- [ ] Resize。
- [ ] DPR 变化。
- [ ] 明暗主题切换。
- [ ] 无效宽度。
- [ ] 组件隐藏后重新显示。
- [ ] 静态内容重绘正确。
- [ ] 当前时间更新不触发全量重绘。

## 29.5 Runtime 联动测试

- [ ] 播放时 Playhead 更新。
- [ ] 暂停后停止移动。
- [ ] seek 后立即同步。
- [ ] 倍速变化。
- [ ] 循环播放。
- [ ] 时间范围变化。
- [ ] 多时序图层统一时间。
- [ ] Timeline 卸载不影响播放时钟。
- [ ] 应用销毁后无遗留监听。

## 29.6 布局测试

- [ ] Docked。
- [ ] Overlay。
- [ ] Compact。
- [ ] Advanced。
- [ ] 折叠。
- [ ] 展开。
- [ ] 小屏幕。
- [ ] 地图尺寸更新。
- [ ] 状态栏避让。
- [ ] 与图例面板不重叠。

---

# 30. 开发实施阶段

## Phase 1：纯时间坐标系统

实现：

- TimeRange。
- TimelineViewport。
- timeToX。
- xToTime。
- zoomAt。
- pan。
- fitRange。
- 边界约束。

交付：

- TypeScript 模块。
- 单元测试。
- 简单 Demo。

验收：

**任意时间与屏幕 X 可以正确转换，鼠标锚点缩放稳定。**

## Phase 2：Canvas 基础绘制

实现：

- TimelineRenderer。
- TimeTickGenerator。
- 主次刻度。
- 标签。
- 网格。
- 时间范围背景。
- HiDPI。
- ResizeObserver。

验收：

**时间轴可以正确显示从秒级到年级的刻度。**

## Phase 3：交互系统

实现：

- Pointer Events。
- 点击 seek。
- Playhead 拖动。
- Wheel Zoom。
- Pan。
- 范围选择。
- Hover 时间提示。

验收：

**时间轴可以像专业 GIS 时间控件一样自由缩放、平移和定位。**

## Phase 4：Vue 组件封装

实现：

- Timeline.vue。
- Props。
- Emits。
- 受控时间。
- 双主题。
- 生命周期清理。

验收：

**Timeline 可以脱离 GISApp 独立运行。**

## Phase 5：TimelinePanel

实现：

- PlaybackControls。
- TimelinePanel。
- TimeController 订阅。
- Docked 布局。
- Overlay 布局。
- 展开收起。

验收：

**create-gis-app 可以通过统一时间轴控制地图时序数据。**

## Phase 6：高级轨道

实现：

- TimelineTrack。
- Interval。
- Event。
- Frame。
- 轨道交互。
- 时间数据过滤。
- 事件点击。

验收：

**可以展示多轨迹有效区间、事件时间和栅格帧信息。**

---

# 31. 最终推荐 API

## 31.1 业务配置

```ts
const appConfig = {
  time: {
    enabled: true,

    range: {
      start: Date.parse(
        '2026-11-21T08:00:00+08:00',
      ),

      end: Date.parse(
        '2026-11-21T18:00:00+08:00',
      ),
    },

    speed: 60,

    loop: false,

    autoPlay: false,
  },

  ui: {
    layout: 'docked-dashboard',

    panels: [
      {
        id: 'timeline',
        visible: true,

        options: {
          mode: 'compact',

          collapsible: true,

          zoomable: true,

          pannable: true,

          rangeSelectable: true,
        },
      },
    ],
  },
}
```

## 31.2 初始化

```ts
const app = createGISApp({
  id: 'timeline-demo',
  name: 'GIS Timeline Demo',
})

app.use(createOLAdapter())
app.use(createVueUI())

await app.init(appConfig)
await app.mount('#app')
```

## 31.3 Runtime 调用

```ts
app.time.play()

app.time.pause()

app.time.stop()

app.time.seek(
  Date.parse(
    '2026-11-21T10:30:00+08:00',
  ),
)

app.time.setSpeed(60)

app.time.setLoop(true)
```

## 31.4 时序数据接入

建议后续支持：

```ts
const unbind = app.time.bind({
  id: 'business-temporal-layer',

  setTime(time) {
    updateBusinessLayer(time)
  },
})
```

此接口为目标 API。

核心时间轴不负责业务图层更新。

---

# 32. Codex 实施要求

请根据当前 create-gis-app 实际代码，实现 Canvas 时间轴 Vue 组件。

必须遵守以下要求。

## 32.1 架构要求

1. 先分析当前三个包的实际结构。
2. 复用现有 UI Context 和生命周期机制。
3. 不直接将 OpenLayers 引入 Timeline。
4. Timeline 不依赖 GISApp。
5. TimelinePanel 负责连接 TimeController。
6. 不创建第二套播放时钟。
7. 不重复维护 Runtime 当前时间。
8. 不创建不必要的 Registry / Manager / EventBus。
9. 不增加不必要的新 npm 包。
10. 与当前主题和布局规范保持一致。

## 32.2 Canvas 要求

1. 使用 Canvas 2D。
2. 正确处理 DPR。
3. 使用 ResizeObserver。
4. 静态刻度与动态指针分离。
5. 正确实现时间像素转换。
6. 正确实现鼠标锚点缩放。
7. 使用 rAF 合并绘制。
8. 不在每次 currentTime 更新时重绘全部刻度。
9. 正确处理时间和图形裁剪。
10. 处理组件销毁和监听清理。

## 32.3 时间要求

1. Unix 毫秒时间戳。
2. 秒、分钟、小时、天、月、年刻度。
3. 处理跨月、跨年。
4. 日历刻度不能简单使用固定毫秒数。
5. 统一时间显示时区策略。
6. 明确数据范围、播放范围、可见范围的区别。
7. 支持单点范围。
8. 支持范围夹取。
9. 支持空状态。
10. 时间轴不独立执行播放时间推进。

## 32.4 UI 要求

1. 适配 Docked。
2. 适配 Overlay。
3. 支持 Compact。
4. 支持 Advanced。
5. 支持展开和收起。
6. 与 StatusPanel、LegendPanel 避让。
7. 支持暗色和亮色。
8. 不新增常驻的大型 TrajectoryPanel。
9. 播放控件使用 Vue DOM。
10. 保持组件 API 简洁。

## 32.5 开发策略

严格建议：

```text
先分析仓库
   ↓
确定接口
   ↓
TimelineViewport
   ↓
TimeTickGenerator
   ↓
TimelineRenderer
   ↓
TimelineInteraction
   ↓
Timeline.vue
   ↓
TimelinePanel.vue
   ↓
TimeController 集成
   ↓
布局适配
   ↓
测试与 Demo
```

不要在第一阶段就同时实现轨迹、栅格、告警等所有时序业务。

应先保证时间轴组件本身稳定。

## 32.6 最终交付

至少包括：

- 完整的 Timeline 基础组件。
- Canvas 时间轴。
- 时间坐标系统。
- 缩放和平移。
- 自动时间刻度。
- 播放指针。
- 时间范围选择。
- Props 和 Emits。
- PlaybackControls。
- TimelinePanel。
- Runtime 时间同步。
- Docked / Overlay。
- 暗色 / 亮色主题。
- 单元测试。
- 可运行 Demo。
- 类型检查。
- 构建验证。
- 使用文档。

如果设计与现有仓库结构冲突，应优先保持现有公开 API 兼容，并说明实际调整。

---

# 33. 验收标准

## 基础组件

- Timeline 可以独立使用。
- 不依赖 OpenLayers。
- 不要求传入 GISApp。
- Props 和 Emits 有完整 TypeScript 类型。
- 时间坐标转换正确。

## Canvas

- 刻度显示正确。
- 缩放和平移平滑。
- HiDPI 清晰。
- 不频繁全量重绘。
- 不出现尺寸错乱。

## 交互

- 点击 seek 正确。
- Playhead 拖动正确。
- 鼠标锚点缩放正确。
- 平移正确。
- 数据边界处理正确。
- 时间范围选择正确。

## Runtime

- 唯一播放时间来自 TimeController。
- UI 隐藏不影响播放。
- 多个时序图层使用同一时间。
- 组件销毁无资源泄漏。

## UI

- 两套布局正常。
- 可展开收起。
- 不遮挡其他面板。
- 暗色亮色正常。
- 组件操作符合现有 UI 风格。

---

# 34. 最终架构决策

本次时间轴采用以下最终设计：

```text
create-gis-app
│
├── gis-core
│   └── TimeController
│       ├── CurrentTime
│       ├── Play / Pause / Stop
│       ├── Speed
│       ├── Loop
│       └── Seek
│
├── ui-vue
│   ├── TimelinePanel
│   │   ├── PlaybackControls
│   │   └── Timeline
│   │       ├── TimelineViewport
│   │       ├── TimeTickGenerator
│   │       ├── TimelineRenderer
│   │       └── TimelineInteraction
│   │
│   └── Layout
│       ├── Docked
│       └── Overlay
│
└── adapter-ol
    └── Temporal Layers
        ├── Trajectory
        ├── Vector
        └── Raster
```

最终设计原则：

**TimeController 负责时间推进。**

**TimelineViewport 负责时间坐标。**

**TimeTickGenerator 负责时间刻度。**

**TimelineRenderer 负责 Canvas 绘制。**

**TimelineInteraction 负责用户交互。**

**TimelinePanel 负责 Vue UI 与 Runtime 集成。**

**OpenLayers Adapter 负责根据时间更新地图。**

---

# 35. 总结

create-gis-app 的时间轴不应该只是一个普通的播放进度条。

它应该是一套完整的、支持 GIS 时空数据的 Canvas 时间可视化组件。

核心能力包括：

- 时间坐标映射。
- 自适应时间刻度。
- 连续缩放。
- 平移。
- 时间跳转。
- 播放区间。
- 多时间轨道。
- 事件标记。
- Runtime 时间同步。
- 专业 GIS 工作台布局适配。

但实现必须遵循渐进式原则：

**V1 先把时间坐标、Canvas、缩放、平移、播放指针和 Runtime 集成做好。**

**V1.1 增加多轨道、事件和离散帧。**

**V2 再研究大量事件、虚拟化和复杂时间交互。**

最终形成：

> 一个通用的 TimeController，一个专业的 Canvas Timeline，以及多个可以接入统一时间引擎的 GIS 时序图层。

这样既能够支撑轨迹回放，也能用于动态点位、基站告警、栅格指标和其他 GIS 时序可视化业务。