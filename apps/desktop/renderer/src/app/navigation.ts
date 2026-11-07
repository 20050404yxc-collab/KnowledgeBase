// 文件：navigation.ts
// 层：React 应用布局
// 作用：声明导航选项。
// 说明：通过受限 API 操作，不访问底层存储或供应商。
export const sections = [
  '探索',
  '知识库',
  '常用',
  '在学',
  '归档',
  '资料库',
  '搜索',
  '回收站',
  '设置',
  '用量统计'
] as const
export type Section = (typeof sections)[number]
// 分区仍作为会话键，入口收拢不改变草稿、阅读和任务的所有权。
export const librarySections = ['知识库', '常用', '在学', '归档'] as const
export const primarySections = [
  '探索',
  '知识库',
  '资料库',
  '搜索',
  '回收站',
  '设置',
  '用量统计'
] as const
export const icons = ['⊕', '▦', '▱', '⌕', '♲', '⚙', '◷']

// 全库与频率分区共享侧栏高亮，但保留独立页面身份。
export function isLibrarySection(section: Section) {
  return librarySections.some((name) => name === section)
}
