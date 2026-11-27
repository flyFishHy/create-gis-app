import type { LayerInstance, LayerTimeFilter, LayerUpdate } from '../types.js';
import { LayerOperations, type LayerInstanceOptions } from './layer-operations.js';

export class LayerInstanceImpl implements LayerInstance {
  private readonly operations: LayerOperations;

  constructor(
    options: Omit<LayerInstanceOptions, 'children' | 'leaves'> & {
      children?: () => LayerInstanceImpl[];
      leaves?: () => LayerInstanceImpl[];
    }
  ) {
    const { children, leaves } = options;
    this.operations = new LayerOperations({
      ...options,
      children: children && (() => children().map((child) => child.operations)),
      leaves: leaves && (() => leaves().map((leaf) => leaf.operations)),
    });
  }

  get id() {
    return this.operations.id;
  }
  get type() {
    return this.operations.type;
  }
  get title() {
    return this.operations.title;
  }
  get status() {
    return this.operations.status;
  }
  get visible() {
    return this.operations.visible;
  }
  get ownVisible() {
    return this.operations.ownVisible;
  }
  get parentId() {
    return this.operations.parentId;
  }
  get childIds() {
    return this.operations.childIds;
  }
  get zIndex() {
    return this.operations.zIndex;
  }
  get version() {
    return this.operations.version;
  }
  get style() {
    return this.operations.style;
  }
  get legend() {
    return this.operations.legend;
  }
  setVisibility(visible: boolean) {
    return this.operations.setVisibility(visible);
  }
  update(patch: LayerUpdate) {
    return this.operations.update(patch);
  }
  dispose() {
    return this.operations.dispose();
  }
  getFields() {
    return this.operations.getFields();
  }
  getFieldValues(field: string) {
    return this.operations.getFieldValues(field);
  }
  getTimeDimensions() {
    return this.operations.getTimeDimensions();
  }
  getTimeFilter() {
    return this.operations.getTimeFilter();
  }
  setTimeFilter(filter: LayerTimeFilter | undefined) {
    return this.operations.setTimeFilter(filter);
  }
  supportsLegendFilter() {
    return this.operations.supportsLegendFilter();
  }
  getLegendFilter() {
    return this.operations.getLegendFilter();
  }
  setLegendFilter(ruleId: string | undefined) {
    return this.operations.setLegendFilter(ruleId);
  }
  getMetadata() {
    return this.operations.getMetadata();
  }
  getInternalHandle() {
    return this.operations.getInternalHandle();
  }
  settleUpdates() {
    return this.operations.settleUpdates();
  }
  inheritVisibility(visible: boolean) {
    return this.operations.inheritVisibility(visible);
  }
  setZIndex(value: number) {
    return this.operations.setZIndex(value);
  }
  recordZIndex(value: number) {
    return this.operations.recordZIndex(value);
  }
  assertIdle() {
    return this.operations.assertIdle();
  }
}
