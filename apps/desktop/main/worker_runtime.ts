// 文件：worker_runtime.ts
// 层：Electron 桌面宿主
// 作用：区分开发解释器与安装资源中的独立后台。
// 说明：命令与参数分离，不调用 shell；不依赖安装目录写权限。
import { join } from 'node:path'

export interface WorkerRuntime {
  executable: string
  arguments: string[]
  cwd: string
  ready?: () => Promise<void>
}

// 安装版后台在 asar 外运行；开发模式保持原入口和解释器参数。
export function workerRuntime(root: string, resources?: string): WorkerRuntime {
  if (resources) {
    const cwd = join(resources, 'worker')
    return { executable: join(cwd, 'knowledge-worker.exe'), arguments: [], cwd }
  }
  return {
    executable: join(root, '.venv', 'Scripts', 'python.exe'),
    arguments: ['-u', join(root, 'services', 'knowledge-agent', 'worker.py')],
    cwd: root
  }
}
