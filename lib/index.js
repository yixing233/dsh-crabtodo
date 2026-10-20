/**
 * CrabTodo — persistent todo manager for DeepSeek Harness (host half).
 *
 * Everything here runs inside the DSH host process. It owns three things:
 *
 *   1. A JSON store under `$DSH_HOME` (last-write-wins, atomic replace, and a
 *      serialized write queue so concurrent tool calls cannot interleave).
 *   2. Six model-facing tools registered on `ctx.tools`.
 *   3. The sidebar page's transport: a REST API plus an SSE change stream,
 *      registered on `ctx.webServer` when the web composition provides it.
 *
 * The browser half (`./client`) is the page itself; the two halves share only
 * the wire types below, never a runtime module.
 *
 * Loader safety: `webServer` is resolved with `ctx.get()`, not `inject`, so a
 * headless/SDK profile can mount this plugin and still get the tools.
 *
 * @module dsh-crabtodo
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'

import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

/** Plugin identity for cordis.yml rows and diagnostics. */
export const name = 'crabtodo'

/** `tools` is required (the whole point); `webServer` is resolved lazily. */
export const inject = ['tools']

// ───────────────────────────────────────────────────────────────────────────
// Configuration
// ───────────────────────────────────────────────────────────────────────────

export const Config = z.object({
  /** JSON file holding the task list. `~` expands against the OS home. */
  dataFile: z
    .string()
    .default('~/.dsh/storage/crabtodo/todos.json')
    .description('JSON store path. `~` expands against the OS home directory.'),
  /** Register the `crabtodo_*` tools on the model-facing tool registry. */
  exposeTools: z
    .boolean()
    .default(true)
    .description('Expose the crabtodo_* tools to the model.'),
  /** Serve the sidebar page's REST API and event stream. */
  exposeHttp: z
    .boolean()
    .default(true)
    .description('Serve /crabtodo API routes for the sidebar page.'),
  /** Tool description prefix that teaches the model the storage lifetime. */
  toolHint: z
    .string()
    .default(
      'CrabTodo is durable across sessions and restarts — unlike the session-only todo_write list.',
    )
    .description('Extra sentence appended to every tool description.'),
  /**
   * Fallback project key, used when the session has no workspace root.
   *
   * Headless and SDK compositions run without a session `cwd`, so without this
   * every task would fall back to global scope. A deployment that knows its
   * project (or a single-project profile) sets this once.
   */
  projectKey: z
    .string()
    .default('')
    .description(
      'Fallback project key for compositions without a session workspace root (headless/SDK). Empty means: use the session cwd, else global.',
    ),
})

// ───────────────────────────────────────────────────────────────────────────
// Wire types (shared shape with the browser half; duplicated, not imported)
// ───────────────────────────────────────────────────────────────────────────

/** The three lifecycle states every consumer agrees on. */
const STATUSES = /** @type {const} */ (['pending', 'in_progress', 'done'])
/** Priority ladder, lowest to highest. */
const PRIORITIES = /** @type {const} */ (['low', 'normal', 'high', 'urgent'])
/** Task scopes: work that belongs to one workspace root, or everything. */
const SCOPES = /** @type {const} */ (['project', 'global'])

/** Epoch millis. */
const now = () => Date.now()

/** Absolute path for the configured store, expanding `~`. */
function resolveDataFile(configured) {
  const raw = String(configured ?? '').trim()
  const expanded = raw.startsWith('~') ? join(homedir(), raw.slice(1)) : raw
  return isAbsolute(expanded) ? expanded : join(process.cwd(), expanded)
}

/** One blank store. */
function emptyStore() {
  return { version: 1, updatedAt: now(), tasks: [] }
}

/**
 * Repair whatever is on disk into a usable store. A corrupt file must never
 * take the plugin down: the tools are more useful with an empty list than
 * with a failed fiber.
 * @param {unknown} value - parsed JSON, or anything else.
 * @returns {{store: object, repaired: boolean}} the store and whether anything changed.
 */
function normalizeStore(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { store: emptyStore(), repaired: true }
  }
  const source = /** @type {Record<string, any>} */ (value)
  if (!Array.isArray(source.tasks)) return { store: emptyStore(), repaired: true }

  let repaired = false
  /** @type {object[]} */
  const tasks = []
  const seen = new Set()
  for (const raw of source.tasks) {
    if (!raw || typeof raw !== 'object') {
      repaired = true
      continue
    }
    const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : null
    const title = typeof raw.title === 'string' ? raw.title.trim() : ''
    if (!id || title.length === 0 || seen.has(id)) {
      repaired = true
      continue
    }
    seen.add(id)
    const status = STATUSES.includes(raw.status) ? raw.status : 'pending'
    const priority = PRIORITIES.includes(raw.priority) ? raw.priority : 'normal'
    if (status !== raw.status || priority !== raw.priority) repaired = true
    // Migration: tasks written before scopes existed become global rows, which
    // is the only assumption that never hides someone's existing list behind a
    // project filter they have not used yet.
    const scope = raw.scope === 'project' ? 'project' : 'global'
    if (raw.scope !== scope) repaired = true
    const project = scope === 'project' && typeof raw.project === 'string' && raw.project.length > 0 ? raw.project : null
    if (scope === 'project' && project === null) repaired = true
    tasks.push({
      id,
      title,
      notes: typeof raw.notes === 'string' ? raw.notes : '',
      status,
      priority,
      scope,
      project,
      tags: Array.isArray(raw.tags) ? raw.tags.filter((tag) => typeof tag === 'string' && tag.length > 0) : [],
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : now(),
      updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : now(),
      completedAt: Number.isFinite(raw.completedAt) ? raw.completedAt : null,
      // Migration: rows written before soft delete existed read as not
      // deleted — the field's absence must never look like a trashed row.
      deletedAt: Number.isFinite(raw.deletedAt) ? raw.deletedAt : null,
      // Migration: rows written before pinning existed read as unpinned.
      pinned: raw.pinned === true,
      source: typeof raw.source === 'string' ? raw.source : 'unknown',
    })
  }
  return {
    store: {
      version: 1,
      updatedAt: Number.isFinite(source.updatedAt) ? source.updatedAt : now(),
      tasks,
    },
    repaired,
  }
}

/**
 * The store: one in-memory snapshot behind a serialized writer.
 *
 * Writes are queued rather than debounced so a tool call's returned value is
 * exactly what landed on disk when `execute` resolves — the model is told the
 * truth, and a crash right after the response cannot lose the edit.
 */
class TodoStore {
  /** @param {string} file - absolute store path. */
  constructor(file) {
    this.file = file
    /** @type {ReturnType<typeof emptyStore>} */
    this.state = emptyStore()
    /** @type {Promise<unknown>} */
    this.queue = Promise.resolve()
    /** @type {Promise<any> | null} one-shot disk read, shared by every caller. */
    this.loading = null
    /** @type {Set<(snapshot: object) => void>} */
    this.listeners = new Set()
  }

  /**
   * Read the file once; tolerate absence and corruption.
   *
   * The in-flight promise — not a boolean — is the guard: several callers can
   * await the same read, and none of them can observe a half-loaded state.
   * @returns {Promise<any>} the loaded state.
   */
  async load() {
    if (!this.loading) this.loading = this.#read()
    return this.loading
  }

  /** @returns {Promise<any>} the state after the one disk read. */
  async #read() {
    try {
      const text = await readFile(this.file, 'utf8')
      const { store, repaired } = normalizeStore(JSON.parse(text))
      this.state = store
      if (repaired) await this.persist()
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error)?.code !== 'ENOENT') {
        // Corrupt or unreadable: start clean but keep the evidence on disk.
        this.state = emptyStore()
      }
    }
    return this.state
  }

  /** Serialize one whole snapshot to disk atomically. */
  async persist() {
    await mkdir(dirname(this.file), { recursive: true })
    const temp = `${this.file}.${process.pid}.tmp`
    await writeFile(temp, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8')
    await rename(temp, this.file)
  }

  /** Current snapshot (defensive copy for callers). */
  snapshot() {
    return structuredClone(this.state)
  }

  /**
   * Run one mutation with exclusive access.
   * @template T
   * @param {(state: any) => T | Promise<T>} mutate - receives the live state.
   * @returns {Promise<T>} the mutation's result, after the write landed.
   */
  async transact(mutate) {
    const run = this.queue.then(async () => {
      await this.load()
      const result = await mutate(this.state)
      this.state.updatedAt = now()
      await this.persist()
      const snapshot = this.snapshot()
      for (const listener of this.listeners) listener(snapshot)
      return result
    })
    // Keep the chain alive after a rejection so one bad call cannot wedge
    // every later write.
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /** @param {(snapshot: object) => void} listener */
  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Task operations — the one implementation both halves' transports call
// ───────────────────────────────────────────────────────────────────────────

/** Trim, and reject empty required strings. */
function requireText(value, field) {
  const text = String(value ?? '').trim()
  if (text.length === 0) throw new Error(`\`${field}\` must be a non-empty string.`)
  return text
}

/** Normalize a tag list: trimmed, de-duplicated, order preserved. */
function normalizeTags(tags) {
  if (tags === undefined) return undefined
  const out = []
  const seen = new Set()
  for (const raw of Array.isArray(tags) ? tags : []) {
    const tag = String(raw ?? '').trim()
    if (tag.length === 0 || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
  }
  return out
}

/** Find a live task by id, or throw a message the model can act on. */
function findTask(state, id) {
  const task = state.tasks.find((candidate) => candidate.id === id)
  if (!task) throw new Error(`No CrabTodo task with id ${JSON.stringify(id)}. Call crabtodo_list to see current ids.`)
  return task
}

/**
 * Create one task.
 * @param {any} state - live store state (mutated).
 * @param {object} input - title plus optional fields.
 * @param {object|string} source - caller context `{project}` or a provenance string.
 */
function createTask(state, input, source, resolveSession) {
  const title = requireText(input.title, 'title')
  const status = input.status ?? 'pending'
  if (!STATUSES.includes(status)) throw new Error(`\`status\` must be one of ${STATUSES.join(', ')}.`)
  const priority = input.priority ?? 'normal'
  if (!PRIORITIES.includes(priority)) throw new Error(`\`priority\` must be one of ${PRIORITIES.join(', ')}.`)
  const placed = placeTask(input, source, resolveSession)
  const stamp = now()
  const task = {
    id: `ct_${randomUUID().slice(0, 8)}`,
    title,
    notes: typeof input.notes === 'string' ? input.notes : '',
    status,
    priority,
    scope: placed.scope,
    project: placed.project,
    tags: normalizeTags(input.tags) ?? [],
    createdAt: stamp,
    updatedAt: stamp,
    completedAt: status === 'done' ? stamp : null,
    deletedAt: null,
    pinned: Boolean(input && input.pinned),
    source: (input && typeof input.source === 'string' && input.source) || 'unknown',
  }
  state.tasks.push(task)
  return task
}

/**
 * Resolve the workspace root a tool call belongs to, used as its project key.
 *
 * The authoritative location is the SESSION header: `cwd` is durable creation
 * metadata there (validated absolute), which is the root the user picked for
 * this conversation. `exec.agent.cwd` is only a convenience that some
 * compositions leave unset (headless runs do), so it is a fallback rather than
 * the primary source.
 *
 * `null` means "no workspace", and a task created then falls back to global
 * scope rather than inventing a project nobody can name again.
 * @param {any} exec - tool run context.
 * @param {any} sessions - the session registry, when available.
 * @returns {{project: string|null}}
 */
function projectOf(exec, sessions, fallbackKey) {
  const direct = exec?.agent?.cwd
  if (typeof direct === 'string' && direct.length > 0) return { project: direct }

  const sessionId = exec?.agent?.sessionId ?? exec?.inputSessionId
  if (sessionId && sessions && typeof sessions.get === 'function') {
    try {
      const session = sessions.get(sessionId)
      const cwd = session?.header?.cwd ?? session?.meta?.cwd
      if (typeof cwd === 'string' && cwd.length > 0) return { project: cwd }
    } catch (error) {
      /* no such session (or no header yet): fall through */
    }
  }

  // Headless/SDK runs have no workspace root at all; a configured key keeps
  // their tasks project-scoped instead of silently global.
  if (typeof fallbackKey === 'string' && fallbackKey.trim().length > 0) {
    return { project: fallbackKey.trim() }
  }
  return { project: null }
}

/**
 * Resolve a workspace root from a bare session id.
 *
 * Shared by the tool path and the HTTP path: `placeTask` and `updateTask` need
 * the same answer whether a move came from the model or from the sidebar.
 * @param {string} id - session id.
 * @param {any} sessions - session registry, when available.
 * @returns {string|null}
 */
function sessionCwd(id, sessions) {
  if (!id || !sessions || typeof sessions.get !== 'function') return null
  try {
    const session = sessions.get(id)
    const cwd = session?.header?.cwd ?? session?.meta?.cwd
    return typeof cwd === 'string' && cwd.length > 0 ? cwd : null
  } catch (error) {
    return null
  }
}

/**
 * Resolve which scope a task belongs to.
 *
 * Two scopes only: `project` (tasks that live with one workspace root) and
 * `global` (everything else). A caller that names no scope gets `project` when
 * a workspace is known and `global` otherwise, which is the behaviour a person
 * expects: work started in a repo belongs to that repo, and work started
 * nowhere belongs to everything.
 * @param {object} input - task input; may carry `scope` and `project`.
 * @param {object} context - `{ project }` resolved from the caller.
 * @returns {{scope: 'project'|'global', project: string|null}}
 */
function placeTask(input, context, resolveSession) {
  const requested = input && input.scope
  if (requested !== undefined && requested !== null && requested !== 'project' && requested !== 'global') {
    throw new Error("`scope` must be 'project' or 'global'.")
  }
  // `createTask` historically took the provenance string here; accept both a
  // bare string (no workspace known) and a `{ project }` context object so no
  // call site silently loses its project.
  let contextProject =
    typeof context === 'string'
      ? null
      : context && typeof context.project === 'string' && context.project.length > 0
        ? context.project
        : null

  // A caller that names a session (the browser page cannot read its cwd) gets
  // the project resolved from that session instead of silently going global.
  if (!contextProject && typeof resolveSession === 'function' && input && typeof input.sessionId === 'string') {
    try {
      const resolved = resolveSession(input.sessionId)
      if (resolved) contextProject = resolved
    } catch (error) {
      /* unknown session: leave it unresolved */
    }
  }
  const explicitProject = typeof input.project === 'string' && input.project.trim().length > 0 ? input.project.trim() : null

  // An explicit scope wins; otherwise default to the caller's project.
  const scope = requested ?? (contextProject ? 'project' : 'global')
  if (scope === 'global') return { scope: 'global', project: null }

  const project = explicitProject ?? contextProject
  if (!project) {
    // The caller asked for project scope but no workspace is resolvable (the
    // browser page, a headless run, a session without cwd). Refusing would make
    // the "add" button fail with no way forward, so degrade to global and keep
    // the task: an unfiled task is far better than a lost one.
    return { scope: 'global', project: null }
  }
  return { scope: 'project', project }
}

/**
 * Patch one task in place. Only provided fields move; done/pending flips keep
 * `completedAt` consistent without the caller thinking about it.
 * @param {any} state - live store state.
 * @param {string} id - target task id.
 * @param {object} patch - partial fields.
 */
function updateTask(state, id, patch, context, resolveSession) {
  const task = findTask(state, id)
  if (patch.title !== undefined) task.title = requireText(patch.title, 'title')
  if (patch.notes !== undefined) task.notes = String(patch.notes ?? '')
  if (patch.status !== undefined) {
    if (!STATUSES.includes(patch.status)) throw new Error(`\`status\` must be one of ${STATUSES.join(', ')}.`)
    if (patch.status !== task.status) {
      task.status = patch.status
      task.completedAt = patch.status === 'done' ? now() : null
    }
  }
  if (patch.priority !== undefined) {
    if (!PRIORITIES.includes(patch.priority)) throw new Error(`\`priority\` must be one of ${PRIORITIES.join(', ')}.`)
    task.priority = patch.priority
  }
  const tags = normalizeTags(patch.tags)
  if (tags !== undefined) task.tags = tags
  // Moving a task between scopes is a legitimate edit (a note started in a
  // repo turns out to be general). Re-place it from the requested scope so the
  // pair stays consistent instead of leaving a project key on a global row.
  if (patch.scope !== undefined) {
    // Pass the caller's context through: moving a task INTO project scope needs
    // the same workspace resolution a create gets, or it silently degrades back
    // to global and the move appears to do nothing.
    const placed = placeTask(
      { scope: patch.scope, project: patch.project, sessionId: patch.sessionId },
      context,
      resolveSession,
    )
    task.scope = placed.scope
    task.project = placed.project
  }
  // Trash control, so a mistaken tool-call delete is itself undoable:
  // `deleted: true` soft-deletes (idempotent), `deleted: false` restores.
  if (patch.deleted !== undefined) {
    if (typeof patch.deleted !== 'boolean') throw new Error('`deleted` must be a boolean.')
    if (patch.deleted) {
      if (task.deletedAt === null) task.deletedAt = now()
    } else {
      task.deletedAt = null
    }
  }
  // Pinning floats a task above the sort ladder without moving it anywhere.
  if (patch.pinned !== undefined) {
    if (typeof patch.pinned !== 'boolean') throw new Error('`pinned` must be a boolean.')
    task.pinned = patch.pinned
  }
  task.updatedAt = now()
  return task
}

/**
 * Soft-delete one task: the row keeps its data, gains a `deletedAt` stamp and
 * leaves every default listing. This is the only delete the tools and the
 * page's trash button perform — a mis-click costs one click to undo, not the
 * task. Restore with `updateTask(state, id, { deleted: false })`; permanence
 * is `purgeTask`'s job and lives only behind explicit purge paths.
 * @returns {object} the trashed row.
 */
function removeTask(state, id) {
  const task = findTask(state, id)
  if (task.deletedAt === null) {
    task.deletedAt = now()
    task.updatedAt = now()
  }
  return task
}

/** Permanently drop one task. Only explicit purge paths may call this. */
function purgeTask(state, id) {
  const task = findTask(state, id)
  state.tasks = state.tasks.filter((candidate) => candidate.id !== id)
  return task
}

/** Permanently drop every trashed row (the trash's 清空回收站). */
function purgeDeleted(state) {
  const before = state.tasks.length
  state.tasks = state.tasks.filter((task) => task.deletedAt === null)
  return before - state.tasks.length
}

/** Stable ordering: open work first, then priority, then age. */
const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 }
const STATUS_RANK = { in_progress: 0, pending: 1, done: 2 }

/**
 * @param {any[]} tasks
 * @param {{status?: string, tag?: string, query?: string, deleted?: string}} filter
 */
function selectTasks(tasks, filter) {
  const query = filter.query ? String(filter.query).toLowerCase() : ''
  const tag = filter.tag ? String(filter.tag).toLowerCase() : ''
  // Trash visibility. Trashed rows are hidden by default; 'include' shows them
  // alongside live work, 'only' lists just the trash.
  const deleted = filter.deleted === 'include' || filter.deleted === 'only' ? filter.deleted : 'exclude'
  let out = tasks.filter((task) => {
    const isDeleted = task.deletedAt !== null && task.deletedAt !== undefined
    if (deleted === 'exclude' && isDeleted) return false
    if (deleted === 'only' && !isDeleted) return false
    if (filter.status && task.status !== filter.status) return false
    // Scope filter: `project` keeps only rows of one workspace root,
    // `global` only the cross-project rows. Omitted means "everything", which
    // is what an unfiltered list should show.
    if (filter.scope === 'project' && task.scope !== 'project') return false
    if (filter.scope === 'global' && task.scope !== 'global') return false
    if (filter.project && task.project !== filter.project) return false
    if (tag && !task.tags.some((candidate) => candidate.toLowerCase() === tag)) return false
    if (query) {
      const haystack = `${task.title}\n${task.notes}\n${task.tags.join(' ')}`.toLowerCase()
      if (!haystack.includes(query)) return false
    }
    return true
  })
  // Pinned rows float above the ladder; below them the ladder is unchanged:
  // status, then priority, then age.
  out = out.sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      a.createdAt - b.createdAt,
  )
  return out
}

/**
 * Human-readable one-liner for model-facing render.
 *
 * Defensive on every field: `output.render` also runs against the partial
 * canonical value a tool declared (e.g. `crabtodo_update` returns only
 * id/title/status/priority), so a renderer must never assume a task row is
 * complete. A throw here reaches the model as a render failure even though
 * the write already succeeded.
 */
function renderTask(task) {
  const row = task ?? {}
  const box = row.status === 'done' ? '[x]' : row.status === 'in_progress' ? '[~]' : '[ ]'
  const pri = row.priority && row.priority !== 'normal' ? ` (${row.priority})` : ''
  const tags = Array.isArray(row.tags) && row.tags.length > 0 ? ` #${row.tags.join(' #')}` : ''
  const gone = row.deletedAt ? ' [trashed]' : ''
  const pin = row.pinned ? '📌 ' : ''
  return `${pin}${box} ${row.title ?? ''}${pri}${tags}${gone}  — ${row.id ?? ''}`.trim()
}

/** Whole-list rendering shared by every tool that returns tasks. */
function renderList(tasks, emptyText) {
  if (tasks.length === 0) return emptyText
  return tasks.map(renderTask).join('\n')
}

// ───────────────────────────────────────────────────────────────────────────
// Plugin body
// ───────────────────────────────────────────────────────────────────────────

/**
 * Mount the host half.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {any} config - validated plugin configuration.
 */
export function apply(ctx, config) {
  const conf = config ?? {}
  const hint = String(conf.toolHint ?? '').trim()
  const withHint = (text) => (hint.length > 0 ? `${text} ${hint}` : text)
  const store = new TodoStore(resolveDataFile(conf.dataFile))
  // Kick the read off immediately so the first tool call is not paying for it.
  store.load().catch(() => {})

  // Expose the live snapshot for other plugins and for debugging; harmless if
  // another package already took the name.
  if (typeof ctx.provide === 'function') {
    try {
      ctx.provide('crabtodo', {
        version: 1,
        snapshot: () => store.snapshot(),
        subscribe: (listener) => store.subscribe(listener),
        dataFile: store.file,
        create: (input) => store.transact((state) => createTask(state, input, 'plugin')),
        update: (id, patch) => store.transact((state) => updateTask(state, id, patch)),
        remove: (id) => store.transact((state) => removeTask(state, id)),
        purge: (id) => store.transact((state) => purgeTask(state, id)),
        purgeDeleted: () => store.transact((state) => purgeDeleted(state)),
      })
    } catch {
      ctx.logger?.('crabtodo')?.warn?.('service `crabtodo` already provided; skipping export')
    }
  }

  // Resolve `sessions` lazily: it carries the durable workspace root, but a
  // minimal composition may not provide it, and that must not cost us the
  // tools themselves. `_sessionsOverride` exists so tests can supply one.
  const sessions =
    conf._sessionsOverride ?? (typeof ctx.get === 'function' ? ctx.get('sessions') : undefined)

  if (conf.exposeTools !== false) {
    registerTools(ctx, store, withHint, sessions, conf.projectKey)
  }
  if (conf.exposeHttp !== false) registerHttp(ctx, store, sessions, conf.projectKey)

  ctx.effect(
    () => () => {
      store.listeners.clear()
    },
    'crabtodo: store teardown',
  )
}

/**
 * Register the six model-facing tools.
 * @param {any} ctx - plugin context.
 * @param {TodoStore} store - the shared store.
 * @param {(text: string) => string} withHint - description decorator.
 */
function registerTools(ctx, store, withHint, sessions, fallbackProject) {
  const register = (definition) => {
    try {
      ctx.tools.register(definition)
    } catch (error) {
      ctx.logger?.('crabtodo')?.warn?.(`tool ${definition.name} not registered: ${error?.message ?? error}`)
    }
  }

  register(
    defineTool({
      name: 'crabtodo_add',
      description: withHint(
        'Add one task to the durable CrabTodo list. Returns the created task with its id. Use this instead of the session-only todo_write list when the task must survive the conversation. Tasks default to the current project scope; pass scope "global" for cross-project work.',
      ),
      parameters: {
        title: { type: 'string', required: true, description: 'Short imperative task title.' },
        notes: { type: 'string', description: 'Optional longer description.' },
        status: {
          type: 'string',
          enum: [...STATUSES],
          description: 'Initial status (default pending).',
        },
        priority: {
          type: 'string',
          enum: [...PRIORITIES],
          description: 'Priority (default normal).',
        },
        scope: {
          type: 'string',
          enum: [...SCOPES],
          description:
            "Where the task lives: 'project' (this workspace, the default when one is open) or 'global' (visible from every project).",
        },
        project: {
          type: 'string',
          description:
            'Project key, only needed when targeting a project other than the current workspace. Usually omit it.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional free-form tags for grouping.',
        },
        pinned: {
          type: 'boolean',
          description: 'Start pinned to the top of the list.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            status: { type: 'string' },
            priority: { type: 'string' },
            scope: { type: 'string' },
            // null for global tasks; the schema must admit it or every global
            // create fails validation even though the write succeeded.
            project: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: `Created ${String(value.id)}: ${String(value.title)} (${value.scope === 'project' ? `项目 ${String(value.project)}` : '全局'})`,
          },
        ],
      },
      async execute(args, exec) {
        const context = projectOf(exec, sessions, fallbackProject)
        const task = await store.transact((state) =>
          createTask(state, { ...args, source: 'model' }, context, (sid) => sessionCwd(sid, sessions)),
        )
        return {
          id: task.id,
          title: task.title,
          status: task.status,
          priority: task.priority,
          scope: task.scope,
          // Never `undefined`: the registry validates this value as lossless
          // JSON, so an absent project must be the JSON null, not a hole in
          // the object.
          project: task.project === null || task.project === undefined ? null : String(task.project),
        }
      },
    }),
  )

  register(
    defineTool({
      name: 'crabtodo_list',
      description: withHint(
        'List CrabTodo tasks, optionally filtered. Pinned tasks come first; below them the order is status, then priority, then age.',
      ),
      parameters: {
        status: { type: 'string', enum: [...STATUSES], description: 'Only tasks in this status.' },
        scope: {
          type: 'string',
          enum: [...SCOPES],
          description:
            "Only tasks of this scope: 'project' (this workspace) or 'global' (cross-project). Omit to list both.",
        },
        project: {
          type: 'string',
          description: 'Only tasks of this project key. Omit to use every project.',
        },
        tag: { type: 'string', description: 'Only tasks carrying this tag.' },
        query: { type: 'string', description: 'Case-insensitive substring match on title, notes and tags.' },
        deleted: {
          type: 'string',
          enum: ['exclude', 'include', 'only'],
          description:
            "Trash visibility (default 'exclude'): 'include' also lists trashed tasks, 'only' lists just the trash.",
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            count: { type: 'number' },
            tasks: { type: 'array', items: { type: 'object', additionalProperties: true } },
          },
        },
        render: (_args, value) =>
          [{ type: 'text', text: renderList(value.tasks ?? [], 'CrabTodo is empty.') }],
      },
      async execute(args) {
        await store.load()
        const filter = args ?? {}
        const tasks = selectTasks(store.snapshot().tasks, filter)
        return { count: tasks.length, tasks }
      },
    }),
  )

  register(
    defineTool({
      name: 'crabtodo_update',
      description: withHint(
        'Change fields of one CrabTodo task. Only the fields you pass move; setting status to done stamps completedAt.',
      ),
      parameters: {
        id: { type: 'string', required: true, description: 'Task id (ct_xxxxxxxx).' },
        title: { type: 'string', description: 'Replacement title.' },
        notes: { type: 'string', description: 'Replacement notes.' },
        status: { type: 'string', enum: [...STATUSES], description: 'New status.' },
        priority: { type: 'string', enum: [...PRIORITIES], description: 'New priority.' },
        scope: {
          type: 'string',
          enum: [...SCOPES],
          description: "Move the task to another scope: 'project' or 'global'.",
        },
        project: { type: 'string', description: 'Project key to move the task to (with scope "project").' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Replacement tag list.' },
        deleted: {
          type: 'boolean',
          description: 'Trash control: true soft-deletes the task, false restores a trashed one.',
        },
        pinned: {
          type: 'boolean',
          description: 'Pin to the top of the list (true) or unpin (false).',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            status: { type: 'string' },
            priority: { type: 'string' },
            deletedAt: { oneOf: [{ type: 'number' }, { type: 'null' }] },
          },
        },
        render: (_args, value) => [
          { type: 'text', text: `Updated ${String(value.id)}: ${renderTask(value)}` },
        ],
      },
      async execute(args, exec) {
        const { id, ...patch } = args
        const context = projectOf(exec, sessions, fallbackProject)
        const task = await store.transact((state) =>
          updateTask(state, id, patch, context, (sid) => sessionCwd(sid, sessions)),
        )
        return {
          id: task.id,
          title: task.title,
          status: task.status,
          priority: task.priority,
          scope: task.scope,
          project: task.project === null || task.project === undefined ? null : String(task.project),
          deletedAt: task.deletedAt === undefined ? null : task.deletedAt,
        }
      },
    }),
  )

  register(
    defineTool({
      name: 'crabtodo_done',
      description: withHint('Mark one task done. Shorthand for crabtodo_update with status "done".'),
      parameters: {
        id: { type: 'string', required: true, description: 'Task id (ct_xxxxxxxx).' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: { id: { type: 'string' }, title: { type: 'string' }, status: { type: 'string' } },
        },
        render: (_args, value) => [{ type: 'text', text: `Done: ${String(value.title)} (${String(value.id)})` }],
      },
      async execute(args) {
        const task = await store.transact((state) => updateTask(state, args.id, { status: 'done' }))
        return { id: task.id, title: task.title, status: task.status }
      },
    }),
  )

  register(
    defineTool({
      name: 'crabtodo_remove',
      description: withHint(
        'Move one task to the trash (soft delete): the row keeps its data, gains a deletedAt stamp and leaves crabtodo_list. Restore it with crabtodo_update {id, deleted:false} — nothing is lost until the user purges the trash in the sidebar.',
      ),
      parameters: {
        id: { type: 'string', required: true, description: 'Task id (ct_xxxxxxxx).' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            deletedAt: { oneOf: [{ type: 'number' }, { type: 'null' }] },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: `Trashed ${String(value.id)}: ${String(value.title)} (restore with crabtodo_update deleted:false)`,
          },
        ],
      },
      async execute(args) {
        const task = await store.transact((state) => removeTask(state, args.id))
        return { id: task.id, title: task.title, deletedAt: task.deletedAt ?? null }
      },
    }),
  )

  register(
    defineTool({
      name: 'crabtodo_clear',
      description: withHint(
        'Permanently delete every completed task in one call; open work is untouched. Use it to tidy the list instead of removing rows one by one. This is permanent — unlike crabtodo_remove, which is restorable.',
      ),
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: { removed: { type: 'number' } },
        },
        render: (_args, value) => [{ type: 'text', text: `Removed ${String(value.removed)} completed task(s).` }],
      },
      async execute() {
        const removed = await store.transact((state) => {
          const before = state.tasks.length
          state.tasks = state.tasks.filter((task) => task.status !== 'done')
          return before - state.tasks.length
        })
        return { removed }
      },
    }),
  )
}

// ───────────────────────────────────────────────────────────────────────────
// HTTP transport for the sidebar page
// ───────────────────────────────────────────────────────────────────────────

/** Read a JSON request body with a size ceiling. */
async function readJson(req, limitBytes = 1_000_000) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limitBytes) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim().length === 0) return {}
  const parsed = JSON.parse(text)
  return parsed && typeof parsed === 'object' ? parsed : {}
}

/** Write one JSON response. */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

/** Same-origin check: this API is for the local UI, not a public surface. */
function sameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true // same-origin GETs and the Electron shell omit it
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

/**
 * Resolve the project context for a request that came from the browser page.
 *
 * The page is session-scoped but cannot read that session's workspace root, so
 * it forwards `sessionId` and this mirrors what a tool call does:
 * `sessions.get(id).header.cwd` (durable creation metadata), then the
 * configured `projectKey`, then nothing (which the caller treats as global).
 *
 * @param {any} body - parsed request body; may carry `sessionId`.
 * @param {any} sessions - session registry when the composition provides one.
 * @param {string} fallbackProject - configured fallback project key.
 * @returns {{project: string|null}}
 */
function resolveHttpProject(body, sessions, fallbackProject) {
  const sessionId = body && typeof body.sessionId === 'string' ? body.sessionId : null
  if (sessionId && sessions && typeof sessions.get === 'function') {
    try {
      const session = sessions.get(sessionId)
      const cwd = session?.header?.cwd ?? session?.meta?.cwd
      if (typeof cwd === 'string' && cwd.length > 0) return { project: cwd }
    } catch (error) {
      /* unknown session: fall through */
    }
  }

  // Fallback for a page that cannot name its session: use the most recently
  // created live session that HAS a workspace root. The page is bound to one of
  // the live sessions, and the newest is the one the user is working in — far
  // better than silently filing everything under "global".
  if (sessions && typeof sessions.list === 'function') {
    try {
      const live = sessions.list()
      for (let index = live.length - 1; index >= 0; index -= 1) {
        const cwd = live[index]?.header?.cwd ?? live[index]?.meta?.cwd
        if (typeof cwd === 'string' && cwd.length > 0) return { project: cwd }
      }
    } catch (error) {
      /* no registry access: fall through */
    }
  }

  if (typeof fallbackProject === 'string' && fallbackProject.trim().length > 0) {
    return { project: fallbackProject.trim() }
  }
  return { project: null }
}

/**
 * Register `/crabtodo` routes on the web server, when this composition has one.
 * @param {any} ctx - plugin context.
 * @param {TodoStore} store - the shared store.
 */
function registerHttp(ctx, store, sessions, fallbackProject) {
  // Resolve `webServer` lazily through `ctx.inject`, never `inject` on the
  // plugin itself: a headless/SDK profile has no web server, and a required
  // injection there would leave this plugin pending forever (losing the
  // tools too). `ctx.inject` runs the body when — and only when — the service
  // appears, and unwinds it if the service goes away.
  ctx.inject(['webServer'], (web) => {
    const server = web.webServer
    if (!server || typeof server.register !== 'function') return
    mountHttpRoutes(ctx, store, server, sessions, fallbackProject)
  })
}

/**
 * Register the routes on a resolved web server.
 * @param {any} ctx - plugin context.
 * @param {TodoStore} store - the shared store.
 * @param {any} server - the WebServer service.
 */
function mountHttpRoutes(ctx, store, server, sessions, fallbackProject) {
  const routes = []
  const add = (kind, path, handler) => {
    try {
      routes.push(server.register({ kind, path, handler }))
    } catch (error) {
      ctx.logger?.('crabtodo')?.warn?.(`route ${path} not registered: ${error?.message ?? error}`)
    }
  }

  // Whole snapshot: the page's initial read and every manual refresh.
  add('exact', '/crabtodo/api/tasks', async (req, res) => {
    try {
      if (req.method === 'GET') {
        await store.load()
        // Report which project this session resolves to, so the page can show
        // the real name instead of a bare "当前项目" placeholder.
        const url = new URL(req.url ?? '/', 'http://dsh.invalid')
        const sessionId = url.searchParams.get('sessionId')
        const context = resolveHttpProject({ sessionId }, sessions, fallbackProject)
        sendJson(res, 200, { ok: true, ...store.snapshot(), currentProject: context.project })
        return
      }
      if (req.method === 'POST') {
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'cross-origin write refused' })
        const body = await readJson(req)
        // The page cannot read a session cwd through its slots, so it sends the
        // sessionId it IS bound to and this side resolves the workspace root
        // exactly like a tool call does. Without that, every task created in
        // the UI fell back to global scope and the project tab stayed empty.
        const context = resolveHttpProject(body, sessions, fallbackProject)
        const task = await store.transact((state) =>
          createTask(state, { ...body, source: 'user' }, context),
        )
        sendJson(res, 200, { ok: true, task })
        return
      }
      sendJson(res, 405, { ok: false, error: 'method not allowed' })
    } catch (error) {
      sendJson(res, 400, { ok: false, error: String(error?.message ?? error) })
    }
  })

  // One task: patch or delete. Registered as a prefix so every id under
  // /crabtodo/api/tasks/ lands here; `/crabtodo/api/tasks` itself is the
  // separate exact route above, and the exact table is consulted first.
  add('prefix', '/crabtodo/api/tasks', async (req, res) => {
    try {
      const pathname = new URL(req.url ?? '/', 'http://dsh.invalid').pathname
      if (pathname === '/crabtodo/api/tasks' || pathname === '/crabtodo/api/tasks/') {
        sendJson(res, 400, { ok: false, error: 'missing task id' })
        return
      }
      const id = decodeURIComponent(pathname.slice('/crabtodo/api/tasks/'.length))
      if (id.length === 0) return sendJson(res, 400, { ok: false, error: 'missing task id' })
      if (req.method === 'PATCH' || req.method === 'PUT') {
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'cross-origin write refused' })
        const body = await readJson(req)
        // Resolve the project the same way creates do, so "move to project"
        // lands in the caller's workspace instead of degrading to global.
        const context = resolveHttpProject(body, sessions, fallbackProject)
        const task = await store.transact((state) =>
          updateTask(state, id, body, context, (sid) => sessionCwd(sid, sessions)),
        )
        sendJson(res, 200, { ok: true, task })
        return
      }
      if (req.method === 'DELETE') {
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'cross-origin write refused' })
        // Default is the UNDOABLE kind: soft delete into the trash. `?purge=1`
        // is the trash view's 彻底删除 — the only permanent single-row drop.
        const purge = new URL(req.url ?? '/', 'http://dsh.invalid').searchParams.get('purge') === '1'
        const task = await store.transact((state) => (purge ? purgeTask(state, id) : removeTask(state, id)))
        sendJson(res, 200, { ok: true, task })
        return
      }
      sendJson(res, 405, { ok: false, error: 'method not allowed' })
    } catch (error) {
      sendJson(res, 400, { ok: false, error: String(error?.message ?? error) })
    }
  })

  // Bulk tidy: drop completed rows.
  add('exact', '/crabtodo/api/clear-completed', async (req, res) => {
    try {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
      if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'cross-origin write refused' })
      const removed = await store.transact((state) => {
        const before = state.tasks.length
        state.tasks = state.tasks.filter((task) => task.status !== 'done')
        return before - state.tasks.length
      })
      sendJson(res, 200, { ok: true, removed })
    } catch (error) {
      sendJson(res, 400, { ok: false, error: String(error?.message ?? error) })
    }
  })

  // Trash: permanently drop every soft-deleted row (the 回收站's 清空).
  add('exact', '/crabtodo/api/purge-deleted', async (req, res) => {
    try {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
      if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'cross-origin write refused' })
      const purged = await store.transact((state) => purgeDeleted(state))
      sendJson(res, 200, { ok: true, purged })
    } catch (error) {
      sendJson(res, 400, { ok: false, error: String(error?.message ?? error) })
    }
  })

  // Live changes: the page keeps this open and re-reads on each event.
  add('exact', '/crabtodo/api/events', (req, res) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    res.write(': crabtodo stream open\n\n')
    const unsubscribe = store.subscribe(() => {
      res.write('event: change\ndata: {}\n\n')
    })
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 25_000)
    const close = () => {
      clearInterval(keepAlive)
      unsubscribe()
    }
    req.on('close', close)
    req.on('error', close)
  })

  ctx.effect(
    () => () => {
      for (const dispose of routes) {
        try {
          dispose()
        } catch {
          /* route already gone */
        }
      }
    },
    'crabtodo: http routes',
  )
}
