export const olTools = [
  { id: 'measure-area', icon: 'area', type: 'Polygon', title: '测量面积' },
  { id: 'measure-angle', icon: 'angle', type: 'LineString', title: '测量角度' },
  { id: 'measure-distance', icon: 'distance', type: 'LineString', title: '测量距离' },
  { id: 'draw-point', icon: 'pin', type: 'Point', title: '绘制点' },
  { id: 'draw-line', icon: 'edit', type: 'LineString', title: '绘制线' },
  { id: 'draw-polygon', icon: 'polygon', type: 'Polygon', title: '绘制面' },
] as const;

export interface OLToolResult {
  readonly id: string;
  readonly toolId: string;
  readonly projection: string;
  readonly geometry: Readonly<Record<string, unknown>>;
  readonly value?: number;
  readonly unit?: 'm' | 'm²' | '°';
}
