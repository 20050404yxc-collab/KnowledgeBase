# 文件：build_worker.py
# 层：发布构建
# 作用：冻结实际后台运行依赖并生成随包 Python 许可证清单。
# 说明：只向忽略提交的 build 目录写产物，不复制虚拟环境或用户数据。
import importlib.metadata as metadata
import json
import subprocess
import sys
from pathlib import Path

from packaging.requirements import Requirement

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ["httpx", "keyring", "python-docx", "pdfplumber", "numpy", "onnxruntime", "tokenizers"]


# 按当前 Windows 环境解析必需依赖，不把 OCR／开发候选全部作为交付能力。
def runtime_distributions() -> list[metadata.Distribution]:
    pending, found = RUNTIME.copy(), {}
    while pending:
        item = metadata.distribution(pending.pop())
        name = item.metadata["Name"].lower().replace("_", "-")
        if name in found:
            continue
        found[name] = item
        for value in item.requires or []:
            requirement = Requirement(value)
            if requirement.marker is None or requirement.marker.evaluate({"extra": ""}):
                pending.append(requirement.name)
    return [found[name] for name in sorted(found)]


# 包声明与原始许可证一起保存，缺少许可证时使发布构建失败而非隐瞒。
def write_notices() -> None:
    destination = ROOT / "build/notices/python"
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "PYTHON-LICENSE.txt").write_bytes(
        (Path(sys.base_prefix) / "LICENSE.txt").read_bytes()
    )
    manifest = []
    distributions = runtime_distributions() + [metadata.distribution("pyinstaller")]
    for distribution in distributions:
        name, version = distribution.metadata["Name"], distribution.version
        target = destination / name
        target.mkdir(exist_ok=True)
        files = []
        for item in distribution.files or []:
            if any(word in str(item).lower() for word in ("license", "copying", "notice")):
                source = Path(distribution.locate_file(item))
                if source.is_file():
                    filename = str(item).replace("/", "_").replace("\\", "_")
                    (target / filename).write_bytes(source.read_bytes())
                    files.append(filename)
        fallback = {"flatbuffers": "25.12.19", "tokenizers": "0.23.3"}
        if not files and name.lower() in fallback:
            # Windows wheel 未携带许可文件，使用同版本上游原文并记录来源。
            filename = f"{name.lower()}-{version}-LICENSE.txt"
            if version != fallback[name.lower()]:
                raise RuntimeError("Dependency version changed; recheck upstream license")
            (target / filename).write_bytes((ROOT / "docs/第三方许可" / filename).read_bytes())
            files.append(filename)
        if not files:
            raise RuntimeError(f"Missing license material: {name}")
        manifest.append({"name": name, "version": version, "license_files": files})
    (destination / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (destination / "bge-small-zh-v1.5-LICENSE.txt").write_bytes(
        (ROOT / "docs/第三方许可/bge-small-zh-v1.5-LICENSE.txt").read_bytes()
    )


# 控制冻结入口与动态凭据导入；后台仍通过 UTF-8 JSON Lines 标准流通信。
def main() -> None:
    write_notices()
    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--noupx",
        "--console",
        "--name=knowledge-worker",
        "--distpath=build/worker",
        "--workpath=build/pyinstaller",
        "--specpath=build/pyinstaller",
        "--paths=services/knowledge-agent",
        "--hidden-import=keyring.backends.Windows",
        "--collect-data=docx",
        "--collect-data=certifi",
    ]
    for name in ["rapidocr", "cv2", "sqlite_vec", "pytest", "ruff"]:
        command.append("--exclude-module=" + name)
    subprocess.run(command + ["services/knowledge-agent/worker.py"], cwd=ROOT, check=True)


if __name__ == "__main__":
    main()
