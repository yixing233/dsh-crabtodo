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
          expandDetails: '展开并编辑详情（备注、优先级、状态、标签）',
          expandDetailsAria: '展开并编辑详情',
          collapseDetails: '收起详情',
          scopeUnresolved: '未解析到工作区',
          scopeCurrentProject: '当前项目',
          deletedAt: '删除于 ',
          restore: '恢复任务',
          purge: '彻底删除',
          persistHint: '持久化待办清单：跨会话保留，模型与页面共享同一份数据',
          openLeft: function (n) { return n + ' 项未完成' },
          confirmDelete: '确认删除？',
          confirmYes: '确认删除',
          confirmPurge: '确认彻底删除？',
          confirmPurgeYes: '确认彻底删除',
          confirmEmptyYes: '确认清空',
          confirmEmptyTip: '再点一次将永久清空回收站',
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
          expandDetails: 'Expand details (notes, priority, status, tags)',
          expandDetailsAria: 'Expand details',
          collapseDetails: 'Collapse details',
          scopeUnresolved: 'No workspace resolved',
          scopeCurrentProject: 'Current project',
          deletedAt: 'Deleted at ',
          restore: 'Restore task',
          purge: 'Delete permanently',
          persistHint: 'A persistent todo list: survives sessions, shared between the model and this page',
          openLeft: function (n) { return n + ' open task(s)' },
          confirmDelete: 'Delete?',
          confirmYes: 'Confirm delete',
          confirmPurge: 'Delete forever?',
          confirmPurgeYes: 'Confirm permanent delete',
          confirmEmptyYes: 'Confirm empty',
          confirmEmptyTip: 'Click again to permanently empty the trash',
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
        '.ct-tabs{flex:0 0 auto;min-width:0;padding:0 2px}',
        // The primitive gives every tab an equal quarter of the row; in a narrow
        // panel that quarter is smaller than the label, and the CJK text broke
        // mid-word (进行/中). Nowrap plus a slightly smaller label keeps all
        // four on one line down to very narrow panels.
        '.ct-tabs [role="tab"]{white-space:nowrap}',
        '.ct-tab-label{display:inline-flex;align-items:center;gap:5px;line-height:1;white-space:nowrap;font-size:13px}',
        '.ct-tab-label svg{width:14px;height:14px}',

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
        '.ct-body{flex:1 1 auto;min-width:0;display:block}',
        '.ct-row{display:flex;align-items:flex-start;gap:5px;min-width:0}',
        // The title carries the row: weight 600 lifts it clear of the quiet
        // notes line below, so the eye reads titles first and details second.
        '.ct-text{flex:1 1 auto;min-width:0;overflow-wrap:break-word;text-wrap:pretty;color:var(--dsw-alias-label-primary);font-weight:600}',
        '.ct-item[data-status="done"] .ct-text{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}',
        '.ct-item[data-status="in_progress"] .ct-text{font:var(--dsw-font-xxs-12,12px/18px sans-serif);font-weight:600;color:var(--dsw-alias-label-primary)}',
        '.ct-text[role="button"]{cursor:text;border-radius:var(--dsw-radius-xs,4px)}',
        '.ct-text[role="button"]:hover{text-decoration:underline dotted;text-underline-offset:3px}',
        '.ct-text[role="button"]:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
        // Notes clamp to two lines: a four-line note per row breaks the
        // list's rhythm and buries the rows below it. The full text lives on
        // the hover tooltip and in the row editor.
        '.ct-notes{margin-top:2px;font:var(--dsw-font-xxxs-11,11px/14px sans-serif);color:var(--dsw-alias-label-tertiary);white-space:pre-wrap;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',

        // Notes detail view. The expanded state drops the clamp and renders
        // the Markdown whitelist; everything unknown stays literal text.
        '.ct-notes-collapsed{cursor:pointer}',
        '.ct-md{display:block;overflow:visible;cursor:pointer}',
        '.ct-md p{margin:0}',
        '.ct-md p+p{margin-top:3px}',
        '.ct-md ul{margin:2px 0;padding-inline-start:16px}',
        '.ct-md li{margin:1px 0}',
        '.ct-md a{color:var(--dsw-alias-brand-primary);text-decoration:underline}',
        '.ct-md code{font-family:ui-monospace,Consolas,monospace;font-size:10.5px;background:var(--dsw-alias-bg-layer-2);border-radius:3px;padding:0 3px}',
        '.ct-md strong{font-weight:600;color:var(--dsw-alias-label-primary)}',
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
        '.ct-actions{position:absolute;top:5px;right:2px;display:flex;gap:1px;opacity:0;transition:opacity .12s;flex:0 0 auto;padding:2px 4px;border-radius:var(--dsw-radius-xs,4px);background:var(--dsw-alias-bg-base,#111)}',
        '.ct-item:hover .ct-actions,.ct-item:focus-within .ct-actions{opacity:1}',
        '@media (hover:none){.ct-actions{opacity:1}}',
        // Touch devices have no hover: the buttons must occupy real space so
        // they do not permanently cover the title's end.
        '@media (hover:none){.ct-item .ct-body{padding-right:76px}}',
        '.ct-icon{display:inline-flex;align-items:center;justify-content:center;appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;border-radius:var(--dsw-radius-xs,4px);padding:1px 2px;line-height:1}',
        '.ct-icon:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
        '.ct-icon:disabled{opacity:.4;cursor:default}',
        '.ct-icon[data-active="true"]{color:var(--dsw-alias-brand-primary)}',

        // Two-step delete: arming swaps the control for an explicit confirm +
        // cancel pair. The danger tone reuses the semantic error colour.
        '.ct-confirm{display:inline-flex;align-items:center;gap:2px}',
        '.ct-confirm-label{font:var(--dsw-font-xxxs-11,11px/14px sans-serif);color:var(--dsw-alias-state-error-primary);white-space:nowrap}',
        '.ct-icon[data-tone="danger"]{color:var(--dsw-alias-state-error-primary)}',
        '.ct-btn[data-tone="danger"]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',

        // Chip badge: the open count rides beside the tab title. The fill/
        // foreground pair is the accent button's — a pairing the theme already
        // guarantees contrast for.
        '.ct-chip-title{display:inline-flex;align-items:center;gap:4px}',
        '.ct-chip-badge{min-width:14px;height:14px;padding:0 4px;border-radius:999px;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font:var(--dsw-font-xxxs-11,11px/14px sans-serif);font-size:9px;line-height:14px;text-align:center;box-sizing:border-box}',
        '.ct-pin-flag{font-size:10px;line-height:14px}',

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

        '.ct-empty{padding:22px 4px;text-align:center;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12,12px/18px sans-serif)}',

        // A real toast: floats OVER the list instead of occupying a row. It
        // used to sit in the flex column, so every confirmation shoved the
        // whole list down and back up when it faded. It rises from just above
        // the composer card — anchored to the card's top edge, not to a magic
        // offset, so it stays above the card whatever height the form takes.
        '.ct-foot{position:relative;flex:0 0 auto;min-width:0}',
        // Every message — errors included — lives in one stack rising from the
        // composer's top edge. Nothing takes a row, the list never jumps, and
        // when several messages coexist they stack instead of overlapping.
        // The stack itself ignores the pointer so the sliver of list behind it
        // stays clickable; each message takes its own events back.
        '.ct-msgs{position:absolute;bottom:100%;left:0;right:0;z-index:5;margin:0 10px 6px;display:flex;flex-direction:column;gap:6px;pointer-events:none}',
        '.ct-msgs>*{pointer-events:auto}',
        '@keyframes ct-toast-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}',
        '.ct-toast{margin:0;padding:6px 10px;border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-3);border:.5px solid var(--dsw-alias-border-l3);box-shadow:var(--dsw-elevation-panel);color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-11,11px/14px sans-serif);overflow-wrap:anywhere;animation:ct-toast-in .16s ease}',
        '.ct-error{margin:0;padding:6px 8px;border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);font:var(--dsw-font-xxxs-11,11px/14px sans-serif);overflow-wrap:anywhere;flex:0 0 auto}',

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
       * Open-task count for the chip badge: non-deleted, not done, every scope.
       *
       * Fetched once and kept live by the same SSE stream the panel uses, so a
       * model completing a task moves the badge without anyone opening the tab.
       */
      function useOpenCount() {
        var [count, setCount] = useState(null)
        useEffect(
          function () {
            var alive = true
            var refresh = function () {
              request('tasks')
                .then(function (body) {
                  if (!alive) return
                  var rows = Array.isArray(body.tasks) ? body.tasks : []
                  setCount(
                    rows.filter(function (task) {
                      return !task.deletedAt && task.status !== 'done'
                    }).length,
                  )
                })
                .catch(function () {
                  /* badge stays as-is; the panel reports errors, a chip need not */
                })
            }
            refresh()
            var stream = null
            try {
              stream = new EventSource(api('events'))
              stream.addEventListener('change', refresh)
              stream.onerror = function () {}
            } catch (error) {}
            return function () {
              alive = false
              if (stream) {
                try {
                  stream.close()
                } catch (error) {}
              }
            }
          },
          [],
        )
        return count
      }

      /**
       * The live chip title, registered under the
       * `sidebar.right.pane.tab.title` seat: the name plus an open-count badge,
       * so a collapsed sidebar or a crowded tab strip still says how much work
       * is left. Without this registration the chip falls back to the static
       * title captured when the tab opened.
       */
      function CrabTabTitle() {
        var count = useOpenCount()
        return h(
          'span',
          { className: 'ct-chip-title' },
          'CrabTodo',
          count
            ? h(
                'span',
                {
                  className: 'ct-chip-badge',
                  title: STR.openLeft(count),
                  'aria-label': STR.openLeft(count)
                },
                count > 99 ? '99+' : String(count),
              )
            : null,
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
        // The last soft-deleted task, kept here so the toast can undo it. The
        // server-side row is already trashed and recoverable either way; this
        // is just the one-click path back.
        var [undoTask, setUndoTask] = useState(null)
        // Trash view: shows the soft-deleted rows instead of live work.
        var [trash, setTrash] = useState(false)
        // Search box: filters the visible rows in memory, mirroring the
        // substring match crabtodo_list's query already performs server-side.
        var [query, setQuery] = useState('')
        // Emptying the trash is permanent: the bulk button arms first too.
        var [confirmEmpty, setConfirmEmpty] = useState(false)
        useEffect(
          function () {
            if (!confirmEmpty) return undefined
            var timer = setTimeout(function () {
              setConfirmEmpty(false)
            }, 4000)
            return function () {
              clearTimeout(timer)
            }
          },
          [confirmEmpty],
        )

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
            // and tags — kept local so typing costs no request.
            var needle = String(query || '')
              .trim()
              .toLowerCase()
            var matched =
              needle.length === 0
                ? rows
                : rows.filter(function (task) {
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
        return h(
          'div',
          { className: 'ct-root', ref: rootRef },
          // The tab chip already says "CrabTodo", so this strip carries only
          // the counts and the two whole-list actions.
          h(
            'div',
            { className: 'ct-head' },
            // In the trash the bar leads with an explicit way home — the
            // view is a dead end by design, so the exit says so in words.
            trash
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'ct-btn',
                    disabled: busy,
                    title: STR.backToList,
                    onClick: function () {
                      setTrash(false)
                    }
                  },
                  STR.home,
                )
              : null,
            h('span', { className: 'ct-count', title: STR.countTip(openCount, inScope.length) }, trash ? STR.trashCountText(inScope.length) : STR.countText(openCount, inScope.length)),
            h('span', { className: 'ct-spacer' }),
            trash
              ? confirmEmpty
                ? h(
                    'div',
                    { className: 'ct-confirm' },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'ct-btn',
                        'data-tone': 'danger',
                        disabled: busy,
                        title: STR.confirmEmptyTip,
                        onClick: function () {
                          setConfirmEmpty(false)
                          purgeDeleted()
                        }
                      },
                      STR.confirmEmptyYes,
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'ct-btn',
                        disabled: busy,
                        onClick: function () {
                          setConfirmEmpty(false)
                        }
                      },
                      STR.cancel,
                    )
                  )
                : h(
                    'button',
                    {
                      type: 'button',
                      className: 'ct-btn',
                      disabled: busy || trashCount === 0,
                      title: STR.emptyTrashTip,
                      onClick: function () {
                        setConfirmEmpty(true)
                      }
                    },
                    STR.emptyTrash,
                  )
              : h(
                  'button',
                  {
                    type: 'button',
                    className: 'ct-btn',
                    disabled: busy || tasks.length === 0,
                    title: STR.clearCompletedTip,
                    onClick: clearCompleted
                  },
                  STR.clearCompleted
                ),
            h(
              'button',
              {
                type: 'button',
                className: 'ct-iconbtn ct-ghost',
                disabled: busy,
                title: trash ? STR.backToList : STR.trashTitle(trashCount),
                'aria-label': trash ? STR.backToList : STR.trash,
                'aria-pressed': String(trash),
                onClick: function () {
                  setTrash(!trash)
                }
              },
              icon('IconTrashOutlineRegular', 13)
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
          h(
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
          trash ? null : renderSegmentedTabs(filter, setFilter),
          h(
            'div',
            { className: 'ct-list' },
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
                          onPurge: purge
                        })
                      : h(TaskRow, {
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
            h(AddTaskCard, { busy: busy, onSubmit: addTask, scope: scope, project: currentProject })
          )
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
                  h('input', {
                    className: 'ct-input',
                    value: tags,
                    placeholder: STR.tagsPlaceholder,
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
       * The notes whitelist renderer: a tiny Markdown subset — bullet lists,
       * paragraphs and the inline shapes above — as React elements. Any other
       * syntax stays text.
       */
      function renderMarkdown(text) {
        var lines = String(text == null ? '' : text).split('\n')
        var out = []
        var para = []
        var items = []
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
          var listKey = 'ul' + out.length
          out.push(
            h(
              'ul',
              { key: listKey },
              items.map(function (item, index) {
                return h('li', { key: 'li' + index }, renderInline(item, listKey + '-' + index))
              }),
            ),
          )
          items = []
        }
        lines.forEach(function (line) {
          var item = /^\s*[-*]\s+(.*)$/.exec(line)
          if (item) {
            flushPara()
            items.push(item[1])
            return
          }
          if (line.trim().length === 0) {
            flushPara()
            flushItems()
            return
          }
          flushItems()
          para.push(line)
        })
        flushPara()
        flushItems()
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
        // Purge is permanent — it arms first like the list's delete does.
        var [confirming, setConfirming] = useState(false)
        useEffect(
          function () {
            if (!confirming) return undefined
            var timer = setTimeout(function () {
              setConfirming(false)
            }, 4000)
            return function () {
              clearTimeout(timer)
            }
          },
          [confirming],
        )
        return h(
          'div',
          { className: 'ct-item', 'data-status': task.status, 'data-deleted': 'true' },
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
            confirming
              ? h(
                  'span',
                  { className: 'ct-confirm' },
                  h('span', { className: 'ct-confirm-label' }, STR.confirmPurge),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'ct-icon',
                      'data-tone': 'danger',
                      disabled: busy,
                      title: STR.confirmPurgeYes,
                      'aria-label': STR.confirmPurgeYes,
                      onClick: function () {
                        setConfirming(false)
                        props.onPurge(task.id)
                      }
                    },
                    icon('IconTrashOutlineRegular', 12)
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'ct-icon',
                      disabled: busy,
                      title: STR.cancel,
                      'aria-label': STR.cancel,
                      onClick: function () {
                        setConfirming(false)
                      }
                    },
                    '×',
                  )
                )
              : h(
                  'button',
                  {
                    type: 'button',
                    className: 'ct-icon',
                    disabled: busy,
                    title: STR.purge,
                    'aria-label': STR.purge,
                    onClick: function () {
                      setConfirming(true)
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
        // Delete arms first, deletes second: one mis-click among the hover
        // icons must not bin a task outright. The armed state disarms itself.
        var [confirming, setConfirming] = useState(false)
        useEffect(
          function () {
            if (!confirming) return undefined
            var timer = setTimeout(function () {
              setConfirming(false)
            }, 4000)
            return function () {
              clearTimeout(timer)
            }
          },
          [confirming],
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

        return h(
          'div',
          { className: 'ct-item', 'data-status': task.status },
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
                      return h('span', { key: tag, className: 'ct-tag' }, '#' + tag)
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
            // "添加到对话": writes this task into the composer draft.
            h(
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
            // Two-step delete: the first click arms, the strip swaps to an
            // explicit confirm + cancel pair, the second click does it.
            confirming
              ? h(
                  'span',
                  { className: 'ct-confirm' },
                  h('span', { className: 'ct-confirm-label' }, STR.confirmDelete),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'ct-icon',
                      'data-tone': 'danger',
                      disabled: busy,
                      title: STR.confirmYes,
                      'aria-label': STR.confirmYes,
                      onClick: function () {
                        setConfirming(false)
                        props.onRemove(task.id)
                      }
                    },
                    icon('IconTrashOutlineRegular', 12)
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'ct-icon',
                      disabled: busy,
                      title: STR.cancel,
                      'aria-label': STR.cancel,
                      onClick: function () {
                        setConfirming(false)
                      }
                    },
                    '×',
                  )
                )
              : h(
                  'button',
                  {
                    type: 'button',
                    className: 'ct-icon',
                    disabled: busy,
                    title: STR.remove,
                    'aria-label': STR.remove,
                    onClick: function () {
                      setConfirming(true)
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

          // Stage three: the live chip title — name plus open-count badge.
          // The host dispatches chip titles through this seat; without a
          // registration the chip shows the static title captured at open.
          scoped.effect(function () {
            return scoped.slots.inject('sidebar.right.pane.tab.title', function () {
              return scoped.slots.register({ name: 'sidebar.right.pane.tab.title', key: TAB_ID }, CrabTabTitle)
            })
          }, 'crabtodo: chip title')
        })
      }

      exports.name = 'crabtodo'
      exports.inject = ['slots']
      exports.apply = apply
      return module.exports
    }
  })
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : null)
