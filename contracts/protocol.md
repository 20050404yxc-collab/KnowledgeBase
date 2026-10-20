# 桌面与后台协议

## 诊断通道

业务 JSON Lines 操作与结果保持不变；stdout 仍只承载协议。Python 独立写数据目录 `logs/worker.log`，Electron 写 `logs/desktop.log`，两端通过现有请求 ID 和环境变量 `KB_LOG_SESSION` 关联。stderr 原始输出不保存正文，只计字节数。

preload 新增 `reportDiagnostic(RendererDiagnostic)`，通过 `kb:diagnostic` 单向发送白名单事件和有界技术字段。宿主验证主窗口主 frame、事件集合、合法操作、请求 ID、数字耗时和无目录栈位置；不接受任意消息／参数／响应对象，不开放文件和任意 IPC。该通道每分钟最多接收 600 条；业务请求独立执行。

简单说：日志记录执行位置和结果；不会把密钥、业务正文或任意界面内容当成日志写入。

本文件描述 test0.03 已实现的本地 JSON Lines 协议。操作和数据类型以 [desktop.ts](desktop.ts) 为准；[protocol_samples.json](protocol_samples.json) 是 Python 和 TypeScript 测试共同读取的握手、离线提问、检索、目录和用量样例。

简单说：两端检查同一份离线样例，搬动代码时不各自猜测返回格式。`dto_samples` 另含合成的审核／分类／公开候选 DTO，由 TypeScript 运行时检查；它们不是实际联网结果。

每行一个 UTF-8 JSON 对象。请求包含 `id`、`operation` 和对象 `params`（省略时为空对象）；ID 为 1–80 个 ASCII 字母、数字或连字符。输入帧最多 1,000,000 字节（含换行），同时最多 16 个业务请求；重复在途 ID 保留首个任务。无效结构返回不带 ID 的受控错误，未知操作返回关联错误，超大帧和 EOF 结束会话。

| 消息     | 字段与语义                                                                        |
| -------- | --------------------------------------------------------------------------------- |
| 就绪     | `type: ready`、`version`                                                          |
| 进度     | `type: progress`、`id`、`message`                                                 |
| 流片段   | `type: stream`、`id`、`delta`；仅供展示，不代表知识已保存                         |
| 成功     | `type: result`、`id`、`result`；按操作校验结果 DTO                                |
| 失败     | `type: error`、`error`、可选 `id`；不返回密钥、SQL 或供应商原始错误体             |
| 取消请求 | 独立 `id`、`operation: cancel`、`params.target` 指向业务 ID；取消帧无独立成功响应 |

Electron 启动等待 15 秒、业务请求等待 180 秒；超时先移除请求关联再发送取消，晚到消息不重新结算。后台请求终结移除任务，提交前取消不收录残缺内容；同步原子提交完成后如实返回实际结果。关闭先发送 EOF，收束业务和解析线程，超过 2.5 秒则终止本应用拥有的后台进程树。

简单说：进度与保存结果分开；取消、超时和关闭都有明确的终点。

preload 校验未知结果及事件；IPC 校验主窗口主 frame、操作白名单和参数对象；Python 入口继续检查字段类型，领域与应用检查业务限制。stdout 只用于协议。样例覆盖代表性离线响应，完整字段校验及异常路径由两端测试补充；这些验证不代表真实供应商接口验收。

## API 配置与模型选择

`providers.save` 支持可选 `id` 编辑原配置；`key` 留空保留已保存凭据，密钥不出现在返回结果。`models` 是模型 ID 数组，`model` 是可为空的默认值且非空时必须属于数组；旧调用方未传 `models` 时兼容单默认模型。默认模型变化清空旧价格，除非 `prices_confirmed: true` 明确确认本次价格。

简单说：保存仍返回无密钥配置列表，更新沿用原 ID，不会因为换模型生成重复接口。

`providers.models` 输入 `{protocol, base_url, id?, key?}`，返回 `{models: string[], partial: boolean}`。读取当前草稿地址加 `/models`；新 Key 优先，否则从指定已保存 ID 解析旧凭据。仅 GET，不保存草稿、不写调用记录；取消沿原有请求 ID 传播。目录最多 1000 个 ID，单页最多 1MB、10 页、总等待 30 秒；达到页数上限返回部分结果，其他失败返回受控错误，界面保留原目录。

`question` 可选 `provider_id`、`model`、`reasoning_effort`；`providers.test` 保留必填配置 `id` 并接受 `model`、`reasoning_effort`。空模型覆盖回退到配置默认值，均为空且需要生成时在 HTTP 前报错；精确知识复用仍显示未调用模型。强度值为 `auto/low/medium/high`：auto 省略供应商字段；Responses 编码 `reasoning.effort`，Chat 编码 `reasoning_effort`；Anthropic 初始只接受 auto。返回尝试和知识中的模型为实际调用型号，临时覆盖非默认模型时单价和费用保持未知。

简单说：这次选中的模型和强度传到新请求；默认配置和已有知识复用不被临时选择改写。具体模型是否接受强度仍需供应商实测。

## 本地检索与知识点目录

`knowledge.search` 输入 `{query, page?, bucket?, scope?, attachment_ids?}`，返回 `{items, total, page, notice}`。默认检索全部频率分区的知识、补充及已保留资料；不调用模型。页面从 0 起，每页 30 条。显式文件／混合范围只读取仍在本次会话中的授权附件，先按相关度返回文件片段，再返回库内结果。每个命中包含类型、主题、标题、摘录及所属知识 ID 或可打开的引用快照。关键词分词不提供语义召回。

简单说：不配置接口也能找本地内容；“本地检索”按钮查全库，问题目录的文件范围和分页则沿用该次选择。

`question.plan` 接受原 `question` 参数，返回 `{plan_id, points, excluded, search, notice}`；规划先结合授权范围内的全库分类摘要（`files` 范围跳过库内读取），再输出大类、小类和具体知识点。每个候选必须经过独立审核：可复用知识保留，职责／项目名／日期等非知识点排除，疑义项给出理由；允许零个合格点，审核失败返回空目录且不产生可学习计划。目录最多 16 点，会话最多保留 24 份，重启或淘汰后需重新拆解。

`knowledge.learn` 输入 `{plan_id, point_id, action, target_id?, attachment_ids?, consent?, public_scope?, public_only?, search_terms?, revision?, candidate_id?, provider_id?, model?, reasoning_effort?}`。动作包括 `learn/supplement/confirm/separate/materials/public-search/public-select/revoke`。项目点在资料或公开示例证据满足前只返回项目门禁；`materials` 只接受当前会话中 1–20 个且与该点相关的附件，`public-search` 必须携带当前点的一次性 `revision`、明确同意和“本点公开示例”范围，检索词可编辑，服务端最多一次搜索和三个 README 请求；`public-select` 绑定实际候选后才允许解释。切换知识点撤销公开许可；范围、附件或明确取消撤销受影响项目依据，切页保留正在执行任务的依据。`revoke` 可带 `public_only: true`，仅保留仍有效的已核对材料及其补充预览，默认完整撤销；公开候选和已选公开示例不能因该标志继续获得许可。补充候选必须来自该目录，不接受任意目标。学习只生成选中项；补充先返回 `review: true` 预览，`confirm` 不再调用模型并在复核目标版本后原子追加；`separate` 保存独立知识。已提交结果可幂等复用，取消不会撤销既有提交。

`Knowledge`、`SearchHit`、`DirectoryPoint` 的 `category`／`subcategory` 为可选兼容字段；旧主题不猜测拆分，不做 R6 批量迁移。项目状态 DTO 使用 `materials`、`material-ready`、`candidates`、`public-ready`，公开候选包含仓库 URL、README 路径、摘录和 UTC 读取时间；解释引用进一步标注实际使用的字符范围；仅模型声称而无读取证据不得进入引用。

简单说：先选目录项再学习；补充要核对后保存，原笔记不会被生成结果覆盖。取消前已经提交的知识仍然保留。

`knowledge.get` 等知识结果增加可选 `theme/version/supplements`；旧知识显示未分类，不批量改写。补充包含稳定 ID、时间、模型、接口、引用和编辑状态。`supplements.save` 输入 `{knowledge_id,id,version,title,content}`；`supplements.delete` 输入 `{knowledge_id,id,version}`。两者均返回最新完整知识，版本过期拒绝，删除原知识级联移除补充及索引。

数据库从 2 升至 3 前通过 SQLite 备份 API 创建 `before-knowledge-topics-v3.sqlite3`，增量结构、回填与版本号同一事务提交。FTS5 不可用时回退到完整分批词法扫描；索引可由仓库维护方法 `rebuild_search_index` 从正式数据重建。没有新增界面维护按钮。

## 多点生成与分区提问（修订 7）

批量沿用 `knowledge.learn`，界面串行对所选未保存点发出单点请求；每项使用独立的实际调用记录，整体停止不是已提交内容回滚。项目资料一次用户提交后对每点执行 `materials`，只在该点返回 `material-ready` 时继续生成，未充分点保留门禁。补充仍返回 review，禁止自动 confirm。界面在每阶段间检查任务取消标志；切页和普通阅读不停止后续项，明确取消后不再启动下一项。

常用／在学／归档的简洁提问同样使用 `question.plan`，继承探索的模型与范围设置；问题、目录、预览和阅读按页隔离。没有新操作名、协议版本或数据库升级。

## 分层知识库与确认式重构（修订 8）

契约位于 [library.ts](library.ts)。导航只切换显示，根会话持有任务和实际阶段请求 ID；一个生成流程可包含多个请求，显式取消、请求超时或后台中断阻止后续阶段。详情阅读版本按页隔离，不用来判定批量是否继续。

`knowledge.tree` 输入 `{query?,bucket?,path?:string[],cursor?}`；路径长度 0/1/2 分别返回大类、小类、知识点，最多 50 节点，结果为 `{nodes,total,revision,next_cursor}`。bucket 先过滤再聚合，查询包含标题、正文、分类与补充；无旧列表上限。游标绑定当前层结果摘要，目录变化拒绝旧游标。叶子只有 ID、标题与分区，详情仍走 `knowledge.get`；展开不增加使用日。

| 操作                          | 参数和状态                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `library.restructure.plan`    | 模型选项及可选 `draft_id,revision,feedback,advance`；不带 advance 初始化或明确重规划，advance 每次处理一个摘要／分类阶段 |
| `library.restructure.prepare` | `{draft_id,revision}`；明确确认目录后每次准备 1 条内容建议，只有 outline/preparing 可推进                                |
| `library.restructure.preview` | `{draft_id,revision,kind,page?}`；outline 每页 30 项，suggestions 每页 1 项，page 从 0 起                                |
| `library.restructure.apply`   | `{draft_id,revision,selected:string[]}`；仅 ready 可提交，空数组仅改目录；重复提交返回原收据                             |
| `library.restructure.discard` | `{draft_id,revision}`；丢弃会话草案，晚到模型结果不能恢复它                                                              |

状态顺序为 `planning → outline → preparing → ready → applied`。后台最多一份草案，重规划产生新的草案与修订标识；旧确认失效。每条正文和补充按 7000 字符分块，累计摘要最多 1600 字符；分类每批 8 条，先前路径成为后批词表，分类输入超过 26000 字符受控停止，不自动重试。全量清单及正文快照存于内存，大库性能未实测。取消阶段可在当前会话显式继续，退出后草案不恢复。

仅未编辑的生成正文且长度不超过 8000 字符可建议替换，其他仅建议追加；单条建议最多 20000 字符。差异默认不选择，已有手工正文、补充和引用保持。全库集合／正文／补充／分类摘要不一致时拒绝提交；使用日变化不构成正文冲突。提交创建唯一 SQLite 恢复点，然后事务内再次检查、写入路径及所选更新、重建搜索索引；异常整体回滚，模型等待不持有写事务。恢复方法见 [使用说明](../README.md#重构知识库)。本轮使用 schema 3，无迁移、协议版本或数据路径更改。

普通 `question`／推荐拓展新增收录要求模型返回合法 `category/subcategory`，与正文原子保存；严格 files 范围不读取旧库分类。旧知识复用不为补分类重复调用模型，手工新建暂留未分类，不隐式外发。
