# create-gis-app 多粒度时间选择组件详细设计

> 文档名称：Multi-Granularity Time Picker Design  
> 项目：create-gis-app  
> 版本：V1.0  
> 技术栈：Vue 3 + TypeScript + Element Plus  
> 所属模块：`@joinmap/ui-vue`  
> 设计状态：V1 已实现  
> 核心目标：实现支持小时、天、周、月、年等粒度的通用时间选择组件，并与 GIS Runtime 和时序播放能力保持解耦。

---

## 仓库接入

`@joinmap/ui-vue` 从同一入口导出 `TimeFilterPicker` 和 `TimePicker`。独立挂载时引入
`@joinmap/ui-vue/style.css`，通过 `v-model` 接收 `TimeSelection | null`。内置看板使用
现有的 `time` 面板。在 `ui.timePicker` 设置选择选项，通过
`ui.panels: [{ id: 'time', visible: false }]` 隐藏面板。已提交的看板选择可从
`app.context.state.snapshot().extensions['vue-ui'].timeSelection` 读取。

`minTime` 和 `maxTime` 约束整个标准化结果，允许 `start === minTime` 和
`endExclusive === maxTime`。`maxRangeDurationMs` 约束实际持续毫秒数。默认使用当前
浏览器时区，可通过 `defaultTimeZone` 设置业务时区。夏令时重复小时附带 UTC 偏移。
精确范围遇到重复时间时须选择偏移，遇到不存在的时间时提示重新选择。

内部草稿只区分单周期与范围，精确范围以 `range + datetime` 表示。公开配置、
事件和快照继续支持 `custom-range`，精确范围的输出粒度仍为 `custom`。
从周期范围切换到精确范围时保留区间端点，切回时恢复之前选用的日历粒度。
确认变更依次触发 `update:modelValue`、`change`、`apply`。已选值被清空时
依次触发 `update:modelValue`、`change`、`clear`。

示例应用 `examples/basic-vue` 将选择器挂载到查询栏并使用 `Asia/Shanghai`。
API 示例见 [Vue UI API](vue-ui-api.md)。

---

# 1. 设计背景

## 1.1 当前项目架构

`create-gis-app` 当前主要包括：

```text
create-gis-app
│
├── gis-core
│   ├── GISApp
│   ├── AppConfig
│   ├── Layers
│   ├── Tools
│   └── TimeController（规划中）
│
├── adapter-ol
│   ├── OpenLayers Adapter
│   └── 各类 GIS 图层
│
└── ui-vue
    ├── SearchPanel
    ├── LayerManager
    ├── PropertiesPanel
    ├── Toolbar
    ├── TimePicker
    └── TimelinePanel（规划中）
```

当前 UI 存在时间选择组件的需求。

用户可能需要：

- 选择某一个小时。
- 选择某一天。
- 选择某一周。
- 选择某一个月。
- 选择某一年。
- 选择连续多个小时。
- 选择连续多天。
- 选择连续几周。
- 选择连续几个月。
- 自定义精确开始时间和结束时间。

例如：

```text
选择小时：

2026-11-21 10:00
```

```text
选择天：

2026-11-21
```

```text
选择周：

2026 年第 47 周
```

```text
选择月：

2026-11
```

```text
选择时间范围：

2026-11-01 ~ 2026-11-21
```

这些选择结果可能被业务用于：

- 查询某个时间范围内的投诉点。
- 查询某个月的基站指标。
- 查询某一周的历史告警。
- 查询车辆轨迹。
- 更新普通业务图层。
- 设置时序播放数据范围。

因此，需要设计一个统一、可配置、可复用的时间选择组件。

## 1.2 组件定位

本次时间组件定位为：

**TimeFilterPicker：通用多粒度时间筛选组件。**

它的职责仅包含：

1. 时间粒度选择。
2. 日期和时间选择。
3. 时间范围选择。
4. 时间快捷选项。
5. 时间合法性验证。
6. 时间范围标准化。
7. 时间显示格式化。
8. 向外输出选择结果。

不负责：

1. 自动请求后端。
2. 自动更新 GIS 图层。
3. 自动修改地图。
4. 自动操作 Timeline。
5. 自动播放时序数据。
6. 创建播放时钟。
7. 管理轨迹数据。

## 1.3 与其他时间能力的区别

未来 create-gis-app 中可能存在三个时间相关模块：

```text
TimeFilterPicker
    │
    └── 选择查询时间和时间范围


TimelinePanel
    │
    └── 展示时间轴、播放控制和时间跳转


TimeController
    │
    └── 统一管理播放时间并驱动时序图层
```

它们各司其职。

TimeFilterPicker 只输出用户选择的时间。

业务可以决定是否使用它更新 TimeController。

---

# 2. 设计目标

## 2.1 核心目标

实现一个支持多种时间粒度的 Vue 组件。

推荐组件名称：

```text
TimeFilterPicker
```

如果现有代码已经使用：

```text
TimePicker
```

则优先保持现有组件名称和公开入口兼容。

不应仅仅因为新增粒度支持就强制重命名整个组件。

## 2.2 设计原则

1. 不绑定具体 GIS 图层。
2. 不依赖 OpenLayers。
3. 不直接依赖 GISApp。
4. 基础组件可以独立运行。
5. 优先复用 Element Plus 日期选择组件。
6. 不自行实现复杂日历系统。
7. 粒度和选择模式分开设计。
8. 不同粒度统一输出明确的时间范围。
9. 内部使用 Unix 毫秒时间戳。
10. 支持明确的时区。
11. 时间边界采用左闭右开规则。
12. 不使用固定毫秒数计算自然月、周、年。
13. 不重复维护业务时间状态。
14. 不创建额外的 TimeManager 或 TimeRegistry。
15. 优先保持现有 create-gis-app 配置体系。

---

# 3. 时间粒度设计

## 3.1 支持的粒度

V1 推荐支持：

```ts
export type TimeGranularity =
  | 'hour'
  | 'day'
  | 'week'
  | 'month'
  | 'year'
```

V1.1 可以扩展：

```ts
export type ExtendedTimeGranularity =
  | TimeGranularity
  | 'minute'
  | 'quarter'
```

不建议在 V1 就提供毫秒、秒、十年等全部粒度。

当前 GIS 业务通常优先需要小时、天、周、月、年。

## 3.2 粒度具体含义

### Hour：小时

选择：

```text
2026-11-21 10:00
```

代表：

```text
开始：2026-11-21 10:00:00

结束：2026-11-21 11:00:00
```

即自然小时。

### Day：天

选择：

```text
2026-11-21
```

代表：

```text
开始：2026-11-21 00:00:00

结束：2026-11-22 00:00:00
```

### Week：周

默认采用 ISO 周规则：

- 星期一是一周开始。
- 星期日为一周最后一个自然日。
- 第 1 周是包含该年第一个星期四的周。
- 周编号使用 ISO 周所属年，而非简单使用自然年。

例如：

```text
选择：2026-W47
```

代表：

```text
开始：2026-11-16 00:00:00

结束：2026-11-23 00:00:00
```

### Month：月

选择：

```text
2026-11
```

代表：

```text
开始：2026-11-01 00:00:00

结束：2026-12-01 00:00:00
```

不能简单按 30 天计算。

### Year：年

选择：

```text
2026
```

代表：

```text
开始：2026-01-01 00:00:00

结束：2027-01-01 00:00:00
```

必须正确处理闰年。

## 3.3 时间粒度与时间步长的区别

需要区分：

**时间粒度 Granularity**

表示用户选择的时间单位。

例如：

```ts
granularity: 'hour'
```

**时间步长 Step**

表示选择或导航时，每次跨越多少单位。

例如：

```ts
granularity: 'hour'
step: 3
```

可以用于：

```text
00:00
03:00
06:00
09:00
12:00
```

但 V1 不建议把 `step` 暴露为通用公共配置。

首版统一按一个自然单位进行选择。

未来如果业务需要每 5 分钟、每 3 小时或每 15 天的时间桶，再设计明确的步长规则。

---

# 4. 选择模式设计

仅仅配置时间粒度还不够。

还需要定义用户是选择一个周期，还是选择一段时间。

## 4.1 三种模式

推荐：

```ts
export type TimeSelectionMode =
  | 'single'
  | 'range'
  | 'custom-range'
```

### single

选择一个完整时间单位。

例如：

```text
小时：2026-11-21 10:00

天：2026-11-21

周：2026-W47

月：2026-11

年：2026
```

### range

选择连续多个完整时间单位。

例如：

```text
小时：10:00 ~ 15:00

天：11月1日 ~ 11月7日

周：第45周 ~ 第47周

月：2026-01 ~ 2026-06

年：2024 ~ 2026
```

这里用户选择的是首尾两个完整周期。

范围包含用户选择的最后一个周期。

例如选择 11 月 1 日到 11 月 7 日，实际标准化结果为：

```text
[11月1日 00:00, 11月8日 00:00)
```

### custom-range

选择任意精确起止时间。

例如：

```text
2026-11-21 10:20:00

至

2026-11-21 15:45:00
```

这种模式不需要对齐整小时、整天或整月。

它适用于精准业务查询。

## 4.2 为什么需要 custom-range

假设业务需要：

```text
2026-11-21 10:20 ~ 11:45
```

如果使用小时粒度，则无法精确表达。

所以建议将：

```text
完整自然周期选择
```

与：

```text
精确时间范围选择
```

作为两种不同的选择语义。

## 4.3 默认模式

建议：

```ts
mode: 'single'
granularity: 'day'
```

这是最常见的日期筛选场景。

支持业务覆盖。

---

# 5. 统一时间值模型

这是整套组件最重要的设计。

不同粒度不能向业务输出互不兼容的数据类型。

不推荐：

```ts
// 小时
'2026-11-21 10'

// 天
'2026-11-21'

// 周
'2026-W47'

// 月
'2026-11'
```

让业务分别解析。

推荐统一为标准化的时间范围。

## 5.1 TimeRange

```ts
export interface TimeRange {
  start: number

  endExclusive: number
}
```

两个时间值均为 Unix 毫秒时间戳。

采用：

```text
[start, endExclusive)
```

左闭右开区间。

## 5.2 TimeSelection

```ts
export interface TimeSelection {
  /**
   * 选择模式
   */
  mode: TimeSelectionMode

  /**
   * 时间粒度
   * custom-range 使用 custom
   */
  granularity: TimeGranularity | 'custom'

  /**
   * IANA 时区
   */
  timeZone: string

  /**
   * 标准化后的时间范围
   */
  range: TimeRange
}
```

这个模型具有几个优点：

- 数据结构统一。
- 天、周、月等自然周期能表示完整区间。
- 后端能直接使用时间戳查询。
- 不需要猜测结束时间是否包含。
- 不需要使用 23:59:59.999 表示自然日结束。
- 能直接与后续时序数据查询、统计和时间轴范围对接。

## 5.3 小时示例

用户选择：

```text
2026-11-21 10:00
```

输出结构：

```ts
const selection: TimeSelection = {
  mode: 'single',
  granularity: 'hour',
  timeZone: 'Asia/Shanghai',

  range: {
    start: Date.parse(
      '2026-11-21T10:00:00+08:00',
    ),

    endExclusive: Date.parse(
      '2026-11-21T11:00:00+08:00',
    ),
  },
}
```

## 5.4 天示例

```ts
const selection: TimeSelection = {
  mode: 'single',
  granularity: 'day',
  timeZone: 'Asia/Shanghai',

  range: {
    start: Date.parse(
      '2026-11-21T00:00:00+08:00',
    ),

    endExclusive: Date.parse(
      '2026-11-22T00:00:00+08:00',
    ),
  },
}
```

## 5.5 周示例

```ts
const selection: TimeSelection = {
  mode: 'single',
  granularity: 'week',
  timeZone: 'Asia/Shanghai',

  range: {
    start: Date.parse(
      '2026-11-16T00:00:00+08:00',
    ),

    endExclusive: Date.parse(
      '2026-11-23T00:00:00+08:00',
    ),
  },
}
```

## 5.6 月示例

```ts
const selection: TimeSelection = {
  mode: 'single',
  granularity: 'month',
  timeZone: 'Asia/Shanghai',

  range: {
    start: Date.parse(
      '2026-11-01T00:00:00+08:00',
    ),

    endExclusive: Date.parse(
      '2026-12-01T00:00:00+08:00',
    ),
  },
}
```

## 5.7 时间范围查询

数据库查询可以采用：

```sql
WHERE event_time >= :startTime
  AND event_time < :endTime
```

这样连续时间范围不会因为结束时间精度问题出现重复统计或遗漏。

如果后端使用秒级时间戳，需要在 API 边界进行明确转换。

不允许前端和后端默默混用秒与毫秒。

---

# 6. 时间边界计算

## 6.1 必须实现的两个基础函数

推荐：

```ts
function startOfPeriod(
  time: number,
  granularity: TimeGranularity,
  timeZone: string,
): number
```

以及：

```ts
function addPeriod(
  time: number,
  granularity: TimeGranularity,
  amount: number,
  timeZone: string,
): number
```

通过这两个函数可以得到任何完整周期的起止时间。

例如：

```ts
const start = startOfPeriod(
  selectedTime,
  'month',
  'Asia/Shanghai',
)

const endExclusive = addPeriod(
  start,
  'month',
  1,
  'Asia/Shanghai',
)
```

## 6.2 不能固定毫秒相加

错误示例：

```ts
const monthEnd =
  monthStart + 30 * 24 * 60 * 60 * 1000
```

原因：

- 每月天数不同。
- 2 月存在闰年。
- 时区可能存在夏令时。
- 自然日不一定始终为 24 个真实小时。

正确做法是基于对应时区的日历进行计算。

## 6.3 时间运算方案

推荐优先检查项目已有的日期工具。

如果当前项目统一使用 Day.js，可以复用，但必须检查时区插件和 ISO 周插件是否已经正确配置。

如果需要完整的 IANA 时区、跨夏令时和自然周期计算，可以考虑使用：

```text
@js-temporal/polyfill
```

但不强制立即增加依赖。

如果项目业务仅明确支持固定时区，也可以先采用已经验证的日期工具实现。

关键要求：

**时间运算必须统一封装，不要在每个 Vue 组件中直接写 startOfMonth、startOfWeek 等重复逻辑。**

## 6.4 参考实现

以下使用 Temporal Polyfill 展示日历运算方式。

这是推荐的实现方向，是否引入依赖需要先检查当前仓库。

```ts
import { Temporal } from '@js-temporal/polyfill'

type Granularity =
  | 'hour'
  | 'day'
  | 'week'
  | 'month'
  | 'year'

function getPeriodStart(
  timestamp: number,
  granularity: Granularity,
  timeZone: string,
) {
  const date = Temporal.Instant
    .fromEpochMilliseconds(timestamp)
    .toZonedDateTimeISO(timeZone)

  switch (granularity) {
    case 'hour':
      return date.with({
        minute: 0,
        second: 0,
        millisecond: 0,
        microsecond: 0,
        nanosecond: 0,
      })

    case 'day':
      return date.startOfDay()

    case 'week':
      return date
        .subtract({
          days: date.dayOfWeek - 1,
        })
        .startOfDay()

    case 'month':
      return date
        .with({ day: 1 })
        .startOfDay()

    case 'year':
      return date
        .with({
          month: 1,
          day: 1,
        })
        .startOfDay()
  }
}
```

然后：

```ts
function getNextPeriodStart(
  start: Temporal.ZonedDateTime,
  granularity: Granularity,
) {
  switch (granularity) {
    case 'hour':
      return start.add({ hours: 1 })

    case 'day':
      return start.add({ days: 1 })

    case 'week':
      return start.add({ weeks: 1 })

    case 'month':
      return start.add({ months: 1 })

    case 'year':
      return start.add({ years: 1 })
  }
}
```

注意：

- 自然周默认按 ISO 星期一开始。
- 自然月和自然年要按日历推进。
- 小时遇到夏令时重复时间时，必须保留实际时间点的时区偏移语义。
- 如果从用户输入的本地墙上时间转换为时间戳，需要明确处理不存在或重复的本地时间。
- 上述代码是周期计算核心示例，正式实现还要进行参数校验与相应测试。

---

# 7. 周粒度详细设计

周粒度是最容易产生歧义的地方之一。

## 7.1 周起始日

V1 建议：

```ts
weekStart: 1
```

含义：

```text
1 = 星期一
```

符合常见国内业务和 ISO 周使用习惯。

V1 暂时不开放任意周起始日配置。

如需支持星期日为一周起点，应同时明确周编号所属年的计算规则，避免只修改周起点却沿用 ISO 周编号。

## 7.2 ISO 周编号

例如：

```text
2027-01-01
```

属于 ISO 周：

```text
2026-W53
```

这是因为 ISO 周所属年和日期的自然年可能不同。

因此不能简单使用：

```ts
date.getFullYear()
```

加上一个简单周计数生成周编号。

## 7.3 周显示格式

推荐：

```text
2026年第47周
```

在 Popup 中展示：

```text
2026年第47周

11月16日 - 11月22日
```

实际输出时间范围：

```text
[11月16日 00:00, 11月23日 00:00)
```

## 7.4 周选择 UI

建议复用 Element Plus 的 Week 模式。

例如：

```vue
<el-date-picker
  v-model="weekValue"
  type="week"
  placeholder="选择周"
/>
```

选择后不要直接把返回的某个日期当作最终查询时间。

必须经过：

```text
选择日期
    ↓
获取对应 ISO 周
    ↓
计算周一开始
    ↓
计算下一周周一
    ↓
生成 TimeSelection
```

## 7.5 周范围

例如：

```text
2026年第45周
~
2026年第47周
```

V1 推荐由两个周选择器组成：

```text
开始周：[2026-W45]

结束周：[2026-W47]
```

不依赖 Element Plus 必须提供原生的 WeekRange 类型。

选择开始周和结束周后进行标准化：

```text
start = 第45周周一零点

endExclusive = 第48周周一零点
```

必须校验开始周不能晚于结束周。

---

# 8. 小时粒度详细设计

## 8.1 UI 形式

推荐：

```text
日期：[2026-11-21]

小时：[10:00]
```

不建议为小时粒度完全重新开发日期日历。

日期选择复用 DatePicker。

小时选择可以复用 TimeSelect 或其他现有的时间选择组件。

## 8.2 小时列表

默认：

```text
00:00
01:00
02:00
...
23:00
```

用户选择：

```text
2026-11-21 10:00
```

实际选择：

```text
[10:00:00, 11:00:00)
```

## 8.3 小时范围

推荐：

```text
开始：
2026-11-21 08:00

结束：
2026-11-21 17:00
```

如果是完整小时范围模式，意味着选择 08 点到 17 点这十个小时段。

标准化范围：

```text
[08:00, 18:00)
```

而如果用户需要精确查询：

```text
08:00 到 17:00 整
```

则应该使用 custom-range 模式。

这样可以避免最后一个小时是否包含的歧义。

## 8.4 跨天范围

必须支持：

```text
2026-11-21 22:00
~
2026-11-22 03:00
```

不允许仅靠一个 TimePicker 的日内时间范围限制小时选择。

## 8.5 时区

如果应用明确采用：

```text
Asia/Shanghai
```

小时选择相对简单。

但如果需要支持存在夏令时的时区：

- 某一天可能只有 23 个实际小时。
- 某一天可能有 25 个实际小时。
- 某个本地小时可能不存在。
- 某个本地小时可能出现两次。

因此小时列表不能在所有时区下无条件假设 0–23 各对应一个唯一的真实时间段。

如需跨时区运行，重复小时应展示偏移信息，无法唯一确定的小时不能静默解析。

---

# 9. 月粒度与年粒度设计

## 9.1 月选择

使用 Element Plus Month 模式：

```vue
<el-date-picker
  v-model="monthValue"
  type="month"
  format="YYYY-MM"
/>
```

例如：

```text
2026-11
```

输出：

```text
[2026-11-01, 2026-12-01)
```

## 9.2 月范围

可以复用 MonthRange：

```vue
<el-date-picker
  v-model="monthRange"
  type="monthrange"
/>
```

例如：

```text
2026-01 ~ 2026-06
```

标准化：

```text
[2026-01-01, 2026-07-01)
```

## 9.3 年选择

使用 Year 模式：

```vue
<el-date-picker
  v-model="yearValue"
  type="year"
/>
```

## 9.4 年范围

年范围可以使用当前安装版本支持的 YearRange 功能，或复用两个 YearPicker。

不应把基础 TimeFilterPicker 与某一个 Element Plus 版本的可选功能强耦合。

## 9.5 年月选择格式

推荐：

```text
2026年
```

```text
2026年11月
```

如果 UI 空间较小，使用：

```text
2026
```

```text
2026-11
```

显示格式由组件格式化逻辑控制，不影响实际时间戳。

---

# 10. UI 交互设计

## 10.1 组件整体结构

推荐：

```text
┌─────────────────────────────┐
│ 时间筛选                    │
│                             │
│ 粒度                        │
│ [小时][天][周][月][年]      │
│                             │
│ 选择方式                    │
│ [单周期][周期范围][自定义]  │
│                             │
│ 时间选择                    │
│ [2026-11-21      ▼]         │
│                             │
│ 快捷选择                    │
│ [今天] [昨天] [本周]        │
│                             │
│ 当前选择                    │
│ 2026-11-21                  │
│                             │
│          [取消] [确定]      │
└─────────────────────────────┘
```

## 10.2 粒度切换

建议顶部采用 SegmentedControl 或 RadioGroup。

例如：

```text
小时 | 天 | 周 | 月 | 年
```

用户选择某个粒度后，下面的日期选择区域自动切换。

不需要在页面中同时放五个日期选择器。

## 10.3 动态内容

### 小时

```text
日期选择 + 小时选择
```

### 天

```text
日期选择器
```

### 周

```text
周选择器
```

### 月

```text
月份选择器
```

### 年

```text
年份选择器
```

### 自定义范围

```text
日期时间范围选择器
```

## 10.4 粒度切换时的行为

例如用户当前选择：

```text
2026-11-21 10:00
```

切换成：

```text
天
```

应自动转换为：

```text
2026-11-21
```

再切换成：

```text
月
```

转换为：

```text
2026-11
```

建议使用原选中范围的开始时间作为新粒度的锚点。

对于范围模式：

- 保留原范围所覆盖的自然周期。
- 开始时间向下对齐。
- 结束边界扩展到最后一个相交周期的结束。
- 不应直接截断原始数据范围。

例如：

```text
原范围：

11月20日 10:00 ~ 11月21日 15:00
```

切换为天粒度：

```text
11月20日 ~ 11月21日
```

在没有自动转换规则的情况下，应优先明确地重置草稿选择，而不是生成含义不清的区间。

## 10.5 确认与取消

推荐默认采用“确认后生效”：

```text
用户修改
    ↓
组件内部 Draft
    ↓
点击确定
    ↓
发出最终选择结果
```

取消则恢复原值。

原因：

- 时间筛选可能触发后台查询。
- 用户切换月份或粒度时不应立即频繁请求。
- 范围选择通常需要多个步骤才能完成。

允许配置立即生效模式，但不作为默认。

---

# 11. Vue 组件 API

## 11.1 核心 Props

```ts
export interface TimeFilterPickerProps {
  /**
   * 已提交选择
   */
  modelValue?: TimeSelection | null

  /**
   * 允许使用的粒度
   */
  granularities?: readonly TimeGranularity[]

  /**
   * 默认粒度
   * 仅在尚无选择值时使用
   */
  defaultGranularity?: TimeGranularity

  /**
   * 默认选择方式
   */
  defaultMode?: TimeSelectionMode

  /**
   * 尚未选择时使用的默认时区
   */
  defaultTimeZone?: string

  /**
   * 是否显示粒度切换
   */
  showGranularitySwitch?: boolean

  /**
   * 是否显示选择模式切换
   */
  showModeSwitch?: boolean

  /**
   * 是否显示快捷选项
   */
  showShortcuts?: boolean

  /**
   * 是否需要确认
   */
  confirmable?: boolean

  /**
   * 是否允许清空
   */
  clearable?: boolean

  /**
   * 是否禁用
   */
  disabled?: boolean

  /**
   * 允许选择的绝对时间范围
   */
  minTime?: number

  maxTime?: number
}
```

说明：

- `modelValue` 是已提交的最终选择。
- `defaultGranularity` 只用于初始状态。
- 如果已传入 `modelValue`，其 `granularity` 和 `timeZone` 优先作为有效值。
- `granularities` 控制可以切换的粒度。
- `custom-range` 通过选择模式进入，不当作普通自然周期。
- `minTime`、`maxTime` 应统一定义限制规则。

## 11.2 Emits

```ts
export interface TimeFilterPickerEmits {
  (
    e: 'update:modelValue',
    value: TimeSelection | null,
  ): void

  (
    e: 'change',
    value: TimeSelection | null,
  ): void

  (
    e: 'apply',
    value: TimeSelection,
  ): void

  (
    e: 'clear',
  ): void

  (
    e: 'cancel',
  ): void
}
```

推荐语义：

`update:modelValue`

已提交选择发生改变。

`change`

已提交值发生有效变化。

`apply`

用户点击确认，或立即生效模式中完成一次有效选择。

`clear`

用户主动清空。

`cancel`

用户取消当前草稿。

注意：

在确认模式中，普通日历点击只改变组件内部 Draft，不立即触发 `update:modelValue`。

## 11.3 基础使用

```vue
<script setup lang="ts">
import { ref } from 'vue'

const selectedTime = ref<TimeSelection | null>(null)
</script>

<template>
  <TimeFilterPicker
    v-model="selectedTime"
    :granularities="[
      'hour',
      'day',
      'week',
      'month',
      'year',
    ]"
    default-granularity="day"
    default-mode="single"
    default-time-zone="Asia/Shanghai"
  />
</template>
```

## 11.4 只允许天、周、月

```vue
<TimeFilterPicker
  v-model="selectedTime"
  :granularities="[
    'day',
    'week',
    'month',
  ]"
/>
```

## 11.5 仅允许月粒度

```vue
<TimeFilterPicker
  v-model="selectedTime"
  :granularities="['month']"
  :show-granularity-switch="false"
/>
```

## 11.6 时间范围查询

```vue
<TimeFilterPicker
  v-model="querySelection"
  default-mode="range"
  default-granularity="day"
  @apply="handleApply"
/>
```

```ts
async function handleApply(
  selection: TimeSelection,
) {
  const { start, endExclusive } = selection.range

  await loadBusinessData({
    startTime: start,
    endTime: endExclusive,
  })
}
```

---

# 12. 内部状态设计

## 12.1 状态分类

建议只有两类状态：

**已提交值**

```ts
modelValue
```

**编辑中的草稿**

```ts
draftSelection
```

不需要新增独立的 TimeStateStore。

## 12.2 状态规则

打开组件：

```text
modelValue
    ↓
复制为 draftSelection
```

用户修改：

```text
只更新 draftSelection
```

点击确定：

```text
校验
    ↓
标准化
    ↓
emit update:modelValue
    ↓
emit change
    ↓
emit apply
```

点击取消：

```text
丢弃 Draft
```

点击清空：

```text
emit update:modelValue(null)
    ↓
emit change(null)
    ↓
emit clear
```

## 12.3 外部修改

如果父组件更新 `modelValue`：

- 组件未编辑时立即同步显示。
- 组件正在编辑时，需要有确定行为。
- 推荐关闭编辑面板时同步外部新值。
- 若运行时可能频繁从外部更新选中值，不允许内部 Draft 在没有确认的情况下静默覆盖外部新值。

首版可以采用“外部值变化时撤销旧草稿并同步新值”的简单规则。

## 12.4 避免重复状态

不建议同时维护：

```ts
selectedDate
selectedWeek
selectedMonth
selectedYear
selectedRange
queryRange
```

六份彼此同步的独立状态。

应该围绕一个统一 Draft，通过不同 Picker 临时值与 `TimeSelection` 进行转换。

---

# 13. 日期组件适配设计

## 13.1 优先复用 Element Plus

建议建立一个轻量的 Picker 适配层：

```text
TimeFilterPicker.vue
│
├── GranularitySelector
│
├── SelectionModeSelector
│
├── PickerBody
│   ├── HourPicker
│   ├── DatePicker
│   ├── WeekPicker
│   ├── MonthPicker
│   ├── YearPicker
│   └── DateTimeRangePicker
│
├── ShortcutSelector
│
└── FooterActions
```

这里是 UI 逻辑结构，不要求每项都建立单独的 Vue 文件。

## 13.2 组件映射

建议：

```text
hour
    ↓
DatePicker + TimeSelect

day
    ↓
DatePicker(type=date)

week
    ↓
DatePicker(type=week)

month
    ↓
DatePicker(type=month)

year
    ↓
DatePicker(type=year)

custom-range
    ↓
DateTimePicker(type=datetimerange)
```

范围模式：

```text
day
    ↓
DatePicker(type=daterange)

month
    ↓
DatePicker(type=monthrange)

week
    ↓
两个 WeekPicker

hour
    ↓
开始日期小时 + 结束日期小时

year
    ↓
YearRange 或两个 YearPicker
```

针对 Element Plus 没有直接适配的组合，使用两个现有选择器即可。

不需要为此重做日历 UI。

## 13.3 转换规则

Element Plus 返回的 Date 或其他组件值，只作为 UI 输入。

必须经过统一的转换函数：

```ts
normalizeTimeSelection(...)
```

然后才能成为最终的 TimeSelection。

不允许各 Picker 自己定义不同的输出区间规则。

---

# 14. 标准化算法

## 14.1 单周期

```text
用户选择一个时间点
    ↓
startOfPeriod()
    ↓
addPeriod(1)
    ↓
生成 [start, endExclusive)
```

伪代码：

```ts
function normalizeSinglePeriod(
  selectedTime: number,
  granularity: TimeGranularity,
  timeZone: string,
): TimeSelection {
  const start = startOfPeriod(
    selectedTime,
    granularity,
    timeZone,
  )

  const endExclusive = addPeriod(
    start,
    granularity,
    1,
    timeZone,
  )

  return {
    mode: 'single',
    granularity,
    timeZone,
    range: {
      start,
      endExclusive,
    },
  }
}
```

## 14.2 连续周期范围

假设选择两个周期：

```text
A = 开始周期
B = 结束周期
```

标准化：

```text
start = startOfPeriod(A)

endExclusive = addPeriod(
  startOfPeriod(B),
  1
)
```

例如：

```text
选择：
2026年11月 ~ 2027年2月
```

实际范围：

```text
[2026-11-01, 2027-03-01)
```

## 14.3 自定义范围

用户直接选择：

```text
start = 10:20:00
end = 15:45:00
```

输出：

```text
[start, end)
```

不执行自然周期对齐。

必须保证：

```text
start < end
```

否则显示校验错误。

## 14.4 合法性验证

需要验证：

- 时间值为有限数字。
- 时间顺序正确。
- 粒度被允许。
- 选择模式被允许。
- IANA 时区有效。
- 不超过最大查询范围。
- 不小于最小允许时间。
- 不大于最大允许时间。
- 结束时间不是无效或缺失值。

## 14.5 时间边界限制

建议定义：

```ts
minTime?: number
maxTime?: number
```

为明确的绝对时间边界。

V1 推荐只允许选择完整落在约束内的周期。

例如：

```text
允许时间范围：

11月5日 ~ 11月20日
```

如果用户选择：

```text
11月份
```

整个自然月并未完整落入允许范围。

因此应禁用该完整月选择，而不是自动把“11月份”偷偷变成“11月5日至11月20日”。

如果业务需要允许部分周期，应通过自定义时间范围模式完成。

这样能保证 granularity 语义不被破坏。

---

# 15. 快捷时间设计

## 15.1 常用快捷项

建议支持：

- 今天。
- 昨天。
- 本周。
- 上周。
- 本月。
- 上月。
- 今年。
- 去年。
- 最近 7 天。
- 最近 30 天。

但不建议全部同时显示。

可根据粒度动态提供。

## 15.2 快捷项语义

必须明确区别：

**本周**

从本周周一开始到下周周一。

**上周**

上一个完整 ISO 周。

**本月**

本月第一天到下月第一天。

**最近 7 天**

建议定义为：

```text
包含今天在内的最近 7 个自然日
```

即从 6 天前当地零点到明天当地零点。

它与：

```text
过去 7 × 24 小时
```

不是同一个概念。

如果业务需要滚动时间窗口，可以另设快捷项：

```text
过去 168 小时
```

## 15.3 快捷项实现

建议：

```ts
export type TimeShortcut =
  | 'today'
  | 'yesterday'
  | 'this-week'
  | 'last-week'
  | 'this-month'
  | 'last-month'
  | 'this-year'
  | 'last-year'
  | 'last-7-days'
  | 'last-30-days'
```

通过纯函数计算：

```ts
function resolveShortcut(
  shortcut: TimeShortcut,
  now: number,
  timeZone: string,
): TimeSelection
```

不要在初始化组件时把所有“今天”“本周”都计算成永久固定的时间戳。

应在用户执行快捷选择时基于当前时间计算。

## 15.4 快捷选择与粒度切换

建议：

- 选择“今天”时，切换到 day + single。
- 选择“本周”时，切换到 week + single。
- 选择“本月”时，切换到 month + single。
- 选择“最近 7 天”时，切换到 day + range。

快捷项的语义优先于当前粒度。

---

# 16. 时间显示格式

## 16.1 格式建议

小时：

```text
2026-11-21 10时
```

天：

```text
2026-11-21
```

周：

```text
2026年第47周
```

月：

```text
2026-11
```

年：

```text
2026年
```

自定义范围：

```text
2026-11-21 10:20
至
2026-11-21 15:45
```

## 16.2 格式化 API

建议：

```ts
function formatTimeSelection(
  selection: TimeSelection,
  locale?: string,
): string
```

示例：

```ts
formatTimeSelection(selection, 'zh-CN')
```

得到：

```text
2026年第47周
```

## 16.3 周格式化注意事项

ISO 周编号必须使用 ISO 周所属年。

不能直接使用日期的自然年拼接周数。

## 16.4 时区显示

如果产品支持多个时区，建议在组件 Tooltip 或高级设置中展示：

```text
时区：Asia/Shanghai (UTC+08:00)
```

其中 UTC 偏移应根据具体日期计算，而不是假设某时区全年固定偏移。

---

# 17. 与 create-gis-app 配置集成

## 17.1 基础配置

建议在当前 UI 配置体系中添加：

```ts
const appConfig = {
  ui: {
    defaults: {
      timePicker: true,
    },

    timePicker: {
      granularities: [
        'hour',
        'day',
        'week',
        'month',
        'year',
      ],

      defaultGranularity: 'day',

      defaultMode: 'single',

      defaultTimeZone: 'Asia/Shanghai',

      showGranularitySwitch: true,

      showModeSwitch: true,

      showShortcuts: true,

      confirmable: true,

      clearable: true,
    },
  },
}
```

以上为目标配置示意。

实际应遵循当前 `ui-vue` 已有 AppConfig Schema。

不建议新增一套与现有面板配置并行的独立配置系统。

## 17.2 不配置图层 ID

不建议：

```ts
timePicker: {
  layerId: 'vehicle-tracks',
}
```

也不建议强制：

```ts
timePicker: {
  targetLayers: [
    'vehicle-tracks',
    'complaints',
  ],
}
```

原因：

TimeFilterPicker 是通用输入组件。

图层绑定应由业务逻辑或更高层的时间过滤能力负责。

## 17.3 业务使用示例

```ts
async function handleTimeApply(
  selection: TimeSelection,
) {
  const {
    start,
    endExclusive,
  } = selection.range

  const data = await queryComplaints({
    startTime: start,
    endTime: endExclusive,
  })

  await updateComplaintLayer(data)
}
```

实际业务中需要：

- loading 状态。
- 请求取消。
- 错误提示。
- 旧请求结果丢弃。
- 空数据处理。

这些不属于基础 TimeFilterPicker。

---

# 18. 与 TimeController 的关系

TimeFilterPicker 不直接依赖 `app.time`。

如果业务选择时间后希望设置播放范围，可以这样处理：

```ts
async function handleTimeApply(
  selection: TimeSelection,
) {
  const data = await fetchTrajectoryData(
    selection.range,
  )

  await updateTrajectoryLayer(data)

  app.time.setRange({
    start: selection.range.start,
    end: selection.range.endExclusive,
  })

  app.time.seek(
    selection.range.start,
  )
}
```

这里需要特别注意：

TimeFilterPicker 返回的是：

```text
查询区间：[start, endExclusive)
```

而 TimeController 管理的是：

```text
连续播放的时间范围
```

两者是否允许播放到边界终点、是否根据已加载数据调整范围，应该由 TimeController 定义。

不能直接假设所有业务查询结束时间都一定是有效的轨迹采样时间。

---

# 19. 与 TimelinePanel 的关系

## 19.1 查询与播放分离

推荐数据流：

```text
TimeFilterPicker
      │
      │ 用户选择查询时间
      ▼
业务数据查询
      │
      ▼
加载时序图层
      │
      ▼
TimeController
      │
      ▼
TimelinePanel
      │
      ▼
时序图层更新
```

## 19.2 不应该重复维护时间

不推荐：

```text
TimeFilterPicker.currentTime

Timeline.currentTime

TimeController.currentTime
```

分别独立维护三个播放时刻。

正确设计：

- TimeFilterPicker 保存用户已选择的查询时间。
- TimeController 保存唯一的播放时刻。
- TimelinePanel 显示和操作 TimeController 的播放时间。

## 19.3 TimeFilterPicker 不自动控制 Timeline

例如：

```text
用户把查询粒度从天切换到月
```

不应该自动修改 TimeController 的播放时间。

只有业务确认并执行对应操作后，才改变播放范围。

---

# 20. Docked 布局设计

推荐保留当前布局位置。

```text
┌─────────────────────────────────────────┐
│ Title                                   │
├────────────┬───────────────┬────────────┤
│ Search     │               │            │
│            │               │ Properties │
│ TimePicker │               │            │
│            │     Map       │            │
│ Layer      │               │            │
│ Manager    │               │            │
│            ├───────────────┤            │
│ Legend     │ Timeline      │            │
├────────────┴───────────────┴────────────┤
│ Status                                  │
└─────────────────────────────────────────┘
```

## 20.1 TimeFilterPicker 位置

建议放在左侧：

```text
SearchPanel 下方
LayerManager 上方
```

默认展示紧凑摘要：

```text
[天 ▼] [2026-11-21 📅]
```

或者：

```text
[周 ▼] [2026年第47周 📅]
```

点击后打开选择面板。

## 20.2 不要一直展示完整日期面板

TimeFilterPicker 应采用：

```text
Compact Trigger + Popover
```

完整的粒度、模式、日历和快捷项在弹层中展示。

避免长期占用左侧 LayerManager 空间。

## 20.3 宽度

推荐：

```text
触发器宽度：100%

Popover 宽度：根据选择模式自动调整
```

复杂的时间范围选择可以适当加宽。

如果左侧宽度较窄，Popover 可以向右展开。

---

# 21. Overlay 布局设计

Overlay 模式下建议：

```text
左上角：

Search

TimeFilterPicker

LayerManager
```

默认只显示：

```text
[日历图标] 2026-11-21  ▼
```

点击弹出时间选择界面。

需要注意：

- Popover zIndex。
- 图层管理面板遮挡。
- 视口边缘翻转。
- 屏幕高度不足时滚动。
- 移动端可降级为抽屉。
- 不影响地图拖拽。
- 不让 Popup 外部点击穿透触发地图交互。

---

# 22. UI 组件拆分

推荐目录：

```text
packages/ui-vue/src/
└── components/
    └── time-picker/
        ├── TimeFilterPicker.vue
        ├── GranularitySelector.vue
        ├── TimePickerBody.vue
        ├── TimePickerShortcuts.vue
        │
        ├── utils/
        │   ├── time-period.ts
        │   ├── time-normalize.ts
        │   ├── time-format.ts
        │   └── time-shortcuts.ts
        │
        └── types.ts
```

其中：

`TimeFilterPicker.vue`

负责 Popover、已提交值、草稿、确认和取消。

`GranularitySelector.vue`

负责切换小时、天、周、月、年。

`TimePickerBody.vue`

根据粒度和选择模式复用 Element Plus 组件。

`TimePickerShortcuts.vue`

展示可用快捷项。

`time-period.ts`

负责日历时间边界计算。

`time-normalize.ts`

负责统一数据格式转换。

`time-format.ts`

负责文本格式化。

`time-shortcuts.ts`

负责快捷时间计算。

不要求机械拆分所有文件。

如果组件逻辑简单，可以合并部分 Vue 组件。

**但时间计算函数应与 UI 分离，确保能够独立单元测试。**

---

# 23. 扩展配置

## 23.1 限制可选粒度

```ts
timePicker: {
  granularities: [
    'day',
    'week',
    'month',
  ],
}
```

## 23.2 限制查询时间范围

```ts
timePicker: {
  minTime: minTimestamp,
  maxTime: maxTimestamp,
}
```

## 23.3 最大查询跨度

可以增加：

```ts
maxRangeDurationMs?: number
```

但它只适合明确的绝对时长约束。

对于：

```text
最多查询 3 个自然月
```

应使用独立的日历周期约束，不能简单按 90 天计算。

V1 可先不支持复杂日历跨度限制。

## 23.4 禁用部分时间

后续可以支持：

```ts
disabledDate?: (date: Date) => boolean
```

但是需要明确粒度相关规则。

例如：

```text
某个月包含一天被禁用
```

到底代表整个月不可选，还是仅仅不能选那一天？

V1 建议优先使用明确的全局最小、最大时间边界。

复杂的业务禁用规则留待扩展。

---

# 24. 错误与边界处理

必须覆盖：

1. 空选择。
2. 仅选择开始时间。
3. 开始时间晚于结束时间。
4. 不支持的粒度。
5. 不合法的时间戳。
6. 不合法的时区。
7. 跨年周编号。
8. 闰年。
9. 不同月份天数。
10. 夏令时切换。
11. 小时跨天。
12. 周范围跨年。
13. 月范围跨年。
14. 选择结果超过允许范围。
15. 切换粒度后不满足约束。
16. 外部 modelValue 变化。
17. 打开组件后取消。
18. 切换粒度后清空。
19. 重复点击确定。
20. 组件反复挂载与销毁。

尤其需要处理时间戳为 0 的情况。

不能简单使用：

```ts
if (!time) {
  // 无效
}
```

因为：

```ts
time === 0
```

是合法的 Unix 时间戳。

应该使用：

```ts
Number.isFinite(time)
```

进行校验。

---

# 25. 测试设计

## 25.1 基础时间计算

- [ ] 小时开始时间正确。
- [ ] 小时结束时间正确。
- [ ] 自然日开始时间正确。
- [ ] 自然日结束时间正确。
- [ ] ISO 周开始时间正确。
- [ ] ISO 周编号正确。
- [ ] 月份开始和结束时间正确。
- [ ] 年份开始和结束时间正确。
- [ ] 闰年 2 月正确。
- [ ] 跨月时间正确。
- [ ] 跨年时间正确。
- [ ] 跨年 ISO 周正确。
- [ ] 时区转换正确。
- [ ] 夏令时边界正确。

## 25.2 选择模式

- [ ] Single Hour。
- [ ] Single Day。
- [ ] Single Week。
- [ ] Single Month。
- [ ] Single Year。
- [ ] Hour Range。
- [ ] Day Range。
- [ ] Week Range。
- [ ] Month Range。
- [ ] Year Range。
- [ ] Custom Range。

## 25.3 状态交互

- [ ] 切换粒度。
- [ ] 切换模式。
- [ ] 保留有效选择。
- [ ] 清空选择。
- [ ] 确认提交。
- [ ] 取消修改。
- [ ] 外部 v-model 更新。
- [ ] 编辑状态与已提交状态隔离。
- [ ] 重复确认不产生无意义更新。

## 25.4 UI

- [ ] Docked 布局。
- [ ] Overlay 布局。
- [ ] 明亮主题。
- [ ] 深色主题。
- [ ] Popover 位置。
- [ ] 屏幕边缘翻转。
- [ ] 小窗口适配。
- [ ] 中文格式。
- [ ] 日期文本溢出处理。
- [ ] 时间选择器键盘操作。

## 25.5 GIS 集成

- [ ] 不绑定图层也能独立使用。
- [ ] 选择日期后业务正常接收。
- [ ] 选择周后查询范围正确。
- [ ] 选择月份后查询范围正确。
- [ ] TimePicker 隐藏不影响 TimeController。
- [ ] 用户取消不触发业务查询。
- [ ] 选择时间不自动修改地图。
- [ ] 业务可以显式设置 Timeline 播放范围。

---

# 26. 推荐实施顺序

## Phase 1：数据模型与时间运算

实现：

- TimeGranularity。
- TimeSelectionMode。
- TimeSelection。
- TimeRange。
- startOfPeriod。
- addPeriod。
- normalizeTimeSelection。
- formatTimeSelection。

优先完成单元测试。

验收：

**任意小时、天、周、月、年都可以转换成正确的标准化时间范围。**

## Phase 2：多粒度 UI

实现：

- TimeFilterPicker。
- GranularitySelector。
- HourPicker。
- DatePicker。
- WeekPicker。
- MonthPicker。
- YearPicker。

优先复用 Element Plus。

验收：

**可以通过 UI 选择不同时间粒度，并正确展示结果。**

## Phase 3：范围模式

实现：

- Single。
- Range。
- Custom Range。
- 时间范围校验。
- 结束边界标准化。
- 粒度切换转换。

验收：

**跨天、跨周、跨月、跨年的时间范围选择正确。**

## Phase 4：快捷选项与交互

实现：

- 今天。
- 昨天。
- 本周。
- 上周。
- 本月。
- 上月。
- 最近 7 天。
- 最近 30 天。
- 确认。
- 取消。
- 清空。

验收：

**用户可以高效完成常用时间选择，且没有错误提交。**

## Phase 5：create-gis-app 集成

实现：

- UI Config。
- Docked。
- Overlay。
- UI Context。
- Runtime 业务事件对接。
- 主题适配。
- Demo。

验收：

**TimeFilterPicker 可以作为内置时间筛选组件使用，但不与具体图层耦合。**

---

# 27. 完整业务使用示例

## 27.1 AppConfig

```ts
const appConfig = {
  ui: {
    layout: 'docked-dashboard',

    defaults: {
      search: true,
      timePicker: true,
      layerManager: true,
      properties: true,
    },

    timePicker: {
      granularities: [
        'hour',
        'day',
        'week',
        'month',
        'year',
      ],

      defaultGranularity: 'day',

      defaultMode: 'single',

      defaultTimeZone: 'Asia/Shanghai',

      showGranularitySwitch: true,

      showModeSwitch: true,

      showShortcuts: true,

      confirmable: true,
    },
  },
}
```

## 27.2 基础初始化

```ts
const app = createGISApp({
  id: 'gis-time-demo',
  name: 'GIS Time Demo',
})

app.use(createOLAdapter())

app.use(createVueUI())

await app.init(appConfig)

await app.mount('#app')
```

## 27.3 业务时间查询

假设用户选择：

```text
2026年11月
```

最终输出：

```ts
{
  mode: 'single',
  granularity: 'month',
  timeZone: 'Asia/Shanghai',

  range: {
    start: Date.parse(
      '2026-11-01T00:00:00+08:00',
    ),

    endExclusive: Date.parse(
      '2026-12-01T00:00:00+08:00',
    ),
  },
}
```

业务可以执行：

```ts
async function onTimeFilterApply(
  selection: TimeSelection,
) {
  const response = await fetch('/api/complaints', {
    method: 'POST',

    headers: {
      'Content-Type': 'application/json',
    },

    body: JSON.stringify({
      startTime: selection.range.start,

      endTime: selection.range.endExclusive,

      granularity: selection.granularity,
    }),
  })

  if (!response.ok) {
    throw new Error('查询失败')
  }

  const data = await response.json()

  // 通过项目已有图层更新 API 更新业务数据
  await updateComplaintLayer(data)
}
```

这里的接口地址和图层更新函数仅为业务示例。

组件本身不会执行该请求。

---

# 28. Codex 开发要求

请基于当前 create-gis-app 仓库实现本设计。

## 28.1 必须遵守

1. 先检查现有 TimePicker 组件。
2. 尽量保持原有组件接口兼容。
3. 优先复用 Element Plus。
4. 不直接引入 OpenLayers。
5. 不直接调用 GISApp。
6. 不强制指定图层 ID。
7. 统一时间范围输出。
8. 使用 Unix 毫秒时间戳。
9. 明确时区。
10. 采用左闭右开区间。
11. 按自然日历计算周、月、年。
12. 周默认采用 ISO 周。
13. 正确处理跨年周编号。
14. 区分已提交状态和草稿状态。
15. 不重复维护多套时间数据。
16. 不新增不必要的 Manager / Registry。
17. 不自行开发完整日历组件。
18. 保持现有 UI 主题和布局规范。
19. 补充边界测试。
20. 保证 Vue 组件可以独立使用。

## 28.2 重点检查

- `el-date-picker` 的当前实际支持类型。
- 当前 Element Plus 版本。
- 当前日期工具依赖。
- 当前 UI Config 类型。
- 当前 Popover 实现。
- 当前 UI Panel Registry 或默认组件映射。
- 当前 TypeScript 编译约束。
- 当前主题 Token。
- 当前已有时间选择组件是否已经有业务事件。

不得因为设计文档中使用了建议名称，就盲目新增重复能力。

## 28.3 最终交付

- TimeFilterPicker Vue 组件。
- 多粒度时间选择。
- 单周期和范围模式。
- 小时选择。
- ISO 周选择。
- 月份和年份选择。
- 自定义时间范围。
- 时间标准化函数。
- 日期格式化函数。
- 快捷时间选择。
- 时间约束与校验。
- UI Config 集成。
- Docked / Overlay 适配。
- 单元测试。
- 可运行 Demo。
- API 使用文档。
- 构建和类型检查结果。

---

# 29. 最终架构决策

## 决策一：TimePicker 是不是一个图层组件？

不是。

它是独立的时间输入组件。

## 决策二：是否需要绑定目标图层？

不需要。

由业务逻辑决定选择结果如何使用。

## 决策三：是否支持小时、天、周、月、年？

V1 全部支持。

其中：

- 小时：日期 + 小时。
- 天：DatePicker。
- 周：WeekPicker。
- 月：MonthPicker。
- 年：YearPicker。

## 决策四：是否需要统一输出？

需要。

统一采用：

```ts
TimeSelection
```

并始终包含：

```ts
range: {
  start,
  endExclusive,
}
```

## 决策五：是否需要时间引擎？

基础 TimeFilterPicker 不需要。

只有业务需要播放时间时，才使用 TimeController。

## 决策六：是否需要 Canvas？

不需要。

TimeFilterPicker 是日期时间输入组件。

Canvas 主要用于专业 Timeline 时间轴。

## 决策七：是否需要独立 npm 包？

V1 不需要。

继续放在：

```text
@joinmap/ui-vue
```

中。

日期计算函数只需保持独立、可测试，未来按需复用。

---

# 30. 最终总结

本次设计最终形成：

```text
TimeFilterPicker
│
├── Granularity
│   ├── Hour
│   ├── Day
│   ├── Week
│   ├── Month
│   └── Year
│
├── SelectionMode
│   ├── Single
│   ├── Range
│   └── CustomRange
│
├── Date Calculation
│   ├── startOfPeriod
│   ├── addPeriod
│   ├── normalizeSelection
│   └── formatSelection
│
├── Quick Selection
│   ├── Today
│   ├── Yesterday
│   ├── ThisWeek
│   ├── LastWeek
│   └── ThisMonth
│
└── Output
    └── TimeSelection
        ├── granularity
        ├── mode
        ├── timeZone
        └── range
            ├── start
            └── endExclusive
```

本组件的最终定位：

**一个不依赖 GIS 图层、支持多时间粒度、统一输出标准时间区间的 Vue 时间筛选组件。**

它可以用于普通业务数据查询，也可以作为时空回放前的数据范围选择入口。

未来 create-gis-app 的整体时间能力将形成：

```text
TimeFilterPicker
    │
    └── 选择时间


TimeController
    │
    └── 驱动时间


TimelinePanel
    │
    └── 展示与控制时间


Temporal Layer
    │
    └── 响应时间变化
```

这四个模块相互配合，但不相互替代。

**最终目标不是让 TimePicker 变得越来越复杂，而是让它成为一个职责明确、配置简单、数据语义统一的时间输入组件。**
