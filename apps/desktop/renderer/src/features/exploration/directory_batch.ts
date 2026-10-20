// 文件：directory_batch.ts
// 层：React 交互流程
// 作用：串行生成所选目录项，并汇总保存、待核对、缺资料及失败结果。
// 说明：复用单点接口；项目资料逐点核验，取消后不再启动下一项。
import type { Answer, DirectoryPoint, LearnInput } from '../../../../../../contracts/desktop'
import { api, errorText } from '../../shared/api/client'

export interface BatchOutcome {
  point: DirectoryPoint
  answer?: Answer
  message: string
}

export interface BatchOptions {
  points: DirectoryPoint[]
  input: Omit<LearnInput, 'point_id' | 'action'>
  attachmentIds?: string[]
  current: () => boolean
  requestId: () => string | undefined
  progress: (text: string) => void
  receive: (outcome: BatchOutcome) => void
}

// 汇总只描述后台实际终态，项目门禁与待核对内容不会显示成已保存。
function outcomeMessage(answer: Answer): string {
  if (answer.knowledge) {
    return '已保存'
  }
  if (answer.review) {
    return '待核对补充'
  }
  return answer.project?.message ?? answer.notice
}

// 项目资料只由显式的一次提交传入，不把其他项目的许可复制到当前知识点。
async function generatePoint(options: BatchOptions, point: DirectoryPoint): Promise<Answer> {
  const params = { ...options.input, point_id: point.id }
  // 自动核对使用本次同组文件；资料不足时保留索要信息并跳过生成。
  if (point.project_required && options.attachmentIds) {
    const checked = await api.request(
      'knowledge.learn',
      {
        ...params,
        action: 'materials',
        attachment_ids: options.attachmentIds
      },
      options.requestId()
    )
    if (!options.current() || checked.project?.status !== 'material-ready') {
      return checked
    }
  }
  // 前一阶段可能刚好收到取消；两个请求之间同样检查归属版本。
  if (!options.current()) {
    throw new Error('批量生成已停止，已保存内容保留')
  }
  return api.request(
    'knowledge.learn',
    {
      ...params,
      action: point.target_id ? 'supplement' : 'learn',
      target_id: point.target_id
    },
    options.requestId()
  )
}

// 单项失败继续处理其他明确选择的项；没有自动重试，也不替用户确认补充归属。
export async function generateBatch(options: BatchOptions) {
  for (const [index, point] of options.points.entries()) {
    // 切页、取消或重新拆解后不再发送下一项请求。
    if (!options.current()) {
      break
    }
    options.progress(`正在处理 ${index + 1}/${options.points.length}：${point.title}`)
    try {
      const answer = await generatePoint(options, point)
      const message = outcomeMessage(answer)
      options.receive({ point, answer, message })
    } catch (error) {
      // 取消会使版本失效，随后循环入口停止；普通单项错误保留可重试结果。
      if (options.current()) {
        options.receive({ point, message: errorText(error) })
      }
    }
  }
}

// 项目按当前目录明确展示的小类分组，旧目录沿用完整主题，不猜测名称拆分。
export function projectKey(point: DirectoryPoint): string {
  return JSON.stringify([point.category ?? point.theme, point.subcategory ?? '未细分'])
}
