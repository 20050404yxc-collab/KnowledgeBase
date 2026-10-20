"""Prepare the pinned RapidOCR package's models in the user-confirmed directory."""

import hashlib
import importlib.metadata
import json
import os
import shutil
from pathlib import Path

import rapidocr
from omegaconf import OmegaConf
from rapidocr.inference_engine.base import FileInfo, InferSession
from rapidocr.utils.download_models import download_models
from rapidocr.utils.parse_parameters import ParseParams


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main():
    root = Path(
        os.environ.get("KB_OCR_MODEL_DIR", "D:/dev-models/KnowledgeBase/rapidocr")
    )
    root.mkdir(parents=True, exist_ok=True)
    package_root = Path(rapidocr.__file__).parent
    config = OmegaConf.load(package_root / "config.yaml")
    config.Global.model_root_dir = str(root)
    config.EngineConfig.onnxruntime.intra_op_num_threads = 4
    config.EngineConfig.onnxruntime.inter_op_num_threads = 1
    config_path = root / "config.yaml"
    OmegaConf.save(config, config_path)
    config = ParseParams.load(config_path)
    models = []
    for task in ("Det", "Cls", "Rec"):
        settings = config[task]
        info = InferSession.get_model_url(
            FileInfo(
                settings.engine_type,
                settings.ocr_version,
                settings.task_type,
                settings.lang_type,
                settings.model_type,
            )
        )
        url = info["model_dir"]
        filename = url.rsplit("/", 1)[-1]
        bundled = package_root / "models" / filename
        target = root / filename
        expected = info["SHA256"]
        if not target.exists() and bundled.is_file() and sha256(bundled) == expected:
            shutil.copyfile(bundled, target)
        models.append(
            {"task": task, "file": filename, "source": url, "sha256": expected}
        )
    download_models(config_path)
    for model in models:
        path = root / model["file"]
        if sha256(path) != model["sha256"]:
            raise RuntimeError(f"Model checksum mismatch: {path}")
        model["bytes"] = path.stat().st_size
    receipt = {
        "rapidocr": importlib.metadata.version("rapidocr"),
        "directory": str(root),
        "config": str(config_path),
        "models": models,
        "license_note": "Model provenance recorded; full redistribution license audit is pending.",
    }
    serialized = json.dumps(receipt, ensure_ascii=False, indent=2) + "\n"
    (root / "models.lock.json").write_text(serialized, encoding="utf-8")
    project = Path(__file__).resolve().parent.parent
    (project / "environment-models.lock.json").write_text(serialized, encoding="utf-8")
    print(serialized)


if __name__ == "__main__":
    main()
