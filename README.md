# dsh-crabtodo

CrabTodo — DeepSeek Harness 的**持久化**待办插件：模型可增删改查的 todo 工具，外加一个 Web 侧边栏任务页面。

![悬浮窗模式：全局浮窗，可拖动/折叠，磨砂玻璃](https://raw.githubusercontent.com/yixing233/dsh-crabtodo/main/assets/screenshot-floating.png)

![侧栏面板：列表、搜索、新建任务卡片](https://raw.githubusercontent.com/yixing233/dsh-crabtodo/main/assets/screenshot-panel.png)

与内置的 `todo_write` 互补：内置那份是**会话级**的（每轮开始清空、只属于当前对话），CrabTodo 把任务写进 `$DSH_HOME` 下的 JSON 文件，**跨会话、跨工作区、跨重启**都在。

## 能做什么

**给模型的 6 个工具**

| 工具 | 用途 |
|---|---|
| `crabtodo_add` | 新增任务（标题、备注、状态、优先级、标签、**范围**、**置顶**） |
| `crabtodo_list` | 查询，可按**范围** / 状态 / 标签 / 关键词过滤；**置顶**优先，然后按状态、优先级和创建时间排序 |
| `crabtodo_update` | 改任意字段（含在项目/全局之间移动、`pinned` 置顶、`order` 手动排序）；改成 `done` 会自动盖 `completedAt` |
| `crabtodo_done` | 一键完成 |
| `crabtodo_remove` | 删除单个任务（软删除进回收站，可恢复） |
| `crabtodo_clear` | 一次清掉所有已完成任务（永久），未完成的不动 |

### 两级范围：项目 / 全局

待办分两种归属，不是三级：

| 范围 | 含义 | 何时产生 |
|---|---|---|
| `project` | 属于某个工作区根目录的待办，跟仓库走 | 在某个工作区里新建时的**默认** |
| `global` | 跨所有项目共享的待办 | 显式指定，或当前没有工作区 |

**会话级不单独建模**：内置 `todo_write` 已经覆盖了「只属于当前对话」的临时清单，再开一级只会和它重叠。

项目键取的是会话的**工作区根目录**（session header 里的 `cwd`）。headless / SDK 这类没有工作区根的组合下，用配置项 `projectKey` 兜底，避免所有任务都退化成全局。

页面上方有 `项目 / 全局 / 全部` 三个标签：`项目` 只显示**当前会话所在项目**的待办（其他工作区的任务不会串进来），`全局` 是跨项目共享的，`全部` 则**不论项目**、所有任务一起看。新建卡片会显示当前会落到哪个范围。

**给你的侧栏页面**

CrabTodo **不占用主页面**，也**不在左侧栏加入口**——它只是**右侧栏的一个标签页**，可以像工作区文件、终端那样停靠、分栏、浮出、关闭：

- 打开方式：右侧栏引导页（侧栏收起时的「开始」页）里的 **CrabTodo** 卡片
- 打开后它会留在右侧栏的标签条上，点 `+`/标签可再次切回

页面支持：

- 底部卡片新建任务（回车确认），展开可填备注/优先级/状态/标签，**展开方向朝上**
- 每行悬停出现的动作：编辑、**置顶**（📌，置顶项恒排最前，行内常显标记）、**添加到对话**、标记进行中、删除（**二次确认**后软删除，提示条里可一键**撤销**）；整行可**拖拽排序**——拖动重排当前视图，落点即所见，置顶仍恒排最前
- 状态筛选用官方 `SegmentedTabs`（下划线标签页，等宽 + 滑动指示器 + 方向键导航），带图标
- 状态标签下方是**搜索框**：标题 / 备注 / 标签关键词即时过滤（与模型侧 `crabtodo_list` 的 `query` 同一套匹配规则，页面本地过滤，不发请求）；`Esc` 或 `×` 清除
- 范围切换（项目 / 全局 / 全部）
- 「清理已完成」批量整理——只在**已完成**标签页显示（避免在其他页面清掉看不见的行）
- 右上角「🗑 回收站（n）」按钮进入**回收站**，⚙ 进入**设置页**（同为二级视图）：**强调色 / 字体大小 / 字体样式**、备注预览行数、删除确认开关、**动画开关**、**右栏默认宽度**（% 数值可输入，替代宿主固定的 45% 首开默认）、启动时默认范围/状态——保存在 **dsh 存储**（`$DSH_HOME/storage/crabtodo/prefs.json`），重启、更换访问地址都不丢：删除的任务先落到这里，可逐条**恢复**或**彻底删除**，也可一键「清空回收站」。撤销窗口之外的误删也能从这里找回；删除、彻底删除、清空回收站均先弹出**确认对话框**（在侧栏面板内居中，说明后果 + 红色危险按钮，Esc/点遮罩可取消，初始焦点在「取消」上）。回收站页面隐藏状态筛选 tab（已删任务与状态无关），顶栏常驻「**回到首页**」文本按钮一键返回列表
- 每行信息分层：标题加粗领衔，备注默认截断两行；底部元信息是一行 10px 的排印式灰字（范围 · 优先级 · `#标签`，分组圆点分隔，优先级保留语义色文字）
- 界面文案跟随宿主语言（`html[lang]`，回退 `navigator.language`）：中文环境出中文，其余出英文——状态/优先级标签、按钮、提示、空态、「添加到对话」的引用格式全部双语，无硬编码
- 备注支持 **Markdown**：点击备注展开详情，清单/链接/加粗/斜体/行内代码渲染成排版后的元素（点标题仍是进编辑器）。渲染走白名单解析、**全程不经过 HTML 字符串**——备注里写任何标签都只会显示为文本，链接仅放行 `http(s)`，天然免疫 XSS；编辑器里始终是原始 Markdown 文本

页面通过同源 SSE 订阅变更：**模型在会话里用工具改了任务，页面会自动刷新**，反过来你在页面上勾选，下一个工具调用读到的也是最新状态。

### 添加到对话

每条任务悬停后的第二个按钮（聊天气泡图标）会把这条待办**写进当前会话的输入框**：

- 引用采用**显式字段**格式：任务、描述、状态/优先级/范围/标签、任务ID、来源，不只是一个光秃秃的标题
- 块首标明这段来自 **dsh-crabtodo 插件**，并列出可用的 `crabtodo_*` 工具——模型读到后知道该按任务ID 调工具查询和操作这些任务，而不是把它当成来历不明的清单
- 输入框已有内容时**追加**，不会覆盖你正在写的东西
- 写入后弹一行确认；没有绑定会话时给出明确错误，而不是默默地什么也没发生

写入输入框的实际格式：

```text
引用待办（来自 dsh-crabtodo 插件的持久化任务列表；可直接调用 crabtodo_list / crabtodo_update / crabtodo_done / crabtodo_remove 工具，按下方任务ID 查询或操作这些任务）：
- 任务: 写文档
  描述: 补齐 HTTP API 一节
  状态: 待办 · 优先级: 高 · 范围: 项目 my-app · 标签: #docs
  任务ID: ct_37d34ac7 · 来源: dsh-crabtodo 插件
```

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
| `PATCH` | `/crabtodo/api/tasks/<id>` | 局部更新；`{"deleted": false}` 恢复回收站任务 |
| `DELETE` | `/crabtodo/api/tasks/<id>` | 删除（软删除进回收站）；`?purge=1` 彻底删除 |
| `POST` | `/crabtodo/api/clear-completed` | 清除已完成（永久） |
| `POST` | `/crabtodo/api/purge-deleted` | 清空回收站（永久） |
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
      "deletedAt": null,
      "pinned": false,
      "order": null,
      "source": "model"
    }
  ]
}
```

`status`：`pending` / `in_progress` / `done`；`priority`：`low` / `normal` / `high` / `urgent`；
`scope`：`project` / `global`（全局任务 `project` 为 `null`）；`deletedAt`：软删除时间戳，非 `null` 表示任务在回收站中（可恢复或彻底删除）；`pinned`：置顶标记，置顶项永远排在列表最前；`order`：手动顺序，拖拽排序写入的序号（越小越靠前），为 `null` 表示未手动排过、走自动阶梯（置顶 → 状态 → 优先级 → 创建时间）。

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

## 悬浮模式

顶栏的浮窗按钮把面板**从侧栏取出**为一个可拖动、可调大小的磨砂玻璃悬浮窗（列表在其下滚动、内容透出），侧栏原位留一张「已移至悬浮窗」的卡片可一键召回；窗口位置记忆在 dsh 存储中，重启后仍在原处。

悬浮窗挂在宿主的**全局悬浮层**（`shell.overlay`，root 作用域）上——它是**应用级窗口而非会话级**：切换会话不消失，始终显示任务全貌并按当前会话解析项目归属。标题栏可**折叠/展开**（折叠后只剩标题条，仍可拖动，状态记住）。悬浮窗内**「添加到对话」同样可用**——通过宿主的会话机制（`uiSession.bindingSource`）解析当前会话的输入框，写入你在看的那个对话的草稿。

## 技能（Skill）

`skills/crabtodo/SKILL.md` 随包分发：DSH 会自动扫描插件包内的技能并列入模型的技能清单，模型看到与用户口令同名的 `crabtodo` 技能即可零摸索直达 `crabtodo_*` 工具（而不是去翻文件系统找"crabtodo"是什么）。

## License

MIT
