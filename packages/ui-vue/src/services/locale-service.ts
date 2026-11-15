import { shallowRef, type ShallowRef } from 'vue'
import type { Locale, LocaleService } from '../types.js'

const MESSAGES: Record<Locale, Record<string, string>> = {
  zh: {
    'app.workspace': 'GIS 工作台',
    'action.expand': '展开',
    'action.collapse': '折叠',
    'action.closePanel': '关闭面板',
    'action.clearSelection': '清除选择',
    'action.toggleLayer': '切换图层显隐',
    'action.removeLayer': '移除图层',
    'tool.zoom-in': '放大',
    'tool.zoom-out': '缩小',
    'tool.measure-area': '测量面积',
    'tool.measure-angle': '测量角度',
    'tool.measure-distance': '测量距离',
    'tool.draw-point': '绘制点',
    'tool.draw-line': '绘制线',
    'tool.draw-polygon': '绘制面',
    'tool.delete-result': '删除选中结果',
    'tool.clear-results': '清空全部结果',
    'tool.results': '绘制与测量结果',
    'action.delete': '删除',
    'status.ready': '地图就绪',
    'theme.light': '浅色',
    'theme.dark': '深色',
    'theme.system': '跟随系统',
    'panel.search': '搜索',
    'panel.layers': '图层',
    'panel.legend': '图例',
    'panel.overview': '概览',
    'panel.properties': '属性',
    'search.placeholder': '搜索位置或要素…',
    'search.empty': '没有找到匹配结果',
    'search.loading': '正在搜索…',
    'search.noProviders': '尚未注册搜索服务',
    'search.layer': '搜索图层',
    'search.general': '通用搜索',
    'search.noLayers': '暂无可搜索图层',
    'layer.empty': '暂无图层',
    'layer.settings': '图层配置',
    'layer.locate': '定位图层',
    'layer.locatePending': '定位图层暂不可用',
    'layer.opacity': '不透明度',
    'layer.opacityUnavailable': '此图层尚未提供不透明度控制',
    'layer.mixed': '混合',
    'layer.type': '类型',
    'layer.expandChildren': '展开子图层',
    'layer.collapseChildren': '收起子图层',
    'layer.state.created': '已创建',
    'layer.state.loading': '加载中',
    'layer.state.ready': '就绪',
    'layer.state.error': '异常',
    'layer.state.disposed': '已移除',
    'legend.empty': '暂无图例',
    'properties.empty': '点击地图要素以查看详细属性',
    'properties.layer': '图层',
    'properties.featureId': '要素 ID',
    'properties.geometry': '几何类型',
    'status.coordinates': '经纬度',
    'status.longitude': '经度',
    'status.latitude': '纬度',
    'status.level': '级别',
    'time.placeholder': '时间范围：待配置',
    'status.scale': '比例尺',
    'status.projection': '投影',
    'status.movePointer': '将指针移到地图上',
  },
  en: {
    'app.workspace': 'GIS Workspace',
    'action.expand': 'Expand',
    'action.collapse': 'Collapse',
    'action.closePanel': 'Close panel',
    'action.clearSelection': 'Clear selected feature',
    'action.toggleLayer': 'Toggle layer visibility',
    'action.removeLayer': 'Remove layer',
    'tool.zoom-in': 'Zoom in',
    'tool.zoom-out': 'Zoom out',
    'tool.measure-area': 'Measure area',
    'tool.measure-angle': 'Measure angle',
    'tool.measure-distance': 'Measure distance',
    'tool.draw-point': 'Draw point',
    'tool.draw-line': 'Draw line',
    'tool.draw-polygon': 'Draw polygon',
    'tool.delete-result': 'Delete selected result',
    'tool.clear-results': 'Clear all results',
    'tool.results': 'Drawing and measurement results',
    'action.delete': 'Delete',
    'status.ready': 'Map ready',
    'theme.light': 'Light',
    'theme.dark': 'Dark',
    'theme.system': 'System',
    'panel.search': 'Search',
    'panel.layers': 'Layers',
    'panel.legend': 'Legend',
    'panel.overview': 'Overview',
    'panel.properties': 'Properties',
    'search.placeholder': 'Search places or features…',
    'search.empty': 'No matching results',
    'search.loading': 'Searching…',
    'search.noProviders': 'No search providers registered',
    'search.layer': 'Search layer',
    'search.general': 'General search',
    'search.noLayers': 'No searchable layers',
    'layer.empty': 'No layers',
    'layer.settings': 'Layer settings',
    'layer.locate': 'Locate layer',
    'layer.locatePending': 'Layer location is not available yet',
    'layer.opacity': 'Opacity',
    'layer.opacityUnavailable': 'This layer does not expose opacity control yet',
    'layer.mixed': 'Mixed',
    'layer.type': 'Type',
    'layer.expandChildren': 'Expand child layers',
    'layer.collapseChildren': 'Collapse child layers',
    'layer.state.created': 'Created',
    'layer.state.loading': 'Loading',
    'layer.state.ready': 'Ready',
    'layer.state.error': 'Error',
    'layer.state.disposed': 'Removed',
    'legend.empty': 'No legend definitions',
    'properties.empty': 'Select a map feature to inspect its properties',
    'properties.layer': 'Layer',
    'properties.featureId': 'Feature ID',
    'properties.geometry': 'Geometry',
    'status.coordinates': 'Coordinates',
    'status.longitude': 'Lon',
    'status.latitude': 'Lat',
    'status.level': 'Zoom',
    'time.placeholder': 'Time range: not configured',
    'status.scale': 'Scale',
    'status.projection': 'Projection',
    'status.movePointer': 'Move pointer over map',
  },
}

export class LocaleServiceImpl implements LocaleService {
  private readonly current: ShallowRef<Locale>
  private readonly listeners = new Set<(locale: Locale) => void>()

  constructor(initial: Locale = 'zh') {
    this.current = shallowRef(initial)
  }

  get(): Locale {
    return this.current.value
  }

  set(locale: Locale): void {
    if (locale === this.current.value) return
    this.current.value = locale
    for (const listener of [...this.listeners]) listener(locale)
  }

  subscribe(listener: (locale: Locale) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  t(key: string): string {
    return MESSAGES[this.current.value][key] ?? key
  }

  clear(): void {
    this.listeners.clear()
  }
}
