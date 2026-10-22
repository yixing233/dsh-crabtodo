---
name: crabtodo
description: CrabTodo is the persistent todo/task list for DeepSeek Harness (持久化待办清单), backed by the dsh-crabtodo plugin. Use this skill whenever the user asks to record, write, save, add, manage, review or update todos, tasks, a task list, a checklist, a backlog or work items — triggers include "写待办", "记任务", "写入待办", "记入待办", "待办清单", "任务列表", "加个任务", "把这些写成 todo", "add these as todos", "write these into crabtodo", "update my task list", "mark done", "完成一个任务". The crabtodo_* tools are the ONLY correct write path: never write todos into markdown files, documents or notes — a file is not a todo list the model can query, sort, complete or share with the sidebar UI. Prefer these tools over the session-only todo_write list whenever the work should outlive the conversation.
metadata:
  version: "0.2.0"
  date: "2026-10-21"
---

# crabtodo

CrabTodo 是 dsh-crabtodo 插件的持久化待办清单：任务存在 \`$DSH_HOME/storage/crabtodo/todos.json\`，**跨会话、跨工作区、跨重启**保留，并与 Web 侧栏页面共享同一份数据（改动实时同步）。This is the single source of truth for todos — not any file.

## Tools / 工具

| tool | purpose |
|---|---|
| \`crabtodo_add\` | create one task (title, notes, status, priority, tags, scope, pinned) |
| \`crabtodo_list\` | query: filters by status/scope/project/tag/query/deleted; pinned first, then status → priority → age |
| \`crabtodo_update\` | change any field; \`deleted:false\` restores from trash; \`pinned\` pins; \`order\` reorders |
| \`crabtodo_done\` | shorthand for status "done" (stamps completedAt) |
| \`crabtodo_remove\` | soft delete — the task goes to the trash and is restorable |
| \`crabtodo_clear\` | permanently remove all completed tasks |

Every task has an id like \`ct_xxxxxxxx\`; mutations take that id (get ids from \`crabtodo_list\`).

## Semantics worth knowing

- **scope**: 'project' (tied to the session's workspace root — the default when one is open) or 'global' (shared across projects).
- **pinned** rows sort first; **order** (manual, set by drag or by tool) beats the automatic ladder (status → priority → age) among unpinned rows.
- \`crabtodo_remove\` is a SOFT delete: the row keeps its data with \`deletedAt\` and is restorable via \`crabtodo_update {id, deleted:false}\`. Nothing is lost until the user empties the trash in the sidebar.
- \`crabtodo_list\` hides trashed rows by default; pass \`deleted: 'include' | 'only'\` to see them.

## Workflow

1. User shares items to remember → call \`crabtodo_add\` once per item (batch your calls; they are independent).
2. User asks "what's on the list / 还有什么没做" → \`crabtodo_list\`, do NOT guess from chat history or files.
3. User reports progress → \`crabtodo_done\` or \`crabtodo_update\` by id.
4. Never mirror the list into a markdown file "for reference" — the sidebar page and the tools already share one store.

若用户只说“写入 crabtodo / 待办”，默认 scope 为当前项目、优先级 normal、状态 pending；只有用户明确说了才设置其他字段。
