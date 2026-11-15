# Vue UI CSS tokens

Import `@joinmap/ui-vue/style.css` once. Theme values are scoped to `.gis-ui-root`
and can be overridden with `ThemeOptions.tokens` or ordinary CSS. TypeScript
token names map to these CSS custom properties:

| Theme token | CSS custom property | Default (light) |
| --- | --- | --- |
| `colorBackground` | `--gis-ui-background` | `#eef3f8` |
| `colorSurface` | `--gis-ui-surface` | `#ffffff` |
| `colorSurfaceElevated` | `--gis-ui-surface-elevated` | `#fbfdff` |
| `colorText` | `--gis-ui-text` | `#142033` |
| `colorTextMuted` | `--gis-ui-text-muted` | `#64748b` |
| `colorBorder` | `--gis-ui-border` | `#dbe4ef` |
| `colorPrimary` | `--gis-ui-primary` | `#087ea4` |
| `colorHover` | `--gis-ui-hover` | `#e8f6fb` |
| `colorSuccess` | `--gis-ui-success` | `#22a06b` |
| `colorDanger` | `--gis-ui-danger` | `#b42318` |
| `panelRadius` | `--gis-ui-panel-radius` | `14px` |
| `panelShadow` | `--gis-ui-panel-shadow` | `0 12px 30px #10233b1a, 0 3px 10px #10233b12` |
| `panelWidth` | `--gis-ui-panel-width` | 未设置；Docked 左 300px/右 320px，Overlay 260px |
| `leftPanelWidth` | `--gis-ui-left-width` | 未设置，使用共享值或布局默认值 |
| `rightPanelWidth` | `--gis-ui-right-width` | 未设置，使用共享值或布局默认值 |
| `overlayPanelWidth` | `--gis-ui-overlay-panel-width` | 未设置，使用共享值或 260px |
| `toolbarHeight` | `--gis-ui-toolbar-height` | `56px` |
| `spacingUnit` | `--gis-ui-gap` | `12px` |
| `fontFamily` | `--gis-ui-font-family` | `Inter, ui-sans-serif, system-ui, sans-serif` |
| `fontSize` | `--gis-ui-font-size` | `14px` |

Example:

侧栏优先级：可见面板配置 width（同侧取 CSS max）> 对应 left/rightPanelWidth >
Overlay 的 overlayPanelWidth > panelWidth > 布局默认值。数字尺寸转换为 px。
width 为布局偏好宽度：Docked 限制为工作区的 30%；Overlay 的右侧图层/图例列与属性抽屉
独立计算 width，各限制为地图容器的 28%，属性宽度不参与图层/图例列的 max。
900px 及以下二者共用右侧区域：属性打开时临时隐藏图层/图例列，关闭恢复；分别限制为
容器的 74% / 82%，同时不超过工具栏右侧剩余空间。显式 left 面板限制为容器的 40%。
面板占满预留侧栏；height 和 min/max 尺寸应用到 PanelHost，
宽度约束受可用空间限制。top/bottom/floating 面板保留自己的 width。

```ts
app.use(createVueUI({
  theme: { mode: 'dark', tokens: { colorPrimary: '#14b8a6', panelRadius: '14px' } },
}))
```

Panel-specific `width` and `height` values are applied by panel state and may
override the global width token. The right panel uses `--gis-ui-right-width`
(320px), which is a CSS-only token with no `ThemeTokens` field.

## Derived CSS-only tokens

The tokens below are part of the theme but are not exposed on
`ThemeOptions.tokens`. Override them with ordinary CSS.

| Purpose | CSS custom property | Light | Dark |
| --- | --- | --- | --- |
| Panel header background | `--gis-ui-panel-header-bg` | `#f3f7fb` | `#101f35` |
| Translucent surface | `--gis-ui-surface-translucent` | `#ffffffe8` | `#0b1728d9` |
| Secondary accent | `--gis-ui-accent-secondary` | `#7c3aed` | `#8b5cf6` |
| Focus ring | `--gis-ui-focus-ring` | `#0ea5e933` | `#38bdf84a` |
| Map grid line | `--gis-ui-grid-line` | `#087ea40a` | `#8edcff0a` |
| Elevation (small) | `--gis-ui-shadow-sm` | `0 2px 8px #10233b12, 0 1px 2px #10233b12` | `0 2px 8px #02061773, 0 1px 2px #0206178c` |
| Elevation (medium) | `--gis-ui-shadow-md` | `0 12px 30px #10233b1a, 0 3px 10px #10233b12` | `0 12px 30px #0206178c, 0 3px 10px #02061770` |
| Elevation (large) | `--gis-ui-shadow-lg` | `0 24px 70px #10233b2e, 0 8px 24px #10233b1f` | `0 24px 70px #020617bf, 0 8px 24px #0206178c` |
| Radius (small) | `--gis-ui-radius-sm` | `8px` | `8px` |
| Radius (large) | `--gis-ui-radius-lg` | `18px` | `18px` |
| Disabled text | `--gis-ui-text-disabled` | `#c4cbd4` | `#475467` |
| Primary hover | `--gis-ui-primary-strong` | `#036584` | `#7dd3fc` |
| Text on primary | `--gis-ui-on-primary` | `#ffffff` | `#0b1220` |
| Danger surface | `--gis-ui-danger-surface` | `#fef3f2` | `#3b1f25` |
| Right panel width | `--gis-ui-right-width` | `320px` | `320px` |
| Title height | `--gis-ui-title-height` | `52px` | `52px` |
| Glass border | `--gis-ui-glass-border` | `#ffffffb8` | `#8edcff2e` |
| Glass highlight | `--gis-ui-glass-highlight` | `#ffffffa6` | `#ffffff12` |
| Overlay shadow | `--gis-ui-overlay-shadow` | `0 14px 36px #10233b24, ...` | `0 14px 36px #0206175c, ...` |
