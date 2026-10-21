# 文件：diagnostics.py
# 层：Python 进程诊断公共能力
# 作用：提供脱敏结构日志、请求上下文及同步异步步骤计时。
# 说明：不读取业务参数、异常正文或局部变量，日志失败不覆盖业务结果。
from __future__ import annotations

import asyncio
import functools
import inspect
import json
import logging
import os
import re
import sys
import time
import traceback
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Callable, Iterator, ParamSpec, TypeVar

from knowledge_agent.domain.validation_errors import FieldValidationError

P = ParamSpec("P")
T = TypeVar("T")
# 上下文归当前请求／步骤所有；线程解析继承副本，退出步骤时还原。
CONTEXT: ContextVar[dict] = ContextVar("diagnostic_context", default={})
LOGGER = logging.getLogger("knowledgebase")
LOGGER.addHandler(logging.NullHandler())
LOGGER.propagate = False
MAX_LOG_BYTES = 5 * 1024 * 1024
LOG_RETENTION_SECONDS = 14 * 24 * 60 * 60
CLEANUP_INTERVAL_SECONDS = 24 * 60 * 60
WORKER_LOG = re.compile(r"(?:\d{4}-\d{2}-\d{2}-[1-9]\d*-worker\.log|worker\.log(?:\.[1-9]\d*)?)")
# 仅允许项目定义的固定提示进入异常原因，动态异常文字一律不保存。
SAFE_REASONS = frozenset(
    {
        "API 配置不存在",
        "DOCX 解压内容过大，请拆分文件",
        "Windows 凭据中未找到 API Key，请重新保存该配置",
        "不支持的操作",
        "不支持该文档格式",
        "严格文件回答缺少可核对引用，未收录",
        "仅支持本地文件路径，不支持网络 URL",
        "仅本次文件范围需明确同意增加公开项目来源",
        "仅本次文件范围需要先加入附件",
        "价格确认状态无效",
        "全文超过测试版单次上下文上限（约 28000 字），未发送接口；请拆分文档。不会把片段概括当作全文总结。",
        "公开 README 数据无效",
        "公开 README 无法解码",
        "公开 README 没有可读文字",
        "公开 README 编码无效",
        "公开候选已过期，请重新授权检索",
        "公开检索授权已过期，请重新确认本知识点的检索词",
        "公开项目响应格式无效",
        "公开项目响应超限，已停止",
        "公开项目标识无效",
        "公开项目检索结果无效",
        "公开项目读取失败或超限；未扩大范围、未自动重试",
        "冲突状态无效，未收录",
        "凭据格式无效",
        "分类词表超出本阶段上限，请调整目录减少重复分类后重试",
        "单价须为非负有限数值",
        "同标题知识已存在，请更换标题或编辑已有条目",
        "复制期间文件超过 50MB，未解析",
        "审核分类后出现重复知识点，请重新拆解",
        "审核标识无效",
        "审核结构无效",
        "审核结论无效",
        "尚未配置生成接口；已有知识仍可直接阅读",
        "已有重构草案，请先查看或取消",
        "所选接口已删除",
        "所选接口已删除，请重新选择",
        "所选模型不在此接口列表中，请重新选择",
        "手工内容不能被重构替换",
        "接口事件过大",
        "接口地址必须为不含凭据、查询参数的 HTTP(S) 基础地址",
        "接口地址过长",
        "接口文本格式不兼容",
        "接口未返回完整文本，未保存内容",
        "接口返回无效的流数据",
        "接口配置字段必须为文本",
        "提取文本超过 200 万字，请拆分文件",
        "数据库版本高于当前程序，请使用新版程序打开",
        "整理建议格式无效，未修改知识库",
        "文本编码无法识别，请转换为 UTF-8",
        "无效会话副本",
        "无效分区",
        "无效分页位置",
        "无效协议消息",
        "无效学习操作",
        "无效推理强度",
        "无效检索范围",
        "无效模型 ID",
        "无效资料副本",
        "无效附件标识",
        "无法写入 Windows 凭据管理器，未保存配置",
        "无补充目标，请选择独立保存",
        "未提取到可用文字；扫描文件需要 OCR，本测试版尚未接入",
        "未配置生成接口",
        "标题须为 1–160 字且包含文字，正文须为 1–120000 字",
        "检索词过多，请缩小问题范围",
        "模型 ID 不能包含控制字符",
        "模型 ID 必须为 1–160 字符的文本",
        "模型列表最多 1000 项",
        "模型建议了范围之外的知识目标",
        "模型引用了不存在的证据，未收录",
        "模型必须返回结构化对象",
        "模型接口报告错误，未保存内容",
        "模型未返回要求的结构，未收录；可调整模型后重试",
        "模型标题或正文不完整，未收录",
        "模型目录不是有效 JSON，可手动添加模型",
        "模型目录分页无效，已有列表保留，可手动添加",
        "模型目录分页格式无效，可手动添加模型",
        "模型目录包含无效条目",
        "模型目录升级失败，已停止写入；请保留数据目录及 before-model-catalog-v2 备份后重试",
        "模型目录响应过大，可手动添加模型",
        "模型目录格式不兼容，可手动添加模型",
        "模型结构无效，本地结果保留；请重试或更换模型",
        "模型结果格式无效，未收录",
        "此协议不支持所选推理强度",
        "此协议暂只支持由模型决定推理强度",
        "此知识点不需要项目操作",
        "没有待核对的完整内容，请先生成",
        "没有重构草案",
        "测试版一次最多使用 20 个附件",
        "测试版单个文件上限为 50MB，请拆分后加入",
        "测试版最多读取 200 页 PDF，请先拆分文档",
        "生成内容超过测试版长度限制",
        "生成未完整结束，未保存残缺内容",
        "生成被截断或未正常完成，未保存内容",
        "目录使用的附件已移除，请重新加入并拆解问题",
        "目录分页无效",
        "目录包含不可用的引用",
        "目录包含重复点或原问题标题，请重试拆解",
        "目录已变化，请刷新后展开",
        "目录已过期，未提交",
        "目录已过期，结果未收录",
        "目录已过期，请重新拆解问题",
        "目录标识无效",
        "目录筛选无效",
        "目录路径无效",
        "目录须有 0–16 个候选；请缩小问题，未静默截断",
        "相同补充已存在，请保留一份",
        "知识不存在或已删除",
        "知识已变化，请重新打开后编辑补充",
        "知识已被修改，请重新打开并生成补充；未覆盖旧内容",
        "知识库为空，无需重构",
        "知识库已变化，请重新规划；未修改知识库",
        "知识库已变化，请重新规划；未覆盖新内容",
        "知识点不属于本次目录",
        "知识点主题无效，未采用模型目录",
        "知识点公开检索词无效，未采用模型目录",
        "知识点大类无效，未采用模型目录",
        "知识点学习侧面无效，未采用模型目录",
        "知识点审核不完整，未放行",
        "知识点审核理由无效，未采用模型目录",
        "知识点小类无效，未采用模型目录",
        "知识点归类理由无效，未采用模型目录",
        "知识点整理理由无效，未采用模型目录",
        "知识点标题无效，未采用模型目录",
        "知识点知识要点无效，未采用模型目录",
        "知识点结构无效",
        "知识点调整意见无效，未采用模型目录",
        "知识点资料核对理由无效，未采用模型目录",
        "知识点项目资料要求无效，未采用模型目录",
        "知识目录升级失败，已停止写入；请保留数据目录及 before-knowledge-topics-v3.sqlite3 恢复点后重试",
        "缺少有效条目标识",
        "缺少项目许可",
        "网络连接失败或超时，请检查接口地址和网络；本地知识仍可使用",
        "获取模型连接失败或超时，已有列表保留，可手动添加",
        "补充不存在或已删除",
        "补充标识或版本无效",
        "补充目标不属于本次候选",
        "该主题已有同名知识，请选择已有项补充；未覆盖原文",
        "该重构阶段仍在执行",
        "请从本次真实检索结果选择项目",
        "请先加入 1–20 份相关项目附件",
        "请先填写 API Key",
        "请先选择公开示例或核对资料",
        "请先选择补充到哪条已有知识",
        "请先配置并选择生成接口",
        "请填写 API Key",
        "请填写有效配置名称，模型 ID 最长 160 字符",
        "请完成当前目录和正文差异核对后确认",
        "请明确同意按当前检索词查找公开项目",
        "请求参数类型无效",
        "请输入 1–12000 字的问题；空问题不会调用接口",
        "请输入有效关键词",
        "请输入有效关键词和分页位置",
        "请选择 MD、TXT、DOCX 或文字版 PDF；OCR 和旧 DOC 尚未接入",
        "请选择 USD、CNY 或 EUR",
        "请选择实际支持的接口协议",
        "请选择模型；此接口未设置默认模型",
        "远程接口须使用 HTTPS；HTTP 仅允许本机服务",
        "配置不存在",
        "配置不存在，请重新选择",
        "配置已删除，请重新添加",
        "重构分类含未知或重复知识标识",
        "重构分类格式无效",
        "重构后同一小类存在同名知识，请填写调整意见重新规划；未合并内容",
        "重构已取消，未修改知识库",
        "重构目录覆盖不完整，未修改知识库",
        "重构草案已失效，请重新打开",
        "重构预览分页无效",
        "问题审核无效，请使用拆解并学习重新审核",
        "附件已移除，请重新加入",
        "附件已移除，请重新加入后再提问",
        "项目依据或授权已变化，请重新生成",
        "项目依赖审核缺失",
        "项目授权已撤销或变更，结果未采用",
        "项目目录已过期",
        "项目资料已移除，请重新核对",
        "项目资料核对无效，未允许解释",
        "默认模型必须属于模型列表",
    }
)
OPERATIONS = frozenset(
    {
        "bootstrap",
        "question",
        "question.plan",
        "recommendations",
        "usage.list",
        "usage.summary",
        "knowledge.tree",
        "knowledge.search",
        "knowledge.learn",
        "knowledge.list",
        "knowledge.get",
        "knowledge.save",
        "knowledge.delete",
        "knowledge.bucket",
        "attachments.add",
        "attachments.remove",
        "sources.list",
        "sources.retain",
        "sources.delete",
        "providers.save",
        "providers.select",
        "providers.delete",
        "providers.test",
        "providers.models",
        "supplements.save",
        "supplements.delete",
        "library.restructure.plan",
        "library.restructure.prepare",
        "library.restructure.preview",
        "library.restructure.apply",
        "library.restructure.discard",
    }
)
NUMERIC_FIELDS = frozenset(
    {
        "input_tokens",
        "output_tokens",
        "http_status",
        "elapsed_ms",
        "bytes",
        "chars",
        "blocks",
        "warnings",
        "index",
        "selected",
        "available",
        "file_blocks",
        "pending",
        "progress",
        "stream",
        "stream_chars",
        "page",
        "models",
    }
)


# 只保留异常类别、技术错误码和调用位置；不序列化异常字符串和源码行。
def error_details(error: BaseException) -> list[dict]:
    chain = []
    seen: set[int] = set()
    while error is not None and id(error) not in seen and len(chain) < 8:
        seen.add(id(error))
        detail: dict = {"type": type(error).__name__}
        # 领域校验不携带正文；字段名和规则仍须白名单验证。
        if isinstance(error, FieldValidationError):
            detail["validation"] = field_validation_details(error)
        # 精确匹配固定提示；未知字符串即使是 ValueError 也不当作安全内容。
        if (
            len(error.args) == 1
            and isinstance(error.args[0], str)
            and error.args[0] in SAFE_REASONS
        ):
            detail["reason"] = error.args[0]
        frames = traceback.StackSummary.extract(
            traceback.walk_tb(error.__traceback__), lookup_lines=False
        )
        detail["frames"] = [
            {"file": Path(frame.filename).name, "line": frame.lineno, "function": frame.name}
            for frame in frames[-16:]
        ]
        # 数字系统码可定位磁盘、权限、SQLite 和 HTTP 问题，不带文件名或响应体。
        for name in ("errno", "winerror", "sqlite_errorcode", "lineno", "colno", "pos"):
            value = getattr(error, name, None)
            if isinstance(value, int):
                detail[name] = value
        response = getattr(error, "response", None)
        status = getattr(response, "status_code", None)
        if isinstance(status, int):
            detail["http_status"] = status
        chain.append(detail)
        error = error.__cause__ or (None if error.__suppress_context__ else error.__context__)
    return chain


# 只接受程序定义的字段、类型和规则，防止扩展异常属性夹带模型内容。
def field_validation_details(error: FieldValidationError) -> dict:
    labels = {
        "标题",
        "主题",
        "学习侧面",
        "审核理由",
        "大类",
        "小类",
        "项目资料要求",
        "公开检索词",
        "调整意见",
        "知识要点",
        "归类理由",
        "整理理由",
        "资料核对理由",
    }
    return {
        "field": error.field if error.field in labels else "unknown",
        "rule": error.rule
        if error.rule in {"required_text", "non_blank", "max_length"}
        else "unknown",
        "actual_type": error.actual_type
        if error.actual_type in {"str", "NoneType", "bool", "int", "float", "list", "dict"}
        else "other",
        "actual_length": error.actual_length if type(error.actual_length) is int else None,
        "limit": error.limit if type(error.limit) is int else None,
    }


class JsonFormatter(logging.Formatter):
    # 日志正文只来自本模块显式构造的记录，不使用 logging 的原始消息格式化。
    def format(self, record: logging.LogRecord) -> str:
        return json.dumps(record.msg, ensure_ascii=False, separators=(",", ":"))


class SafeFileHandler(RotatingFileHandler):
    # 每次初始化独占新文件；标准 handler 的锁串行化线程写入和容量分段。
    def __init__(self, directory: Path) -> None:
        self.directory = directory.resolve()
        self.last_cleanup: float | None = None
        super().__init__(self.new_path(), maxBytes=MAX_LOG_BYTES, backupCount=0, encoding="utf-8")
        self.cleanup_expired()

    # 排他创建防止重启或并发启动接续旧文件，当天序号延续最大值。
    def new_path(self) -> Path:
        date = datetime.now().strftime("%Y-%m-%d")
        pattern = re.compile(rf"{date}-([1-9]\d*)-worker\.log")
        indices = [
            int(match[1])
            for path in self.directory.iterdir()
            if (match := pattern.fullmatch(path.name))
        ]
        index = max(indices, default=0)
        while True:
            index += 1
            path = self.directory / f"{date}-{index}-worker.log"
            try:
                with path.open("x", encoding="utf-8"):
                    return path
            except FileExistsError:
                # 候选名称已占用，继续尝试；其他 I/O 错误由初始化／写入兜底。
                continue

    # 容量分段仅关闭自己的文件，不重命名或按备份数量删除近期日志。
    def doRollover(self) -> None:
        if self.stream:
            self.stream.close()
            self.stream = None
        self.baseFilename = str(self.new_path().resolve())
        self.stream = self._open()

    # 以实际 UTF-8 字节衡量容量，避免中文日志按字符数估算导致越界。
    def shouldRollover(self, record: logging.LogRecord) -> bool:
        if self.maxBytes <= 0:
            return False
        if self.stream is None:
            self.stream = self._open()
        size = self.stream.tell()
        # 标准文本流会转换 Windows 换行，容量计算包含转换后的字节。
        entry = (self.format(record) + self.terminator).replace("\n", os.linesep)
        entry_bytes = len(entry.encode("utf-8"))
        return size > 0 and size + entry_bytes > self.maxBytes

    # 长期运行时，在间隔一天后的首次写入清理；不额外持有后台线程或计时器。
    def emit(self, record: logging.LogRecord) -> None:
        self.cleanup_expired()
        super().emit(record)

    # 只清理本进程新旧白名单内的普通文件；当前文件及链接不作为删除目标。
    def cleanup_expired(self) -> None:
        now = time.time()
        if self.last_cleanup is not None and now - self.last_cleanup < CLEANUP_INTERVAL_SECONDS:
            return
        self.last_cleanup = now
        try:
            for path in self.directory.iterdir():
                if not WORKER_LOG.fullmatch(path.name) or path.absolute() == Path(
                    self.baseFilename
                ):
                    continue
                try:
                    info = path.lstat()
                    if path.is_symlink() or not path.is_file():
                        continue
                    if info.st_mtime < now - LOG_RETENTION_SECONDS:
                        path.unlink()
                except FileNotFoundError:
                    # 并发清理已移除目标是正常状态。
                    continue
                except OSError:
                    sys.stderr.write("KnowledgeBase diagnostic cleanup failed\n")
        except OSError:
            sys.stderr.write("KnowledgeBase diagnostic cleanup failed\n")

    # 不使用 logging 默认的 handleError，它会把原始记录和异常写到 stderr。
    def handleError(self, record: logging.LogRecord) -> None:
        sys.stderr.write("KnowledgeBase diagnostic write failed\n")


# 在后台启动装配前配置；每次启动独占新后台日志，不与 Electron 竞争清理。
def configure(data_dir: Path, session_id: str | None = None) -> None:
    LOGGER.setLevel(logging.DEBUG)
    CONTEXT.set({"session_id": session_id or str(uuid.uuid4())})
    try:
        directory = data_dir / "logs"
        directory.mkdir(parents=True, exist_ok=True)
        handler = SafeFileHandler(directory)
        handler.setFormatter(JsonFormatter())
        # 重配只关闭本诊断器的文件句柄，不改第三方或测试 root logger。
        for old in LOGGER.handlers[:]:
            LOGGER.removeHandler(old)
            old.close()
        LOGGER.addHandler(handler)
    except OSError:
        sys.stderr.write("KnowledgeBase diagnostic initialization failed\n")


# fields 只能由代码内的诊断调用提供；禁止传入业务 params、配置和模型输出。
def record(event: str, *, error: BaseException | None = None, **fields: object) -> None:
    try:
        # 用量等数字来自不可信供应商，类型损坏时只记未知，不能把响应对象写进日志。
        fields = {
            key: (value if type(value) in (int, float) else None)
            if key in NUMERIC_FIELDS
            else value
            for key, value in fields.items()
        }
        level = "error" if error is not None else "info"
        value = {
            "time": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
            "level": level,
            "process": "worker",
            "pid": os.getpid(),
            **CONTEXT.get(),
            "event": event,
            **fields,
        }
        if error is not None:
            value["errors"] = error_details(error)
        LOGGER.log(logging.ERROR if error is not None else logging.INFO, value)
    except Exception:
        # 诊断能力不得改变已有提交、取消与错误传播的结果。
        sys.stderr.write("KnowledgeBase diagnostic record failed\n")


# 请求上下文必须在创建 asyncio 任务后进入，避免并发请求串号。
@contextmanager
def request_context(request_id: str, operation: str) -> Iterator[None]:
    token = CONTEXT.set(
        {
            **CONTEXT.get(),
            "request_id": request_id,
            "operation": operation if operation in OPERATIONS else "unknown",
        }
    )
    try:
        yield
    finally:
        CONTEXT.reset(token)


# 每个步骤单独关联父步骤；异常链不包含可能带秘密的 message 和 notes。
@contextmanager
def step(name: str) -> Iterator[None]:
    parent = CONTEXT.get()
    token = CONTEXT.set(
        {**parent, "span_id": str(uuid.uuid4()), "parent_span": parent.get("span_id")}
    )
    started = time.monotonic()
    record("step.start", step=name)
    try:
        yield
    except BaseException as error:
        record(
            "step.cancelled" if isinstance(error, asyncio.CancelledError) else "step.failed",
            step=name,
            elapsed_ms=round((time.monotonic() - started) * 1000),
            error=error,
        )
        raise
    else:
        record("step.completed", step=name, elapsed_ms=round((time.monotonic() - started) * 1000))
    finally:
        CONTEXT.reset(token)


# 装饰器不检查或输出参数／返回值，保留原调用方式与异常对象。
def traced(function: Callable[P, T]) -> Callable[P, T]:
    name = function.__module__ + "." + function.__qualname__
    if inspect.iscoroutinefunction(function):
        # 协程在 await 内计时，覆盖排队、网络、取消与清理。
        @functools.wraps(function)
        async def asynchronous(*args: P.args, **kwargs: P.kwargs) -> T:
            with step(name):
                return await function(*args, **kwargs)

        return asynchronous

    # 同步存储提交在返回后才记录完成，不提前宣称写入成功。
    @functools.wraps(function)
    def synchronous(*args: P.args, **kwargs: P.kwargs) -> T:
        with step(name):
            return function(*args, **kwargs)

    return synchronous
