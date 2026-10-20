# dsh-crabtodo

CrabTodo — DeepSeek Harness 的**持久化**待办插件：模型可增删改查的 todo 工具，外加一个 Web 侧边栏任务页面。

与内置的 `todo_write` 互补：内置那份是**会话级**的（每轮开始清空、只属于当前对话），CrabTodo 把任务写进 `$DSH_HOME` 下的 JSON 文件，**跨会话、跨工作区、跨重启**都在。

## 能做什么

**给模型的 6 个工具**

| 工具 | 用途 |
|---|---|
| `crabtodo_add` | 新增任务（标题、备注、状态、优先级、标签、**范围**） |
| `crabtodo_list` | 查询，可按**范围** / 状态 / 标签 / 关键词过滤；未完成优先，再按优先级和创建时间排序 |
| `crabtodo_update` | 改任意字段（含在项目/全局之间移动）；改成 `done` 会自动盖 `completedAt` |
| `crabtodo_done` | 一键完成 |
| `crabtodo_remove` | 删除单个任务 |
| `crabtodo_clear` | 一次清掉所有已完成任务，未完成的不动 |

### 两级范围：项目 / 全局

待办分两种归属，不是三级：

| 范围 | 含义 | 何时产生 |
|---|---|---|
| `project` | 属于某个工作区根目录的待办，跟仓库走 | 在某个工作区里新建时的**默认** |
| `global` | 跨所有项目共享的待办 | 显式指定，或当前没有工作区 |

**会话级不单独建模**：内置 `todo_write` 已经覆盖了「只属于当前对话」的临时清单，再开一级只会和它重叠。

项目键取的是会话的**工作区根目录**（session header 里的 `cwd`）。headless / SDK 这类没有工作区根的组合下，用配置项 `projectKey` 兜底，避免所有任务都退化成全局。

页面上方有 `项目 / 全局 / 全部` 三个标签：前两个是真实范围，`全部` 只是把两者放在一起看的视图。新建卡片会显示当前会落到哪个范围。

**给你的侧栏页面**

CrabTodo **不占用主页面**，也**不在左侧栏加入口**——它只是**右侧栏的一个标签页**，可以像工作区文件、终端那样停靠、分栏、浮出、关闭：

- 打开方式：右侧栏引导页（侧栏收起时的「开始」页）里的 **CrabTodo** 卡片
- 打开后它会留在右侧栏的标签条上，点 `+`/标签可再次切回

页面支持：

- 底部卡片新建任务（回车确认），展开可填备注/优先级/状态/标签，**展开方向朝上**
- 每行悬停出现四个动作：编辑、**添加到对话**、标记进行中、删除
- 状态筛选用官方 `SegmentedTabs`（下划线标签页，等宽 + 滑动指示器 + 方向键导航），带图标
- 范围切换（项目 / 全局 / 全部）
- 「清理已完成」批量整理
- 任务带优先级色标与 `#标签`

页面通过同源 SSE 订阅变更：**模型在会话里用工具改了任务，页面会自动刷新**，反过来你在页面上勾选，下一个工具调用读到的也是最新状态。

### 添加到对话

每条任务悬停后的第二个按钮（纸飞机图标）会把这条待办**写进当前会话的输入框**：

- 带上备注、优先级和标签，不只是一个光秃秃的标题
- 输入框已有内容时**追加**，不会覆盖你正在写的东西
- 写入后弹一行确认；没有绑定会话时给出明确错误，而不是默默地什么也没发生

它走的是 `inputActions.setDraft()` 这个公开写稿编口（与编辑器自己的草稿恢复同一条路径），不碰任何私有状态。侧栏 tab 是 session 作用域的，所以这些 props 天然就在。

## 安装

### 从 npm（发布后可用）

```sh
dsh plugin --profile web add dsh-crabtodo
```

或在 Web 界面「插件 → 添加插件」中输入包名 `dsh-crabtodo`。

### 从本地目录

```sh
dsh plugin --profile web add ./dsh-crabtodo
```

安装后 `dsh plugin` 会把包名写进该 profile 的 `dsh.profile.bundles`，重启 `dsh web` 生效。

卸载：

```sh
dsh plugin --profile web remove dsh-crabtodo
```

## 配置

插件在 `cordis.patch.yml` 中自带默认行，可在 profile 的 `cordis.patch.yml` 里按 `id: crabtodo` 覆盖：

| 字段 | 默认值 | 含义 |
|---|---|---|
| `dataFile` | `~/.dsh/storage/crabtodo/todos.json` | JSON 存储路径，`~` 展开为 OS home |
| `exposeTools` | `true` | 是否注册 `crabtodo_*` 工具 |
| `exposeHttp` | `true` | 是否为侧边栏页面提供 `/crabtodo` API |
| `toolHint` | 一句说明 | 追加到每个工具描述的提示语 |
| `projectKey` | 空 | 无工作区根（headless / SDK）时的项目键兜底；空表示用会话 cwd，再退到全局 |

示例——改用工作区内的文件：

```yaml
- id: crabtodo
  name: dsh-crabtodo
  config:
    dataFile: ./todos.json
```

## HTTP API（页面使用，也可自己调）

所有写操作要求同源 `Origin`，跨站写入返回 403。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/crabtodo/api/tasks` | 整份快照 |
| `POST` | `/crabtodo/api/tasks` | 新增，body 同 `crabtodo_add` 参数 |
| `PATCH` | `/crabtodo/api/tasks/<id>` | 局部更新 |
| `DELETE` | `/crabtodo/api/tasks/<id>` | 删除 |
| `POST` | `/crabtodo/api/clear-completed` | 清除已完成 |
| `GET` | `/crabtodo/api/events` | SSE，每次提交后发一条 `change` |

## 数据格式

```json
{
  "version": 1,
  "updatedAt": 1792468933856,
  "tasks": [
    {
      "id": "ct_9adbfaac",
      "title": "写文档",
      "notes": "",
      "status": "pending",
      "priority": "normal",
      "scope": "project",
      "project": "C:/code/my-app",
      "tags": ["docs"],
      "createdAt": 1792468905576,
      "updatedAt": 1792468905576,
      "completedAt": null,
      "source": "model"
    }
  ]
}
```

`status`：`pending` / `in_progress` / `done`；`priority`：`low` / `normal` / `high` / `urgent`；
`scope`：`project` / `global`（全局任务 `project` 为 `null`）。

旧版数据（没有 `scope` 字段）会被当作 `global` 读取，不会因为升级而把已有清单藏在项目筛选后面。

写入走「临时文件 + rename」的原子替换，且在一条串行队列里排队，因此并发工具调用不会互相覆盖。文件损坏或手改坏掉时插件**不会崩**：会退化为空列表并继续可写，而不是让整条插件失效。

## 开发

```sh
node test/smoke.mjs          # 离线自测：工具注册、增删改查、持久化、错误路径、损坏恢复
```

本包里 `lib/client.js` **不是** ES 模块，而是 DSH 客户端模块系统要求的 lazy-CJS factory（执行时只向 `window.__ModuleLoader__` 注册工厂，副作用在首次物化时才跑）。`require('react')` 从宿主模块表解析，不额外打包 React。

一个容易踩的坑：客户端插件的 `inject` 必须声明 `['slots']`。Cordis 在**读取未注入的服务时直接抛错**，而 `apply` 里必然访问 `ctx.slots`，漏声明会让插件在浏览器端 `Failed` 且宿主日志里看不到原因。

第二个坑：右侧栏的服务（`sidebarRightTabs` / `sidebarRight`）由**另一个 bundle** 提供，`apply` 执行时它可能还没就绪。必须用 `ctx.inject([...], fn)` 等它就绪，而不是 `ctx.get()` 读一次 —— 后者会静默拿到 `undefined`，页面和入口都不会出现。

第三个坑：标签页正文挂载在**不是 flex 容器**的宿主外层（实测 `display:block; height:auto`）里。给根节点写 `height:100%` 会让内层 `flex:1` 的列表把每一行压成零高度。用 `max-height:100%` + 列表自身 `overflow-y:auto` 才能同时适配定高与自适应父级。

第四个坑：`output.render` 拿到的是**该工具自己声明的**输出值，而不是完整任务行。`crabtodo_update` 只返回 `id/title/status/priority`，最初的 `renderTask()` 却读 `value.tags.length`，于是写入成功后渲染抛错，模型看到的是一句渲染失败。渲染器必须对每个字段做防御式访问（`Array.isArray(x)` / `?? ''`）。

### 验证模型真的能调用工具

不要只靠「代码里注册了工具」推断。可复现的端到端验证：

```sh
# 复用带模型路由的 profile，再用 patch 把数据文件指到临时路径，避免污染真实数据。
dsh --profile <your-profile> "Call crabtodo_add once with title 'probe'. Then call crabtodo_list and report the count."
```

判读结果的两条硬证据：终端里出现真实工具往返（不是模型凭空作答），且落盘数据里该任务的 `source` 为 `"model"`。

## License

MIT
