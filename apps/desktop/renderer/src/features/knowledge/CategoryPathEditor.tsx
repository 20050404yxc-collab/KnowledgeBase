// 文件：CategoryPathEditor.tsx
// 层：React 展示组件
// 作用：按每行一个名称编辑任意层级的知识父级路径。
// 说明：不按斜线拆分名称；空行保留给后台明确校验。

// 换行是编辑格式，协议使用数组保留名称内的斜线等字符。
export function CategoryPathEditor({
  value,
  onChange
}: {
  value: string[]
  onChange: (value: string[]) => void
}) {
  return (
    <label className="category-path-editor">
      所属路径（每行一级，不含当前标题）
      <textarea
        aria-label="所属路径（每行一级）"
        value={value.join('\n')}
        onChange={(event) => onChange(event.target.value.split('\n'))}
      />
    </label>
  )
}
