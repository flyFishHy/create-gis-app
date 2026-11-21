# Vue UI CSS tokens

Import `@joinmap/ui-vue/style.css` once. Theme values are scoped to `.gis-ui-root`
and can be overridden with `ThemeOptions.tokens` or ordinary CSS. TypeScript
token names map to these CSS custom properties:

| Theme token | CSS custom property | Default (light) |
| --- | --- | --- |
| `colorBackground` | `--gis-ui-background` | `#f1f5f9` |
| `colorSurface` | `--gis-ui-surface` | `#ffffff` |
| `colorSurfaceElevated` | `--gis-ui-surface-elevated` | `#f8fafc` |
| `colorText` | `--gis-ui-text` | `#1e293b` |
| `colorTextMuted` | `--gis-ui-text-muted` | `#64748b` |
| `colorBorder` | `--gis-ui-border` | `#e2e8f0` |
| `colorPrimary` | `--gis-ui-primary` | `#3b82f6` |
| `colorHover` | `--gis-ui-hover` | `#f1f5f9` |
| `colorSuccess` | `--gis-ui-success` | `#22a06b` |
| `colorDanger` | `--gis-ui-danger` | `#b42318` |
| `panelRadius` | `--gis-ui-panel-radius` | `14px` |
| `panelShadow` | `--gis-ui-panel-shadow` | Shadow of the selected panel material |
| `panelOpacity` | `--gis-ui-glass-opacity` | `72%` |
| `panelBlur` | `--gis-ui-glass-blur` | `16px` |
| `panelSpecular` | `--gis-ui-liquid-specular` | `35%` |
| `panelWidth` | `--gis-ui-panel-width` | 未设置；Docked 左/右均 320px，Overlay 300px |
| `leftPanelWidth` | `--gis-ui-left-width` | 未设置，使用共享值或布局默认值 |
| `rightPanelWidth` | `--gis-ui-right-width` | 未设置，使用共享值或布局默认值 |
| `overlayPanelWidth` | `--gis-ui-overlay-panel-width` | 未设置，使用共享值或 300px |
| `toolbarHeight` | `--gis-ui-toolbar-height` | `56px` |
| `spacingUnit` | `--gis-ui-gap` | `12px` |
| `fontFamily` | `--gis-ui-font-family` | `Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif` |
| `fontSize` | `--gis-ui-font-size` | `.875rem`（宿主根字号 16px 时为 14px） |

Example:

组件字号随工作台 `fontSize` 缩放，不设置宿主 html 字号。主要正文默认 13px，面板标题
14px、应用标题 16px，辅助文字 12px，极少量计数 11px；字重采用 400/500/600/700。
CSS 可进一步覆盖 `--gis-ui-font-micro/xs/sm/lg/xl`，默认按基础字号计算；数字使用
`--gis-ui-font-mono`。布局尺寸与 1px 细边框保留 CSS 像素。

`panelStyle` 支持 `frosted`、`liquid` 和 `solid`。Overlay 默认磨砂，材质应用到 Header、搜索、时间、工具栏、状态栏和面板外壳。Docked 默认实色，材质应用到 Header、侧栏、操作行和状态行。搜索、时间和工具栏的下拉浮层复用当前材质，底色至少保持 80% 不透明度。内部卡片和控件复用材质底色、渐变和边框，保持单层背景模糊。`--gis-ui-control-height: 2.75rem` 统一搜索、时间及工具条表面的最小高度。

`glass-opacity` 是背景不透明度，数值越小越通透；`glass-blur` 只控制背景模糊，
不控制透明度。实色模式把有效背景不透明度限制在 94%–100% 并关闭模糊。磨砂和实色沿用参考页的边框与投影。液态玻璃分深浅主题使用不同的渐变、边框和阴影，高光强度由 `panelSpecular` 控制。
工具栏的玻璃、边框、圆角和阴影由外层 `.gis-ui-toolbar-root` 承担，内部只负责排列
按钮；属性面板外层允许阴影溢出，内容仍在 PanelShell 内裁切。

```css
.gis-ui-layout {
  --gis-ui-glass-opacity: 72%;
  --gis-ui-glass-blur: 16px;
}
```

侧栏优先级：可见面板配置 width（同侧取 CSS max）> 对应 left/rightPanelWidth >
Overlay 的 overlayPanelWidth > panelWidth > 布局默认值。数字尺寸转换为 px。
width 为布局偏好宽度：Docked 限制为工作区的 30%；Overlay 左侧图层/图例列默认 300px、
限制为地图容器的 34%，右侧扩展面板和属性抽屉独立计算 width，限制为 30%。
900px 及以下侧栏与属性抽屉共用内容区域：属性打开时临时隐藏侧栏，关闭恢复；侧栏与
普通右侧面板限制为容器的 72%，属性抽屉限制为 82%。
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
| Panel header background | `--gis-ui-panel-header-bg` | `#f1f5f9` | Panel surface (`#0f172a`) |
| Map background | `--gis-ui-map-background` | Workspace background | `#080d1a` |
| Translucent surface | `--gis-ui-surface-translucent` | `#ffffffe8` | `#0f172ad9` |
| Secondary accent | `--gis-ui-accent-secondary` | 68% primary mixed with surface | 68% primary mixed with surface |
| Focus ring | `--gis-ui-focus-ring` | 26% primary | 26% primary |
| Map grid line | `--gis-ui-grid-line` | `#64748b17` | `#94a3b817` |
| Hidden layer | `--gis-ui-layer-hidden` | `#6b7280` | `#88909e` |
| Elevation (small) | `--gis-ui-shadow-sm` | `0 2px 8px #10233b12, 0 1px 2px #10233b12` | `0 2px 8px #02061773, 0 1px 2px #0206178c` |
| Elevation (medium) | `--gis-ui-shadow-md` | `0 8px 24px #10233b12, 0 2px 6px #10233b0d` | `0 8px 24px #02061759, 0 2px 6px #02061733` |
| Elevation (large) | `--gis-ui-shadow-lg` | `0 24px 70px #10233b2e, 0 8px 24px #10233b1f` | `0 24px 70px #020617bf, 0 8px 24px #0206178c` |
| Radius (small) | `--gis-ui-radius-sm` | `8px` | `8px` |
| Radius (large) | `--gis-ui-radius-lg` | `18px` | `18px` |
| Disabled text | `--gis-ui-text-disabled` | `#c4cbd4` | `#64748b` |
| Primary hover | `--gis-ui-primary-strong` | Derived from primary | Derived from primary |
| Text on primary | `--gis-ui-on-primary` | Black for the default blue | Black for the default blue |
| Danger surface | `--gis-ui-danger-surface` | `#fef3f2` | `#3b1f25` |
| Right panel width | `--gis-ui-right-width` | `320px` | `320px` |
| Title height | `--gis-ui-title-height` | `52px` | `52px` |
| Frosted and solid border | `--gis-ui-glass-border` | `rgb(15 23 42 / 12%)` | `rgb(255 255 255 / 14%)` |
| Dropdown highlight | `--gis-ui-glass-highlight` | `#ffffff1f` | `#ffffff0a` |
| Frosted and solid shadow | `--gis-ui-overlay-shadow` | `0 10px 30px -5px rgb(15 23 42 / 12%)` | `0 10px 30px -5px rgb(0 0 0 / 35%)` |

Light and dark palettes share the same primary color. Changing it through
Settings updates controls, panel title icons, and derived accents. Hex overrides
select a contrasting foreground for filled controls. Legend symbols and semantic
status colors retain their own palettes.
The dark workspace uses `#090d16`. Selected segmented buttons use the primary
color with white labels. The toolbar uses a brighter primary tint for its
active tool, including the overflow menu.
