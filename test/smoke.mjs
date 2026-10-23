/**
 * Offline check for the host half: mount the plugin against a fake context and
 * assert the tool registry, the persistence round-trip, and the error paths.
 * Run with: node test/smoke.mjs
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const plugin = await import('../lib/index.js')

let failures = 0
const check = (label, ok, detail) => {
  if (ok) {
    console.log(`  ok   ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/** Minimal Cordis-ish context: records tools, runs effects, no services. */
function fakeCtx() {
  const tools = new Map()
  const effects = []
  const provided = new Map()
  return {
    tools: {
      register(definition) {
        if (tools.has(definition.name)) throw new Error(`duplicate tool ${definition.name}`)
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    },
    effect(factory) {
      effects.push(factory())
      return () => {}
    },
    provide(name, value) {
      provided.set(name, value)
      return () => {}
    },
    inject(_deps, body) {
      // No webServer in this fake composition: the callback must not run.
      void body
    },
    logger: () => ({ info() {}, warn() {}, error() {} }),
    _tools: tools,
    _provided: provided,
    _dispose: () => effects.forEach((fn) => typeof fn === 'function' && fn()),
  }
}

const dir = await mkdtemp(join(tmpdir(), 'crabtodo-smoke-'))
const dataFile = join(dir, 'todos.json')

try {
  // ── mount ────────────────────────────────────────────────────────────────
  console.log('mount')
  const ctx = fakeCtx()
  plugin.apply(ctx, { dataFile, exposeTools: true, exposeHttp: true })
  const names = [...ctx._tools.keys()].sort()
  check('registers seven tools', names.length === 7, names.join(','))
  for (const expected of [
    'crabtodo_add',
    'crabtodo_clear',
    'crabtodo_done',
    'crabtodo_list',
    'crabtodo_remove',
    'crabtodo_tags',
    'crabtodo_update',
  ]) {
    check(`tool ${expected} present`, ctx._tools.has(expected))
  }
  check('exposes the crabtodo service', ctx._provided.has('crabtodo'))

  // ── round-trip ───────────────────────────────────────────────────────────
  console.log('round-trip')
  const add = ctx._tools.get('crabtodo_add')
  const list = ctx._tools.get('crabtodo_list')
  const update = ctx._tools.get('crabtodo_update')
  const done = ctx._tools.get('crabtodo_done')
  const remove = ctx._tools.get('crabtodo_remove')
  const clear = ctx._tools.get('crabtodo_clear')

  const created = await add.execute(
    { title: '  写文档  ', priority: 'high', tags: ['docs', 'docs', ' '] },
    {},
  )
  check('create returns an id', typeof created.id === 'string' && created.id.startsWith('ct_'))
  check('title is trimmed', created.title === '写文档', created.title)

  const first = await list.execute({}, {})
  check('list sees the new task', first.count === 1)
  check('tags de-duplicated', JSON.stringify(first.tasks[0].tags) === '["docs"]', JSON.stringify(first.tasks[0].tags))

  const second = await add.execute({ title: '开会', status: 'pending' }, {})
  const third = await add.execute({ title: '紧急修复', priority: 'urgent' }, {})

  const open = await list.execute({ status: 'pending' }, {})
  check('status filter works', open.count === 3, `${open.count} pending (expected 3: 写文档, 开会, 紧急修复)`)
  check('status filter excludes nothing by accident', open.tasks.every((task) => task.status === 'pending'))

  const ordered = await list.execute({}, {})
  check('urgent sorts before high', ordered.tasks[0].id === third.id, ordered.tasks.map((t) => t.priority).join(','))

  const tagged = await list.execute({ tag: 'DOCS' }, {})
  check('tag filter is case-insensitive', tagged.count === 1)

  const searched = await list.execute({ query: '开' }, {})
  check('query filter works', searched.count === 1, String(searched.count))

  const moved = await update.execute({ id: second.id, status: 'in_progress', notes: '下午三点' }, {})
  check('update applies status', moved.status === 'in_progress')

  // Regression: `crabtodo_update` deliberately returns only id/title/status/
  // priority, so its output.render receives a PARTIAL task row. It used to read
  // `value.tags.length` and throw, which the model saw as a render failure even
  // though the write had already succeeded.
  const updateTool = ctx._tools.get('crabtodo_update')
  let renderThrew = null
  let rendered
  try {
    rendered = updateTool.output.render({ id: second.id, status: 'in_progress' }, moved)
  } catch (error) {
    renderThrew = error
  }
  check('update render tolerates a partial row', renderThrew === null, renderThrew && String(renderThrew.message))
  check(
    'update render still names the task',
    !renderThrew && /renderTask|开会/.test(JSON.stringify(rendered)),
    JSON.stringify(rendered),
  )

  const completed = await done.execute({ id: created.id }, {})
  check('done sets status', completed.status === 'done')

  const afterDone = await list.execute({ status: 'done' }, {})
  check('completedAt was stamped', typeof afterDone.tasks[0].completedAt === 'number')

  // ── scopes ────────────────────────────────────────────────────────────
  console.log('scopes')
  const addT = ctx._tools.get('crabtodo_add')
  const listT = ctx._tools.get('crabtodo_list')

  // A call with a workspace becomes a project task by default.
  const inProject = await addT.execute({ title: '项目内待办' }, { agent: { cwd: 'C:/work/alpha' } })
  check('defaults to project when a workspace is known', inProject.scope === 'project', String(inProject.scope))
  check('project key is the workspace root', inProject.project === 'C:/work/alpha', String(inProject.project))

  // No workspace at all: global.
  const noWorkspace = await addT.execute({ title: '无工作区待办' }, {})
  check('falls back to global without a workspace', noWorkspace.scope === 'global', String(noWorkspace.scope))

  // The durable source is the SESSION header, because headless compositions
  // leave `agent.cwd` unset. A separate mount with a fake registry proves the
  // fallback path, which the plain fixture above cannot reach.
  const headerFile = join(dir, 'header.json')
  const ctxH = fakeCtx()
  plugin.apply(ctxH, { dataFile: headerFile, exposeTools: true, exposeHttp: false, _sessionsOverride: {
    get(id) {
      if (String(id) !== 'sess-1') return undefined
      return { header: { cwd: 'C:/work/from-header' } }
    },
  } })
  const viaHeader = await ctxH._tools.get('crabtodo_add').execute({ title: '头部推导' }, { agent: { sessionId: 'sess-1' } })
  check('project comes from the session header', viaHeader.project === 'C:/work/from-header', String(viaHeader.project))
  check('header-derived task is project-scoped', viaHeader.scope === 'project', String(viaHeader.scope))

  // Headless compositions have neither agent.cwd nor a session header; the
  // configured project key is what keeps their tasks out of global scope.
  const ctxK = fakeCtx()
  plugin.apply(ctxK, {
    dataFile: join(dir, 'keyed.json'),
    exposeTools: true,
    exposeHttp: false,
    projectKey: 'my-project',
  })
  const viaKey = await ctxK._tools.get('crabtodo_add').execute({ title: '键推导' }, {})
  check('configured project key is the fallback', viaKey.project === 'my-project', String(viaKey.project))
  check('fallback key yields project scope', viaKey.scope === 'project', String(viaKey.scope))

  // The UI cannot read a session cwd, so it forwards sessionId and the host
  // resolves the project. Without this a task added from the page silently
  // landed in global scope and the project tab looked broken.
  const ctxHttp = fakeCtx()
  plugin.apply(ctxHttp, {
    dataFile: join(dir, 'http.json'),
    exposeTools: true,
    exposeHttp: false,
    _sessionsOverride: {
      get(id) {
        if (String(id) !== 'sess-http') return undefined
        return { header: { cwd: 'C:/work/page-project' } }
      },
    },
  })
  const viaHttp = await ctxHttp._tools.get('crabtodo_add').execute(
    { title: 'page task', scope: 'project', sessionId: 'sess-http' },
    {},
  )
  check('page-created task resolves project via session', viaHttp.project === 'C:/work/page-project', String(viaHttp.project))

  // Explicit global wins even inside a workspace.
  const explicitGlobal = await addT.execute(
    { title: '跨项目待办', scope: 'global' },
    { agent: { cwd: 'C:/work/alpha' } },
  )
  check('explicit global overrides the workspace', explicitGlobal.scope === 'global')

  // A different workspace is a different project bucket.
  const otherProject = await addT.execute({ title: '另一个项目待办' }, { agent: { cwd: 'C:/work/beta' } })
  check('a second workspace is a separate project', otherProject.project === 'C:/work/beta')

  const onlyProject = await listT.execute({ scope: 'project' }, {})
  check(
    'project filter excludes global rows',
    onlyProject.tasks.every((task) => task.scope === 'project'),
    onlyProject.tasks.map((t) => t.scope).join(','),
  )
  const onlyGlobal = await listT.execute({ scope: 'global' }, {})
  check(
    'global filter excludes project rows',
    onlyGlobal.tasks.every((task) => task.scope === 'global'),
    onlyGlobal.tasks.map((t) => t.scope).join(','),
  )

  const beta = await listT.execute({ project: 'C:/work/beta' }, {})
  check('project filter narrows to one workspace', beta.count === 1 && beta.tasks[0].title === '另一个项目待办')

  // Moving a note from project to global must clear the project key.
  const updateT = ctx._tools.get('crabtodo_update')
  const movedScope = await updateT.execute({ id: inProject.id, scope: 'global' }, {})
  check('update can move a task to global', movedScope.status !== undefined)
  const afterMove = await listT.execute({ scope: 'global' }, {})
  check(
    'moved task lost its project key',
    afterMove.tasks.some((task) => task.id === inProject.id && task.project === null),
    JSON.stringify(afterMove.tasks.find((t) => t.id === inProject.id)),
  )

  // The reverse move: global -> project. This needs the caller's context, or
  // placeTask has no workspace to attach and the task stays global — which is
  // exactly the bug that made "move to project" look like it did nothing.
  const backToProject = await updateT.execute(
    { id: inProject.id, scope: 'project' },
    { agent: { cwd: 'C:/work/alpha' } },
  )
  check('update can move a task back to project', backToProject.scope === 'project', String(backToProject.scope))
  check(
    'moved task regained a project key',
    backToProject.project === 'C:/work/alpha',
    String(backToProject.project),
  )
  const projectList = await listT.execute({ scope: 'project' }, {})
  check(
    'task is visible under the project tab again',
    projectList.tasks.some((task) => task.id === inProject.id),
    projectList.tasks.map((t) => t.title).join(','),
  )

  // ── persistence ──────────────────────────────────────────────────────────
  console.log('persistence')
  const onDisk = JSON.parse(await readFile(dataFile, 'utf8'))
  // Compare against the live list instead of a hardcoded total: earlier
  // sections (scopes) add rows, and a brittle number hides real regressions.
  const beforeClear = await list.execute({}, {})
  check('file holds every task', onDisk.tasks.length === beforeClear.count, `${onDisk.tasks.length} vs ${beforeClear.count}`)
  check('notes persisted', onDisk.tasks.some((task) => task.notes === '下午三点'))
  check('scope survives a write', onDisk.tasks.some((task) => task.scope === 'project'))

  await update.execute({ id: second.id, status: 'done' }, {})
  const cleared = await clear.execute({}, {})
  const doneBefore = beforeClear.tasks.filter((task) => task.status === 'done').length + 1
  check('clear removes only done rows', cleared.removed === doneBefore, `${cleared.removed} vs ${doneBefore}`)
  const remaining = await list.execute({}, {})
  check(
    'open work survived clear',
    remaining.count === beforeClear.count - cleared.removed,
    `${remaining.count} of ${beforeClear.count}`,
  )
  check('no done row survived clear', remaining.tasks.every((task) => task.status !== 'done'))

  // ── trash / soft delete ─────────────────────────────────────────────────
  console.log('trash')
  const victim = await add.execute({ title: '误删的任务' }, {})
  const trashed = await remove.execute({ id: victim.id }, {})
  check('remove soft-deletes', typeof trashed.deletedAt === 'number', String(trashed.deletedAt))
  const afterRemove = await list.execute({}, {})
  check('trashed row leaves the default list', !afterRemove.tasks.some((t) => t.id === victim.id))
  const bin = await list.execute({ deleted: 'only' }, {})
  check('deleted:only lists just the trash', bin.count === 1 && bin.tasks[0].id === victim.id, String(bin.count))
  check('trash rows carry their stamp', typeof bin.tasks[0].deletedAt === 'number')
  const both = await list.execute({ deleted: 'include' }, {})
  check(
    'deleted:include shows live and trashed',
    both.count === afterRemove.count + 1,
    `${both.count} vs ${afterRemove.count}`,
  )

  // A mis-deleted task comes back with its fields intact.
  await update.execute({ id: victim.id, deleted: false }, {})
  const restored = await list.execute({}, {})
  check('update deleted:false restores the row', restored.tasks.some((t) => t.id === victim.id))
  check(
    'restore clears the stamp',
    restored.tasks.find((t) => t.id === victim.id).deletedAt === null,
    String(restored.tasks.find((t) => t.id === victim.id).deletedAt),
  )

  // The tool-level delete is itself undoable; permanence is an explicit purge
  // through the service — the same operation the HTTP ?purge=1 route calls.
  await remove.execute({ id: victim.id }, {})
  const service = ctx._provided.get('crabtodo')
  const purged = await service.purge(victim.id)
  check('purge drops the row permanently', purged.id === victim.id)
  const emptyBin = await list.execute({ deleted: 'only' }, {})
  check('purge emptied the trash', emptyBin.count === 0)
  const afterRoundTrip = await list.execute({}, {})
  check(
    'visible list unchanged by the trash round-trip',
    afterRoundTrip.count === remaining.count,
    `${afterRoundTrip.count} vs ${remaining.count}`,
  )
  check('purgeDeleted is on the service', typeof service.purgeDeleted === 'function')

  // ── pinning ──────────────────────────────────────────────────────────────
  console.log('pinning')
  const pinFile = join(dir, 'pin.json')
  const ctxP = fakeCtx()
  plugin.apply(ctxP, { dataFile: pinFile, exposeTools: true, exposeHttp: false })
  const pAdd = ctxP._tools.get('crabtodo_add')
  const pList = ctxP._tools.get('crabtodo_list')
  const pUpdate = ctxP._tools.get('crabtodo_update')

  const plain = await pAdd.execute({ title: '普通任务', priority: 'normal' }, {})
  const urgent = await pAdd.execute({ title: '紧急任务', priority: 'urgent' }, {})
  const byLadder = await pList.execute({}, {})
  check('ladder sorts urgent first', byLadder.tasks[0].id === urgent.id, byLadder.tasks.map((t) => t.title).join(','))
  check('new rows are not pinned', byLadder.tasks.every((t) => t.pinned === false))

  await pUpdate.execute({ id: plain.id, pinned: true }, {})
  const pinnedList = await pList.execute({}, {})
  check('pinned row sorts first', pinnedList.tasks[0].id === plain.id, pinnedList.tasks.map((t) => t.title).join(','))
  check('pinned outranks an urgent row', pinnedList.tasks[0].priority === 'normal', pinnedList.tasks[0].priority)
  const pinOnDisk = JSON.parse(await readFile(pinFile, 'utf8'))
  check('pin persists to disk', pinOnDisk.tasks.find((t) => t.id === plain.id).pinned === true)

  await pUpdate.execute({ id: plain.id, pinned: false }, {})
  const unpinnedList = await pList.execute({}, {})
  check('unpin restores the ladder', unpinnedList.tasks[0].id === urgent.id, unpinnedList.tasks.map((t) => t.title).join(','))

  let pinThrew = false
  try {
    await pUpdate.execute({ id: plain.id, pinned: 'yes' }, {})
  } catch (error) {
    pinThrew = /pinned/.test(String(error.message))
  }
  check('non-boolean pinned rejected', pinThrew)
  ctxP._dispose()

  // ── manual order ────────────────────────────────────────────────────────
  console.log('manual order')
  const orderFile = join(dir, 'order.json')
  const ctxO = fakeCtx()
  plugin.apply(ctxO, { dataFile: orderFile, exposeTools: true, exposeHttp: false })
  const oAdd = ctxO._tools.get('crabtodo_add')
  const oList = ctxO._tools.get('crabtodo_list')
  const oUpdate = ctxO._tools.get('crabtodo_update')

  const a1 = await oAdd.execute({ title: '甲', priority: 'normal' }, {})
  const a2 = await oAdd.execute({ title: '乙', priority: 'urgent' }, {})
  const a3 = await oAdd.execute({ title: '丙', priority: 'high' }, {})
  const ladder = await oList.execute({}, {})
  check('ladder puts urgent first', ladder.tasks[0].id === a2.id, ladder.tasks.map((t) => t.title).join(','))

  await oUpdate.execute({ id: a1.id, order: 0 }, {})
  await oUpdate.execute({ id: a3.id, order: 1 }, {})
  await oUpdate.execute({ id: a2.id, order: 2 }, {})
  const arranged = await oList.execute({}, {})
  check(
    'manual order beats the ladder',
    arranged.tasks.map((t) => t.title).join('') === '甲丙乙',
    arranged.tasks.map((t) => t.title).join(''),
  )
  const orderOnDisk = JSON.parse(await readFile(orderFile, 'utf8'))
  check('order persists to disk', orderOnDisk.tasks.every((t) => Number.isFinite(t.order)))

  await oUpdate.execute({ id: a3.id, pinned: true }, {})
  const pinTop = await oList.execute({}, {})
  check('pinning still outranks manual order', pinTop.tasks[0].id === a3.id, pinTop.tasks.map((t) => t.title).join(''))
  await oUpdate.execute({ id: a3.id, pinned: false }, {})

  // The tool schema takes numbers only; clearing order (null) is the
  // service's job — the same path the page's PATCH uses.
  await ctxO._provided.get('crabtodo').update(a1.id, { order: null })
  const orderCleared = await oList.execute({}, {})
  check(
    'unordered rows sort after arranged ones',
    orderCleared.tasks[orderCleared.tasks.length - 1].id === a1.id,
    orderCleared.tasks.map((t) => t.title).join(','),
  )

  let orderThrew = false
  try {
    await oUpdate.execute({ id: a2.id, order: 'top' }, {})
  } catch (error) {
    orderThrew = /order/.test(String(error.message))
  }
  check('non-number order rejected', orderThrew)
  ctxO._dispose()

  // ── tag vocabulary ─────────────────────────────────────────────────────
  console.log('tag vocabulary')
  const tagService = ctx._provided.get('crabtodo')
  const t0 = await tagService.addTag('功能修复')
  const t1 = await tagService.addTag('功能修复')
  const t2 = await tagService.addTag('  服务器端  ')
  check('tags add/trim/dedupe', t0.length === 1 && t1.length === 1 && t2[1] === '服务器端', JSON.stringify(t2))
  const tagList = await tagService.listTags()
  check('tags list', tagList.length === 2 && tagList[0] === '功能修复', JSON.stringify(tagList))
  const t3 = await tagService.removeTag('功能修复')
  check('tags remove', t3.length === 1 && t3[0] === '服务器端', JSON.stringify(t3))
  const storeOnDisk = JSON.parse(await readFile(join(dir, 'todos.json'), 'utf8'))
  check(
    'tags persist with store',
    Array.isArray(storeOnDisk.tags) && storeOnDisk.tags.length === 1 && storeOnDisk.tags[0] === '服务器端',
    JSON.stringify(storeOnDisk.tags),
  )

  // '#' query scopes to TAGS ONLY — the page's clickable tag chips depend
  // on this exact rule (#feature must not match titles merely containing the
  // word).
  const taggedCreate = await addT.execute({ title: 'tag query probe', tags: ['feature', 'demo'] }, {})
  const untaggedCreate = await addT.execute({ title: 'feature word in title only' }, {})
  const taggedId = taggedCreate.id ?? taggedCreate.task?.id
  const untaggedId = untaggedCreate.id ?? untaggedCreate.task?.id
  const byHash = await list.execute({ query: '#feature' }, {})
  const hashIds = byHash.tasks.map((t) => t.id)
  check(
    '#query matches tagged rows only',
    hashIds.includes(taggedId) && !hashIds.includes(untaggedId),
    JSON.stringify(hashIds),
  )
  // The probes leave: later sections assert exact row counts.
  await tagService.purge(taggedId)
  await tagService.purge(untaggedId)

  // ── preferences ────────────────────────────────────────────────────────
  console.log('preferences')
  // Prefs live NEXT TO the store (prefs.json) — host-side so they survive
  // the UI origin drifting with dsh's startup port.
  const prefsService = ctx._provided.get('crabtodo')
  await prefsService.setPrefs({ accent: 'blue', fontSize: 'large' })
  const prefsBack = await prefsService.getPrefs()
  check('prefs round-trip', prefsBack.accent === 'blue' && prefsBack.fontSize === 'large', JSON.stringify(prefsBack))
  const prefsOnDisk = JSON.parse(await readFile(join(dir, 'prefs.json'), 'utf8'))
  check('prefs file sits beside the store', prefsOnDisk.accent === 'blue')
  await prefsService.setPrefs(null)
  const clearedPrefs = await prefsService.getPrefs()
  check('non-object prefs degrade to empty', Object.keys(clearedPrefs).length === 0, JSON.stringify(clearedPrefs))

  // ── cross-process freshness ─────────────────────────────────────────────
  console.log('cross-process')
  // Another mount of the plugin (a CLI session) writes the SAME file behind
  // this store's back. A long-running process must see it without a restart.
  const xpFile = join(dir, 'xproc.json')
  const ctxX = fakeCtx()
  plugin.apply(ctxX, { dataFile: xpFile, exposeTools: true, exposeHttp: false })
  await ctxX._tools.get('crabtodo_add').execute({ title: '进程甲写的' }, {})
  const xpRaw = JSON.parse(await readFile(xpFile, 'utf8'))
  xpRaw.tasks.push({
    id: 'ct_ext0000',
    title: '进程乙写的',
    notes: '',
    status: 'pending',
    priority: 'normal',
    scope: 'global',
    project: null,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    completedAt: null,
    deletedAt: null,
    pinned: false,
    order: null,
    source: 'model',
  })
  await writeFile(xpFile, JSON.stringify(xpRaw, null, 2), 'utf8')
  const xpSeen = await ctxX._tools.get('crabtodo_list').execute({}, {})
  check(
    'external write visible without restart',
    xpSeen.tasks.some((t) => t.title === '进程乙写的'),
    xpSeen.tasks.map((t) => t.title).join(','),
  )
  // our own write then wins again — and the mirror stays coherent
  await ctxX._tools.get('crabtodo_add').execute({ title: '进程甲又写的' }, {})
  const xpFinal = JSON.parse(await readFile(xpFile, 'utf8'))
  check('both writers survive on disk', xpFinal.tasks.length === 3, String(xpFinal.tasks.length))
  ctxX._dispose()

  // ── error paths ──────────────────────────────────────────────────────────
  console.log('errors')
  let threw = false
  try {
    await update.execute({ id: 'ct_nope', title: 'x' }, {})
  } catch (error) {
    threw = /No CrabTodo task/.test(String(error.message))
  }
  check('unknown id fails with guidance', threw)

  threw = false
  try {
    await add.execute({ title: '   ' }, {})
  } catch (error) {
    threw = /non-empty/.test(String(error.message))
  }
  check('blank title rejected', threw)

  threw = false
  try {
    await add.execute({ title: 'x', status: 'nope' }, {})
  } catch (error) {
    threw = /status/.test(String(error.message))
  }
  check('invalid status rejected', threw)

  // ── corrupt store tolerance ──────────────────────────────────────────────
  console.log('recovery')
  const second2 = join(dir, 'broken.json')
  await writeFile(second2, '{ this is not json', 'utf8')
  const ctx2 = fakeCtx()
  plugin.apply(ctx2, { dataFile: second2, exposeTools: true, exposeHttp: false })
  const brokenList = ctx2._tools.get('crabtodo_list')
  const empty = await brokenList.execute({}, {})
  check('corrupt store degrades to empty, not a crash', empty.count === 0)
  const healed = await ctx2._tools.get('crabtodo_add').execute({ title: '恢复后新增' }, {})
  check('store heals and accepts writes', typeof healed.id === 'string')

  // Rows written before soft delete existed carry no deletedAt field; they
  // must read as live tasks, never as trashed ones.
  const legacyFile = join(dir, 'legacy.json')
  await writeFile(
    legacyFile,
    JSON.stringify({
      version: 1,
      updatedAt: 1,
      tasks: [
        {
          id: 'ct_legacy0',
          title: '旧数据',
          notes: '',
          status: 'pending',
          priority: 'normal',
          scope: 'global',
          project: null,
          tags: [],
          createdAt: 1,
          updatedAt: 1,
          completedAt: null,
          source: 'user',
        },
      ],
    }),
    'utf8',
  )
  const ctx4 = fakeCtx()
  plugin.apply(ctx4, { dataFile: legacyFile, exposeTools: true, exposeHttp: false })
  const legacyList = await ctx4._tools.get('crabtodo_list').execute({}, {})
  check('legacy rows read as not deleted', legacyList.count === 1 && legacyList.tasks[0].deletedAt === null)
  check('legacy rows read as unpinned', legacyList.tasks[0].pinned === false, String(legacyList.tasks[0].pinned))
  check('legacy rows read as unordered', legacyList.tasks[0].order === null, String(legacyList.tasks[0].order))
  const legacyBin = await ctx4._tools.get('crabtodo_list').execute({ deleted: 'only' }, {})
  check('legacy rows stay out of the trash', legacyBin.count === 0)
  ctx4._dispose()

  // ── restart durability ───────────────────────────────────────────────────
  console.log('restart')
  const ctx3 = fakeCtx()
  plugin.apply(ctx3, { dataFile, exposeTools: true, exposeHttp: false })
  const reloaded = await ctx3._tools.get('crabtodo_list').execute({}, {})
  check('a fresh mount reads the same file', reloaded.count === remaining.count, `${reloaded.count} vs ${remaining.count}`)
  check(
    'reloaded task keeps its title',
    reloaded.tasks.some((task) => task.title === '紧急修复'),
    reloaded.tasks.map((task) => task.title).join(' | '),
  )
  check('scopes survive a restart', reloaded.tasks.some((task) => task.scope === 'project'))

  ctx._dispose()
  ctx2._dispose()
  ctx3._dispose()
} finally {
  await rm(dir, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
