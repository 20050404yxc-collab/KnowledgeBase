// 文件：ModelPicker.tsx
// 层：React 展示组件
// 作用：显示模型与协议推理强度选择。
// 说明：目录只有模型 ID，不能证明具体型号支持强度。
import type { GenerationOptions, Provider } from '../../../../../../contracts/desktop'
interface Props {
  provider: Provider
  value: GenerationOptions
  disabled: boolean
  onModel: (value: string) => void
  onEffort: (value: string) => void
}
// 显式保留默认项，未设置默认时提示选择，不提供未适配协议的强度。
export function ModelPicker({ provider, value, disabled, onModel, onEffort }: Props) {
  return (
    <div className="model-picker">
      <label>
        模型
        <select
          aria-label="生成模型"
          disabled={disabled}
          value={value.model ?? ''}
          onChange={(event) => onModel(event.target.value)}
        >
          <option value="">
            {provider.model ? `使用接口默认模型 · ${provider.model}` : '请选择模型（未设置默认）'}
          </option>
          {provider.models.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      </label>
      <label>
        推理强度
        <select
          aria-label="推理强度"
          disabled={
            disabled || provider.protocol === 'anthropic' || !(value.model || provider.model)
          }
          value={value.reasoning_effort ?? 'auto'}
          onChange={(event) => onEffort(event.target.value)}
        >
          <option value="auto">由模型决定</option>
          {provider.protocol !== 'anthropic' && (
            <>
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
            </>
          )}
        </select>
      </label>
      <small>
        {provider.protocol === 'anthropic'
          ? '此协议暂由模型决定强度'
          : '强度需模型支持，兼容性未实测'}
      </small>
    </div>
  )
}
