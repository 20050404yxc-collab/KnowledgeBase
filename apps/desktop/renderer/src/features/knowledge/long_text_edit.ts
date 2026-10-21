// 文件：long_text_edit.ts
// 层：React 受限 API 协调
// 作用：逐段上传长正文，在全部内容就绪后原子保存。
// 说明：沿用原版本；导航离开时停止未提交的编辑并清理会话。
import { api, errorText, reportFeedback } from '../../shared/api/client'

export type TextTarget = { id: string; version: string; supplement_id?: string; title: string }

// 偏移使用后台返回的 Unicode 字符数，避免表情等字符导致上传错位。
async function appendText(edit_id: string, text: string, offset: number, active: () => boolean) {
  const characters = Array.from(text)
  for (let start = 0; start < characters.length; start += 12000) {
    if (!active()) {
      throw new Error('已离开当前正文，未提交编辑')
    }
    const result = await api.request('knowledge.text', {
      action: 'append',
      edit_id,
      offset,
      content: characters.slice(start, start + 12000).join('')
    })
    if (result.offset === undefined) {
      throw new Error('正文上传结果无效')
    }
    offset = result.offset
  }
  return offset
}

// 只替换当前编辑段，其他段逐页读取原版本；失败不留下半条正式知识。
export async function saveTextPage(
  target: TextTarget,
  page: number,
  pages: number,
  replacement: string,
  active: () => boolean
) {
  // 只发送目标字段，不把组件的当前显示正文和引用夹带进控制请求。
  target = {
    id: target.id,
    version: target.version,
    title: target.title,
    supplement_id: target.supplement_id
  }
  const session = await api.request('knowledge.text', { action: 'begin', ...target })
  if (!session.edit_id) {
    throw new Error('无法开始正文编辑')
  }
  let committed = false
  try {
    let offset = 0
    for (let index = 0; index < pages; index++) {
      if (!active()) {
        throw new Error('已离开当前正文，未提交编辑')
      }
      const part =
        index === page
          ? replacement
          : (
              await api.request('knowledge.text', {
                action: 'read',
                ...target,
                page: index
              })
            ).content
      if (part === undefined) {
        throw new Error('原正文读取不完整，未保存')
      }
      offset = await appendText(session.edit_id, part, offset, active)
    }
    if (!active()) {
      throw new Error('已离开当前正文，未提交编辑')
    }
    await api.request('knowledge.text', {
      action: 'commit',
      edit_id: session.edit_id,
      chars: offset
    })
    committed = true
  } finally {
    // 清理失败单独记录，不覆盖主错误或已经提交的结果；后台退出也释放全部会话。
    if (!committed) {
      try {
        await api.request('knowledge.text', { action: 'discard', edit_id: session.edit_id })
      } catch (error) {
        reportFeedback(errorText(error))
      }
    }
  }
}
