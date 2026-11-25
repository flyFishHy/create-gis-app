import { createGISApp, parseGISAppConfig } from '@joinmap/gis-core';
import { createOLAdapter, useOLMap } from '@joinmap/adapter-ol';
import { createVueUI } from '@joinmap/ui-vue';
import config from './appConfig.json';
import 'ol/ol.css';
import '../../../packages/ui-vue/src/styles.scss';
import './style.css';
const app = createGISApp();
app.use(createOLAdapter({ zoomControl: false }));
app.use(createVueUI());
await app.init(
  parseGISAppConfig({ ...config, ui: { ...config.ui, layout: 'docked-dashboard', theme: 'dark' } })
);
await app.mount('#app');
const map = useOLMap(app),
  report = document.querySelector('#left-report');
let active;
const original = map.updateSize;
map.updateSize = function (...args) {
  if (active) active.updateSizeCalls++;
  return original.apply(this, args);
};
document.querySelector('#run-left').onclick = async () => {
  report.textContent = 'running';
  document.querySelector('#run-left').disabled = true;
  const results = [];
  for (const [name, selector] of [
    ['left-close', '.gis-ui-left-region .gis-ui-sidebar-collapse'],
    ['left-open', '.gis-ui-sidebar-restore.is-left'],
  ]) {
    const widths = new Set(),
      positions = new Set(),
      queryPositions = new Set();
    const result = { name, updateSizeCalls: 0, frames: 0 };
    active = result;
    function sample() {
      if (active !== result) return;
      result.frames++;
      widths.add(map.getTargetElement().clientWidth);
      positions.add(
        Number(document.querySelector('.gis-ui-map-region').getBoundingClientRect().left.toFixed(2))
      );
      queryPositions.add(
        Number(
          document.querySelector('.gis-ui-map-actions').getBoundingClientRect().left.toFixed(2)
        )
      );
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
    document.querySelector(selector).click();
    await new Promise((resolve) => setTimeout(resolve, 380));
    active = undefined;
    result.layoutWidths = [...widths];
    result.mapPositionSamples = positions.size;
    result.queryPositionSamples = queryPositions.size;
    result.finalTransform = getComputedStyle(
      document.querySelector('.gis-ui-map-region')
    ).transform;
    results.push(result);
  }
  report.textContent = JSON.stringify({ results });
  document.querySelector('#run-left').disabled = false;
};
