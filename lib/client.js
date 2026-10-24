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
      // FLIP wants layout timing; fall back where the host React lacks it.
      var useLayoutEffect = React.useLayoutEffect || React.useEffect

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
       * Project keys are workspace paths; compare them the way the OS does —
       * case-insensitively — so `C:\\Code` and `c:\\code` are one project.
       */
      function sameProjectKey(a, b) {
        if (a === b) return true
        return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()
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

      // ── UI strings ─────────────────────────────────────────────────────────
      /**
       * The panel follows the host locale: `html[lang]` (the shell sets it),
       * falling back to `navigator.language`. zh gets Chinese, everything else
       * gets English — those are the two complete catalogs.
       */
      var LANG = (function () {
        var tag = ''
        try {
          tag = (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) || ''
        } catch (error) {}
        if (!tag) {
          try {
            tag = (typeof navigator !== 'undefined' && navigator.language) || ''
          } catch (error) {}
        }
        return /^zh/i.test(tag) ? 'zh' : 'en'
      })()

      /** Both catalogs side by side: same keys, one row each. */
      var STR = (function () {
        var zh = {
          status: { pending: '待办', in_progress: '进行中', done: '已完成' },
          priority: { low: '低', normal: '普通', high: '高', urgent: '紧急' },
          filters: { open: '待办', all: '全部', in_progress: '进行中', done: '已完成' },
          scopes: { project: '项目', global: '全局', all: '全部' },
          tabsLabel: '任务状态筛选',
          scopeTabsAria: '待办范围',
          scopeTipProject: '当前工作区的待办',
          scopeTipGlobal: '所有项目共享的待办',
          scopeTipAll: '两种范围一起看',
          countTip: function (open, total) { return '未完成 ' + open + ' 项，共 ' + total + ' 项' },
          countText: function (open, total) { return '待办 ' + open + ' / ' + total },
          trashCountText: function (n) { return '回收站 ' + n },
          trashTitle: function (n) { return '回收站' + (n > 0 ? '（' + n + '）' : '') },
          clearCompleted: '清理已完成',
          clearCompletedTip: '删除所有已完成任务',
          emptyTrash: '清空回收站',
          emptyTrashTip: '永久删除本视图中回收站的任务',
          backToList: '返回任务列表',
          home: '回到首页',
          floatBtn: '悬浮模式',
          floatDock: '回到侧栏',
          floatCollapse: '折叠',
          floatExpand: '展开',
          floatStub: '面板已移至悬浮窗，可拖动标题栏移动位置。',
          settingsTitle: '设置',
          settingsNotesLines: '备注显示行数',
          settingsConfirmDelete: '删除任务前弹出确认',
          settingsAnimations: '动画效果',
          settingsRightbarWidth: '右栏默认宽度',
          settingsDefaultScope: '启动时默认范围',
          settingsDefaultFilter: '启动时默认状态筛选',
          settingsOn: '开',
          settingsOff: '关',
          settingsAccent: '强调色',
          settingsFontSize: '字体大小',
          settingsDefault: '默认',
          settingsBlue: '蓝',
          settingsPurple: '紫',
          settingsGreen: '绿',
          settingsOrange: '橙',
          settingsRed: '红',
          trash: '回收站',
          reload: '重新读取',
          loading: '加载中…',
          emptyList: '还没有任务。用下方卡片添加，或让模型调用 crabtodo_add。',
          emptyFilter: '此筛选下没有任务。',
          emptyTrashView: '回收站是空的。删除的任务会先落到这里。',
          noMatch: function (q) { return '没有匹配「' + q + '」的任务。' },
          undo: '撤销',
          restored: function (title) { return '已恢复：' + title },
          deletedToast: function (title) { return '已删除' + (title ? '「' + title + '」' : '任务') },
          deletedFallback: '已删除任务',
          referenced: function (title) { return '已引用到对话：' + title },
          noComposer: '当前没有可写入的会话输入框（未绑定会话时无法添加到对话）。',
          refFailed: function (err) { return '添加到对话失败：' + err },
          refMark: '引用待办',
          refHeader: '（来自 dsh-crabtodo 插件的持久化任务列表；可直接调用 crabtodo_list / crabtodo_update / crabtodo_done / crabtodo_remove 工具，按下方任务ID 查询或操作这些任务）：',
          refNone: '（无）',
          refTask: '- 任务: ',
          refNotes: '  描述: ',
          refStatus: '状态: ',
          refPriority: '优先级: ',
          refScope: '范围: ',
          refScopeProject: '项目 ',
          refScopeGlobal: '全局',
          refTags: '标签: ',
          refId: '  任务ID: ',
          refSource: ' · 来源: dsh-crabtodo 插件',
          markDone: '标记为已完成',
          markUndone: '标记为未完成',
          clickEdit: '点击编辑',
          clickCollapse: '点击收起',
          clickExpand: '点击展开详情',
          inProgressBadge: '进行中',
          edit: '编辑任务',
          addToChatTip: '添加到对话输入框',
          addToChat: '添加到对话',
          copyRef: '复制引用',
          copied: '引用已复制',
          moveToGlobal: '移到全局',
          moveToProject: '移到项目',
          moveAria: '移动任务',
          markInProgress: '标记为进行中',
          remove: '删除任务',
          moveTo: '移动到',
          save: '保存',
          cancel: '取消',
          saveHint: 'Enter 保存 · Esc 取消',
          titleRequired: '任务标题（必填）',
          newTask: '新建任务',
          addTaskAria: '添加任务',
          whatToDo: '要做什么？回车添加',
          add: '添加',
          notesOptional: '备注（可选）',
          priorityTitle: '优先级',
          statusTitle: '状态',
          tagsPlaceholder: '标签（空格分隔）',
          tagsLibrary: '标签库',
          tagNewPlaceholder: '新标签，回车加入',
          tagFilterTip: '点击按此标签筛选',
          expandDetails: '展开并编辑详情（备注、优先级、状态、标签）',
          expandDetailsAria: '展开并编辑详情',
          collapseDetails: '收起详情',
          scopeUnresolved: '未解析到工作区',
          scopeCurrentProject: '当前项目',
          deletedAt: '删除于 ',
          restore: '恢复任务',
          purge: '彻底删除',
          persistHint: '持久化待办清单：跨会话保留，模型与页面共享同一份数据',
          dlgDeleteTitle: '删除任务',
          dlgDeleteDesc: function (title) { return '「' + title + '」将移入回收站，可在回收站中恢复。' },
          dlgConfirmDelete: '删除',
          dlgPurgeTitle: '彻底删除',
          dlgPurgeDesc: function (title) { return '「' + title + '」将被永久删除，此操作不可恢复。' },
          dlgConfirmPurge: '永久删除',
          dlgEmptyTitle: '清空回收站',
          dlgEmptyDesc: function (n) { return '回收站中的 ' + n + ' 条任务将被永久删除，此操作不可恢复。' },
          dlgConfirmEmpty: '清空',
          dlgClose: '关闭',
          pin: '置顶任务',
          unpin: '取消置顶',
          pinnedFlag: '已置顶',
          searchPlaceholder: '搜索标题 / 备注 / 标签…',
          searchAria: '搜索任务',
          clearSearch: '清除搜索',
        }
        var en = {
          status: { pending: 'To do', in_progress: 'In progress', done: 'Done' },
          priority: { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' },
          filters: { open: 'To do', all: 'All', in_progress: 'In progress', done: 'Done' },
          scopes: { project: 'Project', global: 'Global', all: 'All' },
          tabsLabel: 'Filter tasks by status',
          scopeTabsAria: 'Task scope',
          scopeTipProject: 'Tasks of the current workspace',
          scopeTipGlobal: 'Tasks shared across all projects',
          scopeTipAll: 'Both scopes together',
          countTip: function (open, total) { return open + ' open, ' + total + ' total' },
          countText: function (open, total) { return 'To-do ' + open + ' / ' + total },
          trashCountText: function (n) { return 'Trash ' + n },
          trashTitle: function (n) { return 'Trash' + (n > 0 ? ' (' + n + ')' : '') },
          clearCompleted: 'Clear completed',
          clearCompletedTip: 'Permanently remove all completed tasks',
          emptyTrash: 'Empty trash',
          emptyTrashTip: 'Permanently remove every trashed task shown in this view',
          backToList: 'Back to the task list',
          home: 'Home',
          floatBtn: 'Float window',
          floatDock: 'Dock to sidebar',
          floatCollapse: 'Collapse',
          floatExpand: 'Expand',
          floatStub: 'The panel is floating — drag its title bar to move it.',
          settingsTitle: 'Settings',
          settingsNotesLines: 'Notes preview lines',
          settingsConfirmDelete: 'Confirm before deleting a task',
          settingsAnimations: 'Animations',
          settingsRightbarWidth: 'Right panel width',
          settingsDefaultScope: 'Default scope on open',
          settingsDefaultFilter: 'Default status filter on open',
          settingsOn: 'On',
          settingsOff: 'Off',
          settingsAccent: 'Accent color',
          settingsFontSize: 'Font size',
          settingsDefault: 'Default',
          settingsBlue: 'Blue',
          settingsPurple: 'Purple',
          settingsGreen: 'Green',
          settingsOrange: 'Orange',
          settingsRed: 'Red',
          trash: 'Trash',
          reload: 'Reload',
          loading: 'Loading…',
          emptyList: 'No tasks yet. Add one with the card below, or let the model call crabtodo_add.',
          emptyFilter: 'No tasks under this filter.',
          emptyTrashView: 'The trash is empty. Deleted tasks land here first.',
          noMatch: function (q) { return 'No tasks match "' + q + '".' },
          undo: 'Undo',
          restored: function (title) { return 'Restored: ' + title },
          deletedToast: function (title) { return 'Deleted' + (title ? ' "' + title + '"' : ' task') },
          deletedFallback: 'Task deleted',
          referenced: function (title) { return 'Referenced in composer: ' + title },
          noComposer: 'No session input to write to (bind a session to enable "add to conversation").',
          refFailed: function (err) { return 'Failed to add to conversation: ' + err },
          refMark: 'Referenced todos',
          refHeader: ' (from the dsh-crabtodo plugin\'s persistent task list; call crabtodo_list / crabtodo_update / crabtodo_done / crabtodo_remove and use the task IDs below to query or operate on these tasks):',
          refNone: '(none)',
          refTask: '- Task: ',
          refNotes: '  Notes: ',
          refStatus: 'Status: ',
          refPriority: 'Priority: ',
          refScope: 'Scope: ',
          refScopeProject: 'Project ',
          refScopeGlobal: 'Global',
          refTags: 'Tags: ',
          refId: '  Task ID: ',
          refSource: ' · Source: dsh-crabtodo plugin',
          markDone: 'Mark as done',
          markUndone: 'Mark as not done',
          clickEdit: 'Click to edit',
          clickCollapse: 'Click to collapse',
          clickExpand: 'Click to expand details',
          inProgressBadge: 'In progress',
          edit: 'Edit task',
          addToChatTip: 'Add to the conversation input',
          addToChat: 'Add to conversation',
          copyRef: 'Copy reference',
          copied: 'Reference copied',
          moveToGlobal: 'Move to global',
          moveToProject: 'Move to project',
          moveAria: 'Move task',
          markInProgress: 'Mark as in progress',
          remove: 'Delete task',
          moveTo: 'Move to',
          save: 'Save',
          cancel: 'Cancel',
          saveHint: 'Enter to save · Esc to cancel',
          titleRequired: 'Task title (required)',
          newTask: 'New task',
          addTaskAria: 'Add task',
          whatToDo: 'What needs doing? Press Enter to add',
          add: 'Add',
          notesOptional: 'Notes (optional)',
          priorityTitle: 'Priority',
          statusTitle: 'Status',
          tagsPlaceholder: 'Tags (space-separated)',
          tagsLibrary: 'Tag library',
          tagNewPlaceholder: 'New tag, press Enter',
          tagFilterTip: 'Filter by this tag',
          expandDetails: 'Expand details (notes, priority, status, tags)',
          expandDetailsAria: 'Expand details',
          collapseDetails: 'Collapse details',
          scopeUnresolved: 'No workspace resolved',
          scopeCurrentProject: 'Current project',
          deletedAt: 'Deleted at ',
          restore: 'Restore task',
          purge: 'Delete permanently',
          persistHint: 'A persistent todo list: survives sessions, shared between the model and this page',
          dlgDeleteTitle: 'Delete task',
          dlgDeleteDesc: function (title) { return '"' + title + '" moves to the trash and can be restored.' },
          dlgConfirmDelete: 'Delete',
          dlgPurgeTitle: 'Delete forever',
          dlgPurgeDesc: function (title) { return '"' + title + '" will be permanently deleted. This cannot be undone.' },
          dlgConfirmPurge: 'Delete forever',
          dlgEmptyTitle: 'Empty trash',
          dlgEmptyDesc: function (n) { return n + ' task(s) in the trash will be permanently deleted. This cannot be undone.' },
          dlgConfirmEmpty: 'Empty',
          dlgClose: 'Close',
          pin: 'Pin to top',
          unpin: 'Unpin',
          pinnedFlag: 'Pinned',
          searchPlaceholder: 'Search title / notes / tags…',
          searchAria: 'Search tasks',
          clearSearch: 'Clear search',
        }
        return LANG === 'zh' ? zh : en
      })()

      /**
       * User preferences for the panel, persisted per browser in localStorage.
       * These are VIEW preferences only — store path, tool exposure and the
       * rest are schema-owned host config in cordis.patch.yml, not something a
       * page should edit at runtime.
       */
      var PREFS_KEY = 'dsh-crabtodo:prefs'
      var PREFS_DEFAULT = {
        notesLines: 2,
        confirmDelete: true,
        startScope: 'project',
        startFilter: 'open',
        accent: 'default',
        fontSize: 13,
        animations: true,
        rightbarWidthPct: 45,
        floatMode: false,
        floatX: null,
        floatY: null,
        floatW: null,
        floatH: null,
        floatCollapsed: false,
      }
      /**
       * Appearance tables behind the settings page. The accent replaces the
       * theme's brand/primary fills inside THIS panel only (the override lives
       * on .ct-root), so the shell stays untouched. Size and family override
       * the theme's font shorthand vars the same way; the size values keep
       * `var(--dsw-font-family)` so a family pick still applies on top.
       */
      var ACCENT_COLORS = {
        blue: '#4f7cff',
        purple: '#8b5cf6',
        green: '#16a34a',
        orange: '#ea7a1a',
        red: '#e5484d',
      }
      // Font size is a plain px number (the settings stepper's range).
      var FONT_SIZE_MIN = 11
      var FONT_SIZE_MAX = 20

      /**
       * Fill the right panel's width from the preferred percentage.
       *
       * The host's layout store starts each session with rightbar: null, and
       * openRightbar then falls back to its built-in 45% of the frame — every
       * launch landed there again. This pre-fills the store once per session;
       * a later drag still wins, because nothing re-applies unless the
       * percentage itself changes. The width action lives on the store actions
       * behind ctx.layout (the controller forwards navigation only), so a host
       * that moves it degrades here to a no-op.
       */
      function applyRightbarWidth(ctx, prefs) {
        try {
          var pct = Number(prefs && prefs.rightbarWidthPct)
          if (!Number.isFinite(pct)) return
          pct = Math.min(65, Math.max(30, pct))
          var actions = ctx && ctx.layout && ctx.layout.panels
          if (!actions || typeof actions.setRightbar !== 'function') return
          if (typeof window === 'undefined' || !Number.isFinite(window.innerWidth)) return
          actions.setRightbar(Math.round(window.innerWidth * (pct / 100)))
        } catch (error) {}
      }

      /**
       * Session-level preference applier, installed by apply(). The settings
       * page calls it on every change; it only acts when the RIGHT PANEL
       * PERCENTAGE actually moved, so toggling unrelated settings never
       * stomps a width the user dragged by hand.
       */
      var prefsApplier = null
      /** Reads the on-screen session (key + composer verbs); installed by apply(). */
      var activeSession = null

      /**
       * Readable text colour for a fill: black-ish or white, whichever wins on
       * luminance. The theme's own pair (button-primary-fill /
       * label-primary-foreground) is correct per theme, but a custom accent
       * fill silently breaks the pairing — and small CJK labels looked washed
       * on the warm dark-theme fill regardless. Computing the pair at runtime
       * settles it for every fill.
       */
      function readableOn(colorText) {
        var rgb = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(colorText || '')
        var r
        var g
        var b
        if (rgb) {
          r = Number(rgb[1])
          g = Number(rgb[2])
          b = Number(rgb[3])
        } else {
          var hex = /^#?([0-9a-f]{6})$/i.exec(colorText || '')
          if (!hex) return null
          var n = parseInt(hex[1], 16)
          r = (n >> 16) & 255
          g = (n >> 8) & 255
          b = n & 255
        }
        // WCAG relative luminance: channels are linearised first, then
        // compared against both candidates by contrast ratio. A raw channel
        // average mis-picked mid-tone fills (orange wanted dark text).
        var lin = function (c) {
          var v = c / 255
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
        }
        var fill = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
        // A filled primary button wears a WHITE label — the product's own
        // light palette and every other filled button follow that convention.
        // Only a genuinely light fill switches to dark text; "max contrast"
        // math alone would put black on a blue accent and read as broken.
        return fill > 0.6 ? '#1c1c1e' : '#ffffff'
      }

      /**
       * The accent button's text colour for the CURRENT appearance.
       *
       * Dark mode: white, always — that is the product's dark-palette
       * expectation for filled primary buttons (a luminance pick put black on
       * a blue accent and read as broken). Light mode: contrast-computed
       * against whichever fill is in play — a custom accent hex is known by
       * value, the default one is resolved with a probe.
       */
      function accentForeground(accentHex) {
        try {
          if (typeof document === 'undefined' || !document.body) return null
          var dark =
            document.body.hasAttribute('data-ds-dark-theme') ||
            (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches)
          if (dark) return '#ffffff'
          if (accentHex) return readableOn(accentHex)
          var probe = document.createElement('i')
          probe.style.cssText =
            'position:absolute;visibility:hidden;pointer-events:none;color:var(--dsw-alias-button-primary-fill)'
          document.body.appendChild(probe)
          var fill = getComputedStyle(probe).color
          probe.remove()
          return readableOn(fill)
        } catch (error) {
          return null
        }
      }

      /**
       * Shared preference state — ONE source for every panel instance: the
       * session seat and the global float host both read and write it, so a
       * toggle thrown in one window is instantly true in the other.
       */
      var prefsStore = {
        value: loadPrefs(),
        listeners: new Set(),
        /** Apply, persist (browser cache + host), and fan out. */
        set: function (next) {
          prefsStore.value = next
          try {
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem(PREFS_KEY, JSON.stringify(next))
            }
          } catch (error) {}
          request('prefs', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(next),
          }).catch(function () {})
          prefsStore.listeners.forEach(function (listener) {
            listener(next)
          })
        },
        /** Adopt a value WITHOUT writing it back — the server's own copy. */
        adopt: function (next) {
          prefsStore.value = next
          prefsStore.listeners.forEach(function (listener) {
            listener(next)
          })
        },
      }

      /** Shared prefs state for one panel instance. */
      function useSharedPrefs() {
        var pair = useState(prefsStore.value)
        var value = pair[0]
        var setValue = pair[1]
        useEffect(function () {
          var listener = function (next) {
            setValue(next)
          }
          prefsStore.listeners.add(listener)
          // Catch up: the store may have moved while this instance mounted.
          setValue(prefsStore.value)
          return function () {
            prefsStore.listeners.delete(listener)
          }
        }, [])
        var set = useCallback(function (next) {
          prefsStore.set(next)
        }, [])
        return [value, set]
      }

      /** The panel root's style object: prefs in, CSS variable overrides out. */
      function rootStyleFor(prefs, accentText) {
        // The motion var turns every CSS animation/transition in the panel
        // into a no-op when animations are switched off in settings.
        var style = {
          '--ct-notes-lines': String(prefs.notesLines),
          '--ct-motion': prefs.animations ? '180ms' : '0s',
        }
        var accent = ACCENT_COLORS[prefs.accent]
        if (accent) {
          style['--dsw-alias-brand-primary'] = accent
          style['--dsw-alias-button-primary-fill'] = accent
          style['--dsw-alias-button-primary-hover'] = accent
        }
        if (accentText) {
          // The theme's foreground was tuned for ITS fill and mode — the
          // appearance-aware pick replaces it (white in dark mode).
          style['--ct-on-accent'] = accentText
        }
        // The px number scales both type tiers: the base tier at N, the
        // annotation tier one step under it, line heights kept generous.
        var size = Number(prefs.fontSize)
        if (Number.isFinite(size) && size > 0) {
          style['--dsw-font-xxs-12'] = size + 'px/' + (size + 6) + 'px var(--dsw-font-family)'
          style['--dsw-font-xxxs-11'] = (size - 1) + 'px/' + (size + 3) + 'px var(--dsw-font-family)'
        }
        return style
      }

      function loadPrefs() {
        var merged = {}
        try {
          var raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PREFS_KEY) : null
          if (raw) {
            var parsed = JSON.parse(raw)
            if (parsed && typeof parsed === 'object') merged = parsed
          }
        } catch (error) {}
        // No explicit choice yet: honour the OS motion preference as the
        // default — an explicit setting still overrides it either way.
        if (merged.animations === undefined) {
          try {
            if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
              merged.animations = false
            }
          } catch (error) {}
        }
        var merged2 = Object.assign({}, PREFS_DEFAULT, merged)
        // Legacy values (small/medium/large) and junk fall back to the default.
        if (!Number.isFinite(merged2.fontSize) || merged2.fontSize < FONT_SIZE_MIN - 2 || merged2.fontSize > FONT_SIZE_MAX + 4) {
          merged2.fontSize = PREFS_DEFAULT.fontSize
        }
        if (!Number.isFinite(merged2.rightbarWidthPct) || merged2.rightbarWidthPct < 25 || merged2.rightbarWidthPct > 75) {
          merged2.rightbarWidthPct = PREFS_DEFAULT.rightbarWidthPct
        }
        merged2.floatCollapsed = merged2.floatCollapsed === true
        if (!Number.isFinite(merged2.floatW) || merged2.floatW < 200 || merged2.floatW > 2000) merged2.floatW = null
        if (!Number.isFinite(merged2.floatH) || merged2.floatH < 120 || merged2.floatH > 2000) merged2.floatH = null
        return merged2
      }

      /**
       * The reference block's header, and the marker its first line starts with.
       *
       * The header appears once per draft and carries the two things the model
       * cannot infer from a bare task row: where the row came from (the
       * dsh-crabtodo plugin's persistent list, not the chat) and which tools
       * operate on it. Without that, the model reads a stray list and either
       * ignores it or invents a workflow around it.
       */
      var REFERENCE_MARK = STR.refMark
      var REFERENCE_HEADER = REFERENCE_MARK + STR.refHeader

      /**
       * One task as an explicit-field reference block for the composer.
       *
       * This text is read by the MODEL once sent, so every line is labelled and
       * self-contained: what the task is, its description, its state, and the id
       * the crabtodo_* tools take. The old one-liner left the model guessing
       * what it was holding and which tools (if any) could act on it.
       */
      function formatReference(task) {
        var notes = String((task && task.notes) || '').trim()
        var noteLines = (notes.length > 0 ? notes : STR.refNone).split('\n')
        var description = STR.refNotes + noteLines[0]
        for (var line = 1; line < noteLines.length; line++) {
          // Continuation lines stay inside the field instead of looking like
          // new fields of their own.
          description += '\n  ' + noteLines[line]
        }
        var bits = []
        bits.push(STR.refStatus + (STATUS_LABEL[task.status] || task.status))
        bits.push(STR.refPriority + (PRIORITY_LABEL[task.priority] || task.priority))
        bits.push(STR.refScope + (task.scope === 'project' ? STR.refScopeProject + (projectLabel(task.project) || '') : STR.refScopeGlobal))
        if (Array.isArray(task.tags) && task.tags.length > 0) {
          bits.push(
            STR.refTags +
              task.tags
                .map(function (tag) {
                  return '#' + tag
                })
                .join(' '),
          )
        }
        return [
          STR.refTask + task.title,
          description,
          '  ' + bits.join(' · '),
          STR.refId + task.id + STR.refSource,
        ].join('\n')
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
            label: STR.tabsLabel
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
      /** Localized labels for the wire enum values; the values never change. */
      var STATUS_LABEL = STR.status
      var PRIORITY_LABEL = STR.priority
      /** Filter chips; 'open' (unfinished work) is the useful default. */
      var FILTERS = [
        {
          id: 'open',
          label: STR.filters.open,
          iconName: 'IconChecklistOutlineRegular',
          test: function (task) { return task.status !== 'done' }
        },
        {
          id: 'all',
          label: STR.filters.all,
          iconName: 'IconFlatListOutlineRegular',
          test: function () { return true }
        },
        {
          id: 'in_progress',
          label: STR.filters.in_progress,
          iconName: 'IconClockOutlineRegular',
          test: function (task) { return task.status === 'in_progress' }
        },
        {
          id: 'done',
          label: STR.filters.done,
          iconName: 'IconCheckCircleOutlineRegular',
          test: function (task) { return task.status === 'done' }
        }
      ]

      /**
       * Scope tabs. Two scopes exist ('project' / 'global'); the third tab is a
       * view across both, not a third scope, so it is named 全部.
       */
      var SCOPE_TABS = [
        { id: 'project', label: STR.scopes.project },
        { id: 'global', label: STR.scopes.global },
        { id: 'all', label: STR.scopes.all }
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
        '.ct-root{position:relative;display:flex;flex-direction:column;box-sizing:border-box;height:100%;min-height:0;font:var(--dsw-font-xxs-12,12px/18px sans-serif);color:var(--dsw-alias-label-primary);background:transparent;overflow:hidden}',
        '.ct-host{position:relative;height:100%;min-height:0;display:flex;flex-direction:column}',

        // Header strip: counts + whole-list actions.
        '.ct-head{display:flex;align-items:center;gap:6px;padding:8px 10px 6px;flex:0 0 auto;min-width:0}',
        '.ct-count{font:var(--dsw-font-xxxs-11,11px/14px sans-serif);color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
        '.ct-spacer{flex:1 1 auto;min-width:0}',

        // Buttons and icon buttons.
        '.ct-btn{appearance:none;border:.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-11,11px/14px sans-serif);border-radius:var(--dsw-radius-sm,6px);padding:3px 7px;cursor:pointer;white-space:nowrap;flex:0 0 auto;display:inline-flex;align-items:center;gap:4px}',
        '.ct-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
        '.ct-btn[data-tone="accent"]{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--ct-on-accent,var(--dsw-alias-label-primary-foreground));font-weight:600}',
        // Disabled accent: mute the FILL and the TEXT separately toward the
        // surface instead of flattening the whole button with opacity — the
        // text kept its contrast and stayed readable while the button still
        // unmistakably reads as disabled. Falls back to the opacity look
        // wherever color-mix is unsupported.
        '.ct-btn[data-tone="accent"]:disabled{opacity:1;background:color-mix(in srgb, var(--dsw-alias-button-primary-fill) 42%, var(--dsw-alias-bg-base,#222));color:color-mix(in srgb, var(--ct-on-accent,var(--dsw-alias-label-primary-foreground)) 72%, var(--dsw-alias-bg-base,#222))}',
        // Hover changes the FILL only — the label keeps the computed contrast
        // colour. (Dropping back to the host's foreground token here is what
        // used to turn the text black on hover.)
        '.ct-btn[data-tone="accent"]:hover{background:var(--dsw-alias-button-primary-hover);color:var(--ct-on-accent,var(--dsw-alias-label-primary-foreground))}',
        '.ct-btn:disabled{opacity:.55;cursor:default}',
        '.ct-iconbtn{display:inline-flex;align-items:center;justify-content:center;padding:3px 6px;line-height:1;border-radius:var(--dsw-radius-xs,4px);flex:0 0 auto;cursor:pointer;border:.5px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary)}',
        '.ct-iconbtn:disabled{opacity:.4;cursor:default}',
        '.ct-ghost{border-color:transparent;background:transparent;color:var(--dsw-alias-label-tertiary)}',
        '.ct-ghost:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',

        // Add-task CARD: its own surface, hairline border, and a header row.
        // Composer card: raised above the list with a brighter surface, a real
        // elevation shadow and a stronger border, so it reads as a distinct
        // layer rather than another row.
                // Frosted glass: a translucent fill plus backdrop blur, so rows
        // scrolling under the composer stay visible as motion behind it. The
        // solid background is a fallback declaration — engines without
        // color-mix keep the opaque card.
        '.ct-card{display:flex;flex-direction:column;margin:8px 10px 10px;flex:0 0 auto;min-width:0;background:var(--dsw-alias-bg-layer-3);background:color-mix(in srgb, var(--dsw-alias-bg-layer-3) 72%, transparent);-webkit-backdrop-filter:blur(14px) saturate(1.15);backdrop-filter:blur(14px) saturate(1.15);border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg,10px);box-shadow:var(--dsw-elevation-panel);position:relative;z-index:2}',
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
        '.ct-card-detail{order:-1;display:grid;grid-template-rows:0fr;min-width:0;opacity:0;visibility:hidden;transition:grid-template-rows var(--ct-motion,220ms) ease,opacity var(--ct-motion,180ms) ease,visibility 0s linear var(--ct-motion,220ms)}',
        // One child owns the collapse: grid 0fr→1fr animates with the content's
        // real height (the old max-height:320px clip timed oddly and could
        // truncate a tall form), and visibility defers so hidden fields leave
        // the tab order only after the fold finishes.
        '.ct-card-detail-inner{display:flex;flex-direction:column;gap:6px;padding:0 9px;min-height:0;overflow:hidden;transition:padding var(--ct-motion,220ms) ease}',,
        '.ct-card[data-open="true"] .ct-card-detail{grid-template-rows:1fr;opacity:1;visibility:visible;transition:grid-template-rows var(--ct-motion,220ms) ease,opacity var(--ct-motion,180ms) ease,visibility 0s}',
        '.ct-card[data-open="true"] .ct-card-detail-inner{padding:8px 9px;border-bottom:.5px solid var(--dsw-alias-border-l1)}',,
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
        // The form row wraps, and the tag picker claims a full line ABOVE the
        // controls: chips are inherently multi-line, and sharing one flex line
        // with dropdowns and the tag input squeezed everything into overlap.
        '.ct-form-row{display:flex;gap:6px;align-items:center;min-width:0;flex-wrap:wrap}',
        '.ct-form-row .ct-tagpicker{order:-1;flex:1 0 100%;width:100%}',
        '.ct-hint{font:var(--dsw-font-xxxs-11,11px/14px sans-serif);color:var(--dsw-alias-label-tertiary);margin-left:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',

        // Filter chips.
        // One filter bar: the scope chips hug their labels instead of
        // stretching across the panel, and the search box fills the rest of
        // the row. Two 2-char filters and a field do not need two rows.
        '.ct-bar{display:flex;align-items:center;gap:8px;padding:0 10px 6px;flex:0 0 auto;min-width:0}',
        '.ct-scopes{display:flex;gap:0;flex:0 0 auto;min-width:0}',
        '.ct-scope{flex:0 0 auto;appearance:none;border:.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxxs-11,11px/14px sans-serif);padding:3px 9px;cursor:pointer;white-space:nowrap}',
        '.ct-scope:first-child{border-start-start-radius:var(--dsw-radius-sm,6px);border-end-start-radius:var(--dsw-radius-sm,6px)}',
        '.ct-scope:last-child{border-start-end-radius:var(--dsw-radius-sm,6px);border-end-end-radius:var(--dsw-radius-sm,6px)}',
        '.ct-scope+.ct-scope{border-inline-start-width:0}',
        '.ct-scope:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
        // NO font-weight change on the active chip: a state-driven weight
        // flip re-runs CJK glyph fallback on Windows, and the characters
        // visibly swap typeface as tabs switch. The active chip is carried by
        // fill and colour alone, so the glyphs never re-render in another font.
        '.ct-scope[data-active="true"]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}',

        // Status tabs: the product's SegmentedTabs, framed by this container.
        // Light mode dissolves this control's own edges: its track paints
        // bg-module-platform (≈ the page) and its sliding pill borders with
        // the faintest alias. Re-shell it from the wrapper: the track goes
        // transparent (its vars are overridden inside .ct-tabs), and OUR box
        // draws a real border + a tinted track surface, so the control reads
        // in both themes. The pill's border is strengthened the same way, and
        // its fill is the interactive-active grey — the same light grey the
        // scope chips use when selected, so active states read alike everywhere.
        '.ct-tabs{flex:0 0 auto;min-width:0;padding:0 2px;--dsw-alias-bg-module-platform:transparent;--dsw-alias-border-l3:var(--dsw-alias-border-l2);--dsw-alias-bg-layer-3:var(--dsw-alias-interactive-bg-active);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,10px);background:var(--dsw-alias-bg-layer-2)}',
        // The primitive gives every tab an equal quarter of the row; in a narrow
        // panel that quarter is smaller than the label, and the CJK text broke
        // mid-word (进行/中). Nowrap plus a slightly smaller label keeps all
        // four on one line down to very narrow panels.
        '.ct-tabs [role="tab"]{white-space:nowrap}',
        // NO font-weight change on the selected tab — the same CJK hazard as
        // the scope chips, plus a second effect: bold metrics widen the grid
        // column, so every label shifts when the selection moves (the visible
        // "jitter"). The grey pill and the colour carry the state instead.
        '.ct-tabs [role="tab"][aria-selected="true"]{font-weight:inherit}',
        '.ct-tab-label{display:inline-flex;align-items:center;gap:5px;line-height:1;white-space:nowrap;font-size:13px}',
        '.ct-tab-label svg{width:14px;height:14px}',

        // Filter chips (fallback only, when the host lacks SegmentedTabs).
        '.ct-filters{display:flex;gap:2px;padding:0 10px 6px;flex:0 0 auto;flex-wrap:wrap}',
        '.ct-chip{border:.5px solid transparent;background:transparent;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxxs-11,11px/14px sans-serif);border-radius:999px;corner-shape:round;padding:3px 9px;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:4px;line-height:1}',
        '.ct-chip-label{line-height:1}',
        '.ct-chip:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}',
        '.ct-chip[data-active="true"]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-active);border-color:var(--dsw-alias-border-l2)}',

        // Task rows.
        '.ct-list{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding:0 10px 96px}',
        // Row shell. The actions column is `flex:0 0 auto`, so the body is what
        // shrinks; keeping `nowrap` stops the action buttons from being pushed
        // onto their own line when the panel is narrow (they used to wrap and
        // leave a tall, airy row).
        // Row shell. The action buttons are absolutely positioned over the row's
        // top-right, NOT in the flow: if they were, the title would get narrower
        // whenever they faded in on hover, and the whole row would visibly jump.
        '.ct-item{display:flex;flex-wrap:nowrap;gap:6px;align-items:flex-start;padding:6px 0;border-bottom:.5px solid var(--dsw-alias-border-l1);min-width:0;position:relative}',
        '.ct-check{margin:1px 0 0;width:14px;height:14px;flex:0 0 auto;cursor:pointer;accent-color:var(--dsw-alias-brand-primary)}',
        '.ct-body{flex:1 1 auto;min-width:0;display:block}',
        '.ct-row{display:flex;align-items:flex-start;gap:5px;min-width:0}',
        // The title carries the row: weight 600 lifts it clear of the quiet
        // notes line below, so the eye reads titles first and details second.
        // The task title is the row's anchor: one tier ABOVE everything the notes
        // contain — larger than body and in-notes headings, heavier than
        // in-notes emphasis, with a touch of tracking to read as a heading.
        '.ct-text{flex:1 1 auto;min-width:0;overflow-wrap:break-word;text-wrap:pretty;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;font-weight:700;letter-spacing:.01em}',
        '.ct-item[data-status="done"] .ct-text{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}',
        '.ct-item[data-status="in_progress"] .ct-text{font:var(--dsw-font-xxs-12,12px/18px sans-serif);font-weight:600;color:var(--dsw-alias-label-primary)}',
        '.ct-text[role="button"]{cursor:text;border-radius:var(--dsw-radius-xs,4px)}',
        '.ct-text[role="button"]:hover{text-decoration:underline dotted;text-underline-offset:3px}',
        '.ct-text[role="button"]:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
        // Notes clamp to two lines: a four-line note per row breaks the
        // list's rhythm and buries the rows below it. The full text lives on
        // the hover tooltip and in the row editor.
        // Notes carry ONE typography — collapsed and expanded identical. The
        // click to expand used to swap size, colour and leading at once, which
        // read as "the font changed"; now the toggle only reveals more text
        // and the rich shapes. Hierarchy comes from the title's own tier.
        '.ct-notes{margin-top:2px;font:var(--dsw-font-xxs-12,12px/18px sans-serif);line-height:1.7;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:var(--ct-notes-lines,2);-webkit-box-orient:vertical;overflow:hidden}',

        // Notes detail view. The expanded state drops the clamp and renders
        // the Markdown whitelist; everything unknown stays literal text.
        '.ct-notes-collapsed{cursor:pointer}',
        // Notes typography (expanded view): 12px at 1.75 leading and a
        // primary body colour — the old 11px/1.27 with tertiary grey read as
        // one dense dim block. The size rides the --dsw-font token, so the
        // settings' font-size knob keeps scaling it.
        '.ct-md{display:block;overflow:visible;cursor:pointer;overflow-wrap:anywhere}',
        '.ct-md p{margin:5px 0}',
        '.ct-md> :first-child{margin-top:0}',
        '.ct-md> :last-child{margin-bottom:0}',
        '.ct-md ul{margin:6px 0;padding-inline-start:16px}',
        '.ct-md li{margin:3px 0}',
        '.ct-md li::marker{color:var(--dsw-alias-label-secondary);font-size:.85em}',
        '.ct-md a{color:var(--dsw-alias-brand-primary);text-decoration:underline}',
        '.ct-md strong{font-weight:600;color:var(--dsw-alias-label-primary)}',
        '.ct-md em{font-style:italic}',
        // Meta line: one quiet typographic row — scope, priority, tags — at
        // 10px, clearly below the notes in the hierarchy. Hairline dot
        // separators split the groups; priority keeps its semantic colour as
        // text (the pill was the only box left and read as noise).
        '.ct-meta{display:flex;gap:0;flex-wrap:wrap;margin-top:3px;align-items:center;font-size:10px;line-height:14px}',
        '.ct-meta>*+*::before{content:"·";color:var(--dsw-alias-label-tertiary);opacity:.55;margin:0 4px}',
        '.ct-meta .ct-pri{border:0;padding:0;border-radius:0;font-size:inherit;font-weight:600}',
        '.ct-tags{display:inline-flex;gap:4px;min-width:0;flex-wrap:wrap}',
        // Meta chips were the row's noise source: eight rows carried twenty
        // little boxes. The scope and the tags read as one quiet grey line
        // now; only the priority keeps its semantic colour pill.
        '.ct-scope-tag{font:inherit;color:var(--dsw-alias-label-secondary);white-space:nowrap;max-width:11em;overflow:hidden;text-overflow:ellipsis}',
        '.ct-move{flex:0 0 100%;display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin:4px 0 2px 21px;padding:5px 7px;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,6px)}',
        '.ct-move-label{font:var(--dsw-font-xxxs-11,11px/14px sans-serif);color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
        '.ct-move-opt{appearance:none;border:.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-11,11px/14px sans-serif);border-radius:var(--dsw-radius-xs,4px);padding:2px 7px;cursor:pointer;white-space:nowrap;max-width:9em;overflow:hidden;text-overflow:ellipsis}',
        '.ct-move-opt:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
        '.ct-move-opt[data-active="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);font-weight:600}',
        '.ct-move-opt:disabled{opacity:.45;cursor:default}',
        '.ct-move-cancel{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxxs-11,11px/14px sans-serif);padding:2px 4px;cursor:pointer;margin-left:auto}',
        '.ct-move-cancel:hover{color:var(--dsw-alias-label-primary)}',
        '.ct-tag{font:inherit;color:var(--dsw-alias-label-tertiary);white-space:nowrap}',

        // Priority pills use the semantic state colours (theme-aware).
        '.ct-pri{font:var(--dsw-font-xxxs-11,11px/14px sans-serif);border-radius:999px;corner-shape:round;padding:0 6px;border:.5px solid currentColor;white-space:nowrap}',
        '.ct-pri[data-p="urgent"]{color:var(--dsw-alias-state-error-primary)}',
        '.ct-pri[data-p="high"]{color:var(--dsw-alias-state-warn-primary)}',
        '.ct-pri[data-p="low"]{color:var(--dsw-alias-label-tertiary)}',

        // Row actions: revealed on hover/focus, always visible on touch.
        // Overlay buttons: absolutely positioned so their fade-in never reflows
        // the row. The strip carries its own solid backing, so the text tail
        // under it reads as cleanly covered instead of showing through.
        '.ct-actions{position:absolute;top:5px;right:2px;display:flex;gap:1px;opacity:0;transition:opacity var(--ct-motion,120ms);flex:0 0 auto;padding:2px 4px;border-radius:var(--dsw-radius-xs,4px);background:var(--dsw-alias-bg-base,#111)}',
        '.ct-item:hover .ct-actions,.ct-item:focus-within .ct-actions{opacity:1}',
        '@media (hover:none){.ct-actions{opacity:1}}',
        // Touch devices have no hover: the buttons must occupy real space so
        // they do not permanently cover the title's end.
        '@media (hover:none){.ct-item .ct-body{padding-right:76px}}',
        '.ct-icon{display:inline-flex;align-items:center;justify-content:center;appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;border-radius:var(--dsw-radius-xs,4px);padding:1px 2px;line-height:1}',
        '.ct-icon:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
        '.ct-icon:disabled{opacity:.4;cursor:default}',
        '.ct-icon[data-active="true"]{color:var(--dsw-alias-brand-primary)}',

        // Destructive dialog. The danger tone reuses the semantic error
        // colour; the action row is shared by the host Modal's footer and the
        // self-drawn fallback, whose mask/card styles live here too.
        '.ct-btn[data-tone="danger"]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
        '.ct-dlg-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}',
        // The mask is inset:0 against .ct-root — the dialog centres INSIDE
        // the sidebar panel and the scrim only covers it; the rest of the
        // window stays untouched. (A body-portalled page-centre modal put the
        // question far away from the click that asked it.)
        '.ct-dlg-mask{position:absolute;inset:0;z-index:1000;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center}',
        '.ct-dlg-card{width:min(360px,86vw);box-sizing:border-box;padding:16px;border-radius:var(--dsw-radius-lg,10px);background:var(--dsw-alias-bg-layer-3);border:.5px solid var(--dsw-alias-border-l3);box-shadow:var(--dsw-elevation-panel)}',
        '.ct-dlg-title{font:var(--dsw-font-xxs-12,12px/18px sans-serif);font-weight:600;color:var(--dsw-alias-label-primary);margin-bottom:6px}',
        '.ct-dlg-desc{font:var(--dsw-font-xxxs-11,11px/14px sans-serif);color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',

        '.ct-pin-flag{font-size:10px;line-height:14px}',

        // Drag to reorder: the row is the grab target, a hairline accent marks
        // the landing edge, and the row in flight is ghosted.
        '.ct-item{cursor:grab}',
        '.ct-item[data-dragging="true"]{opacity:.5}',
        '.ct-item[data-drop="above"]{box-shadow:inset 0 2px 0 var(--dsw-alias-brand-primary)}',
        '.ct-item[data-drop="below"]{box-shadow:inset 0 -2px 0 var(--dsw-alias-brand-primary)}',

        // Trash view: dim the row, pin its actions open (there is nothing to
        // hover-reveal — the two exits ARE the view), and style the undo link.
        '.ct-item[data-deleted="true"] .ct-text{color:var(--dsw-alias-label-tertiary)}',
        '.ct-actions[data-pinned="true"]{opacity:1}',
        '.ct-toast-undo{margin-left:8px;appearance:none;border:0;background:transparent;color:var(--dsw-alias-brand-primary);cursor:pointer;font:inherit;text-decoration:underline;padding:0}',

        // Search row under the status tabs: a quiet field, same shape as the
        // create card's input, filtering in memory as the user types.
        '.ct-search{flex:1 1 auto;display:flex;align-items:center;min-width:88px}',
        '.ct-search-box{flex:1 1 auto;display:flex;align-items:center;gap:5px;padding:0 8px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-tertiary);min-width:0}',
        '.ct-search-box:focus-within{border-color:var(--dsw-alias-brand-primary)}',
        '.ct-search-input{flex:1 1 auto;min-width:0;appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxxs-11,11px/14px sans-serif);padding:4px 0;outline:none}',
        '.ct-search-clear{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font:var(--dsw-font-xxs-12,12px/18px sans-serif);line-height:1;padding:0 2px}',
        '.ct-search-clear:hover{color:var(--dsw-alias-label-primary)}',

        // Settings page: one quiet row per preference, chip groups as the
        // control — the same visual language as the scope tabs.
        '.ct-settings{flex:1 1 auto;min-height:0;overflow-y:auto;padding:2px 10px 96px;box-sizing:border-box}',
        '.ct-set-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:.5px solid var(--dsw-alias-border-l1)}',
        '.ct-set-label{font:var(--dsw-font-xxxs-11,11px/14px sans-serif);color:var(--dsw-alias-label-secondary);min-width:0}',
        '.ct-set-options{display:flex;gap:0;flex:0 0 auto}',
        '.ct-set-opt{appearance:none;border:.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxxs-11,11px/14px sans-serif);padding:2px 9px;cursor:pointer;white-space:nowrap}',
        '.ct-set-opt:first-child{border-start-start-radius:var(--dsw-radius-sm,6px);border-end-start-radius:var(--dsw-radius-sm,6px)}',
        '.ct-set-opt:last-child{border-start-end-radius:var(--dsw-radius-sm,6px);border-end-end-radius:var(--dsw-radius-sm,6px)}',
        '.ct-set-opt+.ct-set-opt{border-inline-start-width:0}',
        '.ct-set-opt[data-active="true"]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}',
        '.ct-set-opt:disabled{opacity:.4;cursor:default}',
        '.ct-set-input{width:52px;box-sizing:border-box;text-align:center;padding:3px 4px;font:var(--dsw-font-xxxs-11,11px/14px sans-serif);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:0;border-top:.5px solid var(--dsw-alias-border-l2);border-bottom:.5px solid var(--dsw-alias-border-l2);outline:none}',
        '.ct-set-input:focus{border-color:var(--dsw-alias-brand-primary)}',
        '.ct-set-value{display:inline-flex;align-items:center;justify-content:center;min-width:44px;padding:2px 8px;font:var(--dsw-font-xxxs-11,11px/14px sans-serif);color:var(--dsw-alias-label-primary);border-top:.5px solid var(--dsw-alias-border-l2);border-bottom:.5px solid var(--dsw-alias-border-l2);box-sizing:border-box;white-space:nowrap}',
        '.ct-set-swatch-row{display:inline-flex;align-items:center;gap:5px}',
        '.ct-set-swatch{width:9px;height:9px;border-radius:50%;display:inline-block;flex:0 0 auto}',
        '.ct-set-swatch[data-default="true"]{background:transparent;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2)}',

        '.ct-empty{padding:22px 4px;text-align:center;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12,12px/18px sans-serif)}',

        // A real toast: floats OVER the list instead of occupying a row. It
        // used to sit in the flex column, so every confirmation shoved the
        // whole list down and back up when it faded. It rises from just above
        // the composer card — anchored to the card's top edge, not to a magic
        // offset, so it stays above the card whatever height the form takes.
                // The composer floats: the foot is pinned over the bottom of the
        // panel and the list scrolls beneath it — content passes under the
        // card and shows through its frosted glass.
        // Floating mode: the panel leaves the sidebar as a fixed, draggable,
        // resizable glass card over the whole window. The same content tree
        // renders inside it (one .ct-root keeps every layout rule), and the
        // sidebar body shows a stub that recalls it.
        '.ct-float{position:fixed;z-index:900;left:0;top:0;width:min(420px,calc(100vw - 24px));height:min(580px,calc(100vh - 48px));display:flex;flex-direction:column;border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-2);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 88%,transparent);-webkit-backdrop-filter:blur(18px) saturate(1.2);backdrop-filter:blur(18px) saturate(1.2);border:.5px solid var(--dsw-alias-border-l3);box-shadow:0 18px 48px rgba(0,0,0,.42);resize:both}',
        '.ct-float-head{display:flex;align-items:center;gap:6px;padding:8px 10px;cursor:grab;user-select:none;-webkit-user-select:none;flex:0 0 auto;border-bottom:.5px solid var(--dsw-alias-border-l1)}',
        '.ct-float-head:active{cursor:grabbing}',
        // Collapsed: the card folds to its title bar — still draggable, still
        // resumable, just out of the way. These are the stable END states;
        // the fold itself is animated from JS (an inline height + a one-shot
        // transition) so the resize handle never fights a CSS transition.
        '.ct-float-head{height:38px;box-sizing:border-box;padding:0 10px}',
        '.ct-float[data-collapsed="true"]{height:38px;resize:none}',
        '.ct-float[data-collapsed="true"] .ct-float-body{display:none}',
        '.ct-float-title{font:var(--dsw-font-xxs-12,12px/18px sans-serif);font-weight:600;color:var(--dsw-alias-label-primary);white-space:nowrap}',
        '.ct-float-body{flex:1 1 auto;min-height:0;position:relative}',
        '.ct-stub{margin:10px;padding:14px;border-radius:var(--dsw-radius-lg,10px);border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);display:flex;align-items:center;gap:8px;font:var(--dsw-font-xxxs-11,11px/14px sans-serif);color:var(--dsw-alias-label-secondary)}',
        '.ct-foot{position:absolute;bottom:0;left:0;right:0;z-index:3;min-width:0}',
        // Every message — errors included — lives in one stack rising from the
        // composer's top edge. Nothing takes a row, the list never jumps, and
        // when several messages coexist they stack instead of overlapping.
        // The stack itself ignores the pointer so the sliver of list behind it
        // stays clickable; each message takes its own events back.
        '.ct-msgs{position:absolute;bottom:100%;left:0;right:0;z-index:5;margin:0 10px 6px;display:flex;flex-direction:column;gap:6px;pointer-events:none}',
        '.ct-msgs>*{pointer-events:auto}',
        '@keyframes ct-toast-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}',
        // Every motion duration runs through --ct-motion, so the settings
        // toggle turns the whole panel's animation off in one var. Row enter
        // and slide live in the FLIP effect (JS), not in mount-keyed CSS.
        '.ct-toast{margin:0;padding:6px 10px;border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-3);border:.5px solid var(--dsw-alias-border-l3);box-shadow:var(--dsw-elevation-panel);color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-11,11px/14px sans-serif);overflow-wrap:anywhere;animation:ct-toast-in var(--ct-motion,160ms) ease}',
        '.ct-error{margin:0;padding:6px 8px;border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);font:var(--dsw-font-xxxs-11,11px/14px sans-serif);overflow-wrap:anywhere;flex:0 0 auto}',

        // Block shapes for the notes markdown whitelist (renderMarkdown):
        // headings, fenced code, quotes and rules sized for the row, not for
        // a document — the notes stay scannable at list density.
        // In-notes headings stay clearly BELOW the row title: body size, bold,
        // spaced — distinct from inline strong by standing alone with margins.
        '.ct-md h1,.ct-md h2,.ct-md h3{font-size:12px;line-height:19px;font-weight:600;color:var(--dsw-alias-label-primary);margin:9px 0 4px}',
        '.ct-md h4,.ct-md h5,.ct-md h6{font-size:12px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-secondary);margin:7px 0 3px}',
        '.ct-md pre{margin:6px 0;padding:8px 10px;border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-1));border:.5px solid var(--dsw-alias-border-l1);overflow-x:auto;max-height:260px;overflow-y:auto}',
        '.ct-md pre code{font-family:var(--dsw-font-mono,ui-monospace,Consolas,monospace);font-size:11px;line-height:17px;white-space:pre;padding:0;color:var(--dsw-alias-label-primary)}',
        // Inline code: a soft chip that interrupts the line as little as
        // possible — 1px vertical padding so wrapped lines breathe.
        '.ct-md code{font-family:var(--dsw-font-mono,ui-monospace,Consolas,monospace);font-size:11px;line-height:inherit;padding:1px 4px;border-radius:4px;background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary)}',
        '.ct-md blockquote{margin:6px 0;padding:2px 0 2px 10px;border-left:2px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}',
        '.ct-md hr{border:0;height:.5px;background:var(--dsw-alias-border-l1);margin:8px 0}',
        '.ct-md ol{margin:6px 0;padding-left:18px}',
        // Tag vocabulary: pickers in forms, clickable tags on rows.
        '.ct-tagpicker{display:flex;flex-wrap:wrap;gap:4px;min-width:0;max-width:100%}',
        '.ct-form-row .ct-tagpicker{max-height:64px;overflow-y:auto}',
        '.ct-tagpicker .ct-tag{cursor:pointer}',
        '.ct-tag.ct-picked{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}',
        '.ct-tags .ct-tag{cursor:pointer}',
        '.ct-tags .ct-tag:hover{text-decoration:underline dotted;text-underline-offset:2px}',
        // Row context menu: a small elevated menu at the pointer.
        '.ct-ctxmask{position:fixed;inset:0;z-index:1100}',
        '.ct-ctxmenu{position:fixed;z-index:1101;min-width:184px;padding:4px;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-2);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 96%,transparent);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);box-shadow:var(--dsw-elevation-panel);transform-origin:top left;animation:ct-ctx-in var(--ct-motion,180ms) cubic-bezier(.2,.8,.2,1) both}',
        // Closing is a state, not an unmount: the exit runs first and the
        // element leaves afterwards (fill mode holds it invisible).
        '.ct-ctxmenu[data-closing="true"]{animation:ct-ctx-out calc(var(--ct-motion,180ms) * .65) ease both}',
        '@keyframes ct-ctx-in{from{opacity:0;transform:scale(.96) translateY(-3px)}to{opacity:1;transform:none}}',
        '@keyframes ct-ctx-out{from{opacity:1;transform:none}to{opacity:0;transform:scale(.97)}}',
        '.ct-ctxitem{display:flex;align-items:center;gap:8px;width:100%;padding:5px 10px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxxs-11,11px/14px sans-serif);cursor:pointer;text-align:left;white-space:nowrap}',
        '.ct-ctxitem:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.ct-ctxitem[data-danger="true"]{color:var(--dsw-alias-state-error-primary)}',
        '.ct-ctxsep{height:.5px;background:var(--dsw-alias-border-l1);margin:4px 6px;flex:0 0 auto}',
        // The cursor card for a task drag: a small glass chip that replaces
        // the browser's default row ghost. It is snapshotted once at dragstart,
        // so it paints off-screen and setDragImage picks it up.
        '.ct-dragcard{position:fixed;left:0;top:0;z-index:10000;will-change:transform;display:flex;flex-direction:column;gap:3px;max-width:280px;padding:8px 11px;background:var(--dsw-alias-bg-layer-2);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 92%,transparent);border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.35);font:var(--dsw-font-xxs-12,12px/18px sans-serif);pointer-events:none}',
        '.ct-dragcard-title{color:var(--dsw-alias-label-primary);overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
        '.ct-dragcard-meta{display:flex;align-items:center;gap:6px;font:var(--dsw-font-xxxs-11,11px/14px sans-serif);color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden}',
        '.ct-dragcard .ct-meta{display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden}',
        // In-place row editor.
        '.ct-item.ct-editing{display:block;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,6px);padding:8px;margin:6px 0}',
        '.ct-form{display:flex;flex-direction:column;gap:6px;min-width:0}',
      ].join('')

      /**
       * Drag-a-task-into-the-conversation bridge. While one of our rows is
       * being dragged, drops over the composer (or anywhere outside the
       * panel) carry the task's reference block into the draft — the same
       * semantics as the 💬 button, reached by gesture. Reorder drops stay
       * untouched: they land INSIDE the list and are handled by the rows.
       */
      var taskDrag = null
      var dragBridgeInstalled = false

      /** Write a task's reference block into the on-screen composer draft. */
      function pushTaskToComposer(task) {
        var session = typeof activeSession === 'function' ? activeSession() : null
        if (!session || !session.inputActions || typeof session.inputActions.setDraft !== 'function') return false
        var block = formatReference(task)
        var header = '引用待办：'
        var draft = typeof session.readDraft === 'function' ? session.readDraft() : ''
        var text
        if (!draft.trim()) {
          text = header + '\n' + block
        } else {
          // Already the draft's first block? Then this is a duplicate drop.
          var existing = draft.slice(0, (header + '\n' + block).length).replace(/\s+$/, '')
          if (existing === header + block) return true
          text = draft.replace(/\s+$/, '') + '\n' + header + '\n' + block
        }
        session.inputActions.setDraft(text)
        return true
      }

      /** The current drag-card element, if any. */
      var dragCardEl = null
      /** Where the cursor holds the card (px within the card) — the grab point. */
      var dragCardGrab = { x: 18, y: 18 }

      /** Flip one tag in a space-separated tag field value. */
      function toggleTagWord(value, tag) {
        var words = String(value || '').split(/\s+/).filter(Boolean)
        var at = words.indexOf(tag)
        if (at >= 0) words.splice(at, 1)
        else words.push(tag)
        return words.join(' ')
      }

      /**
       * TagPicker: the vocabulary as toggleable chips over a form's tag field.
       * Clicking flips the tag in the field; the field stays plain text, so
       * free typing keeps working and new words simply join the vocabulary
       * when the form registers them.
       */
      function TagPicker(props) {
        var selected = String(props.value || '').split(/\s+/).filter(Boolean)
        var tags = props.tags || []
        if (tags.length === 0) return null
        return h(
          'div',
          { className: 'ct-tagpicker' },
          tags.map(function (tag) {
            var on = selected.indexOf(tag) >= 0
            return h(
              'button',
              {
                key: tag,
                type: 'button',
                className: on ? 'ct-tag ct-picked' : 'ct-tag',
                'data-active': String(on),
                title: tag,
                onClick: function () {
                  props.onToggle(tag)
                }
              },
              '#' + tag,
            )
          }),
        )
      }

      /**
       * The row context menu — the row's own verbs at the pointer, the place
       * right-handed users actually look. Clamped into the viewport; closed
       * by outside click, Esc, or picking an item.
       */
      function ContextMenu(props) {
        var close = props.onClose
        var closingRef = useRef(false)
        var closingPair = useState(false)
        var closing = closingPair[0]
        var setClosing = closingPair[1]
        // Two-phase close: play the exit, then unmount. The exit's fill mode
        // keeps the menu invisible afterwards, so a fixed grace period is
        // safe even with animations switched off (0s ends instantly).
        var requestClose = useCallback(
          function () {
            if (closingRef.current) return
            closingRef.current = true
            setClosing(true)
            setTimeout(function () {
              close()
            }, 150)
          },
          [close],
        )
        useEffect(
          function () {
            var onKey = function (event) {
              if (event.key === 'Escape') {
                event.preventDefault()
                requestClose()
              }
            }
            document.addEventListener('keydown', onKey)
            return function () {
              document.removeEventListener('keydown', onKey)
            }
          },
          [requestClose],
        )
        var vw = typeof window !== 'undefined' && Number.isFinite(window.innerWidth) ? window.innerWidth : 1200
        var vh = typeof window !== 'undefined' && Number.isFinite(window.innerHeight) ? window.innerHeight : 800
        var left = Math.max(8, Math.min(props.x, vw - 200))
        var top = Math.max(8, Math.min(props.y, vh - 250))
        var item = function (key, label, iconName, run, danger) {
          return h(
            'button',
            {
              key: key,
              type: 'button',
              className: 'ct-ctxitem',
              'data-danger': danger ? 'true' : 'false',
              onClick: function () {
                requestClose()
                run()
              }
            },
            icon(iconName, 13),
            h('span', null, label),
          )
        }
        var task = props.task
        var items = []
        items.push(item('edit', STR.edit, 'IconEditOutlineRegular', props.onEdit))
        if (props.canChat) items.push(item('chat', STR.addToChat, 'IconNewChatOutlineRegular', props.onAddToChat))
        items.push(item('copy', STR.copyRef, 'IconCopyOutlineRegular', props.onCopyRef))
        items.push(h('div', { key: 'sep1', className: 'ct-ctxsep' }))
        items.push(item('pin', task.pinned ? STR.unpin : STR.pin, task.pinned ? 'IconPinFillRegular' : 'IconPinOutlineRegular', props.onTogglePinned))
        if (task.status !== 'in_progress') items.push(item('doing', STR.markInProgress, 'IconAlarmClockOutlineRegular', props.onMarkDoing))
        items.push(item('done', task.status === 'done' ? STR.markUndone : STR.markDone, 'IconChecklistOutlineRegular', props.onToggleDone))
        items.push(h('div', { key: 'sep2', className: 'ct-ctxsep' }))
        items.push(item('del', STR.remove, 'IconTrashOutlineRegular', props.onAskDelete, true))
        return h(
          'div',
          {
            className: 'ct-ctxmask',
            onClick: requestClose,
            onContextMenu: function (event) {
              event.preventDefault()
              requestClose()
            }
          },
          h(
            'div',
            {
              className: 'ct-ctxmenu',
              'data-closing': String(closing === true),
              style: { left: left + 'px', top: top + 'px' }
            },
            items,
          ),
        )
      }

      /** A 1x1 transparent canvas: handed to setDragImage to hide the native ghost. */
      var dragPixel = null

      /**
       * The cursor card is SELF-DRAWN. The engine's setDragImage ghost proved
       * unreliable in this shell (two rounds of standard recipes produced the
       * default row ghost), so: hide the native ghost with a transparent
       * pixel and drive the card's position from dragover coordinates — the
       * same path every manual drag avatar uses.
       */
      function showDragCard(event, task) {
        try {
          if (dragCardEl && dragCardEl.parentNode) dragCardEl.parentNode.removeChild(dragCardEl)
          if (!dragPixel) {
            try {
              dragPixel = document.createElement('canvas')
              dragPixel.width = 1
              dragPixel.height = 1
            } catch (error) {}
          }
          if (dragPixel) {
            try {
              event.dataTransfer.setDragImage(dragPixel, 0, 0)
            } catch (error) {}
          }
          var el = document.createElement('div')
          el.className = 'ct-dragcard'
          var title = document.createElement('div')
          title.className = 'ct-dragcard-title'
          title.textContent = typeof task.title === 'string' ? task.title : ''
          el.appendChild(title)
          // The meta row mirrors the list row field-for-field (and reuses
          // the row's own classes, so the two never drift apart). Its own
          // failure boundary: the title card still beats no card at all.
          try {
            var meta = document.createElement('div')
            meta.className = 'ct-meta'
            if (task.pinned) {
              var pin = document.createElement('span')
              pin.className = 'ct-pin-flag'
              pin.textContent = '📌'
              meta.appendChild(pin)
            }
            var scope = document.createElement('span')
            scope.className = 'ct-scope-tag'
            scope.textContent =
              task.scope === 'project' ? projectLabel(task.project) || STR.scopes.project : STR.scopes.global
            meta.appendChild(scope)
            if (task.status === 'in_progress') {
              var doing = document.createElement('span')
              doing.className = 'ct-pri'
              doing.setAttribute('data-p', 'high')
              doing.textContent = STR.inProgressBadge
              meta.appendChild(doing)
            }
            if (task.priority && task.priority !== 'normal') {
              var pri = document.createElement('span')
              pri.className = 'ct-pri'
              pri.setAttribute('data-p', task.priority)
              pri.textContent = PRIORITY_LABEL[task.priority] || task.priority
              meta.appendChild(pri)
            }
            ;(task.tags || []).forEach(function (tag) {
              var tagEl = document.createElement('span')
              tagEl.className = 'ct-tag'
              tagEl.textContent = '#' + tag
              meta.appendChild(tagEl)
            })
            el.appendChild(meta)
          } catch (error) {}
          document.body.appendChild(el)
          dragCardEl = el
          // Hold the card where the row was held: the press point within the
          // row maps to the same fraction of the card, so the cursor sits
          // inside the card exactly where the user grabbed — the object
          // follows the hand instead of trailing at a corner.
          try {
            var rowRect =
              event.currentTarget && typeof event.currentTarget.getBoundingClientRect === 'function'
                ? event.currentTarget.getBoundingClientRect()
                : null
            if (rowRect && rowRect.width > 0 && rowRect.height > 0) {
              var fx = Math.min(0.95, Math.max(0.05, (event.clientX - rowRect.left) / rowRect.width))
              var fy = Math.min(0.95, Math.max(0.05, (event.clientY - rowRect.top) / rowRect.height))
              dragCardGrab = { x: fx * el.offsetWidth, y: fy * el.offsetHeight }
            }
          } catch (error) {}
          el.style.transform =
            'translate(' + ((event.clientX || 0) - dragCardGrab.x) + 'px,' + ((event.clientY || 0) - dragCardGrab.y) + 'px)'
          // Teardown on dragend / next dragstart: the card is a live
          // follower, not a snapshot.
        } catch (error) {
          // Never swallow silently: a broken drag card should announce
          // itself instead of looking like "the feature does nothing".
          if (typeof console !== 'undefined' && console.warn) console.warn('[crabtodo] drag card failed', error)
        }
      }

      /** Document-level capture so the composer's own drop handling never sees the gesture. */
      function installDragBridge() {
        if (dragBridgeInstalled) return
        if (typeof document === 'undefined') return
        dragBridgeInstalled = true
        var outside = function (event) {
          return !(event.target && event.target.closest && event.target.closest('.ct-root, .ct-float, .ct-stub'))
        }
        document.addEventListener(
          'dragover',
          function (event) {
            if (!taskDrag) return
            if (dragCardEl) {
              dragCardEl.style.transform =
                'translate(' + (event.clientX - dragCardGrab.x) + 'px,' + (event.clientY - dragCardGrab.y) + 'px)'
            }
            if (!outside(event)) return
            event.preventDefault()
            try {
              event.dataTransfer.dropEffect = 'copy'
            } catch (error) {}
          },
          true,
        )
        document.addEventListener(
          'drop',
          function (event) {
            if (!taskDrag || !outside(event)) return
            // Capture + stop: the composer must not also treat this as text
            // or a file drop — the reference goes through setDraft exactly once.
            event.preventDefault()
            event.stopPropagation()
            var task = taskDrag
            taskDrag = null
            pushTaskToComposer(task)
          },
          true,
        )
        document.addEventListener(
          'dragend',
          function () {
            taskDrag = null
          },
          true,
        )
      }

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
       * The settings page — a secondary view like the trash. Small, honest
       * preferences only: everything structural (store path, tool exposure)
       * is schema-owned host config in cordis.patch.yml, not page state.
       */
      function SettingsPanel(props) {
        var prefs = props.prefs
        var setPrefs = props.setPrefs
        var pick = function (key, value) {
          var next = Object.assign({}, prefs)
          next[key] = value
          setPrefs(next)
          // Session-level effects (right panel width) re-apply live; the
          // applier ignores everything but the width percentage.
          if (typeof prefsApplier === 'function') {
            try {
              prefsApplier(next)
            } catch (error) {}
          }
        }
        // Accent options: plain-string labels for the host Menu (its typeahead
        // stringifies labels), with the colour riding on the trigger's swatch.
        var accentOptions = [
          { value: 'default', label: STR.settingsDefault, color: null },
          { value: 'blue', label: STR.settingsBlue, color: ACCENT_COLORS.blue },
          { value: 'purple', label: STR.settingsPurple, color: ACCENT_COLORS.purple },
          { value: 'green', label: STR.settingsGreen, color: ACCENT_COLORS.green },
          { value: 'orange', label: STR.settingsOrange, color: ACCENT_COLORS.orange },
          { value: 'red', label: STR.settingsRed, color: ACCENT_COLORS.red },
        ]
        var accentTrigger = function (value) {
          var picked =
            accentOptions.filter(function (option) {
              return option.value === value
            })[0] || accentOptions[0]
          return h(
            'span',
            { className: 'ct-set-swatch-row' },
            h('span', {
              className: 'ct-set-swatch',
              style: picked.color ? { background: picked.color } : undefined,
              'data-default': picked.color ? undefined : 'true'
            }),
            picked.label,
          )
        }
        var row = function (label, options, value, onPick) {
          return h(
            'div',
            { className: 'ct-set-row' },
            h('div', { className: 'ct-set-label' }, label),
            h(
              'div',
              { className: 'ct-set-options' },
              options.map(function (opt) {
                return h(
                  'button',
                  {
                    key: String(opt.value),
                    type: 'button',
                    className: 'ct-set-opt',
                    'data-active': String(opt.value === value),
                    onClick: function () {
                      onPick(opt.value)
                    }
                  },
                  opt.label,
                )
              }),
            ),
          )
        }
        return h(
          'div',
          { className: 'ct-settings' },
          row(
            STR.settingsNotesLines,
            [
              { value: 1, label: '1' },
              { value: 2, label: '2' },
              { value: 3, label: '3' },
            ],
            prefs.notesLines,
            function (value) {
              pick('notesLines', value)
            },
          ),
          row(
            STR.settingsConfirmDelete,
            [
              { value: true, label: STR.settingsOn },
              { value: false, label: STR.settingsOff },
            ],
            prefs.confirmDelete,
            function (value) {
              pick('confirmDelete', value)
            },
          ),
          row(
            STR.settingsAnimations,
            [
              { value: true, label: STR.settingsOn },
              { value: false, label: STR.settingsOff },
            ],
            prefs.animations,
            function (value) {
              pick('animations', value)
            },
          ),
          // The tag library (标签库): the vocabulary behind every picker and
          // every tag filter. Add here or straight from a form; prune stale
          // names without touching the tasks that carry them.
          h(
            'div',
            { className: 'ct-set-row' },
            h('div', { className: 'ct-set-label' }, STR.tagsLibrary),
            h(
              'div',
              { className: 'ct-set-value' },
              h(
                'div',
                { className: 'ct-tagpicker' },
                (props.tagList || []).map(function (tag) {
                  return h(
                    'span',
                    { key: tag, className: 'ct-tag ct-picked' },
                    '#' + tag,
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'ct-icon',
                        title: STR.remove,
                        'aria-label': STR.remove,
                        onClick: function () {
                          if (typeof props.onRemoveTag === 'function') props.onRemoveTag(tag)
                        }
                      },
                      icon('IconCloseOutlineRegular', 11),
                    ),
                  )
                }),
              ),
              h('input', {
                className: 'ct-input',
                placeholder: STR.tagNewPlaceholder,
                onKeyDown: function (event) {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  var clean = event.currentTarget.value.trim()
                  if (clean && typeof props.onAddTag === 'function') props.onAddTag(clean)
                  event.currentTarget.value = ''
                }
              }),
            ),
          ),
          h(
            'div',
            { className: 'ct-set-row' },
            h('div', { className: 'ct-set-label' }, STR.settingsRightbarWidth),
            h(
              'div',
              { className: 'ct-set-options' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'ct-set-opt',
                  disabled: prefs.rightbarWidthPct <= 30,
                  'aria-label': '-',
                  onClick: function () {
                    pick('rightbarWidthPct', Math.max(30, prefs.rightbarWidthPct - 1))
                  }
                },
                '\u2212',
              ),
              // Editable value: type a percentage directly. Enter/blur
              // commits (clamped), Escape reverts; the ± buttons above and
              // below keep working and re-key this input on change.
              h('input', {
                key: String(prefs.rightbarWidthPct),
                className: 'ct-set-input',
                defaultValue: String(prefs.rightbarWidthPct),
                inputMode: 'numeric',
                'aria-label': STR.settingsRightbarWidth,
                onKeyDown: function (event) {
                  if (event.key === 'Enter') event.currentTarget.blur()
                  if (event.key === 'Escape') {
                    event.currentTarget.value = String(prefs.rightbarWidthPct)
                    event.currentTarget.blur()
                  }
                },
                onBlur: function (event) {
                  var value = parseInt(event.target.value, 10)
                  if (!Number.isFinite(value)) {
                    event.target.value = String(prefs.rightbarWidthPct)
                    return
                  }
                  value = Math.min(65, Math.max(30, value))
                  event.target.value = String(value)
                  if (value !== prefs.rightbarWidthPct) pick('rightbarWidthPct', value)
                }
              }),
              h(
                'button',
                {
                  type: 'button',
                  className: 'ct-set-opt',
                  disabled: prefs.rightbarWidthPct >= 65,
                  'aria-label': '+',
                  onClick: function () {
                    pick('rightbarWidthPct', Math.min(65, prefs.rightbarWidthPct + 1))
                  }
                },
                '+',
              ),
            ),
          ),
          row(
            STR.settingsDefaultScope,
            SCOPE_TABS.map(function (tab) {
              return { value: tab.id, label: tab.label }
            }),
            prefs.startScope,
            function (value) {
              pick('startScope', value)
            },
          ),
          h(
            'div',
            { className: 'ct-set-row' },
            h('div', { className: 'ct-set-label' }, STR.settingsDefaultFilter),
            h(Dropdown, {
              title: STR.settingsDefaultFilter,
              value: prefs.startFilter,
              label: (
                FILTERS.filter(function (entry) {
                  return entry.id === prefs.startFilter
                })[0] || FILTERS[0]
              ).label,
              options: FILTERS.map(function (entry) {
                return { value: entry.id, label: entry.label }
              }),
              onSelect: function (value) {
                pick('startFilter', value)
              }
            })
          ),
          h(
            'div',
            { className: 'ct-set-row' },
            h('div', { className: 'ct-set-label' }, STR.settingsAccent),
            h(Dropdown, {
              title: STR.settingsAccent,
              value: prefs.accent,
              label: accentTrigger(prefs.accent),
              options: accentOptions.map(function (option) {
                return { value: option.value, label: option.label }
              }),
              onSelect: function (value) {
                pick('accent', value)
              }
            })
          ),
          // Font size: a plain px stepper — the value is the base type size.
          h(
            'div',
            { className: 'ct-set-row' },
            h('div', { className: 'ct-set-label' }, STR.settingsFontSize),
            h(
              'div',
              { className: 'ct-set-options' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'ct-set-opt',
                  disabled: prefs.fontSize <= FONT_SIZE_MIN,
                  'aria-label': '-',
                  onClick: function () {
                    pick('fontSize', Math.max(FONT_SIZE_MIN, prefs.fontSize - 1))
                  }
                },
                '\u2212',
              ),
              h('span', { className: 'ct-set-value' }, String(prefs.fontSize) + ' px'),
              h(
                'button',
                {
                  type: 'button',
                  className: 'ct-set-opt',
                  disabled: prefs.fontSize >= FONT_SIZE_MAX,
                  'aria-label': '+',
                  onClick: function () {
                    pick('fontSize', Math.min(FONT_SIZE_MAX, prefs.fontSize + 1))
                  }
                },
                '+',
              ),
            ),
          ),
        )
      }

      /**
       * The destructive-action dialog, centred INSIDE the sidebar panel: the
       * question stays next to the click that asked it. A body-portalled
       * page-centre modal — the shell's Modal — put it across the whole
       * window instead, which is the wrong place for a panel-local action.
       *
       * Escape and a click on the scrim cancel; initial focus lands on
       * CANCEL, so a stray Enter cannot destroy anything.
       */
      function ConfirmDialog(props) {
        var cancelRef = useRef(null)
        useEffect(
          function () {
            if (!props.open) return undefined
            if (cancelRef.current && typeof cancelRef.current.focus === 'function') {
              cancelRef.current.focus()
            }
            var onKey = function (event) {
              if (event.key === 'Escape') {
                event.preventDefault()
                props.onCancel()
              }
            }
            document.addEventListener('keydown', onKey)
            return function () {
              document.removeEventListener('keydown', onKey)
            }
          },
          [props.open, props.onCancel],
        )
        if (!props.open) return null
        var actions = h(
          'div',
          { className: 'ct-dlg-actions' },
          h(
            'button',
            { type: 'button', className: 'ct-btn', ref: cancelRef, onClick: props.onCancel },
            STR.cancel,
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'ct-btn',
              'data-tone': 'danger',
              onClick: props.onConfirm
            },
            props.confirmLabel,
          ),
        )
        return h(
          'div',
          { className: 'ct-dlg-mask', onClick: props.onCancel },
          h(
            'div',
            {
              className: 'ct-dlg-card',
              role: 'dialog',
              'aria-modal': 'true',
              'aria-label': props.title,
              onClick: function (event) {
                event.stopPropagation()
              }
            },
            h('div', { className: 'ct-dlg-title' }, props.title),
            h('div', { className: 'ct-dlg-desc' }, props.description),
            actions,
          ),
        )
      }

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
        // The composer: the seat's own verbs when docked in a session, or the
        // ACTIVE session's resolved verbs when floating. The session
        // machinery materialises inputActions for any binding (activeSession),
        // so the app-level float writes into whichever composer is on screen.
        var remote = props && props.inputActions ? null : typeof activeSession === 'function' ? activeSession() : null
        var inputActions = (props && props.inputActions) || (remote && remote.inputActions) || null
        // The seat is session-scoped so the bound session id is always here;
        // floating, the active session's key stands in. The page cannot read a
        // session's workspace root itself; forwarding the id lets the host
        // resolve the project for UI-created tasks.
        var sessionId =
          props && typeof props.sessionId === 'string' ? props.sessionId : (remote && remote.key) || null
        // Published input state is how the current draft is read; the actions
        // surface itself has no getter. Floating, the draft comes from the
        // input store's snapshot instead.
        var input = props && typeof props.useInput === 'function' ? props.useInput(function (state) { return state }) : null
        var currentDraft =
          input && typeof input.draft === 'string'
            ? input.draft
            : remote && typeof remote.readDraft === 'function'
              ? remote.readDraft()
              : ''
        useInjectedStyles()
        var [tasks, setTasks] = useState([])
        var [loading, setLoading] = useState(true)
        var [error, setError] = useState('')
        var [toast, setToast] = useState('')
        // The last soft-deleted task, kept here so the toast can undo it. The
        // server-side row is already trashed and recoverable either way; this
        // is just the one-click path back.
        var [undoTask, setUndoTask] = useState(null)
        // Secondary views over the same rows: the trash and the settings page
        // swap in where the list is — a panel within the panel.
        var [view, setView] = useState('list')
        var trash = view === 'trash'
        var settings = view === 'settings'
        // User preferences come from the module-level shared store (see
        // prefsStore): the seat and the global float host must agree.
        var prefsPair = useSharedPrefs()
        var prefs = prefsPair[0]
        var setPrefs = prefsPair[1]
        // The button text for the current appearance + accent (see
        // accentForeground): white in dark mode, contrast-picked in light.
        var accentText = useMemo(function () {
          return accentForeground(prefs.accent === 'default' ? null : ACCENT_COLORS[prefs.accent])
        }, [prefs.accent])
        // (Server sync lives in prefsStore: one PUT per change, and the
        // startup GET merges the host copy in via adopt() — see apply.)
        // Search box: filters the visible rows in memory, mirroring the
        // substring match crabtodo_list's query already performs server-side.
        var [query, setQuery] = useState('')
        // Drag-to-reorder: which row is in the air, and where a hover would
        // land it ({id, side} of the hovered row).
        var [dragId, setDragId] = useState(null)
        var [dropHint, setDropHint] = useState(null)
        // Every destructive action funnels through ONE dialog at panel level:
        // the rows and buttons ask, the dialog decides.
        var [dialog, setDialog] = useState(null)

        // Auto-dismiss the confirmation; a stuck toast in a narrow panel is
        // worse than no toast at all. The undo toast lingers longer: its whole
        // point is the window it opens, and 2.4s is too easy to miss.
        useEffect(
          function () {
            if (!toast && !undoTask) return undefined
            var timer = setTimeout(function () {
              setToast('')
              setUndoTask(null)
            }, undoTask ? 6000 : 2400)
            return function () {
              clearTimeout(timer)
            }
          },
          [toast, undoTask]
        )
        // The row context menu, and the menu's "edit" hand-off to the row.
        var [ctxMenu, setCtxMenu] = useState(null)
        // The managed tag vocabulary (crabtodo_tags / the picker's chips).
        var [tagList, setTagList] = useState([])
        var [editRequest, setEditRequest] = useState(null)
        var [filter, setFilter] = useState(prefs.startFilter)
        // Which scope tab is showing. 'project' is the default because that is
        // where the current workspace's work lives.
        var [scope, setScope] = useState(prefs.startScope)
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
         * Re-runs when the host changes (float ⟷ sidebar): the tree moves to
         * a different wrapper chain, and the pixel fix has to follow it —
         * otherwise a dock-after-float leaves the seat without its height and
         * the whole layout collapses back to the pre-fix mess. Not on every
         * render: the value tracks the column, not our content.
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
          [prefs.floatMode]
        )

        /** Project key the host resolved for this session; shown in the card. */
        var [currentProject, setCurrentProject] = useState(null)

        // Vocabulary writes: the picker registers new words, settings prunes.
        var registerTag = async function (name) {
          var clean = String(name || '').trim()
          if (!clean) return
          try {
            var body = await request('tags', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ name: clean }),
            })
            if (Array.isArray(body.tags)) setTagList(body.tags)
          } catch (failure) {
            if (alive.current) setError(String((failure && failure.message) || failure))
          }
        }
        var dropTag = async function (name) {
          try {
            var body = await request('tags?name=' + encodeURIComponent(name), { method: 'DELETE' })
            if (Array.isArray(body.tags)) setTagList(body.tags)
          } catch (failure) {
            if (alive.current) setError(String((failure && failure.message) || failure))
          }
        }
        // Clicking a row's tag filters by it — the fastest path to "show me
        // everything of this kind".
        var filterTag = function (tag) {
          setQuery('#' + tag)
        }
        // One choke point: any tag word that reaches a task and is not yet in
        // the vocabulary joins it — free typing stays effortless while the
        // library grows into a filterable set.
        var registerNewWords = function (tagsValue) {
          String(tagsValue || '').split(/\s+/).filter(Boolean).forEach(function (word) {
            if (tagList.indexOf(word) < 0) registerTag(word)
          })
        }

        var load = useCallback(async function () {
          try {
            var query = sessionId ? '?sessionId=' + encodeURIComponent(sessionId) : ''
            var body = await request('tasks' + query)
            if (!alive.current) return
            setTasks(Array.isArray(body.tasks) ? body.tasks : [])
            setTagList(Array.isArray(body.tags) ? body.tags : [])
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
            // Coalesce change bursts (a batched write notifies per row) into
            // one reload — intermediate states used to render and animate.
            var loadTimer = null
            var queueLoad = function () {
              clearTimeout(loadTimer)
              loadTimer = setTimeout(load, 120)
            }
            stream.addEventListener('change', queueLoad)
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
            registerNewWords(tags)
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
              setError(STR.noComposer)
              return
            }
            var entry = formatReference(task)

            var existing = String(currentDraft || '')
            // Keep one header: a second reference joins the same block instead
            // of stacking a second one. Matching on the leading marker — not the
            // whole line — also migrates drafts written by an older version: an
            // outdated header line is replaced, so the block always carries the
            // current tool guidance.
            var body = ''
            if (existing.indexOf(REFERENCE_MARK) === 0) {
              var firstBreak = existing.indexOf('\n')
              body = firstBreak >= 0 ? existing.slice(firstBreak + 1) : ''
            }
            var merged
            if (body.trim().length > 0) {
              merged = REFERENCE_HEADER + '\n' + entry + '\n\n' + body.replace(/^\n/, '')
            } else if (existing.trim().length > 0 && existing.indexOf(REFERENCE_MARK) !== 0) {
              // A draft you are already writing is APPENDED to, never silently
              // discarded.
              merged = REFERENCE_HEADER + '\n' + entry + '\n\n' + existing
            } else {
              merged = REFERENCE_HEADER + '\n' + entry + '\n'
            }
            try {
              inputActions.setDraft(merged)
              setError('')
              setToast(STR.referenced(task.title))
            } catch (failure) {
              setError(STR.refFailed(String((failure && failure.message) || failure)))
            }
          },
          [inputActions, currentDraft]
        )

        var patch = useCallback(
          function (id, changes) {
            if (changes && typeof changes.tags !== 'undefined') registerNewWords(changes.tags)
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
            // The server soft-deletes (the row lands in the trash, restorable
            // from there); the toast below is the one-click path back.
            var task =
              tasks.filter(function (candidate) {
                return candidate.id === id
              })[0] || null
            mutate(function () {
              return request('tasks/' + encodeURIComponent(id), { method: 'DELETE' })
            })
            setToast(STR.deletedToast(task ? task.title : ''))
            setUndoTask(task)
          },
          [mutate, tasks]
        )

        var restore = useCallback(
          function (id) {
            mutate(function () {
              return request('tasks/' + encodeURIComponent(id), {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ deleted: false })
              })
            })
          },
          [mutate]
        )

        var purge = useCallback(
          function (id) {
            mutate(function () {
              return request('tasks/' + encodeURIComponent(id) + '?purge=1', { method: 'DELETE' })
            })
          },
          [mutate]
        )

        var purgeDeleted = useCallback(
          function () {
            // Sweep exactly what the view shows: on the 项目 tab that is this
            // workspace's trashed rows, on 全部 the whole bin. Per-row purges
            // through the same explicit path the row's own button uses — a
            // bulk route would sweep rows this view never showed.
            var rows = tasks.filter(function (task) {
              if (!task.deletedAt) return false
              var scopeOf = task.scope || 'global'
              if (scope === 'project') {
                return scopeOf === 'project' && (!currentProject || sameProjectKey(task.project, currentProject))
              }
              if (scope === 'global') return scopeOf === 'global'
              return true
            })
            mutate(function () {
              return Promise.all(
                rows.map(function (task) {
                  return request('tasks/' + encodeURIComponent(task.id) + '?purge=1', { method: 'DELETE' })
                }),
              )
            })
          },
          [mutate, tasks, scope, currentProject],
        )

        var clearCompleted = useCallback(
          function () {
            mutate(function () {
              return request('clear-completed', { method: 'POST' })
            })
          },
          [mutate]
        )

        // The three destructive actions each ask the same dialog. The dialog
        // carries its own run action, so confirming is one generic call.
        var askDelete = useCallback(
          function (task) {
            // The dialog is a preference (settings page); the soft delete
            // behind it always lands in the trash either way.
            if (!prefs.confirmDelete) {
              remove(task.id)
              return
            }
            setDialog({
              title: STR.dlgDeleteTitle,
              description: STR.dlgDeleteDesc(task.title),
              confirmLabel: STR.dlgConfirmDelete,
              run: function () {
                remove(task.id)
              }
            })
          },
          [remove, prefs]
        )

        var askPurge = useCallback(
          function (task) {
            setDialog({
              title: STR.dlgPurgeTitle,
              description: STR.dlgPurgeDesc(task.title),
              confirmLabel: STR.dlgConfirmPurge,
              run: function () {
                purge(task.id)
              }
            })
          },
          [purge]
        )

        var askEmpty = useCallback(
          function () {
            setDialog({
              title: STR.dlgEmptyTitle,
              description: STR.dlgEmptyDesc(trashCount),
              confirmLabel: STR.dlgConfirmEmpty,
              run: purgeDeleted
            })
          },
          [trashCount, purgeDeleted]
        )

        // Rows under the current scope tab, before the trash toggle. 'project'
        // is the session's OWN workspace — a task filed under another root is
        // that workspace's business — while 'all' is genuinely everything:
        // every project plus global, because 全部 is where you look when you
        // want the complete picture. With no workspace resolved there is
        // nothing to compare against, so the 项目 tab shows every project row
        // (the same fallback the create card uses).
        var inScopeRows = useMemo(
          function () {
            return tasks.filter(function (task) {
              var scopeOf = task.scope || 'global'
              if (scope === 'project') {
                return scopeOf === 'project' && (!currentProject || sameProjectKey(task.project, currentProject))
              }
              if (scope === 'global') return scopeOf === 'global'
              return true
            })
          },
          [tasks, scope, currentProject]
        )

        var inScope = useMemo(
          function () {
            // The trash is a view over the same rows: normal mode hides the
            // trashed ones, trash mode shows only them.
            return inScopeRows.filter(function (task) {
              return trash ? !!task.deletedAt : !task.deletedAt
            })
          },
          [inScopeRows, trash]
        )

        var visible = useMemo(
          function () {
            var rows = inScope
            // In the trash the status chips have nothing to say — a trashed
            // row is trashed whatever its status — so the view skips them.
            if (!trash) {
              var rule = FILTERS.filter(function (entry) {
                return entry.id === filter
              })[0]
              var test = rule ? rule.test : FILTERS[0].test
              rows = rows.filter(test)
            }
            // The same haystack crabtodo_list's query searches — title, notes
            // and tags — kept local so typing costs no request. A '#'
            // prefix scopes the match to TAGS ONLY (what the row's clickable
            // tags set: #feature matches the tag, not every title with the
            // word in it).
            var needle = String(query || '')
              .trim()
              .toLowerCase()
            var matched =
              needle.length === 0
                ? rows
                : rows.filter(function (task) {
                    if (needle.charAt(0) === '#') {
                      var want = needle.slice(1)
                      return (Array.isArray(task.tags) ? task.tags : []).some(function (tag) {
                        return String(tag).toLowerCase().indexOf(want) >= 0
                      })
                    }
                    var haystack = (
                      task.title +
                      '\n' +
                      (task.notes || '') +
                      '\n' +
                      (Array.isArray(task.tags) ? task.tags.join(' ') : '')
                    ).toLowerCase()
                    return haystack.indexOf(needle) >= 0
                  })
            // The same ladder the model sees: pinned first, then status →
            // priority → age.
            return sortTasks(matched)
          },
          [inScope, filter, trash, query]
        )

        /**
         * Land a dragged row at its new place and write the arrangement back.
         *
         * Manual order replaces the ladder among arranged rows, so a drop
         * renumbers the rows of the CURRENT view top to bottom: what is on the
         * screen is what gets stored. Only rows whose number actually moved
         * are written — a drop usually touches a handful, not the list.
         */
        var reorder = useCallback(
          function (fromId, targetId, side) {
            var rows = visible.slice()
            var from = rows.findIndex(function (task) {
              return task.id === fromId
            })
            if (from < 0) return
            var moved = rows.splice(from, 1)[0]
            var to = rows.findIndex(function (task) {
              return task.id === targetId
            })
            if (to < 0) return
            rows.splice(side === 'below' ? to + 1 : to, 0, moved)
            // One batched write, one reload. Writing each row separately made
            // the server re-sort N times and the list visibly re-flow in
            // stages — the drop looked like it was jumping to position.
            var writes = []
            rows.forEach(function (task, index) {
              if (task.order !== index) writes.push({ id: task.id, order: index })
            })
            if (writes.length === 0) return
            mutate(function () {
              return Promise.all(
                writes.map(function (write) {
                  return request('tasks/' + encodeURIComponent(write.id), {
                    method: 'PATCH',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ order: write.order }),
                  })
                }),
              )
            })
          },
          [visible, patch]
        )

        var dropRow = useCallback(
          function (targetId, side) {
            // The side comes from the drop event (see TaskRow's onDrop); the
            // hint state is visuals only and never gates the move.
            if (dragId && dragId !== targetId) {
              reorder(dragId, targetId, side || 'above')
            }
            setDragId(null)
            setDropHint(null)
          },
          [dragId, reorder]
        )

        // FLIP, with every motion decision made HERE rather than on mount:
        // a CSS animation keyed to element mount made whole views flash when
        // rows re-created under filtering, and its transform fought the slide.
        //   - view's first render: record only — a clean switch, no fanfare
        //   - row moved: slide from its old place
        //   - row appeared: quiet fade (no slide — it would fight the sliders)
        //   - row left: nothing (it is already gone; the others glide around it)
        var listRef = useRef(null)
        var flipTops = useRef({})
        // Coordinates are only comparable within one host: switching between
        // the sidebar seat and the floating card invalidates every recorded
        // top, or the next list change animates rows from another window.
        useEffect(
          function () {
            flipTops.current = {}
          },
          [prefs.floatMode],
        )
        useLayoutEffect(
          function () {
            var root = listRef.current
            if (!root) return
            var prev = flipTops.current || {}
            var hadRows = Object.keys(prev).length > 0
            var next = {}
            for (var el = root.firstElementChild; el; el = el.nextElementSibling) {
              if (!(el.dataset && el.dataset.taskId)) continue
              var id = el.dataset.taskId
              var top = el.getBoundingClientRect().top
              next[id] = top
              if (!prefs.animations || !hadRows || typeof el.animate !== 'function') continue
              var before = prev[id]
              if (before === undefined) {
                el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'ease-out' })
                continue
              }
              var delta = before - top
              if (Math.abs(delta) < 1) continue
              el.animate(
                [{ transform: 'translateY(' + delta + 'px)' }, { transform: 'none' }],
                { duration: 180, easing: 'ease' },
              )
            }
            flipTops.current = next
          },
          [visible, trash, prefs.animations],
        )

        /**
         * The landing edge for a pointer that missed every row — the gaps and,
         * above all, the empty area BELOW the list, which is where "move to
         * the end" has to be expressible. Rows are contiguous, so the nearest
         * row's midpoint decides the edge. DOM order matches `visible` order.
         */
        function edgeOfList(listEl, clientY) {
          var rows = []
          for (var node = listEl.firstElementChild; node; node = node.nextElementSibling) {
            if (node.dataset && node.dataset.taskId) rows.push(node)
          }
          if (rows.length === 0) return null
          var best = null
          rows.forEach(function (el) {
            var rect = el.getBoundingClientRect()
            var mid = rect.top + rect.height / 2
            var dist = Math.abs(clientY - mid)
            if (!best || dist < best.dist) {
              best = { dist: dist, id: el.dataset.taskId, side: clientY < mid ? 'above' : 'below' }
            }
          })
          return best ? { id: best.id, side: best.side } : null
        }

        // The list itself is a drop target for everything a row does not
        // cover. Without these, dragging past the last row hit a dead zone —
        // a forbidden cursor and a drop that could never land.
        function listDragOver(event) {
          if (!dragId) return
          if (event.target && event.target.closest && event.target.closest('.ct-item')) return
          event.preventDefault()
          var edge = edgeOfList(event.currentTarget, event.clientY)
          if (edge) setDropHint(edge)
        }

        function listDrop(event) {
          if (!dragId) return
          // Dropped on a row? Its own handler owns that one (and this event
          // bubbles up from it).
          if (event.target && event.target.closest && event.target.closest('.ct-item')) return
          event.preventDefault()
          var edge = edgeOfList(event.currentTarget, event.clientY)
          if (edge && edge.id !== dragId) {
            reorder(dragId, edge.id, edge.side)
          }
          setDragId(null)
          setDropHint(null)
        }

        // The badge must say how many rows the trash VIEW will show — so it
        // counts the current scope tab's trashed rows, exactly what sweeping
        // the bin from this view removes.
        var trashCount = useMemo(
          function () {
            return inScopeRows.filter(function (task) {
              return !!task.deletedAt
            }).length
          },
          [inScopeRows]
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
        // Panel-scope preference writer. SettingsPanel has its own pick();
        // the header and the float chrome need the same behaviour HERE.
        var setPref = function (key, value) {
          var next = Object.assign({}, prefs)
          next[key] = value
          setPrefs(next)
          if (typeof prefsApplier === 'function') {
            try {
              prefsApplier(next)
            } catch (error) {}
          }
        }

        // The SAME content array renders in the sidebar seat, in the stub's
        // place while floating, or inside the global float host's card.
        var content = [
          // The tab chip already says "CrabTodo", so this strip carries only
          // the counts and the two whole-list actions.
          h(
            'div',
            { className: 'ct-head' },
            // Secondary views lead with an explicit way home — they are
            // dead ends by design, so the exit says so in words.
            trash || settings
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'ct-btn',
                    disabled: busy,
                    title: STR.backToList,
                    onClick: function () {
                      setView('list')
                    }
                  },
                  STR.home,
                )
              : null,
            h('span', { className: 'ct-count', title: settings ? STR.settingsTitle : STR.countTip(openCount, inScope.length) }, settings ? STR.settingsTitle : trash ? STR.trashCountText(inScope.length) : STR.countText(openCount, inScope.length)),
            h('span', { className: 'ct-spacer' }),
            settings
              ? null
              : trash
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'ct-btn',
                    disabled: busy || trashCount === 0,
                    title: STR.emptyTrashTip,
                    onClick: askEmpty
                  },
                  STR.emptyTrash,
                )
              : // Clearing completed rows belongs to the 已完成 tab: on any
                // other view it would sweep rows the user cannot see.
                filter === 'done'
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'ct-btn',
                      disabled:
                        busy ||
                        !inScope.some(function (task) {
                          return task.status === 'done'
                        }),
                      title: STR.clearCompletedTip,
                      onClick: clearCompleted
                    },
                    STR.clearCompleted,
                  )
                : null,
            // The trash button wears its name — with the count — and lives
            // on the list view only: inside the trash the exit is 回到首页,
            // and a button labelled 回收站 that means "go back" would lie.
            trash || settings
              ? null
              : h(
                  'button',
                  {
                    type: 'button',
                    className: 'ct-btn',
                    disabled: busy,
                    title: STR.trashTitle(trashCount),
                    'aria-label': STR.trashTitle(trashCount),
                    onClick: function () {
                      setView('trash')
                    }
                  },
                  icon('IconTrashOutlineRegular', 13),
                  STR.trashTitle(trashCount),
                ),
            // Floating mode: the panel leaves the sidebar as a movable,
            // resizable glass window; the same button docks it back.
            h(
              'button',
              {
                type: 'button',
                className: 'ct-iconbtn ct-ghost',
                disabled: busy,
                title: prefs.floatMode ? STR.floatDock : STR.floatBtn,
                'aria-label': prefs.floatMode ? STR.floatDock : STR.floatBtn,
                onClick: function () {
                  setPref('floatMode', !prefs.floatMode)
                }
              },
              h(FloatGlyph, { size: 13 })
            ),
            // Settings entry — every view but the settings page itself.
            settings
              ? null
              : h(
                  'button',
                  {
                    type: 'button',
                    className: 'ct-iconbtn ct-ghost',
                    disabled: busy,
                    title: STR.settingsTitle,
                    'aria-label': STR.settingsTitle,
                    onClick: function () {
                      setView('settings')
                    }
                  },
                  icon('IconSettingsOutlineRegular', 13)
                ),
            h(
              'button',
              {
                type: 'button',
                className: 'ct-iconbtn ct-ghost',
                disabled: busy,
                title: STR.reload,
                'aria-label': STR.reload,
                onClick: load
              },
              icon('IconRefreshOutlineRegular', 13)
            )
          ),

          // Scope chips and the search box share one row: both narrow the
          // list, and a two-character chip group does not need a row of its
          // own. The status tabs below stay full-width on the host control.
          settings ? null : h(
            'div',
            { className: 'ct-bar' },
            h(
              'div',
              { className: 'ct-scopes', role: 'tablist', 'aria-label': STR.scopeTabsAria },
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
                    title:
                      entry.id === 'project'
                        ? STR.scopeTipProject
                        : entry.id === 'global'
                          ? STR.scopeTipGlobal
                          : STR.scopeTipAll,
                    onClick: function () {
                      setScope(entry.id)
                    }
                  },
                  entry.label,
                )
              }),
            ),
            // Search: the page-local twin of the model's query filter —
            // title, notes and tags — so a long list need not be tab-filtered.
            h(
              'div',
              { className: 'ct-search' },
              h(
                'div',
                { className: 'ct-search-box' },
                icon('IconSearchOutlineRegular', 12),
                h('input', {
                  type: 'text',
                  className: 'ct-search-input',
                  value: query,
                  placeholder: STR.searchPlaceholder,
                  'aria-label': STR.searchAria,
                  onChange: function (event) {
                    setQuery(event.target.value)
                  },
                  onKeyDown: function (event) {
                    if (event.key === 'Escape') setQuery('')
                  },
                }),
                query
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'ct-search-clear',
                        title: STR.clearSearch,
                        'aria-label': STR.clearSearch,
                        onClick: function () {
                          setQuery('')
                        },
                      },
                      '×',
                    )
                  : null,
              ),
            ),
          ),
          // Status tabs use the product's own SegmentedTabs, the same underlined
          // control the plugin market uses: equal-width, sliding indicator,
          // Left/Right/Home/End keyboard support. Icons stay alongside the
          // labels so the state is still readable at a glance.
          // The status tabs have nothing to say about trashed rows — a
          // trashed row is trashed whatever its status — so the trash hides
          // them instead of offering filters that do nothing.
          trash || settings ? null : renderSegmentedTabs(filter, setFilter),
          settings
            ? h(SettingsPanel, {
              prefs: prefs,
              setPrefs: setPrefs,
              tagList: tagList,
              onAddTag: registerTag,
              onRemoveTag: dropTag,
            })
            : h(
            'div',
            {
              className: 'ct-list',
              ref: listRef,
              onDragOver: listDragOver,
              onDrop: listDrop
            },
            loading
              ? h('div', { className: 'ct-empty' }, STR.loading)
              : visible.length === 0
                ? h(
                    'div',
                    { className: 'ct-empty' },
                    query
                      ? STR.noMatch(query)
                      : trash
                        ? STR.emptyTrashView
                        : inScopeRows.length === 0
                          ? STR.emptyList
                          : STR.emptyFilter
                  )
                : visible.map(function (task) {
                    return trash
                      ? h(TrashRow, {
                          key: task.id,
                          task: task,
                          busy: busy,
                          onRestore: restore,
                          onAskPurge: askPurge
                        })
                      : h(TaskRow, {
                          key: task.id,
                          task: task,
                          busy: busy,
                          onPatch: patch,
                          onRemove: remove,
                          onAddToChat: addToChat,
                          canChat: !!inputActions,
                          tagList: tagList,
                          onRegisterTag: registerTag,
                          onFilterTag: filterTag,
                          onContextMenu: function (task, x, y) {
                            setCtxMenu({ task: task, x: x, y: y })
                          },
                          editRequest: editRequest,
                          onEditDone: function () {
                            setEditRequest(null)
                          },
                          currentProject: currentProject,
                          onAskDelete: askDelete,
                          dragging: dragId,
                          dropHint: dropHint,
                          onDragStart: function (id) {
                            setDragId(id)
                          },
                          onDropHint: setDropHint,
                          onDropRow: dropRow,
                          onDragEnd: function () {
                            setDragId(null)
                            setDropHint(null)
                          }
                        })
                  })
          ),
          // The composer lives at the BOTTOM of the panel: new work goes in
          // where the list ends, and its detail section expands upward so the
          // growing form never pushes existing rows off-screen.
          // Every message rises from the composer's top edge: whatever
          // height the card takes, the stack sits right above it.
          h(
            'div',
            { className: 'ct-foot' },
            h(
              'div',
              { className: 'ct-msgs' },
              error ? h(
                'div',
                { className: 'ct-error', role: 'alert' },
                error
              ) : null,
              // Transient confirmation for "添加到对话"; the button changes nothing
              // visible in this panel, so silence would read as a broken button.
              toast || undoTask
                ? h(
                    'div',
                    { className: 'ct-toast', role: 'status' },
                    toast || STR.deletedFallback,
                    undoTask
                      ? h(
                          'button',
                          {
                            type: 'button',
                            className: 'ct-toast-undo',
                            onClick: function () {
                              var task = undoTask
                              setUndoTask(null)
                              setToast(STR.restored(task.title))
                              patch(task.id, { deleted: false })
                            }
                          },
                          STR.undo
                        )
                      : null
                  )
                : null,
            ),
            h(AddTaskCard, {
            busy: busy,
            onSubmit: addTask,
            scope: scope,
            project: currentProject,
            tagList: tagList,
          })
          ),
          ctxMenu
            ? h(ContextMenu, {
                task: ctxMenu.task,
                x: ctxMenu.x,
                y: ctxMenu.y,
                canChat: !!inputActions,
                onClose: function () {
                  setCtxMenu(null)
                },
                onEdit: function () {
                  setEditRequest({ id: ctxMenu.task.id })
                },
                onAddToChat: function () {
                  addToChat(ctxMenu.task)
                },
                onCopyRef: function () {
                  try {
                    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
                      navigator.clipboard.writeText(formatReference(ctxMenu.task))
                    }
                    setToast(STR.copied)
                  } catch (error) {}
                },
                onTogglePinned: function () {
                  patch(ctxMenu.task.id, { pinned: !ctxMenu.task.pinned })
                },
                onMarkDoing: function () {
                  patch(ctxMenu.task.id, { status: 'in_progress' })
                },
                onToggleDone: function () {
                  patch(ctxMenu.task.id, { status: ctxMenu.task.status === 'done' ? 'pending' : 'done' })
                },
                onAskDelete: function () {
                  askDelete(ctxMenu.task)
                },
              })
            : null,
          h(ConfirmDialog, {
            open: !!dialog,
            title: dialog ? dialog.title : '',
            description: dialog ? dialog.description : '',
            confirmLabel: dialog ? dialog.confirmLabel : '',
            onConfirm: function () {
              var d = dialog
              setDialog(null)
              if (d && typeof d.run === 'function') d.run()
            },
            onCancel: function () {
              setDialog(null)
            }
          })
        ]
        if (props.floatHost) {
          // Inside the APP-LEVEL floating card: the content root only — the
          // window chrome and its drag live in CrabFloatHost.
          return h(
            'div',
            {
              className: 'ct-root',
              ref: rootRef,
              // Appearance overrides + the notes clamp — see the settings page.
              style: rootStyleFor(prefs, accentText),
            },
            content,
          )
        }
        if (prefs.floatMode) {
          // The seat shows a stub while the global float host carries the real
          // panel — the window is the app's, not this session's.
          return h(
            'div',
            { className: 'ct-stub' },
            h('span', null, STR.floatStub),
            h(
              'button',
              {
                type: 'button',
                className: 'ct-btn',
                disabled: busy,
                onClick: function () {
                  setPref('floatMode', false)
                }
              },
              STR.floatDock,
            ),
          )
        }
        return h(
          'div',
          {
            className: 'ct-root',
            ref: rootRef,
            // Appearance overrides + the notes clamp — see the settings page.
            style: rootStyleFor(prefs, accentText),
          },
          content,
        )
      }

      /**
       * The floating window's APP-LEVEL host, mounted in the frame's
       * \`shell.overlay\` seat (root scope, list kind). The window therefore
       * belongs to the application, not to whichever session's sidebar
       * happened to host the panel: switching sessions keeps it on screen —
       * exactly the "global, not per-session" behaviour.
       *
       * It renders the same panel component with \`floatHost\` (no seat
       * chrome) and binds the on-screen session for project resolution.
       */
      function CrabFloatHost() {
        var prefsPair = useSharedPrefs()
        var prefs = prefsPair[0]
        var setPrefs = prefsPair[1]
        var floatRef = useRef(null)
        var dragState = useRef(null)
        // Every hook lives ABOVE the early return: a hook below a conditional
        // exit changes the hook count between renders (floatMode flips) and
        // React kills the whole subtree — that is exactly why the window went
        // missing after the fold feature landed.
        var foldSize = useRef(null)
        // Manual resizes are recorded into prefs — debounced, and never
        // during a fold (the tween is not a size choice).
        var foldBusy = useRef(false)
        var sizeTimer = useRef(null)
        useEffect(
          function () {
            if (typeof ResizeObserver === 'undefined') return undefined
            var el = floatRef.current
            if (!el) return undefined
            var observer = new ResizeObserver(function (entries) {
              if (foldBusy.current) return
              var entry = entries[0]
              var box = entry && entry.contentRect
              if (!box || box.width < 200 || box.height < 120) return
              if (sizeTimer.current) clearTimeout(sizeTimer.current)
              sizeTimer.current = setTimeout(function () {
                if (Number.isFinite(prefs.floatW) && Math.abs(prefs.floatW - box.width) < 2) return
                if (Number.isFinite(prefs.floatH) && Math.abs(prefs.floatH - box.height) < 2) return
                prefsStore.set(Object.assign({}, prefs, { floatW: Math.round(box.width), floatH: Math.round(box.height) }))
              }, 250)
            })
            observer.observe(el)
            return function () {
              observer.disconnect()
              if (sizeTimer.current) clearTimeout(sizeTimer.current)
            }
          },
          [prefs.floatCollapsed],
        )

        if (!prefs.floatMode) return null
        var viewport = function () {
          return {
            w: typeof window !== 'undefined' && Number.isFinite(window.innerWidth) ? window.innerWidth : 1200,
            h: typeof window !== 'undefined' && Number.isFinite(window.innerHeight) ? window.innerHeight : 800
          }
        }
        var floatStyle = function () {
          var v = viewport()
          var x = Number.isFinite(prefs.floatX) ? prefs.floatX : Math.max(12, v.w - 460)
          var y = Number.isFinite(prefs.floatY) ? prefs.floatY : 96
          var style = {
            left: Math.max(0, Math.min(x, v.w - 120)) + 'px',
            top: Math.max(0, Math.min(y, v.h - 60)) + 'px'
          }
          // The remembered size: ours, not the browser resize state (which a
          // fold resets — that is how manual sizes used to vanish on expand).
          // While collapsed the fold choreography owns the height inline.
          if (Number.isFinite(prefs.floatW)) style.width = prefs.floatW + 'px'
          if (Number.isFinite(prefs.floatH) && !prefs.floatCollapsed) style.height = prefs.floatH + 'px'
          return style
        }
        var floatDrag = function (event) {
          if (event.target && event.target.closest && event.target.closest('button')) return
          var el = floatRef.current
          if (!el) return
          dragState.current = { dx: event.clientX - el.offsetLeft, dy: event.clientY - el.offsetTop }
          var move = function (e2) {
            if (!dragState.current || !floatRef.current) return
            var v = viewport()
            var x = Math.max(0, Math.min(v.w - 120, e2.clientX - dragState.current.dx))
            var y = Math.max(0, Math.min(v.h - 60, e2.clientY - dragState.current.dy))
            floatRef.current.style.left = x + 'px'
            floatRef.current.style.top = y + 'px'
          }
          var up = function () {
            if (dragState.current && floatRef.current) {
              var next = Object.assign({}, prefs, {
                floatX: parseInt(floatRef.current.style.left, 10) || 0,
                floatY: parseInt(floatRef.current.style.top, 10) || 0
              })
              prefsStore.set(next)
            }
            dragState.current = null
            document.removeEventListener('mousemove', move)
            document.removeEventListener('mouseup', up)
          }
          document.addEventListener('mousemove', move)
          document.addEventListener('mouseup', up)
        }
        var dock = function () {
          var next = Object.assign({}, prefs, { floatMode: false })
          setPrefs(next)
          if (typeof prefsApplier === 'function') {
            try {
              prefsApplier(next)
            } catch (error) {}
          }
        }
        // Collapse/expand is a height tween driven here rather than by CSS:
        // the float is user-resizable, and a permanent height transition would
        // make every resize drag lag behind the cursor. The transition is
        // attached for the fold only. During the tween the body stays laid
        // out and simply gets clipped by the shrinking box — the classic fold.
        var toggleCollapsed = function () {
          var el = floatRef.current
          var collapsing = !prefs.floatCollapsed
          foldBusy.current = true
          var unbusy = function () {
            foldBusy.current = false
          }
          setTimeout(unbusy, 400)
          if (!el) {
            prefsStore.set(Object.assign({}, prefs, { floatCollapsed: collapsing }))
            return
          }
          var headH = el.firstElementChild ? el.firstElementChild.offsetHeight : 38
          var finish = function () {
            el.style.transition = ''
            // Keep the height where the tween left it. Clearing it used to
            // drop the box back to the CSS default — the manual size was
            // lost on every expand. React's style (floatStyle) and prefs
            // agree with this value, so renders re-assert it.
            el.removeEventListener('transitionend', finish)
          }
          if (collapsing) {
            foldSize.current = el.offsetHeight
            el.style.height = el.offsetHeight + 'px'
            void el.offsetHeight
            el.style.transition = 'height var(--ct-motion,220ms) ease'
            el.style.height = headH + 'px'
            // Flip to the collapsed END state only once the fold lands, or the
            // body would vanish mid-animation.
            var settled = false
            var settle = function () {
              if (settled) return
              settled = true
              el.removeEventListener('transitionend', settle)
              // Keep the INLINE folded height and only drop the transition.
              // Clearing the height here used to flash the fully expanded box:
              // the attribute flip lands a React render LATER, and in between
              // the element fell back to the CSS expanded height for a frame.
              el.style.transition = ''
              prefsStore.set(Object.assign({}, prefs, { floatCollapsed: true }))
            }
            el.addEventListener('transitionend', settle)
            // A 0s transition (animations switched off) may never fire
            // transitionend — the grace timer keeps the fold from sticking.
            setTimeout(settle, 350)
            return
          }
          // Expanding: pin the head height first (so the attribute flip below
          // cannot flash the full box), then tween to the remembered size.
          el.style.height = headH + 'px'
          void el.offsetHeight
          prefsStore.set(Object.assign({}, prefs, { floatCollapsed: false }))
          var target = foldSize.current && foldSize.current > headH ? foldSize.current : 0
          el.style.transition = 'height var(--ct-motion,220ms) ease'
          el.style.height = target > 0 ? target + 'px' : 'min(580px, calc(100vh - 48px))'
          var done = false
          var finishOnce = function () {
            if (done) return
            done = true
            finish()
          }
          el.addEventListener('transitionend', finishOnce)
          setTimeout(finishOnce, 350)
        }
        return h(
          'div',
          {
            className: 'ct-float',
            ref: floatRef,
            style: floatStyle(),
            'data-collapsed': String(prefs.floatCollapsed === true)
          },
          h(
            'div',
            { className: 'ct-float-head', onMouseDown: floatDrag },
            h(
              'button',
              {
                type: 'button',
                className: 'ct-iconbtn ct-ghost',
                title: prefs.floatCollapsed ? STR.floatExpand : STR.floatCollapse,
                'aria-label': prefs.floatCollapsed ? STR.floatExpand : STR.floatCollapse,
                'aria-expanded': String(prefs.floatCollapsed !== true),
                onClick: toggleCollapsed
              },
              icon(prefs.floatCollapsed ? 'IconChevronUpOutlineRegular' : 'IconChevronDownOutlineRegular', 13)
            ),
            h('span', { className: 'ct-float-title' }, 'CrabTodo'),
            h('span', { className: 'ct-spacer' }),
            h(
              'button',
              {
                type: 'button',
                className: 'ct-iconbtn ct-ghost',
                title: STR.floatDock,
                'aria-label': STR.floatDock,
                onClick: dock
              },
              '×',
            ),
          ),
          h(
            'div',
            { className: 'ct-float-body' },
            h(CrabTodoPanel, {
              floatHost: true,
              sessionId: (typeof activeSession === 'function' && activeSession() && activeSession().key) || null,
            }),
          ),
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
          { className: 'ct-card', 'data-open': String(open), 'aria-label': STR.addTaskAria },
          h(
            'header',
            { className: 'ct-card-head' },
            h('span', { className: 'ct-card-title' }, STR.newTask),
            h(
              'span',
              { className: 'ct-card-scope', title: props.project || STR.scopeUnresolved },
              props.scope === 'global'
                ? STR.scopes.global
                : props.scope === 'all'
                  ? STR.scopes.all
                  : props.project
                    ? projectLabel(props.project)
                    : STR.scopeCurrentProject
            ),
            h('span', { className: 'ct-spacer' }),
            h(
              'button',
              {
                type: 'button',
                className: 'ct-iconbtn ct-ghost',
                disabled: busy,
                title: open ? STR.collapseDetails : STR.expandDetails,
                'aria-label': open ? STR.collapseDetails : STR.expandDetailsAria,
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
              placeholder: STR.whatToDo,
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
              STR.add
            )
          ),
          // Always rendered: the open/close animation needs both endpoints
          // present, so visibility is CSS-driven via the card's data-open.
          h(
                'div',
                { className: 'ct-card-detail', 'aria-hidden': String(!open) },
                h(
                  'div',
                  { className: 'ct-card-detail-inner' },
                  h('textarea', {
                  className: 'ct-textarea',
                  value: notes,
                  placeholder: STR.notesOptional,
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
                    title: STR.priorityTitle,
                    value: priority,
                    disabled: busy,
                    options: PRIORITIES.map(function (value) {
                      return { value: value, label: PRIORITY_LABEL[value] || value }
                    }),
                    onSelect: setPriority
                  }),
                  h(Dropdown, {
                    label: STATUS_LABEL[status] || status,
                    title: STR.statusTitle,
                    value: status,
                    disabled: busy,
                    options: STATUSES.map(function (value) {
                      return { value: value, label: STATUS_LABEL[value] || value }
                    }),
                    onSelect: setStatus
                  }),
                  h(TagPicker, {
                    tags: props.tagList,
                    value: tags,
                    onToggle: function (tag) {
                      setTags(toggleTagWord(tags, tag))
                    }
                  }),
                  h('input', {
                    className: 'ct-input',
                    value: tags,
                    placeholder: STR.tagsPlaceholder,
                    disabled: busy,
                    onChange: function (event) {
                      setTags(event.target.value)
                    },
                    onKeyDown: onFieldKeyDown
                  }),
                ),
              ),
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
      /**
       * Inline markdown — code, bold, links (http/https only) and italic —
       * parsed straight into React elements.
       *
       * Safety note: there is no HTML step anywhere in this path. A note
       * containing `<img src=x onerror=...>` stays literal text, because the
       * only things this produces are `h()` elements and text nodes. The
       * whitelist is the four token shapes matched below and nothing else.
       */
      function renderInline(text, keyPrefix) {
        var out = []
        var re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))|(\*[^*]+\*)/g
        var last = 0
        var match
        var count = 0
        while ((match = re.exec(text)) !== null) {
          if (match.index > last) out.push(text.slice(last, match.index))
          var token = match[0]
          var key = keyPrefix + '-' + count++
          if (token.charAt(0) === '`') {
            out.push(h('code', { key: key }, token.slice(1, -1)))
          } else if (token.slice(0, 2) === '**') {
            out.push(h('strong', { key: key }, token.slice(2, -2)))
          } else if (token.charAt(0) === '[') {
            var parts = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)
            var href = parts && /^https?:\/\//i.test(parts[2]) ? parts[2] : null
            out.push(
              href
                ? h(
                    'a',
                    { key: key, href: href, target: '_blank', rel: 'noopener noreferrer' },
                    parts[1],
                  )
                : token,
            )
          } else {
            out.push(h('em', { key: key }, token.slice(1, -1)))
          }
          last = match.index + token.length
        }
        if (last < text.length) out.push(text.slice(last))
        return out
      }

      /**
       * The notes whitelist renderer: a practical Markdown subset as React
       * elements — headings, fenced code blocks, bullet and numbered lists
       * (one indent level), blockquotes, horizontal rules, paragraphs, and
       * the inline shapes above. Everything renders through h() with text
       * children only: no innerHTML, no HTML in, no script surface. Syntax
       * outside the subset stays literal text.
       */
      function renderMarkdown(text) {
        var lines = String(text == null ? '' : text).split('\n')
        var out = []
        var para = []
        var items = []
        var quote = []
        var inCode = false
        var codeLines = []
        var flushPara = function () {
          if (para.length === 0) return
          var content = []
          para.forEach(function (line, index) {
            if (index > 0) content.push(h('br', { key: 'br' + index }))
            renderInline(line, 'p' + out.length + '-' + index).forEach(function (piece) {
              content.push(piece)
            })
          })
          out.push(h('p', { key: 'p' + out.length }, content))
          para = []
        }
        var flushItems = function () {
          if (items.length === 0) return
          out.push(
            h(
              items[0].ordered ? 'ol' : 'ul',
              { key: 'list' + out.length },
              items.map(function (item, index) {
                return h(
                  'li',
                  {
                    key: 'li' + index,
                    style: item.level > 0 ? { marginLeft: Math.min(item.level, 3) * 16 + 'px' } : undefined
                  },
                  renderInline(item.text, 'li' + out.length + '-' + index),
                )
              }),
            ),
          )
          items = []
        }
        var flushQuote = function () {
          if (quote.length === 0) return
          var content = []
          quote.forEach(function (line, index) {
            if (index > 0) content.push(h('br', { key: 'qbr' + index }))
            renderInline(line, 'q' + out.length + '-' + index).forEach(function (piece) {
              content.push(piece)
            })
          })
          out.push(h('blockquote', { key: 'quote' + out.length }, content))
          quote = []
        }
        var flushCode = function () {
          if (codeLines.length === 0) return
          // Code is TEXT, never parsed: no inline shapes, no HTML path.
          out.push(
            h('pre', { key: 'pre' + out.length }, h('code', { key: 'code' + out.length }, codeLines.join('\n'))),
          )
          codeLines = []
        }
        var flushAll = function () {
          flushPara()
          flushItems()
          flushQuote()
        }
        lines.forEach(function (line) {
          if (inCode) {
            if (/^\s*\u0060{3}/.test(line)) {
              inCode = false
              flushCode()
            } else {
              codeLines.push(line)
            }
            return
          }
          if (/^\s*\u0060{3}\s*\w*/.test(line)) {
            flushAll()
            inCode = true
            codeLines = []
            return
          }
          var head = /^(#{1,6})\s+(.*)$/.exec(line)
          if (head) {
            flushAll()
            var level = Math.min(6, head[1].length)
            out.push(h('h' + level, { key: 'h' + out.length }, renderInline(head[2], 'h' + out.length)))
            return
          }
          if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
            flushAll()
            out.push(h('hr', { key: 'hr' + out.length }))
            return
          }
          var quoted = /^\s*>\s?(.*)$/.exec(line)
          if (quoted) {
            flushPara()
            flushItems()
            quote.push(quoted[1])
            return
          }
          var item = /^\s*([-*]|\d+[.)])\s+(.*)$/.exec(line)
          if (item) {
            flushPara()
            flushQuote()
            var ordered = /^\d/.test(item[1])
            // Ordered and unordered are different lists: a type change
            // flushes the buffer, or bullets would grow inside the <ol>.
            if (items.length > 0 && items[items.length - 1].ordered !== ordered) flushItems()
            var indent = (line.match(/^\s*/) || [''])[0].replace(/\t/g, '  ').length
            items.push({
              level: Math.floor(indent / 2),
              ordered: ordered,
              text: item[2],
            })
            return
          }
          if (line.trim().length === 0) {
            flushAll()
            return
          }
          flushItems()
          flushQuote()
          para.push(line)
        })
        if (inCode) flushCode()
        flushAll()
        return out
      }
      /**
       * The sort ladder the model's list uses: pinned rows first, then status,
       * priority and age. The snapshot arrives in insertion order, so the page
       * sorts for itself rather than trusting file order.
       */
      var STATUS_RANK = { in_progress: 0, pending: 1, done: 2 }
      var PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 }
      function sortTasks(rows) {
        return rows.slice().sort(function (a, b) {
          return (
            (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) ||
            // A dragged row's manual position wins over the ladder; rows never
            // arranged keep the ladder and sort after the arranged ones.
            (a.order === null || a.order === undefined ? Number.MAX_SAFE_INTEGER : a.order) -
              (b.order === null || b.order === undefined ? Number.MAX_SAFE_INTEGER : b.order) ||
            STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
            PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
            a.createdAt - b.createdAt
          )
        })
      }

      /** Short timestamp for the trash's "deleted at" chip: MM-DD HH:mm. */
      function formatWhen(stamp) {
        if (!stamp) return ''
        var d = new Date(stamp)
        function pad(n) {
          return (n < 10 ? '0' : '') + n
        }
        return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
      }

      /**
       * One row in the trash view: the data, plus the two ways out — restore
       * (back to the list) and purge (gone for good; no further prompt, the
       * row is already sitting in a view named 回收站).
       */
      function TrashRow(props) {
        var task = props.task
        var busy = props.busy
        // Purge is permanent — the panel's dialog asks before it lands.
        return h(
          'div',
          { className: 'ct-item', 'data-status': task.status, 'data-deleted': 'true', 'data-task-id': task.id },
          h(
            'div',
            { className: 'ct-body' },
            h('div', { className: 'ct-row' }, h('span', { className: 'ct-text' }, task.title)),
            task.notes ? h('div', { className: 'ct-notes', title: task.notes }, task.notes) : null,
            h(
              'div',
              { className: 'ct-meta' },
              h(
                'span',
                { className: 'ct-scope-tag' },
                task.scope === 'project' ? projectLabel(task.project) || STR.scopes.project : STR.scopes.global
              ),
              h('span', { className: 'ct-tag' }, STR.deletedAt + formatWhen(task.deletedAt))
            )
          ),
          h(
            'div',
            { className: 'ct-actions', 'data-pinned': 'true' },
            h(
              'button',
              {
                type: 'button',
                className: 'ct-icon',
                disabled: busy,
                title: STR.restore,
                'aria-label': STR.restore,
                onClick: function () {
                  props.onRestore(task.id)
                }
              },
              icon('IconRefreshOutlineRegular', 12)
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'ct-icon',
                disabled: busy,
                title: STR.purge,
                'aria-label': STR.purge,
                onClick: function () {
                  props.onAskPurge(task)
                }
              },
              icon('IconTrashOutlineRegular', 12)
            )
          )
        )
      }
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
        // Notes detail: collapsed shows the clamped plain line, expanded shows
        // the rendered Markdown whitelist.
        var [expanded, setExpanded] = useState(false)
        // Delete asks the panel's dialog first: one mis-click among the hover
        // icons must never bin a task outright.

        // The context menu's "edit" lands here: a request object from the
        // panel opens this row's inline editor.
        useEffect(
          function () {
            if (props.editRequest && props.editRequest.id === task.id) {
              begin()
              if (typeof props.onEditDone === 'function') props.onEditDone()
            }
          },
          [props.editRequest],
        )
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
                placeholder: STR.titleRequired,
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
                placeholder: STR.notesOptional,
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
                  title: STR.priorityTitle,
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
                  title: STR.statusTitle,
                  value: form.status,
                  options: STATUSES.map(function (value) {
                    return { value: value, label: STATUS_LABEL[value] || value }
                  }),
                  onSelect: function (value) {
                    setForm(Object.assign({}, form, { status: value }))
                  }
                }),
                h(TagPicker, {
                  tags: props.tagList,
                  value: form.tags,
                  onToggle: function (tag) {
                    setForm(Object.assign({}, form, { tags: toggleTagWord(form.tags, tag) }))
                  }
                }),
                h('input', {
                  className: 'ct-input',
                  value: form.tags,
                  placeholder: STR.tagsPlaceholder,
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
                h('button', { type: 'button', className: 'ct-btn', 'data-tone': 'accent', onClick: commit }, STR.save),
                h('button', { type: 'button', className: 'ct-btn', onClick: cancel }, STR.cancel),
                h('span', { className: 'ct-hint' }, STR.saveHint)
              )
            )
          )
        }

        // The row is its own grab target: dragging reorders the visible list,
        // and clicks are unaffected — a drag only starts once the pointer moves.
        var dropSide =
          props.dropHint && props.dropHint.id === task.id && props.dragging !== task.id
            ? props.dropHint.side
            : null
        return h(
          'div',
          {
            className: 'ct-item',
            'data-status': task.status,
            'data-task-id': task.id,
            'data-dragging': String(props.dragging === task.id),
            'data-drop': dropSide || undefined,
            draggable: true,
            onContextMenu: function (event) {
              event.preventDefault()
              if (typeof props.onContextMenu === 'function') props.onContextMenu(task, event.clientX, event.clientY)
            },
            onDragStart: function (event) {
              try {
                // The reference block travels as text: dropping it anywhere
                // text is accepted works natively, and the drag bridge gives
                // the composer its own setDraft semantics on top.
                event.dataTransfer.effectAllowed = 'copyMove'
                event.dataTransfer.setData('text/plain', formatReference(task))
                event.dataTransfer.setData('application/x-crabtodo-task', task.id)
                showDragCard(event, task)
              } catch (error) {}
              taskDrag = task
              props.onDragStart(task.id)
            },
            onDragOver: function (event) {
              if (props.dragging === task.id) return
              // Accept the drop unconditionally on non-self rows: the guard
              // on props.dragging had the same batching race as the drop
              // hint — if the very first dragover ran before the drag state
              // committed, no dragover ever allowed the drop and the row
              // simply could not land. External file/text drags are accepted
              // here too, and ignored in onDrop.
              event.preventDefault()
              if (!props.dragging) return
              var rect = event.currentTarget.getBoundingClientRect()
              props.onDropHint({
                id: task.id,
                side: event.clientY < rect.top + rect.height / 2 ? 'above' : 'below'
              })
            },
            onDrop: function (event) {
              event.preventDefault()
              if (!props.dragging || props.dragging === task.id) return
              // The landing side is computed HERE, from the event: the
              // hover hint lives in React state, and a fast drop can land
              // before that state commits (batched updates) — trusting it
              // made quick drops silently do nothing.
              var rect = event.currentTarget.getBoundingClientRect()
              var side = event.clientY < rect.top + rect.height / 2 ? 'above' : 'below'
              props.onDropRow(task.id, side)
            },
            onDragEnd: function () {
              taskDrag = null
              if (dragCardEl && dragCardEl.parentNode) dragCardEl.parentNode.removeChild(dragCardEl)
              dragCardEl = null
              props.onDragEnd()
            }
          },
          h('input', {
            type: 'checkbox',
            className: 'ct-check',
            checked: done,
            disabled: busy,
            title: done ? STR.markUndone : STR.markDone,
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
                  title: STR.clickEdit,
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
                ? h('span', { className: 'ct-pri', 'data-p': 'high' }, STR.inProgressBadge)
                : null
            ),
            // Collapsed: the clamped plain line (fast to scan). Expanded:
            // the rendered Markdown whitelist. Clicks on a link follow the
            // link; every other click toggles.
            task.notes
              ? expanded
                ? h(
                    'div',
                    {
                      className: 'ct-notes ct-md',
                      title: STR.clickCollapse,
                      onClick: function (event) {
                        if (event.target && event.target.tagName === 'A') return
                        setExpanded(false)
                      }
                    },
                    renderMarkdown(task.notes)
                  )
                : h(
                    'div',
                    {
                      className: 'ct-notes ct-notes-collapsed',
                      title: STR.clickExpand,
                      onClick: function () {
                        setExpanded(true)
                      }
                    },
                    task.notes
                  )
              : null,
            h(
              'div',
              { className: 'ct-meta' },
              // Pin state shows without hover — a pinned row should say so.
              task.pinned ? h('span', { className: 'ct-pin-flag', title: STR.pinnedFlag }, '📌') : null,
              // Scope chip: always visible so the task's home is never a guess.
              h(
                'span',
                { className: 'ct-scope-tag' },
                task.scope === 'project'
                  ? projectLabel(task.project) || STR.scopes.project
                  : STR.scopes.global
              ),
              task.priority && task.priority !== 'normal'
                ? h('span', { className: 'ct-pri', 'data-p': task.priority }, PRIORITY_LABEL[task.priority] || task.priority)
                : null,
              (task.tags || []).length > 0
                ? h(
                    'span',
                    { className: 'ct-tags' },
                    (task.tags || []).map(function (tag) {
                      return h(
                        'span',
                        {
                          key: tag,
                          className: 'ct-tag',
                          title: STR.tagFilterTip,
                          role: 'button',
                          tabIndex: 0,
                          onClick: function () {
                            if (typeof props.onFilterTag === 'function') props.onFilterTag(tag)
                          }
                        },
                        '#' + tag,
                      )
                    }),
                  )
                : null
            )
          ),
          h(
            'div',
            { className: 'ct-actions' },
            h(
              'button',
              { type: 'button', className: 'ct-icon', disabled: busy, title: STR.edit, 'aria-label': STR.edit, onClick: begin },
              icon('IconEditOutlineRegular', 12)
            ),
            // Pin: floats the row above the sort ladder without moving it
            // anywhere else. The product icon set may lack a pin glyph, so a
            // text pin stands in rather than leaving a blank button.
            h(
              'button',
              {
                type: 'button',
                className: 'ct-icon',
                disabled: busy,
                'data-active': String(!!task.pinned),
                title: task.pinned ? STR.unpin : STR.pin,
                'aria-label': task.pinned ? STR.unpin : STR.pin,
                onClick: function () {
                  props.onPatch(task.id, { pinned: !task.pinned })
                }
              },
              icon('IconPinOutlineRegular', 12) || '📌'
            ),
            // "添加到对话": writes this task into the composer draft. Hidden
            // when no composer is reachable at all — a button that can only
            // fail is worse than no button.
            props.canChat === false
              ? null
              : h(
                  'button',
                  {
                    type: 'button',
                    className: 'ct-icon',
                    disabled: busy,
                    title: STR.addToChatTip,
                    'aria-label': STR.addToChat,
                    onClick: function () {
                      props.onAddToChat(task)
                    }
                  },
                  icon('IconNewChatOutlineRegular', 12) || '💬'
                ),
            // "移动": switch this task between project and global scope.
            h(
              'button',
              {
                type: 'button',
                className: 'ct-icon',
                disabled: busy,
                title: task.scope === 'project' ? STR.moveToGlobal : STR.moveToProject,
                'aria-label': STR.moveAria,
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
                    title: STR.markInProgress,
                    'aria-label': STR.markInProgress,
                    onClick: function () {
                      props.onPatch(task.id, { status: 'in_progress' })
                    }
                  },
                  icon('IconPlayOutlineRegular', 12)
                )
              : null,
            // The dialog decides; nothing dies from one stray click.
            h(
              'button',
              {
                type: 'button',
                className: 'ct-icon',
                disabled: busy,
                title: STR.remove,
                'aria-label': STR.remove,
                onClick: function () {
                  props.onAskDelete(task)
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
                h('span', { className: 'ct-move-label' }, STR.moveTo),
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
                  projectLabel(props.currentProject) || STR.scopes.project
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
                  STR.scopes.global
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
                  STR.cancel
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
      /**
       * The floating-mode glyph: a titled window lifted over the content
       * behind it.
       *
       * The product set has no "floating window" concept — its nearest shapes
       * read as copy (a solid duplicate) and fullscreen (diagonal arrows, and
       * arrows read wrong here). CrabIcon's "no home-made art" note stands for
       * decorative illustrations; a missing UI metaphor is the other case, so
       * this follows the product's stroke conventions: 16 box, 1px stroke,
       * currentColor, rounded joins, a 0.35 ghost layer like CompactOutline.
       */
      function FloatGlyph(props) {
        var size = (props && props.size) || 16
        return h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 16 16',
            fill: 'none',
            xmlns: 'http://www.w3.org/2000/svg',
            'aria-hidden': 'true'
          },
          // The content behind, ghosted: what the floating window covers.
          h('rect', {
            x: 1.25,
            y: 1.25,
            width: 8.5,
            height: 8.5,
            rx: 2,
            stroke: 'currentColor',
            strokeWidth: 1,
            opacity: 0.35
          }),
          // The floating window itself, with a title bar line.
          h('rect', {
            x: 5.25,
            y: 5.25,
            width: 9.5,
            height: 9.5,
            rx: 2,
            stroke: 'currentColor',
            strokeWidth: 1
          }),
          h('path', {
            d: 'M7.5 8H12.5',
            stroke: 'currentColor',
            strokeWidth: 1,
            strokeLinecap: 'round'
          })
        )
      }

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

        // Session-default right panel width: the applier is installed here and
        // fires once from the saved percentage (host prefs first, browser
        // cache as fallback), then again whenever that percentage changes.
        // The active session, resolved through the session machinery: its
        // key AND its standard props (inputActions) and input state (draft).
        // bindingSource materialises the provided sources for any binding —
        // this is what lets the APP-LEVEL float write into whichever
        // session's composer is on screen, without a seat of its own.
        activeSession = function () {
          try {
            var ui = ctx.uiSession
            var source = ui && ui.adapter && ui.adapter.current
            if (!source || typeof source.getSnapshot !== 'function') return null
            // materialize() gives { key, ctx, hooks, keyedHooks, props } —
            // everything this panel needs in ONE snapshot: the session key,
            // the conversation's inputActions, and the input store (draft).
            var value = source.getSnapshot()
            if (!value || value.key === undefined || value.key === null) return null
            var inputStore = value.hooks && value.hooks.input
            return {
              key: value.key,
              inputActions: (value.props && value.props.inputActions) || null,
              readDraft: function () {
                try {
                  var snap = inputStore
                  if (snap && typeof snap.getSnapshot === 'function') snap = snap.getSnapshot()
                  return snap && typeof snap.draft === 'string' ? snap.draft : ''
                } catch (error) {
                  return ''
                }
              }
            }
          } catch (error) {
            return null
          }
        }
        var lastWidthPct = null
        prefsApplier = function (prefs) {
          var pct = Number(prefs && prefs.rightbarWidthPct)
          if (pct === lastWidthPct) return
          lastWidthPct = pct
          applyRightbarWidth(ctx, prefs)
        }
        request('prefs')
          .then(function (body) {
            var merged = Object.assign(loadPrefs(), body && body.prefs ? body.prefs : {})
            prefsStore.adopt(merged)
            prefsApplier(merged)
          })
          .catch(function () {
            prefsApplier(loadPrefs())
          })

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
                    return STR.persistHint
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

          // A task dragged out of the panel can land in the conversation.
        installDragBridge()

        // The floating window is APP-LEVEL: its host mounts into the frame's
          // root overlay seat (shell.overlay), so the window outlives any
          // session's sidebar — switching sessions keeps it on screen.
          scoped.effect(function () {
            return scoped.slots.inject('shell.overlay', function () {
              return scoped.slots.register(
                { name: 'shell.overlay', id: 'crabtodo-float', order: 100 },
                CrabFloatHost,
              )
            })
          }, 'crabtodo: float host')

        })
      }

      exports.name = 'crabtodo'
      // 'layout' is what makes ctx.layout real for this module: the frame's
      // panel actions (the width setter included) arrive through it. Without
      // the declaration the property never materialises — the width applier
      // silently did nothing.
      // 'uiSession' lets the GLOBAL float host bind the on-screen session
      // (its workspace key), so tasks created from the window land in the
      // project the user is actually looking at.
      exports.inject = ['slots', 'layout', 'uiSession']
      exports.apply = apply
      return module.exports
    }
  })
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : null)
