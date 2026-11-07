// 文件：OrganizationSetup.tsx
// 层：React 知识库组件
// 作用：在可聚焦对话框中明确整理范围、模型和费用。
// 说明：关闭不提交；生成后由原会话继续任务与草案审核。
import { useEffect, useRef } from 'react'
import { useAppContext } from '../../app/AppContext'
import { ModelPicker } from '../providers'

// 原生模态框限制焦点并支持 Escape，卸载时关闭，恢复触发按钮焦点。
export function OrganizationSetup({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const model = useAppContext()
  const { activeProvider, generationOptions, busy, ready, organizationMode } = model
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  return (
    <dialog
      ref={dialog}
      className="modal organization-setup"
      aria-labelledby="organization-title"
      onClose={onClose}
    >
      <div className="modal-heading">
        <h2 id="organization-title">整理知识库</h2>
        <button aria-label="关闭整理设置" onClick={() => dialog.current?.close()}>
          ×
        </button>
      </div>
      <p>
        先调用当前模型分析知识并提出分类，概览每条最多 2400
        字符，记录用量并可能产生费用。确认方案后才保存。
      </p>
      <label>
        <input
          type="radio"
          name="organization-mode"
          checked={organizationMode === 'categories'}
          onChange={() => model.setOrganizationMode('categories')}
          disabled={!!busy}
        />
        只整理分类（保留正文）
      </label>
      <label>
        <input
          type="radio"
          name="organization-mode"
          checked={organizationMode === 'content'}
          onChange={() => model.setOrganizationMode('content')}
          disabled={!!busy}
        />
        整理分类并准备内容调整
      </label>
      <p className="subtle">
        仅分类无需生成正文。合并知识必须准备并接受完整原文整理稿；内容模式会继续调用模型，全文分片处理后逐项核对。
      </p>
      {activeProvider ? (
        <ModelPicker
          provider={activeProvider}
          value={generationOptions}
          disabled={!!busy}
          onModel={(value) => model.chooseModel(activeProvider, value)}
          onEffort={(value) => model.chooseEffort(activeProvider, value)}
        />
      ) : (
        <button onClick={() => model.setSection('设置')}>配置生成接口</button>
      )}
      <div className="modal-actions">
        <button onClick={() => dialog.current?.close()}>取消</button>
        <button
          className="primary"
          disabled={!ready || !!busy || !activeProvider}
          onClick={() => {
            // 先退出模态再启动原任务，进度、取消和确认草案留在知识库页面。
            onClose()
            void model.planRestructure()
          }}
        >
          生成整理方案
        </button>
      </div>
    </dialog>
  )
}
