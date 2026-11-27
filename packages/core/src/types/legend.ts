/** Map-domain legend description; contains no UI framework values. */
export interface LegendDefinition {
  readonly field?: string;
  readonly ranges?: readonly LegendRange[];
  /** Opt in to the layer's uniform style for a single category symbol. */
  readonly useLayerStyle?: boolean;
  readonly id: string;
  readonly layerId?: string;
  readonly title?: string;
  readonly type: 'category' | 'continuous' | 'interval' | 'image';
  readonly items?: readonly LegendItem[];
  readonly stops?: readonly LegendStop[];
  readonly noData?: LegendItem;
  readonly imageUrl?: string;
}

export type LegendValue = string | number | boolean;

export interface LegendItem {
  readonly values?: readonly LegendValue[];
  /** Legacy input only; normalization converts it to values. */
  readonly value?: string | number | boolean;
  readonly id: string;
  readonly label: string;
  readonly color?: string;
  readonly symbol?: 'fill' | 'line' | 'circle' | 'square';
  readonly visible?: boolean;
}

export interface LegendStop {
  readonly value: number;
  readonly color: string;
  readonly label?: string;
}

/** Numeric intervals are left-closed/right-open; includeMax opts in to a closed upper edge. */
export interface LegendRange {
  readonly id: string;
  readonly min: number;
  readonly max: number;
  readonly includeMax?: boolean;
  readonly label?: string;
  readonly color: string;
}
