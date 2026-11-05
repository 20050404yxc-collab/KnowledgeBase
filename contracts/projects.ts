// 文件：projects.ts
// 层：跨进程契约
// 作用：描述带标签的本地项目路径引用及有界目录预览。
// 说明：引用只存元数据，不表示项目文件已导入或完整解析。
export interface ProjectReference {
  id: string
  label: string
  path: string
  category_path: string[]
  revision: string
}

export interface ProjectReferenceInput {
  id?: string
  label: string
  path: string
  category_path: string[]
}
