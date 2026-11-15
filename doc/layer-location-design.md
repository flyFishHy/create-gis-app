# 图层定位契约与实施范围

已实现 GeoJSON 当前数据范围和现有 GROUP 合并范围。send 按钮调用真实定位；空数据或不支持范围的图层禁用。

## 最小数据流

建议复用现有 LayerService 和 MapService，不新建定位 Manager 或全局事件：

```text
定位按钮 → app.layers.getDataLocation(id) → MapLayerHandle.getDataLocation 可选方法
         → MapLocation（extent/coordinate + projection）→ app.map.locate(location)
```

getDataLocation 已是公开 LayerService API。UI 不访问 OL Map、Source 或原始 GeoJSON。
范围按点击时的当前数据计算，不在面板里保存第二份 bbox 状态。

## 范围语义

- GeoJSON：OL handle 从 VectorSource 读取当前 Feature 范围，适配器保证返回范围与声明的 projection 一致；数据更新后下次定位自然读取新范围。
- 空数据或非有限范围：返回 undefined，不调用 fit，不改变当前视图。
- 单点或退化范围：返回 coordinate，复用当前缩放级别定位，避免无限放大；面积范围 fit 已使用 24px padding 和级别上限。
- XYZ/其他瓦片：优先使用明确配置且有业务含义的覆盖范围，不将瓦片网格的全世界范围当成“已有数据范围”；无法确定时保持按钮不可用。
- GROUP：GeoJSON handle 先统一到当前视图投影，再由 Core 合并仍属于该组的实例范围；同 ID 新实例不纳入旧组。无有效子层时不可定位。自定义 handle 返回不同投影时拒绝合并，不能假装同一坐标系；不把投影变换实现搬入 Core。
- 隐藏图层：定位不自动修改显隐，避免按钮同时执行两个未声明的操作。
- 图层删除或范围读取失败：保留视图并反馈错误，不能继续使用旧实例范围。

## 实施边界

已覆盖数据更新、空数据、单点、隐藏/删除、投影变化和分组范围回归。OL fit 增加 24px 留白和默认级别上限，单点只设置中心。范围不进入 AppState；hasDataLocation 是从源数据计算的可用性元数据，使空/非空变化能刷新定位按钮。
XYZ 配置覆盖范围及远程服务范围读取仍未接入；它们继续保持不可定位，避免将全球瓦片范围误当实际数据范围。
