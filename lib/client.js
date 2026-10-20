/**
 * CrabTodo — browser half (client plugin bundle).
 *
 * This file is NOT an ES module: the DSH client module system hands the page a
 * lazy-CJS factory. Executing this script only REGISTERS that factory with
 * `window.__ModuleLoader__.load({ id, factory })`; every side effect (including
 * the injected <style>) lives inside the factory and runs when the module is
 * first materialized. `require('react')` resolves against the shell's module
 * table, so we ride the host's React instance instead of bundling a second one.
 *
 * What it contributes, through public contracts only: one tab TYPE of the
 * RIGHT sidebar. A type is two registrations under one id — the static
 * definition in `ctx.sidebarRightTabs` (kind, chip title, guide entry) and the
 * body in the keyed `sidebar.right.pane.tab` seat. The page therefore docks,
 * splits, floats and closes like any other tab and never takes the main column.
 *
 * Data comes from the host half's `/crabtodo` API; a same-origin EventSource
 * tells us when the model edited the list, so the page stays current without
 * polling.
 */
;(function (root) {
  if (!root) return
  var loader = root.__ModuleLoader__
  if (!loader || typeof loader.load !== 'function') return

  loader.load({
    id: 'dsh-crabtodo',
    factory: function (require) {
      var module = { exports: {} }
      var exports = module.exports
      Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

      // ── react, from the shell's module table ───────────────────────────
      var React = null
      try {
        React = require('react')
      } catch (error) {
        React = null
      }
      if (!React) {
        // No React: the page cannot mount, and saying so beats a blank pane.
        exports.name = 'crabtodo'
        exports.apply = function () {
          try {
            console.warn('[dsh-crabtodo] react unavailable; sidebar page disabled')
          } catch (error) {}
        }
        return module.exports
      }
      var h = React.createElement
      var useState = React.useState
      var useEffect = React.useEffect
      var useMemo = React.useMemo
      var useRef = React.useRef
      var useCallback = React.useCallback

      /**
       * The product's own icon set, from the shared module table.
       *
       * Using these instead of hand-drawn paths or text glyphs keeps the panel
       * consistent with the rest of the shell: same 1px stroke, same optical
       * size, `currentColor` theming. The require is guarded because a stripped
       * host may not carry the primitives bundle.
       */
      var Icons = null
      try {
        Icons = require('@deepseek-ai/dsh-client-ui-primitives')
      } catch (error) {
        Icons = null
      }

      /** Render one product icon, or nothing when the icon set is absent. */
      function icon(name, size) {
        var Component = Icons && Icons[name]
        if (typeof Component !== 'function') return null
        return h(Component, { size: size || 14 })
      }

      /**
       * Short, readable name for a project key.
       *
       * The key is an absolute workspace path, too long for a narrow panel's
       * badge; the last path segment is the part a person recognizes. The full
       * path stays in the tooltip.
       * @param project - absolute workspace root.
       * @returns the final path segment.
       */
      function projectLabel(project) {
        var text = String(project || '').replace(/[\\/]+$/, '')
        var cut = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'))
        return cut >= 0 ? text.slice(cut + 1) || text : text
      }

      /**
       * The status filter as the product's underlined tab control.
       *
       * Uses `SegmentedTabs` from the shared primitives (the same control the
       * plugin market's 发现/主题/已安装 row uses), so this panel reads as part
       * of the shell rather than as a bespoke chip row. Falls back to plain
       * buttons if a stripped host does not carry the component.
       *
       * @param value - currently selected filter id.
       * @param onChange - selection callback from the panel's state.
       */
      function renderSegmentedTabs(value, onChange) {
        var Tabs = Icons && Icons.SegmentedTabs
        if (typeof Tabs !== 'function') {
          return h(
            'div',
            { className: 'ct-filters' },
            FILTERS.map(function (entry) {
              return h(
                'button',
                {
                  key: entry.id,
                  type: 'button',
                  className: 'ct-chip',
                  'data-active': String(entry.id === value),
                  onClick: function () {
                    onChange(entry.id)
                  }
                },
                icon(entry.iconName, 13),
                h('span', { className: 'ct-chip-label' }, entry.label)
              )
            })
          )
        }

        var items = FILTERS.map(function (entry) {
          return {
            value: entry.id,
            id: 'crabtodo-tab-' + entry.id,
            panelId: 'crabtodo-panel-' + entry.id,
            label: h(
              'span',
              { className: 'ct-tab-label' },
              icon(entry.iconName, 13),
              h('span', null, entry.label)
            )
          }
        })

        return h(
          'div',
          { className: 'ct-tabs' },
          h(Tabs, {
            items: items,
            value: value,
            onChange: onChange,
            label: '任务状态筛选'
          })
        )
      }

      // ── constants ──────────────────────────────────────────────────────
      /** Stable identity of this tab type; also the key its body registers under. */
      var TAB_ID = 'dsh-crabtodo'
      /** The kind `openTab` names to open the CrabTodo page. */
      var TAB_KIND = 'crabtodo'

            var STATUSES = ['pending', 'in_progress', 'done']
      var PRIORITIES = ['low', 'normal', 'high', 'urgent']
      /** Chinese labels for the wire enum values; the values themselves never change. */
      var STATUS_LABEL = { pending: '待办', in_progress: '进行中', done: '已完成' }
      var PRIORITY_LABEL = { low: '低', normal: '普通', high: '高', urgent: '紧急' }
      /** Filter chips; 'open' (unfinished work) is the useful default. */
      var FILTERS = [
        {
          id: 'open',
          label: '待办',
          iconName: 'IconChecklistOutlineRegular',
          test: function (task) { return task.status !== 'done' }
        },
        {
          id: 'all',
          label: '全部',
          iconName: 'IconFlatListOutlineRegular',
          test: function () { return true }
        },
        {
          id: 'in_progress',
          label: '进行中',
          iconName: 'IconClockOutlineRegular',
          test: function (task) { return task.status === 'in_progress' }
        },
        {
          id: 'done',
          label: '已完成',
          iconName: 'IconCheckCircleOutlineRegular',
          test: function (task) { return task.status === 'done' }
        }
      ]

      /**
       * Scope tabs. Two scopes exist ('project' / 'global'); the third tab is a
       * view across both, not a third scope, so it is named 全部.
       */
      var SCOPE_TABS = [
        { id: 'project', label: '项目' },
        { id: 'global', label: '全局' },
        { id: 'all', label: '全部' }
      ]

      /** API base, anchored on document.baseURI so a sub-path mount works. */
      /**
       * Build the API URL.
       *
       * `pathname` alone was used here, which silently DROPPED any query string
       * — so `?sessionId=...` never reached the host and every project lookup
       * came back null. `pathname + search` keeps the query while still
       * anchoring the path on the document's base (the UI may be mounted under
       * a sub-path).
       * @param path - API-relative path, optionally carrying a query string.
       * @returns the same-origin path plus its query.
       */
      function api(path) {
        var raw = String(path).replace(/^\/+/, '')
        var queryAt = raw.indexOf('?')
        var pathPart = queryAt >= 0 ? raw.slice(0, queryAt) : raw
        var query = queryAt >= 0 ? raw.slice(queryAt) : ''
        var relative = 'crabtodo/api/' + pathPart
        if (typeof document === 'undefined') return '/' + relative + query
        try {
          return new URL(relative, document.baseURI).pathname + query
        } catch (error) {
          return '/' + relative + query
        }
      }

      async function request(path, init) {
        var response = await fetch(api(path), Object.assign({ cache: 'no-store' }, init || {}))
        var body = null
        try {
          body = await response.json()
        } catch (error) {
          body = null
        }
        if (!response.ok || !body || body.ok !== true) {
          throw new Error((body && body.error) || 'CrabTodo request failed (HTTP ' + response.status + ')')
        }
        return body
      }

      /**
       * A product-styled dropdown, replacing the native `<select>`.
       *
       * A native select opens the OS menu, which ignores the shell's surface,
       * typography and elevation — visibly foreign next to the rest of the UI.
       * `Menu` from the primitives is the same control the plugin market and
       * settings use: it carries the menu surface material, a check on the
       * selected row, and the arrow-key/Tab/Escape walk.
       *
       * @param props.label - visible trigger text (already localized).
       * @param props.options - ordered values plus their display labels.
       * @param props.value - currently selected value.
       * @param props.onSelect - selection callback.
       * @param props.title - accessible name for the trigger.
       */
      function Dropdown(props) {
        var [open, setOpen] = useState(false)
        var Menu = Icons && Icons.Menu
        var options = props.options || []
        var items = options.map(function (option) {
          return { id: option.value, label: option.label }
        })

        var trigger = h(
          'button',
          {
            type: 'button',
            className: 'ct-select',
            disabled: props.disabled,
            title: props.title,
            'aria-label': props.title,
            'aria-haspopup': 'menu',
            'aria-expanded': String(open),
            onClick: function () {
              setOpen(!open)
            }
          },
          h('span', { className: 'ct-select-label' }, props.label),
          icon('IconChevronDownOutlineRegular', 11)
        )

        // Without the primitives bundle there is no Menu to render; the trigger
        // still shows the current value, so the form stays legible.
        if (typeof Menu !== 'function') return trigger

        return h(Menu, {
          open: open,
          anchor: trigger,
          items: items,
          selectedId: props.value,
          autoFocus: true,
          // These dropdowns live at the bottom of the panel, so open upward.
          side: 'top',
          align: 'start',
          portal: true,
          compact: true,
          closeOnPointerLeave: false,
          onSelect: function (id) {
            setOpen(false)
            props.onSelect(id)
          },
          onClose: function () {
            setOpen(false)
          }
        })
      }

      // ── styles, injected once per materialization ──────────────────────
      // Sized for a docked side panel (roughly 280-420px), not a full page.
      //
      // Every colour and type size comes from the host's `--dsw-*` semantic
      // tokens, which swap per theme; nothing here is a literal colour or a
      // theme branch of our own. Opacity is deliberately NOT used for text:
      // stacking opacity on an already-secondary label is what made the page
      // unreadable in the light theme. Emphasis uses the token LADDER
      // (`label-primary` -> `label-secondary` -> `label-tertiary`) instead.
      //
      // The tab body is mounted inside a host wrapper that is NOT a flex
      // container (measured: `display:block; height:auto`), so `height:100%`
      // on the root resolves against a shrink-to-fit parent and the inner
      // `flex:1` list then squeezes every row to zero. The layout below uses
      // `max-height:100%` + an overflowing list, which survives both a
      // fixed-height and an auto-height parent.
      var CSS = [
        // Root + typography (12/18 body, 11/14 micro).
        // The panel fills its host box absolutely. The tab body wrapper is
        // `height:auto` and grows with content, so a normal-flow root can never
        // become a fixed box — but an absolutely positioned root resolves
        // against the nearest POSITIONED ancestor and gets a real height. That
        // is what makes "bottom edge fixed, grow upward" possible.
        '.ct-root{display:flex;flex-direction:column;box-sizing:border-box;height:100%;min-height:0;font:var(--dsw-font-xxs-12,12px/18px sans-serif);color:var(--dsw-alias-label-primary);background:transparent;overflow:hidden}',
        '.ct-host{position:relative;height:100%;min-height:0;display:flex;flex-direction:column}',

        // Header strip: counts + whole-list actions.
        '.ct-head{display:flex;align-items:center;gap:6px;padding:8px 10px 6px;flex:0 0 auto;min-width:0}',
        '.ct-count{font:var(--dsw-font-xxxs-11,11px/14px sans-serif);color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
        '.ct-spacer{flex:1 1 auto;min-width:0}',

        // Buttons and icon buttons.
        '.ct-btn{appearance:none;border:.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-11,11px/14px sans-serif);border-radius:var(--dsw-radius-sm,6px);padding:3px 7px;cursor:pointer;white-space:nowrap;flex:0 0 auto}',
        '.ct-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
        '.ct-btn[data-tone="accent"]{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}',
        '.ct-btn[data-tone="accent"]:hover{background:var(--dsw-alias-button-primary-hover);color:var(--dsw-alias-label-primary-foreground)}',
        '.ct-btn:disabled{opacity:.4;cursor:default}',
        '.ct-iconbtn{display:inline-flex;align-items:center;justify-content:center;padding:3px 6px;line-height:1;border-radius:var(--dsw-radius-xs,4px);flex:0 0 auto;cursor:pointer;border:.5px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary)}',
        '.ct-iconbtn:disabled{opacity:.4;cursor:default}',
        '.ct-ghost{border-color:transparent;background:transparent;color:var(--dsw-alias-label-tertiary)}',
        '.ct-ghost:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',

        // Add-task CARD: its own surface, hairline border, and a header row.
        // Composer card: raised above the list with a brighter surface, a real
        // elevation shadow and a stronger border, so it reads as a distinct
        // layer rather than another row.
        '.ct-card{display:flex;flex-direction:column;margin:8px 10px 10px;flex:0 0 auto;min-width:0;background:var(--dsw-alias-bg-layer-3);border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg,10px);box-shadow:var(--dsw-elevation-panel);position:relative;z-index:2}',
        '.ct-card-head{display:flex;align-items:center;gap:6px;padding:7px 9px 2px;min-width:0}',
        '.ct-card-title{color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-11,11px/14px sans-serif);font-weight:600;white-space:nowrap}',
        '.ct-card-scope{font:var(--dsw-font-xxxs-11,11px/14px sans-serif);color:var(--dsw-alias-label-tertiary);border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;corner-shape:round;padding:0 6px;white-space:nowrap}',
        '.ct-card-row{display:flex;align-items:center;gap:6px;padding:2px 8px 8px;min-width:0}',
        // The detail panel floats ABOVE the card instead of being inserted into
        // its flow. The card body therefore never gets taller, so its bottom
        // edge stays put and the extra fields grow upward over the list — the
        // only approach that does not depend on the host wrapper having a
        // resolvable height.
        // The detail form sits ABOVE the primary row inside the card, so the
        // card's bottom edge never moves: the form grows upward. Animating
        // max-height (not height:auto, which cannot transition) gives the
        // open/close a real, smooth slide instead of a jump.
        '.ct-card-detail{order:-1;display:flex;flex-direction:column;gap:6px;padding:0 9px;min-width:0;overflow:hidden;max-height:0;opacity:0;transition:max-height .22s ease,opacity .18s ease,padding .22s ease}',
        '.ct-card[data-open="true"] .ct-card-detail{max-height:320px;opacity:1;padding:8px 9px;border-bottom:.5px solid var(--dsw-alias-border-l1)}',
        // Respect users who ask for less motion.
        '@media (prefers-reduced-motion:reduce){.ct-card-detail{transition:none}}',

        // Fields.
        '.ct-input{flex:1 1 auto;width:100%;box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12,12px/18px sans-serif);border-radius:var(--dsw-radius-sm,6px);padding:5px 8px;outline:none;min-width:0}',
        '.ct-input::placeholder,.ct-textarea::placeholder{color:var(--dsw-alias-label-tertiary);opacity:1}',
        '.ct-input:focus{border-color:var(--dsw-alias-brand-primary)}',
        '.ct-quick{flex:1 1 auto;min-width:0}',
        '.ct-textarea{width:100%;box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12,12px/18px sans-serif);border-radius:var(--dsw-radius-sm,6px);padding:5px 8px;outline:none;resize:vertical;min-height:38px;min-width:0}',
        '.ct-textarea:focus{border-color:var(--dsw-alias-brand-primary)}',
        // Trigger only: the list itself is the product Menu's own surface, so
        // this must look like a button, not a form control.
        '.ct-select{flex:0 0 auto;display:inline-flex;align-items:center;gap:4px;appearance:none;border:.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-11,11px/14px sans-serif);border-radius:var(--dsw-radius-sm,6px);padding:4px 6px;outline:none;cursor:pointer;white-space:nowrap}',
        '.ct-select:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
        '.ct-select:disabled{opacity:.4;cursor:default}',
        '.ct-select-label{line-height:1}',
        '.ct-select:focus{border-color:var(--dsw-alias-brand-primary)}',
        '.ct-form-row{display:flex;gap:6px;align-items:center;min-width:0}',
        '.ct-hint{font:var(--dsw-font-xxxs-11,11px/14px sans-serif);color:var(--dsw-alias-label-tertiary);margin-left:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',

        // Filter chips.
        '.ct-scopes{display:flex;gap:0;padding:0 10px 6px;flex:0 0 auto}',
        '.ct-scope{flex:1 1 auto;appearance:none;border:.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxxs-11,11px/14px sans-serif);padding:3px 6px;cursor:pointer;white-space:nowrap}',
        '.ct-scope:first-child{border-start-start-radius:var(--dsw-radius-sm,6px);border-end-start-radius:var(--dsw-radius-sm,6px)}',
        '.ct-scope:last-child{border-start-end-radius:var(--dsw-radius-sm,6px);border-end-end-radius:var(--dsw-radius-sm,6px)}',
        '.ct-scope+.ct-scope{border-inline-start-width:0}',
        '.ct-scope:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
        '.ct-scope[data-active="true"]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary);font-weight:600}',

        // Status tabs: the product's SegmentedTabs, framed by this container.
        '.ct-tabs{flex:0 0 auto;min-width:0;padding:0 2px}',
        // The primitive gives every tab an equal quarter of the row; in a narrow
        // panel that quarter is smaller than the label, and the CJK text broke
        // mid-word (进行/中). Nowrap plus a slightly smaller label keeps all
        // four on one line down to very narrow panels.
        '.ct-tabs [role="tab"]{white-space:nowrap}',
        '.ct-tab-label{display:inline-flex;align-items:center;gap:3px;line-height:1;white-space:nowrap;font-size:11px}',
        '.ct-tab-label svg{width:11px;height:11px}',

        // Filter chips (fallback only, when the host lacks SegmentedTabs).
        '.ct-filters{display:flex;gap:2px;padding:0 10px 6px;flex:0 0 auto;flex-wrap:wrap}',
        '.ct-chip{border:.5px solid transparent;background:transparent;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxxs-11,11px/14px sans-serif);border-radius:999px;corner-shape:round;padding:3px 9px;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:4px;line-height:1}',
        '.ct-chip-label{line-height:1}',
        '.ct-chip:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}',
        '.ct-chip[data-active="true"]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-active);border-color:var(--dsw-alias-border-l2)}',

        // Task rows.
        '.ct-list{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding:0 10px 8px}',
        // Row shell. The actions column is `flex:0 0 auto`, so the body is what
        // shrinks; keeping `nowrap` stops the action buttons from being pushed
        // onto their own line when the panel is narrow (they used to wrap and
        // leave a tall, airy row).
        // Row shell. The action buttons are absolutely positioned over the row's
        // top-right, NOT in the flow: if they were, the title would get narrower
        // whenever they faded in on hover, and the whole row would visibly jump.
        '.ct-item{display:flex;flex-wrap:nowrap;gap:6px;align-items:flex-start;padding:6px 0;border-bottom:.5px solid var(--dsw-alias-border-l1);min-width:0;position:relative}',
        '.ct-check{margin:1px 0 0;width:14px;height:14px;flex:0 0 auto;cursor:pointer;accent-color:var(--dsw-alias-brand-primary)}',
        '.ct-body{flex:1 1 auto;min-width:0;display:block;transition:padding-right .12s}',
        // Reserve room for the hover buttons so the title does not have to dodge
        // them; only the last line needs clearance, but a uniform padding is
        // simpler and reads as intentional breathing room.
        '.ct-item:hover .ct-body,.ct-item:focus-within .ct-body{padding-right:76px}',
        '.ct-row{display:flex;align-items:flex-start;gap:5px;min-width:0}',
        '.ct-text{flex:1 1 auto;min-width:0;overflow-wrap:break-word;text-wrap:pretty;color:var(--dsw-alias-label-primary)}',
        '.ct-item[data-status="done"] .ct-text{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}',
        '.ct-item[data-status="in_progress"] .ct-text{font:var(--dsw-font-xxs-12,12px/18px sans-serif);font-weight:600;color:var(--dsw-alias-label-primary)}',
        '.ct-text[role="button"]{cursor:text;border-radius:var(--dsw-radius-xs,4px)}',
        '.ct-text[role="button"]:hover{text-decoration:underline dotted;text-underline-offset:3px}',
        '.ct-text[role="button"]:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
        '.ct-notes{margin-top:2px;font:var(--dsw-font-xxxs-11,11px/14px sans-serif);color:var(--dsw-alias-label-tertiary);white-space:pre-wrap;overflow-wrap:anywhere}',
        '.ct-meta{display:flex;gap:4px;flex-wrap:wrap;margin-top:3px;align-items:center}',
        '.ct-scope-tag{font:var(--dsw-font-xxxs-11,11px/14px sans-serif);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-xs,4px);padding:0 5px;white-space:nowrap;max-width:11em;overflow:hidden;text-overflow:ellipsis}',
        '.ct-move{flex:0 0 100%;display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin:4px 0 2px 21px;padding:5px 7px;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,6px)}',
        '.ct-move-label{font:var(--dsw-font-xxxs-11,11px/14px sans-serif);color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
        '.ct-move-opt{appearance:none;border:.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-11,11px/14px sans-serif);border-radius:var(--dsw-radius-xs,4px);padding:2px 7px;cursor:pointer;white-space:nowrap;max-width:9em;overflow:hidden;text-overflow:ellipsis}',
        '.ct-move-opt:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
        '.ct-move-opt[data-active="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);font-weight:600}',
        '.ct-move-opt:disabled{opacity:.45;cursor:default}',
        '.ct-move-cancel{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxxs-11,11px/14px sans-serif);padding:2px 4px;cursor:pointer;margin-left:auto}',
        '.ct-move-cancel:hover{color:var(--dsw-alias-label-primary)}',
        '.ct-tag{font:var(--dsw-font-xxxs-11,11px/14px sans-serif);color:var(--dsw-alias-label-tertiary);border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;corner-shape:round;padding:0 6px;white-space:nowrap}',

        // Priority pills use the semantic state colours (theme-aware).
        '.ct-pri{font:var(--dsw-font-xxxs-11,11px/14px sans-serif);border-radius:999px;corner-shape:round;padding:0 6px;border:.5px solid currentColor;white-space:nowrap}',
        '.ct-pri[data-p="urgent"]{color:var(--dsw-alias-state-error-primary)}',
        '.ct-pri[data-p="high"]{color:var(--dsw-alias-state-warn-primary)}',
        '.ct-pri[data-p="low"]{color:var(--dsw-alias-label-tertiary)}',

        // Row actions: revealed on hover/focus, always visible on touch.
        // Overlay buttons: absolutely positioned so their fade-in never reflows
        // the row. The gradient keeps them readable when they sit over text.
        '.ct-actions{position:absolute;top:5px;right:2px;display:flex;gap:1px;opacity:0;transition:opacity .12s;flex:0 0 auto}',
        '.ct-item:hover .ct-actions,.ct-item:focus-within .ct-actions{opacity:1}',
        '@media (hover:none){.ct-actions{opacity:1}}',
        // Touch devices have no hover: the buttons must occupy real space so
        // they do not permanently cover the title's end.
        '@media (hover:none){.ct-item .ct-body{padding-right:76px}}',
        '.ct-icon{display:inline-flex;align-items:center;justify-content:center;appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;border-radius:var(--dsw-radius-xs,4px);padding:1px 2px;line-height:1}',
        '.ct-icon:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
        '.ct-icon:disabled{opacity:.4;cursor:default}',

        '.ct-empty{padding:22px 4px;text-align:center;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12,12px/18px sans-serif)}',

        '.ct-toast{margin:0 10px 6px;padding:5px 8px;border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-11,11px/14px sans-serif);overflow-wrap:anywhere;flex:0 0 auto}',
        '.ct-error{margin:0 10px 8px;padding:6px 8px;border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);font:var(--dsw-font-xxxs-11,11px/14px sans-serif);overflow-wrap:anywhere;flex:0 0 auto}',

        // In-place row editor.
        '.ct-item.ct-editing{display:block;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,6px);padding:8px;margin:6px 0}',
        '.ct-form{display:flex;flex-direction:column;gap:6px;min-width:0}',
      ].join('')

      function useInjectedStyles() {
        useEffect(function () {
          if (typeof document === 'undefined') return undefined
          var tag = document.createElement('style')
          tag.dataset.plugin = 'dsh-crabtodo'
          tag.textContent = CSS
          document.head.appendChild(tag)
          return function () {
            tag.remove()
          }
        }, [])
      }

      // ── the page ───────────────────────────────────────────────────────
      /**
       * The page itself.
       *
       * The `sidebar.right.pane.tab` seat is SESSION-scoped, so this component
       * receives the standard session props — including `inputActions`, the
       * public verb for writing the composer draft. That is what powers
       * "添加到对话" without reaching into any private state.
       *
       * @param props - slot props for this tab body.
       */
      function CrabTodoPanel(props) {
        var inputActions = props && props.inputActions
        // The seat is session-scoped, so the bound session id is always here.
        // The page cannot read that session's workspace root itself; forwarding
        // the id lets the host resolve the project for UI-created tasks.
        var sessionId = props && typeof props.sessionId === 'string' ? props.sessionId : null
        // Published input state is how the current draft is read; the actions
        // surface itself has no getter.
        var input = props && typeof props.useInput === 'function' ? props.useInput(function (state) { return state }) : null
        var currentDraft = input && typeof input.draft === 'string' ? input.draft : ''
        useInjectedStyles()
        var [tasks, setTasks] = useState([])
        var [loading, setLoading] = useState(true)
        var [error, setError] = useState('')
        var [toast, setToast] = useState('')

        // Auto-dismiss the confirmation; a stuck toast in a narrow panel is
        // worse than no toast at all.
        useEffect(
          function () {
            if (!toast) return undefined
            var timer = setTimeout(function () {
              setToast('')
            }, 2400)
            return function () {
              clearTimeout(timer)
            }
          },
          [toast]
        )
        var [filter, setFilter] = useState('open')
        // Which scope tab is showing. 'project' is the default because that is
        // where the current workspace's work lives.
        var [scope, setScope] = useState('project')
        var [busy, setBusy] = useState(false)
        var alive = useRef(true)
        var rootRef = useRef(null)

        /**
         * Give the mount chain a resolvable height, ONCE.
         *
         * Measured ancestor chain above this panel: `static|298`, `static|0`,
         * `static|800`..., where the first is the sidebar's own box. It HAS a
         * height but declares `height:auto`, so a percentage on our side
         * resolves against "auto" and collapses; that is why the composer used
         * to sit mid-column and expand downward. Writing that pixel height onto
         * the wrapper makes `height:100%` meaningful, and flexbox can then push
         * the composer to the bottom and grow it upward.
         *
         * Runs once per mount: the value tracks the column, not our content, so
         * there is no measure -> render -> measure loop.
         */
        useEffect(
          function () {
            if (typeof window === 'undefined') return undefined
            var node = rootRef.current
            if (!node) return undefined
            var host = node.parentElement
            if (!host) return undefined

            var column = 0
            for (var el = host, depth = 0; el && depth < 6; el = el.parentElement, depth += 1) {
              var h = el.getBoundingClientRect().height
              if (h > 0) {
                column = Math.round(h)
                break
              }
            }
            if (column <= 0) return undefined

            var applied = []
            var prevHost = host.style.height
            host.style.height = column + 'px'
            applied.push([host, prevHost])
            // Any zero-height wrappers between us and that column need it too.
            for (var up = host.parentElement, d = 0; up && d < 4; up = up.parentElement, d += 1) {
              if (up.getBoundingClientRect().height > 0) break
              var prev = up.style.height
              up.style.height = '100%'
              applied.push([up, prev])
            }
            return function () {
              for (var i = 0; i < applied.length; i += 1) applied[i][0].style.height = applied[i][1]
            }
          },
          []
        )

        /** Project key the host resolved for this session; shown in the card. */
        var [currentProject, setCurrentProject] = useState(null)

        var load = useCallback(async function () {
          try {
            var query = sessionId ? '?sessionId=' + encodeURIComponent(sessionId) : ''
            var body = await request('tasks' + query)
            if (!alive.current) return
            setTasks(Array.isArray(body.tasks) ? body.tasks : [])
            setCurrentProject(typeof body.currentProject === 'string' ? body.currentProject : null)
            setError('')
          } catch (failure) {
            if (alive.current) setError(String((failure && failure.message) || failure))
          } finally {
            if (alive.current) setLoading(false)
          }
        }, [sessionId])

        useEffect(function () {
          alive.current = true
          load()
          // Live updates: the host half emits one `change` per committed write,
          // whether it came from this page or from a model tool call.
          var stream = null
          try {
            stream = new EventSource(api('events'))
            stream.addEventListener('change', load)
            stream.onerror = function () {
              /* EventSource reconnects on its own; silence is correct here. */
            }
          } catch (failure) {
            /* no EventSource: the page still works, just without live updates */
          }
          return function () {
            alive.current = false
            if (stream) {
              try {
                stream.close()
              } catch (failure) {}
            }
          }
        }, [load])

        var mutate = useCallback(
          async function (run) {
            setBusy(true)
            try {
              await run()
              await load()
              if (alive.current) setError('')
            } catch (failure) {
              if (alive.current) setError(String((failure && failure.message) || failure))
            } finally {
              if (alive.current) setBusy(false)
            }
          },
          [load]
        )

        var addTask = useCallback(
          function (fields) {
            var title = String((fields && fields.title) || '').trim()
            if (title.length === 0) return Promise.resolve(false)
            // The card creates into the scope currently being viewed, so what
            // you add lands where your eyes are. The 全部 view cannot name a
            // scope, so it falls back to the server's default.
            var payload = { title: title }
            if (scope === 'project' || scope === 'global') payload.scope = scope
            if (sessionId) payload.sessionId = sessionId
            if (fields.notes) payload.notes = fields.notes
            if (fields.priority && fields.priority !== 'normal') payload.priority = fields.priority
            if (fields.status && fields.status !== 'pending') payload.status = fields.status
            var tags = String(fields.tags || '')
              .split(/[\s,]+/)
              .map(function (tag) { return tag.replace(/^#/, '').trim() })
              .filter(function (tag) { return tag.length > 0 })
            if (tags.length > 0) payload.tags = tags
            return mutate(async function () {
              await request('tasks', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload)
              })
            }).then(function () { return true })
          },
          [mutate, scope, sessionId]
        )

        /**
         * Send one task to the conversation composer.
         *
         * The draft is written through `inputActions.setDraft`, the same public
         * verb the composer's own restore path uses, so the text lands in the
         * real input box. Three behaviours matter here:
         *
         *  - A task becomes a sentence that carries its context (notes, tags,
         *    priority), because a bare title in the composer loses the reason
         *    you wrote it down.
         *  - An empty draft is replaced; a draft you are already writing is
         *    APPENDED to, never silently discarded.
         *  - Failure is reported, not swallowed: without `inputActions` (no
         *    session bound) the button would otherwise look like it worked.
         */
        /**
         * Reference one task into the composer draft.
         *
         * `setDraft` is the only public write verb (the structured-chip path is
         * a session-scoped event the page cannot emit), so the reference is
         * plain text. It carries the task id so a follow-up instruction like
         * "mark this done" resolves to a real row instead of fuzzy matching.
         */
        var addToChat = useCallback(
          function (task) {
            if (!inputActions || typeof inputActions.setDraft !== 'function') {
              setError('当前没有可写入的会话输入框（未绑定会话时无法添加到对话）。')
              return
            }
            var bits = ['- ' + task.title]
            bits.push(task.scope === 'project' ? projectLabel(task.project) || '项目' : '全局')
            if (task.priority && task.priority !== 'normal') {
              bits.push(PRIORITY_LABEL[task.priority] || task.priority)
            }
            bits.push(task.id)
            var entry = bits.join(' · ')

            var existing = String(currentDraft || '')
            // Keep one header: append the new row under it instead of stacking
            // a second "引用待办：" each time another task is referenced.
            var HEADER = '引用待办：'
            if (existing.indexOf(HEADER) === 0) {
              var body = existing.slice(HEADER.length).replace(/^\n/, '')
              var next = HEADER + '\n' + entry + (body.trim().length > 0 ? '\n' + body : '\n')
              try {
                inputActions.setDraft(next)
                setError('')
                setToast('已引用到对话：' + task.title)
              } catch (failure) {
                setError('添加到对话失败：' + String((failure && failure.message) || failure))
              }
              return
            }

            var text = HEADER + '\n' + entry + '\n'
            var merged = existing.trim().length > 0 ? text + existing : text
            try {
              inputActions.setDraft(merged)
              setError('')
              setToast('已引用到对话：' + task.title)
            } catch (failure) {
              setError('添加到对话失败：' + String((failure && failure.message) || failure))
            }
          },
          [inputActions, currentDraft]
        )

        var patch = useCallback(
          function (id, changes) {
            mutate(function () {
              return request('tasks/' + encodeURIComponent(id), {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(changes)
              })
            })
          },
          [mutate]
        )

        var remove = useCallback(
          function (id) {
            mutate(function () {
              return request('tasks/' + encodeURIComponent(id), { method: 'DELETE' })
            })
          },
          [mutate]
        )

        var clearCompleted = useCallback(
          function () {
            mutate(function () {
              return request('clear-completed', { method: 'POST' })
            })
          },
          [mutate]
        )

        var inScope = useMemo(
          function () {
            if (scope === 'all') return tasks
            return tasks.filter(function (task) {
              return (task.scope || 'global') === scope
            })
          },
          [tasks, scope]
        )

        var visible = useMemo(
          function () {
            var rule = FILTERS.filter(function (entry) {
              return entry.id === filter
            })[0]
            var test = rule ? rule.test : FILTERS[0].test
            return inScope.filter(test)
          },
          [inScope, filter]
        )

        var openCount = useMemo(
          function () {
            return inScope.filter(function (task) {
              return task.status !== 'done'
            }).length
          },
          [inScope]
        )

        // The composer is visually pinned to the bottom of the column with
        // `position:sticky;bottom:0` (see .ct-card). That needs no height
        // measurement and works whatever the host wrapper reports.
        return h(
          'div',
          { className: 'ct-root', ref: rootRef },
          // The tab chip already says "CrabTodo", so this strip carries only
          // the counts and the two whole-list actions.
          h(
            'div',
            { className: 'ct-head' },
            h('span', { className: 'ct-count', title: '未完成 ' + openCount + ' 项，共 ' + tasks.length + ' 项' }, '待办 ' + openCount + ' / ' + tasks.length),
            h('span', { className: 'ct-spacer' }),
            h(
              'button',
              {
                type: 'button',
                className: 'ct-btn',
                disabled: busy || tasks.length === 0,
                title: '删除所有已完成任务',
                onClick: clearCompleted
              },
              '清理已完成'
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'ct-iconbtn ct-ghost',
                disabled: busy,
                title: '重新读取',
                'aria-label': '重新读取',
                onClick: load
              },
              icon('IconRefreshOutlineRegular', 13)
            )
          ),
          error ? h('div', { className: 'ct-error' }, error) : null,
          // Transient confirmation for "添加到对话"; the button changes nothing
          // visible in this panel, so silence would read as a broken button.
          toast ? h('div', { className: 'ct-toast', role: 'status' }, toast) : null,
          // Scope tabs sit above the status chips: "where" then "which".
          h(
            'div',
            { className: 'ct-scopes', role: 'tablist', 'aria-label': '待办范围' },
            SCOPE_TABS.map(function (entry) {
              return h(
                'button',
                {
                  key: entry.id,
                  type: 'button',
                  className: 'ct-scope',
                  role: 'tab',
                  'aria-selected': String(entry.id === scope),
                  'data-active': String(entry.id === scope),
                  title: entry.id === 'project' ? '当前工作区的待办' : entry.id === 'global' ? '所有项目共享的待办' : '两种范围一起看',
                  onClick: function () {
                    setScope(entry.id)
                  }
                },
                entry.label
              )
            })
          ),
          // Status tabs use the product's own SegmentedTabs, the same underlined
          // control the plugin market uses: equal-width, sliding indicator,
          // Left/Right/Home/End keyboard support. Icons stay alongside the
          // labels so the state is still readable at a glance.
          renderSegmentedTabs(filter, setFilter),
          h(
            'div',
            { className: 'ct-list' },
            loading
              ? h('div', { className: 'ct-empty' }, '加载中…')
              : visible.length === 0
                ? h(
                    'div',
                    { className: 'ct-empty' },
                    tasks.length === 0
                      ? '还没有任务。用下方卡片添加，或让模型调用 crabtodo_add。'
                      : '此筛选下没有任务。'
                  )
                : visible.map(function (task) {
                    return h(TaskRow, {
                      key: task.id,
                      task: task,
                      busy: busy,
                      onPatch: patch,
                      onRemove: remove,
                      onAddToChat: addToChat,
                      currentProject: currentProject
                    })
                  })
          ),
          // The composer lives at the BOTTOM of the panel: new work goes in
          // where the list ends, and its detail section expands upward so the
          // growing form never pushes existing rows off-screen.
          h(AddTaskCard, { busy: busy, onSubmit: addTask, scope: scope, project: currentProject })
        )
      }

      /**
       * The add-task card.
       *
       * A card, not a bare input row: it owns a surface, a hairline border and
       * a header, so it reads as the single place new work enters the list.
       * Collapsed it is one line (title + 添加 + expand); the caret grows that
       * SAME card into the full detail form without losing what was typed.
       * Enter submits and Escape collapses.
       */
      function AddTaskCard(props) {
        var busy = props.busy
        var [open, setOpen] = useState(false)
        var [title, setTitle] = useState('')
        var [notes, setNotes] = useState('')
        var [priority, setPriority] = useState('normal')
        var [status, setStatus] = useState('pending')
        var [tags, setTags] = useState('')
        var titleRef = useRef(null)

        useEffect(function () {
          if (open && titleRef.current) titleRef.current.focus()
        }, [open])

        var reset = useCallback(function () {
          setTitle('')
          setNotes('')
          setPriority('normal')
          setStatus('pending')
          setTags('')
          setOpen(false)
        }, [])

        var submit = useCallback(
          function () {
            if (busy || title.trim().length === 0) return
            Promise.resolve(
              props.onSubmit({ title: title, notes: notes, priority: priority, status: status, tags: tags })
            ).then(function (ok) {
              if (ok) reset()
            })
          },
          [busy, title, notes, priority, status, tags, props, reset]
        )

        var collapse = useCallback(function () {
          // Collapsing keeps whatever was already typed.
          setOpen(false)
        }, [])

        /** Enter submits from any single-line field; Escape collapses. */
        function onFieldKeyDown(event) {
          if (event.key === 'Enter') {
            event.preventDefault()
            submit()
          } else if (event.key === 'Escape' && open) {
            event.preventDefault()
            collapse()
          }
        }

        return h(
          'section',
          { className: 'ct-card', 'data-open': String(open), 'aria-label': '添加任务' },
          h(
            'header',
            { className: 'ct-card-head' },
            h('span', { className: 'ct-card-title' }, '新建任务'),
            h(
              'span',
              { className: 'ct-card-scope', title: props.project || '未解析到工作区' },
              props.scope === 'global'
                ? '全局'
                : props.scope === 'all'
                  ? '全部'
                  : props.project
                    ? projectLabel(props.project)
                    : '当前项目'
            ),
            h('span', { className: 'ct-spacer' }),
            h(
              'button',
              {
                type: 'button',
                className: 'ct-iconbtn ct-ghost',
                disabled: busy,
                title: open ? '收起详情' : '展开并编辑详情（备注、优先级、状态、标签）',
                'aria-label': open ? '收起详情' : '展开并编辑详情',
                'aria-expanded': String(open),
                onClick: function () {
                  setOpen(!open)
                }
              },
              // The detail panel grows UPWARD, so the affordance points that
              // way: an up-chevron invites the click, and the open state flips
              // it back down to mean "collapse". `ChevronsUpDown` reads as a
              // sort control, which is what it looked like before.
              icon(open ? 'IconChevronDownOutlineRegular' : 'IconChevronUpOutlineRegular', 13)
            )
          ),
          // The primary row exists in both states: that is the fast path.
          h(
            'div',
            { className: 'ct-card-row' },
            h('input', {
              ref: titleRef,
              className: 'ct-input ct-quick',
              value: title,
              placeholder: '要做什么？回车添加',
              disabled: busy,
              onChange: function (event) {
                setTitle(event.target.value)
              },
              onKeyDown: onFieldKeyDown
            }),
            h(
              'button',
              {
                type: 'button',
                className: 'ct-btn',
                'data-tone': 'accent',
                disabled: busy || title.trim().length === 0,
                onClick: submit
              },
              '添加'
            )
          ),
          // Always rendered: the open/close animation needs both endpoints
          // present, so visibility is CSS-driven via the card's data-open.
          h(
                'div',
                { className: 'ct-card-detail', 'aria-hidden': String(!open) },
                h('textarea', {
                  className: 'ct-textarea',
                  value: notes,
                  placeholder: '备注（可选）',
                  rows: 2,
                  disabled: busy,
                  onChange: function (event) {
                    setNotes(event.target.value)
                  },
                  onKeyDown: function (event) {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      collapse()
                    }
                  }
                }),
                h(
                  'div',
                  { className: 'ct-form-row' },
                  h(Dropdown, {
                    label: PRIORITY_LABEL[priority] || priority,
                    title: '优先级',
                    value: priority,
                    disabled: busy,
                    options: PRIORITIES.map(function (value) {
                      return { value: value, label: PRIORITY_LABEL[value] || value }
                    }),
                    onSelect: setPriority
                  }),
                  h(Dropdown, {
                    label: STATUS_LABEL[status] || status,
                    title: '状态',
                    value: status,
                    disabled: busy,
                    options: STATUSES.map(function (value) {
                      return { value: value, label: STATUS_LABEL[value] || value }
                    }),
                    onSelect: setStatus
                  }),
                  h('input', {
                    className: 'ct-input',
                    value: tags,
                    placeholder: '标签（空格分隔）',
                    disabled: busy,
                    onChange: function (event) {
                      setTags(event.target.value)
                    },
                    onKeyDown: onFieldKeyDown
                  })
                )
              )
        )
      }

      /**
       * One task row, with in-place editing.
       *
       * Clicking the title (or the pencil) swaps the display for a small form:
       * title, notes, priority and tags. Enter saves, Escape cancels, and an
       * unchanged form writes nothing, so tabbing through the list is harmless.
       */
      function TaskRow(props) {
        var task = props.task
        var busy = props.busy
        var done = task.status === 'done'
        var [editing, setEditing] = useState(false)
        var [form, setForm] = useState(null)
        var titleRef = useRef(null)
        // Showing the move control as a small inline picker keeps it one click
        // away instead of buried in the edit form.
        var [moving, setMoving] = useState(false)

        var begin = useCallback(
          function () {
            setForm({
              title: task.title,
              notes: task.notes || '',
              priority: task.priority || 'normal',
              status: task.status || 'pending',
              tags: (task.tags || []).join(' ')
            })
            setEditing(true)
          },
          [task]
        )

        useEffect(
          function () {
            if (editing && titleRef.current) {
              titleRef.current.focus()
              titleRef.current.select()
            }
          },
          [editing]
        )

        var cancel = useCallback(function () {
          setEditing(false)
          setForm(null)
        }, [])

        var commit = useCallback(
          function () {
            if (!form) return
            var title = String(form.title || '').trim()
            if (title.length === 0) {
              // An empty title is meaningless; treat it as cancel.
              cancel()
              return
            }
            var next = {
              title: title,
              notes: form.notes || '',
              priority: form.priority || 'normal',
              status: form.status || 'pending',
              tags: String(form.tags || '')
                .split(/[\s,]+/)
                .map(function (tag) { return tag.replace(/^#/, '').trim() })
                .filter(function (tag) { return tag.length > 0 })
            }
            var changed =
              next.title !== task.title ||
              next.notes !== (task.notes || '') ||
              next.priority !== (task.priority || 'normal') ||
              next.status !== (task.status || 'pending') ||
              next.tags.join(' ') !== (task.tags || []).join(' ')
            setEditing(false)
            setForm(null)
            if (changed) props.onPatch(task.id, next)
          },
          [form, task, props, cancel]
        )

        if (editing && form) {
          return h(
            'div',
            { className: 'ct-item ct-editing', 'data-status': task.status },
            h(
              'div',
              { className: 'ct-form' },
              h('input', {
                ref: titleRef,
                className: 'ct-input',
                value: form.title,
                placeholder: '任务标题（必填）',
                onChange: function (event) {
                  setForm(Object.assign({}, form, { title: event.target.value }))
                },
                onKeyDown: function (event) {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commit()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    cancel()
                  }
                }
              }),
              h('textarea', {
                className: 'ct-textarea',
                value: form.notes,
                placeholder: '备注（可选）',
                rows: 2,
                onChange: function (event) {
                  setForm(Object.assign({}, form, { notes: event.target.value }))
                },
                onKeyDown: function (event) {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    cancel()
                  }
                }
              }),
              h(
                'div',
                { className: 'ct-form-row' },
                h(Dropdown, {
                  label: PRIORITY_LABEL[form.priority] || form.priority,
                  title: '优先级',
                  value: form.priority,
                  options: PRIORITIES.map(function (priority) {
                    return { value: priority, label: PRIORITY_LABEL[priority] || priority }
                  }),
                  onSelect: function (value) {
                    setForm(Object.assign({}, form, { priority: value }))
                  }
                }),
                // Status is editable here too: an in-progress task was
                // otherwise stuck, because the row's quick controls only
                // offer done/undo and "mark in progress".
                h(Dropdown, {
                  label: STATUS_LABEL[form.status] || form.status,
                  title: '状态',
                  value: form.status,
                  options: STATUSES.map(function (value) {
                    return { value: value, label: STATUS_LABEL[value] || value }
                  }),
                  onSelect: function (value) {
                    setForm(Object.assign({}, form, { status: value }))
                  }
                }),
                h('input', {
                  className: 'ct-input',
                  value: form.tags,
                  placeholder: '标签（空格分隔）',
                  onChange: function (event) {
                    setForm(Object.assign({}, form, { tags: event.target.value }))
                  },
                  onKeyDown: function (event) {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      commit()
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      cancel()
                    }
                  }
                })
              ),
              h(
                'div',
                { className: 'ct-form-row' },
                h('button', { type: 'button', className: 'ct-btn', 'data-tone': 'accent', onClick: commit }, '保存'),
                h('button', { type: 'button', className: 'ct-btn', onClick: cancel }, '取消'),
                h('span', { className: 'ct-hint' }, 'Enter 保存 · Esc 取消')
              )
            )
          )
        }

        return h(
          'div',
          { className: 'ct-item', 'data-status': task.status },
          h('input', {
            type: 'checkbox',
            className: 'ct-check',
            checked: done,
            disabled: busy,
            title: done ? '标记为未完成' : '标记为已完成',
            onChange: function () {
              props.onPatch(task.id, { status: done ? 'pending' : 'done' })
            }
          }),
          h(
            'div',
            { className: 'ct-body' },
            h(
              'div',
              { className: 'ct-row' },
              h(
                'span',
                {
                  className: 'ct-text',
                  title: '点击编辑',
                  role: 'button',
                  tabIndex: 0,
                  onClick: begin,
                  onKeyDown: function (event) {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      begin()
                    }
                  }
                },
                task.title
              ),
              task.status === 'in_progress'
                ? h('span', { className: 'ct-pri', 'data-p': 'high' }, '进行中')
                : null
            ),
            task.notes ? h('div', { className: 'ct-notes' }, task.notes) : null,
            h(
              'div',
              { className: 'ct-meta' },
              // Scope chip: always visible so the task's home is never a guess.
              h(
                'span',
                { className: 'ct-scope-tag' },
                task.scope === 'project'
                  ? projectLabel(task.project) || '项目'
                  : '全局'
              ),
              task.priority && task.priority !== 'normal'
                ? h('span', { className: 'ct-pri', 'data-p': task.priority }, PRIORITY_LABEL[task.priority] || task.priority)
                : null,
              (task.tags || []).map(function (tag) {
                return h('span', { key: tag, className: 'ct-tag' }, '#' + tag)
              })
            )
          ),
          h(
            'div',
            { className: 'ct-actions' },
            h(
              'button',
              { type: 'button', className: 'ct-icon', disabled: busy, title: '编辑任务', 'aria-label': '编辑任务', onClick: begin },
              icon('IconEditOutlineRegular', 12)
            ),
            // "添加到对话": writes this task into the composer draft.
            h(
              'button',
              {
                type: 'button',
                className: 'ct-icon',
                disabled: busy,
                title: '添加到对话输入框',
                'aria-label': '添加到对话',
                onClick: function () {
                  props.onAddToChat(task)
                }
              },
              icon('IconSendOutlineRegular', 12)
            ),
            // "移动": switch this task between project and global scope.
            h(
              'button',
              {
                type: 'button',
                className: 'ct-icon',
                disabled: busy,
                title: task.scope === 'project' ? '移到全局' : '移到项目',
                'aria-label': '移动任务',
                'aria-expanded': String(moving),
                onClick: function () {
                  setMoving(!moving)
                }
              },
              icon('IconFolderOpenOutlineRegular', 12)
            ),
            task.status !== 'in_progress'
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'ct-icon',
                    disabled: busy,
                    title: '标记为进行中',
                    'aria-label': '标记为进行中',
                    onClick: function () {
                      props.onPatch(task.id, { status: 'in_progress' })
                    }
                  },
                  icon('IconPlayOutlineRegular', 12)
                )
              : null,
            h(
              'button',
              {
                type: 'button',
                className: 'ct-icon',
                disabled: busy,
                title: '删除任务',
                'aria-label': '删除任务',
                onClick: function () {
                  props.onRemove(task.id)
                }
              },
              icon('IconTrashOutlineRegular', 12)
            )
          ),
          // Inline scope picker: one click to flip this task between the
          // current project and global, without opening the full editor.
          moving
            ? h(
                'div',
                { className: 'ct-move' },
                h('span', { className: 'ct-move-label' }, '移动到'),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'ct-move-opt',
                    'data-active': String(task.scope === 'project'),
                    disabled: busy,
                    onClick: function () {
                      setMoving(false)
                      if (task.scope === 'project') return
                      // Name the project explicitly: the host cannot always
                      // resolve it from the session, and an unresolved move
                      // silently degrades back to global.
                      props.onPatch(task.id, {
                        scope: 'project',
                        project: props.currentProject || undefined,
                      })
                    }
                  },
                  projectLabel(props.currentProject) || '项目'
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'ct-move-opt',
                    'data-active': String(task.scope === 'global'),
                    disabled: busy,
                    onClick: function () {
                      setMoving(false)
                      if (task.scope !== 'global') props.onPatch(task.id, { scope: 'global' })
                    }
                  },
                  '全局'
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'ct-move-cancel',
                    onClick: function () {
                      setMoving(false)
                    }
                  },
                  '取消'
                )
              )
            : null
        )
      }

      // ── the tab / guide icon ───────────────────────────────────────────



      /**
       * The tab type's glyph.
       *
       * A checklist says what the page is; drawing our own crab would be a
       * fifth unrelated illustration in a shell that already has a coherent
       * icon set. Falls back to nothing when the icon bundle is unavailable.
       */
      function CrabIcon(props) {
        var size = (props && props.size) || 16
        var Checklist = Icons && Icons.IconChecklistOutlineRegular
        if (typeof Checklist === 'function') return h(Checklist, { size: size })
        return null
      }

      // ── registration ───────────────────────────────────────────────────
      /**
       * Contribute CrabTodo as a tab type of the RIGHT sidebar.
       *
       * A tab type is two registrations under one id: the static definition
       * (its kind, chip title, guide entry) in `sidebarRightTabs`, and the body
       * in the keyed `sidebar.right.pane.tab` seat. The seat dispatches by the
       * definition's `id`, so the page docks, splits, floats and closes like any
       * other tab and never occupies the main column.
       *
       * `ctx.inject` — not a plain `ctx.get` read — because the right sidebar
       * ships as its own bundle: whether it is already provided when this
       * plugin's `apply` runs depends on composition order. Injecting makes
       * Cordis run this body exactly while the registry exists, and unwind it
       * if that ever goes away, so a profile without a right sidebar gets no
       * page instead of a failed entry.
       *
       * @param ctx - client root context.
       */
      function apply(ctx) {

        ctx.inject(['sidebarRightTabs'], function (scoped) {
          var tabs = scoped.sidebarRightTabs
          if (!tabs || typeof tabs.register !== 'function') return

          // Stage one: the type itself. No `patterns` — this is a page type
          // opened by kind, not a viewer claiming resource addresses.
          scoped.effect(function () {
            return tabs.register({
              id: TAB_ID,
              kind: TAB_KIND,
              priority: 'extension',
              title: function () {
                return 'CrabTodo'
              },
              guide: [
                {
                  id: TAB_KIND,
                  order: 60,
                  title: function () {
                    return 'CrabTodo'
                  },
                  description: function () {
                    return '持久化待办清单：跨会话保留，模型与页面共享同一份数据'
                  },
                  icon: CrabIcon
                }
              ]
            })
          }, 'crabtodo: tab type')

          // Stage two: the body, keyed by the definition id. The seat is
          // declared by the same bundle, so inject rather than assume it.
          scoped.effect(function () {
            return scoped.slots.inject('sidebar.right.pane.tab', function () {
              return scoped.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, CrabTodoPanel)
            })
          }, 'crabtodo: tab body')
        })
      }

      exports.name = 'crabtodo'
      exports.inject = ['slots']
      exports.apply = apply
      return module.exports
    }
  })
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : null)
