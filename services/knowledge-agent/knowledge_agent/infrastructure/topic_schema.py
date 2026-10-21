# 文件：topic_schema.py
# 层：Python infrastructure
# 作用：迁移主题、补充与可重建词法索引。
# 说明：迁移事务前建立一致性恢复点，SQL 触发器同步所有写入路径。
import re
import sqlite3
from contextlib import closing
from pathlib import Path

from knowledge_agent.domain.knowledge_rules import tokens
from knowledge_agent.domain.taxonomy import PREFIX, TREE_PREFIX, classification


# 分词函数由连接拥有，触发器与检索使用相同的中文双字及英文词规则。
def register_tokens(db: sqlite3.Connection) -> None:
    # 只解码自身分类编码，让现有触发器仍索引人可读分类；旧数据无需迁移。
    def tokenize(value: str | None) -> str:
        text = re.sub(
            "(?:" + re.escape(PREFIX) + "|" + re.escape(TREE_PREFIX) + r")[0-9a-f]+",
            lambda m: classification(m[0])["theme"],
            value or "",
        )
        return " ".join(sorted(tokens(text)))

    db.create_function("kb_tokens", 1, tokenize)


# 备份先落临时文件再改名，失败不会留下看似完整的恢复点。
def backup_topics(db: sqlite3.Connection, root: Path) -> None:
    target = root / "before-knowledge-topics-v3.sqlite3"
    if target.exists():
        return
    temporary = target.with_suffix(".pending")
    try:
        with closing(sqlite3.connect(temporary)) as destination:
            db.backup(destination)
        temporary.replace(target)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


# 普通索引表始终可用；FTS5 不可用时保留完整分批扫描能力。
def create_index(db: sqlite3.Connection) -> None:
    db.execute("""CREATE TABLE search_documents (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, knowledge_id TEXT, source_id TEXT,
        title TEXT NOT NULL, theme TEXT NOT NULL, body TEXT NOT NULL,
        locator TEXT NOT NULL, terms TEXT NOT NULL)""")
    try:
        db.execute("CREATE VIRTUAL TABLE search_fts USING fts5(terms)")
    except sqlite3.OperationalError as error:
        # 仅缺少 FTS5 模块允许降级；磁盘或其他 SQL 失败必须阻止升级。
        if "no such module" not in str(error):
            raise
        return
    for event, statement in (
        ("INSERT", "INSERT INTO search_fts(rowid,terms) VALUES(new.rowid,new.terms);"),
        ("DELETE", "DELETE FROM search_fts WHERE rowid=old.rowid;"),
        (
            "UPDATE",
            "DELETE FROM search_fts WHERE rowid=old.rowid; "
            "INSERT INTO search_fts(rowid,terms) VALUES(new.rowid,new.terms);",
        ),
    ):
        db.execute(
            f"CREATE TRIGGER search_{event.lower()} AFTER {event} ON search_documents "
            f"BEGIN {statement} END"
        )


# 为知识和补充安装同步索引触发器，变更与正文处于同一事务。
def content_triggers(db: sqlite3.Connection) -> None:
    for table, kind, parent in (
        ("knowledge", "knowledge", "new.id"),
        ("supplements", "supplement", "new.knowledge_id"),
    ):
        prefix = kind + ":"
        theme = f"coalesce((SELECT theme FROM topic_links WHERE knowledge_id={parent}),'未分类')"
        insert = f"""INSERT INTO search_documents
            VALUES('{prefix}'||new.id,'{kind}',{parent},NULL,new.title,{theme},new.content,
            '知识正文',kb_tokens(new.title||' '||new.content||' '||{theme}))
            ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,
            theme=excluded.theme,terms=excluded.terms;"""
        for event in ("INSERT", "UPDATE"):
            db.execute(
                f"CREATE TRIGGER {table}_{event.lower()} AFTER {event} ON {table} "
                f"BEGIN {insert} END"
            )
        db.execute(
            f"CREATE TRIGGER {table}_delete AFTER DELETE ON {table} BEGIN "
            f"DELETE FROM search_documents WHERE id='{prefix}'||old.id; END"
        )
    db.execute("""CREATE TRIGGER topic_insert AFTER INSERT ON topic_links BEGIN
        UPDATE search_documents SET theme=new.theme,
        terms=kb_tokens(title||' '||body||' '||new.theme) WHERE knowledge_id=new.knowledge_id;
        END""")
    db.execute("""CREATE TRIGGER topic_title AFTER UPDATE OF title ON knowledge BEGIN
        UPDATE topic_links SET title_key=kb_identity(new.title) WHERE knowledge_id=new.id;
        END""")


# 资料块沿用稳定证据 ID，删除资料即清理该资料索引，不删除知识摘录。
def source_triggers(db: sqlite3.Connection) -> None:
    insert = """INSERT INTO search_documents
        SELECT 'source:'||new.id||':'||json_extract(value,'$.id'),'source',NULL,new.id,
        new.name,'已保留资料',json_extract(value,'$.text'),json_extract(value,'$.locator'),
        kb_tokens(new.name||' '||json_extract(value,'$.text')) FROM json_each(new.blocks);"""
    db.execute("CREATE TRIGGER sources_insert AFTER INSERT ON sources BEGIN " + insert + " END")
    db.execute("""CREATE TRIGGER sources_delete AFTER DELETE ON sources BEGIN
        DELETE FROM search_documents WHERE source_id=old.id; END""")


# 所有结构与回填均显式处于同一事务，禁止 executescript 隐式提前提交。
def migrate_topics(db: sqlite3.Connection, root: Path) -> None:
    if db.execute("PRAGMA user_version").fetchone()[0] >= 3:
        return
    try:
        backup_topics(db, root)
        with db:
            db.execute("BEGIN")
            db.execute("""CREATE TABLE topic_links (
                knowledge_id TEXT PRIMARY KEY REFERENCES knowledge(id) ON DELETE CASCADE,
                theme TEXT NOT NULL, theme_key TEXT NOT NULL, title_key TEXT NOT NULL,
                UNIQUE(theme_key,title_key))""")
            db.execute("""CREATE TABLE supplements (
                id TEXT PRIMARY KEY, knowledge_id TEXT NOT NULL REFERENCES knowledge(id)
                ON DELETE CASCADE, title TEXT NOT NULL, content TEXT NOT NULL,
                digest TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                citations TEXT NOT NULL, model TEXT NOT NULL, provider_name TEXT NOT NULL,
                edited INTEGER NOT NULL DEFAULT 0, UNIQUE(knowledge_id,digest))""")
            db.execute("""CREATE TABLE capture_receipts (
                capture_key TEXT PRIMARY KEY, knowledge_id TEXT NOT NULL
                REFERENCES knowledge(id) ON DELETE CASCADE)""")
            create_index(db)
            content_triggers(db)
            source_triggers(db)
            populate_index(db)
            db.execute("PRAGMA user_version=3")
    except Exception as error:
        raise ValueError(
            "知识目录升级失败，已停止写入；请保留数据目录及 "
            "before-knowledge-topics-v3.sqlite3 恢复点后重试"
        ) from error


# 索引仅从正式正文、补充和保留资料重建，不依赖旧索引的内容。
def populate_index(db: sqlite3.Connection) -> None:
    db.execute("""INSERT INTO search_documents SELECT 'knowledge:'||k.id,'knowledge',
        k.id,NULL,k.title,coalesce(t.theme,'未分类'),k.content,'知识正文',
        kb_tokens(k.title||' '||k.content||' '||coalesce(t.theme,''))
        FROM knowledge k LEFT JOIN topic_links t ON t.knowledge_id=k.id""")
    db.execute("""INSERT INTO search_documents SELECT 'supplement:'||s.id,'supplement',
        s.knowledge_id,NULL,s.title,coalesce(t.theme,'未分类'),s.content,'知识补充',
        kb_tokens(s.title||' '||s.content||' '||coalesce(t.theme,''))
        FROM supplements s LEFT JOIN topic_links t ON t.knowledge_id=s.knowledge_id""")
    db.execute("""INSERT INTO search_documents SELECT
        'source:'||s.id||':'||json_extract(b.value,'$.id'),'source',NULL,s.id,
        s.name,'已保留资料',json_extract(b.value,'$.text'),json_extract(b.value,'$.locator'),
        kb_tokens(s.name||' '||json_extract(b.value,'$.text'))
        FROM sources s,json_each(s.blocks) b""")
