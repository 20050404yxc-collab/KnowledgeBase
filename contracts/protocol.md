# 桌面与后台协议

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

`knowledge.learn` 输入 `{plan_id, point_id, action, target_id?, attachment_ids?, consent?, public_scope?, search_terms?, revision?, candidate_id?, provider_id?, model?, reasoning_effort?}`。动作包括 `learn/supplement/confirm/separate/materials/public-search/public-select/revoke`。项目点在资料或公开示例证据满足前只返回项目门禁；`materials` 只接受当前会话中 1–20 个且与该点相关的附件，`public-search` 必须携带当前点的一次性 `revision`、明确同意和“本点公开示例”范围，检索词可编辑，服务端最多一次搜索和三个 README 请求；`public-select` 绑定实际候选后才允许解释。变更点、范围、附件、取消或切页会撤销旧许可。补充候选必须来自该目录，不接受任意目标。学习只生成选中项；补充先返回 `review: true` 预览，`confirm` 不再调用模型并在复核目标版本后原子追加；`separate` 保存独立知识。已提交结果可幂等复用，取消不会撤销既有提交。

`Knowledge`、`SearchHit`、`DirectoryPoint` 的 `category`／`subcategory` 为可选兼容字段；旧主题不猜测拆分，不做 R6 批量迁移。项目状态 DTO 使用 `materials`、`material-ready`、`candidates`、`public-ready`，公开候选包含仓库 URL、README 路径、摘录和 UTC 读取时间；解释引用进一步标注实际使用的字符范围；仅模型声称而无读取证据不得进入引用。

简单说：先选目录项再学习；补充要核对后保存，原笔记不会被生成结果覆盖。取消前已经提交的知识仍然保留。

`knowledge.get` 等知识结果增加可选 `theme/version/supplements`；旧知识显示未分类，不批量改写。补充包含稳定 ID、时间、模型、接口、引用和编辑状态。`supplements.save` 输入 `{knowledge_id,id,version,title,content}`；`supplements.delete` 输入 `{knowledge_id,id,version}`。两者均返回最新完整知识，版本过期拒绝，删除原知识级联移除补充及索引。

数据库从 2 升至 3 前通过 SQLite 备份 API 创建 `before-knowledge-topics-v3.sqlite3`，增量结构、回填与版本号同一事务提交。FTS5 不可用时回退到完整分批词法扫描；索引可由仓库维护方法 `rebuild_search_index` 从正式数据重建。没有新增界面维护按钮。
