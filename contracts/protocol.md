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

`question.plan` 接受原 `question` 参数，返回 `{plan_id, points, excluded, search, notice}`；规划先结合授权范围内的全库分类摘要（`files` 范围跳过库内读取），再输出完整父级路径和具体知识点。每个候选必须经过独立审核：可复用知识保留，职责／项目名／日期等非知识点排除，疑义项给出理由；允许零个合格点，审核失败返回空目录且不产生可学习计划。目录最多 16 点，会话最多保留 24 份，重启或淘汰后需重新拆解。

`knowledge.learn` 输入 `{plan_id, point_id, action, target_id?, attachment_ids?, consent?, public_scope?, public_only?, search_terms?, revision?, candidate_id?, provider_id?, model?, reasoning_effort?}`。动作包括 `learn/supplement/confirm/separate/materials/public-search/public-select/revoke`。项目点在资料或公开示例证据满足前只返回项目门禁；`materials` 只接受当前会话中 1–20 个且与该点相关的附件，`public-search` 必须携带当前点的一次性 `revision`、明确同意和“本点公开示例”范围，检索词可编辑，服务端最多一次搜索和三个 README 请求；`public-select` 绑定实际候选后才允许解释。切换知识点撤销公开许可；范围、附件或明确取消撤销受影响项目依据，切页保留正在执行任务的依据。`revoke` 可带 `public_only: true`，仅保留仍有效的已核对材料及其补充预览，默认完整撤销；公开候选和已选公开示例不能因该标志继续获得许可。补充候选必须来自该目录，不接受任意目标。学习只生成选中项；补充先返回 `review: true` 预览，`confirm` 不再调用模型并在复核目标版本后原子追加；`separate` 保存独立知识。已提交结果可幂等复用，取消不会撤销既有提交。

`Knowledge`、`SearchHit`、`DirectoryPoint` 的 `category_path:string[]` 为可选完整父级路径，存在时必须为 1–64 段非空文本，每段最多 80 字；缺少时才适配旧 `category`／`subcategory` 可选兼容字段；旧主题不猜测拆分，不做 R6 批量迁移。项目状态 DTO 使用 `materials`、`material-ready`、`candidates`、`public-ready`，公开候选包含仓库 URL、README 路径、摘录和 UTC 读取时间；解释引用进一步标注实际使用的字符范围；仅模型声称而无读取证据不得进入引用。

简单说：先选目录项再学习；补充要核对后保存，原笔记不会被生成结果覆盖。取消前已经提交的知识仍然保留。

`knowledge.get` 等知识结果增加可选 `theme/version/supplements`；旧知识显示未分类，不批量改写。补充包含稳定 ID、时间、模型、接口、引用和编辑状态。`supplements.save` 输入 `{knowledge_id,id,version,title,content}`；`supplements.delete` 输入 `{knowledge_id,id,version}`。两者均返回最新完整知识，版本过期拒绝，删除原知识级联移除补充及索引。

数据库从 2 升至 3 前通过 SQLite 备份 API 创建 `before-knowledge-topics-v3.sqlite3`，增量结构、回填与版本号同一事务提交。FTS5 不可用时回退到完整分批词法扫描；索引可由仓库维护方法 `rebuild_search_index` 从正式数据重建。没有新增界面维护按钮。

## 多点生成与分区提问（修订 7）

批量沿用 `knowledge.learn`，界面串行对所选未保存点发出单点请求；每项使用独立的实际调用记录，整体停止不是已提交内容回滚。项目资料一次用户提交后对每点执行 `materials`，只在该点返回 `material-ready` 时继续生成，未充分点保留门禁。补充仍返回 review，禁止自动 confirm。界面在每阶段间检查任务取消标志；切页和普通阅读不停止后续项，明确取消后不再启动下一项。

常用／在学／归档的简洁提问同样使用 `question.plan`，继承探索的模型与范围设置；问题、目录、预览和阅读按页隔离。没有新操作名、协议版本或数据库升级。

## 分层知识库与确认式重构（修订 8）

契约位于 [library.ts](library.ts)。导航只切换显示，根会话持有任务和实际阶段请求 ID；一个生成流程可包含多个请求，显式取消、请求超时或后台中断阻止后续阶段。详情阅读版本按页隔离，不用来判定批量是否继续。

修订 15：已有 draft_id/revision 的 plan 携带 feedback 时，在同一草案增量修订，不重新生成成功概览；当前目录保留至新目录完成，旧确认失效。summary 新增可选 `feedback_history:string[]`，按顺序保存意见，每条最多 2000 字符，累计 6000 字符；超限或快照变化拒绝且保留旧草案。语义比较 `library-group` 是内部模型目的，不新增桌面操作：同一完整父级路径的全部对按最多 12 对／26000 序列化字符分批，输出决策精确覆盖。模型提出的同知识组预填 merge 方案，最多 8 来源且两两同义，用户仍可保持独立；确认结构后才全文核验。多来源完整分片重写后通过 `library-content` 的 `mode=fuse` 融合，正文输入批次最多 18000 字符，来源映射可多对一。失败保留成功分片，显式 retry 才继续；不把拼接中间态发布为完成稿。记忆只在本次后台会话，不跨重启。

`knowledge.tree` 输入 `{query?,bucket?,path?:string[],cursor?}`；路径递归查询下一层，最多 65 段（含知识标题），每页最多 50 节点，结果为 `{nodes,total,revision,next_cursor,content_id?}`；可选 `content_id` 为当前节点正文 ID，空字符串表示没有唯一正文。bucket 先过滤再聚合，查询包含标题、正文、分类与补充；无旧列表上限。游标绑定搜索、分区、完整路径及当前层结果摘要，目录变化拒绝旧游标。节点的可选 `children:boolean` 指示是否有下级，正文 ID 可与下级同时存在；缺少标记时适配旧无 ID 即分支规则。旧显示别名碰撞时，正文以各自稳定 ID 独立列出，详情仍走 `knowledge.get`；展开不增加使用日。

| 操作                          | 参数和状态                                                                                                                                                                                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `library.restructure.plan`    | 模型选项及可选 `draft_id,revision,feedback,advance,retry,review`；初始化／重规划；advance 一轮最多两分析块或一个分类／核验阶段；paused 必须显式 retry                                                                                                                         |
| `library.restructure.prepare` | `{draft_id,revision,retry?}`；明确确认当前结构后，核验拟合并组并逐个完整原文块生成重组正文                                                                                                                                                                                    |
| `library.restructure.preview` | `{draft_id,revision,kind,page?,evidence_page?,text_page?}`；outline 每页 30，suggestions／records／sources／duplicates 每页 1；summary 只同步状态；重复组证据另按 evidence_page 每页 1                                                                                        |
| `library.restructure.apply`   | `{draft_id,revision,selected:string[],directory_only?:boolean}`；默认仅 ready 可提交；outline 时显式 directory_only=true 可通过完整结构校验直接保存分类，拒绝拟合并且不调用正文模型；每个合并保留点 ID 必须选中其完整重组稿；本轮不另生成模型解释建议；无合并时空数组仅改目录 |
| `library.restructure.discard` | `{draft_id,revision}`；先失效再取消并等待两路子任务，返回后无子请求在途                                                                                                                                                                                                       |

`review` 为 `point`（id/title/category_path，缺少新路径时兼容 category/subcategory）、`candidate`（2 至 8 个当前来源 ID）或 `decision`（组 ID、merge/keep/undecided）。merge 必须同时传组内 target_id、title、完整 category_path（或旧 category/subcategory）和明确的 manual_bucket（合法分区或 null）。每次成功结构修改产生新 revision，清空结构确认、内容稿和选择；重新候选须重新核验原文。未知 ID、交叉组及同路径同名阻止结构准备；未决定组默认保持独立；related/conflict 不可合并。

状态为 `planning → outline → preparing → ready → applied`，分析或准备失败进入 `paused`，保留成功片段。summary 区分来源 total/covered、target_count、groups/undecided、workers 和错误。所有来源按 created_at/id 固定排序，两路独占领取；每来源只做一次轻量概览，最多取样 7000 字符，输出硬上限 2400（含空白标点）。标题优先及首中尾取样，保留完整已读/未读定位；模型范围元数据最多前 50 条且明确总数，记录预览通过 text_page 每页 50 条查看全部范围。classification 每轮一个目标，分轮消费全部相关来源概览和已有路径，携带前轮建议，序列化输入最多 26000 字符。记录包含草案／修订／source version／agent／generation／locator／call_id／attempt_ids；取消父请求同时取消并等待两路。

确认前只有概览与结构规划；prepare 确认当前 revision，随后只核验拟合并组的完整来源（包括隐藏历史成员），失败返回 outline/review，清除批准，不自动再确认。完整正文以 7000 字符原文块送入模型重组，带确认路径和最近 12 段标题，按输入顺序组装；每块对应输出章节与 source/version/locator。原引用和已有有效引用标记保留；覆盖清单不能证明语义无遗漏。重组正文无总字符业务上限；每调用的上下文／输出／超时及机器资源边界保持。suggestions 每项正文/原文/diff 分别按 text_page 每页 12000 字符，provenance 每页 20 条；apply 始终使用后台完整正文，不接收预览切片。

`Knowledge` 和 `Supplement` 新增可选 `content_chars`，存在即表示当前正文非完整，需要分页。主正文首屏最多 12000 字符，所有补充共享另一个 12000 字符首屏预算；超预算补充正文留空并携带完整字符数。既有短结果保持，`knowledge.get` 复用回答同步处理长正文。新增白名单操作 `knowledge.text`：read `{id,version,supplement_id?,page?}` 返回 `{content,version,page,pages}`，每页 12000 Python 字符；begin `{id,version,supplement_id?,title}` 返回 `{edit_id,offset:0}`；append `{edit_id,offset,content}` 每块最多 12000 字符且偏移严格连续，返回新 offset；commit `{edit_id,chars}` 必须匹配暂存总字符数，再核验版本并一次事务保存及更新索引；discard `{edit_id}` 只释放暂存。前端逐页读取原版本并仅替换编辑段，全部上传完成才 commit。偏移以后台 Unicode 字符数为准，不用 JS UTF-16 长度。草稿由服务内存拥有，退出释放；无磁盘溢写、跨重启恢复或全文编辑总字符门槛。普通新建及生成长度契约保持。

schema 4 通过一致性唯一备份和单事务从 3 增量升级，保留来源行，新增 canonical 映射、原始版本与整理 provenance；高于 4 拒绝。全库正文／补充／引用／手工分区／分类／来源映射版本变化使 apply 失效，使用日不影响快照。最终提交前唯一恢复点，事务检查和映射／分类／内容／索引原子写入，收据含 source_count/target_count/groups，重复成功提交幂等。版本号、数据目录、凭据服务名不变；仅隔离库验证迁移。

`knowledge.get` 默认沿旧 ID 解析保留点，并返回可选 original_sources（source_id/version/title/chunks）。以 `{id,original:true,source_id,version,page?}` 逐个 7000 字符片段只读打开原版本，返回 read_only/original_locator/original_page/original_total，不记录使用日。常规 get／编辑／分区／补充均作用于 canonical；树、列表、搜索和复用排除独立隐藏来源，但原内容可检索为保留点。使用日按组内自然日集合计算。合并组普通删除拒绝；未合并知识正常删除其关联快照。恢复方法见 [使用说明](../README.md#整理知识库)。

普通 `question`／推荐拓展新增收录要求模型返回合法 `category_path`（兼容旧 `category/subcategory`），与正文原子保存；严格 files 范围不读取旧库分类。旧知识复用不为补分类重复调用模型，手工新建可选分类，留空未分类，不隐式外发。

## Settings and full-history usage

`ProviderInput.model_prices` is an optional complete list of per-model `{model,input_price,output_price,currency}` entries. Models must belong to the catalog and be unique; prices may be blank/null (unknown) or finite nonnegative values, including explicit zero. Currency is USD/CNY/EUR. Saved `Provider.model_prices` returns nullable numeric values. Legacy default price fields remain compatible and refer only to the default model. Generation selects actual-model prices and preserves the call-time snapshot; historical attempts are never recalculated.

`usage.summary` accepts `{}` and returns all-history `calls`, `successful`, nullable input/output/total tokens, missing-input/output counts and per-currency nullable estimated cost plus estimated/unknown counts. Known subtotals do not claim complete usage; no-history tokens are zero and all-missing history remains unknown. `usage.list` continues to return the latest 500 attempts.

Preload exposes `storagePaths()` and `openDirectory('data'|'logs'|'sources')` as fixed Electron capabilities, independently of Python operations. The main host checks the active window/main-frame identity and request identifier; it resolves paths from the worker's data root and accepts no arbitrary path. The paths DTO contains `data`, `database`, `sources`, `logs`. Path access/open errors carry correlation identifiers. Paths cannot be edited or migrated by this interface.

Model-price persistence upgrades schema 4 to 5 with a unique consistent backup and transactional rollback, after schema 4 merge migration. Existing default prices migrate only to that default model. Unsupported higher schemas are rejected.

## Recovery and candidate usability (revision 20)

`library.restructure.preview` accepts optional `query` (string, at most 200 characters) for outline title/current-path/original-path filtering before the existing 30-item page; full draft coverage is retained. Duplicate groups may include `source_details: [{id,title,path}]` for title-based choices; existing IDs and evidence gates remain canonical.

`recycle.list({page?:number})` returns `{items:[{id,title,deleted_at}],total,page}` with 30 deletion-event summaries per page. `knowledge.delete` retains its `{deleted:boolean}` result but archives owned knowledge relations atomically; merged groups still reject deletion. `recycle.restore({id})` returns `{restored:boolean}` only on complete restoration; conflicts preserve both current data and the archived event. IDs identify independent deletion events, not knowledge IDs.

`recovery.list({})` returns newest 30 `{id,created_at,kind}` points (Unix seconds; kind daily/manual/before). `recovery.create({})` returns `{backup}`. `recovery.restore({id})` accepts only managed current-schema snapshot names, returns `{restored,backup}` after atomic knowledge-only restoration and rejects when another protocol request remains pending. It preserves current providers, accounting, source metadata/files, vault and recycle; success invalidates backend topic/restructure/edit sessions. Renderer must reload to invalidate its old snapshots. Restore creates a unique pre-restore snapshot; validation/write errors never report success.

Schema 6 adds the persistent recycle table after a unique consistent `before-recovery-v6-*.sqlite3` backup and transactional migration. Unknown versions above 6 reject startup. Daily first-start snapshots retain 7 daily files; manual/pre-restore snapshots are not automatically pruned. These database snapshots are on the same data volume and do not replace offline full-directory or offsite backups.

### 手写笔记、分类移动与资料复用（修订 21）

`knowledge.save` 接受 `{id?,title,content,category_path?,version?}`：手写保存不按标题或正文静默复用，冲突报错；仅显式已有 ID 编辑。新增分类为空数组表示未分类；缺字段保留已有分类（包括旧自由主题）。同父级同标题拒绝；不同父级可同名。UI 编辑携带打开时 version，过期拒绝；旧客户端缺版本仍兼容。标题、正文、分类和搜索索引事务提交，保留引用、模型、补充与使用日。生成用例仍沿用原有复用规则。

新增 `knowledge.move`：`{id,version,category_path:string[]}`，返回 Knowledge；必需当前版本、完整合法父级或空数组。只移动分类并刷新索引，不上传／改写正文、引用或补充。无 schema 或数据位置变更。

新增 `sources.read`：`{id,page?}` 返回 `{name,page,pages,items:Citation[]}`；从保存解析块只读分页，每段最多 12000 字符，保留来源位置；非法页或已删除资料报错，不依赖用户原路径。新增 `sources.attach`：`{id}` 返回 Attachment；从经过管理目录校验的保留副本建立会话快照，复用同会话 ID；在途删除、解析取消和重复完成均释放多余临时文件。挂载本身不调用模型，后续学习仍须用户提交且受显式附件范围约束。

全局搜索固定使用现有 `knowledge.search` 的 `scope=knowledge`，涵盖所有保存知识、补充和资料，不继承 AI 学习范围；不占用模型任务。页面筛选只作用当前列表。树视图偏好仅在渲染器 localStorage 保存各页视图名称，默认 list，失败退回内存，不写知识数据。
