# 图层定位设计（待实现）

本轮仅提供图层行右侧的 send 图标按钮，保持禁用，不触发地图跳转。透明度滑块已经接入真实更新，定位能力尚未接入。

## 最小数据流

建议复用现有 LayerService 和 MapService，不新建定位 Manager 或全局事件：

```text
定位按钮 → app.layers.getDataLocation(id) → MapLayerHandle 的可选数据范围读取
         → MapLocation（extent/coordinate + projection）→ app.map.locate(location)
```

上述 getDataLocation 为后续候选 API，目前未导出。UI 不访问 OL Map、Source 或原始 GeoJSON。
范围按点击时的当前数据计算，不在面板里保存第二份 bbox 状态。

## 范围语义

- GeoJSON：OL handle 从 VectorSource 读取当前 Feature 范围，适配器保证返回范围与声明的 projection 一致；数据更新后下次定位自然读取新范围。
- 空数据或非有限范围：返回 undefined，不调用 fit，不改变当前视图。
- 单点或退化范围：返回 coordinate，复用当前缩放级别定位，避免无限放大；小范围 fit 后续可按实际需求提供 maxZoom/padding。
- XYZ/其他瓦片：优先使用明确配置且有业务含义的覆盖范围，不将瓦片网格的全世界范围当成“已有数据范围”；无法确定时保持按钮不可用。
- GROUP：适配器先统一各子层返回的投影，再由 Core 合并有限范围；无有效子层时不可定位。不把投影变换实现搬入 Core。
- 隐藏图层：定位不自动修改显隐，避免按钮同时执行两个未声明的操作。
- 图层删除或范围读取失败：保留视图并反馈错误，不能继续使用旧实例范围。

## 实施边界

下一步先落地 GeoJSON 的当前数据范围和空数据处理，再补分组及配置覆盖范围；继续使用现有 app.map.locate 完成跨投影定位。需覆盖数据更新、空数据、单点、隐藏/删除、投影变化和分组范围的回归。
