// 文件：CategoryPicker.tsx
// 层：React 展示组件
// 作用：逐层编辑可选父级分类，不要求用户输入编码或分隔符。
// 说明：空数组表示未分类；各层文字和完整路径由后台最终校验。

// 每层提供独立输入与删除；名称中的斜线始终属于原名称。
export function CategoryPicker({
  value,
  onChange
}: {
  value: string[]
  onChange: (path: string[]) => void
}) {
  return (
    <fieldset className="category-picker">
      <legend>所属分类（可选）</legend>
      {!value.length && <p className="subtle">未分类；可稍后从知识详情移动。</p>}
      {value.map((part, index) => (
        <div className="category-level" key={index}>
          <label>
            第 {index + 1} 级
            <input
              aria-label={`第 ${index + 1} 级分类`}
              value={part}
              maxLength={80}
              required
              placeholder={index ? '例如：Python' : '例如：编程'}
              onChange={(event) =>
                onChange(value.map((p, i) => (i === index ? event.target.value : p)))
              }
            />
          </label>
          <button
            type="button"
            aria-label={`删除第 ${index + 1} 级分类`}
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            移除此级
          </button>
        </div>
      ))}
      <button type="button" disabled={value.length >= 64} onClick={() => onChange([...value, ''])}>
        ＋ 添加一级分类
      </button>
      {!!value.length && (
        <small>保存到：{value.filter(Boolean).join(' → ')}。不含当前知识标题。</small>
      )}
    </fieldset>
  )
}
