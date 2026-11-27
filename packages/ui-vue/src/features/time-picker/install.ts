import { shallowRef } from 'vue';
import type { UITimePickerConfig } from '@joinmap/gis-core';
import type { TimeSelection } from '../../components/time-picker/types.js';
import TimePickerPanel from './TimePickerPanel.vue';
import type { PanelService } from '../../types.js';

export function installTimePicker(panels: PanelService, options?: UITimePickerConfig) {
  const selection = shallowRef<TimeSelection | null>(null);
  panels.register({
    id: 'time',
    component: TimePickerPanel,
    allowedPositions: ['top'],
    order: 1,
    defaultVisible: true,
    unframed: true,
    props: {
      options,
      selection,
      setSelection: (value: TimeSelection | null) => {
        selection.value = value;
      },
    },
  });
  return () => selection.value;
}
