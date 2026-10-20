// 文件：navigation.ts
// 层：React 应用布局
// 作用：声明导航选项。
// 说明：通过受限 API 操作，不访问底层存储或供应商。
export const sections = ['探索', '常用', '在学', '归档', '资料库', 'API 配置', '用量统计'] as const
export type Section = (typeof sections)[number]
export const icons = ['⌕', '☆', '▤', '▣', '▱', '⚙', '◷']
