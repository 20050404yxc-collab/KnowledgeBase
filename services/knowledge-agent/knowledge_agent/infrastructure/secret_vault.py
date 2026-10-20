# 文件：secret_vault.py
# 层：Python infrastructure
# 作用：访问 Windows 凭据管理器，不使用明文降级。
# 说明：保持既有协议与数据兼容。
import keyring

from knowledge_agent.diagnostics import traced

SERVICE = "KnowledgeBase.test0.01"


class SecretVault:
    # 初始化本对象拥有的状态和资源，依赖由调用方显式提供。
    @traced
    def __init__(self) -> None:
        # 明确使用 Windows 凭据管理器，不接受明文回退。
        from keyring.backends.Windows import WinVaultKeyring

        self.backend = WinVaultKeyring()

    # 按稳定标识读取当前记录，缺失状态由所属适配器明确处理。
    @traced
    def get(self, config_id: str) -> str | None:
        return self.backend.get_password(SERVICE, config_id)

    # 保存给定标识的值，失败向调用者报告以便协调补偿。
    @traced
    def set(self, config_id: str, secret: str) -> None:
        self.backend.set_password(SERVICE, config_id, secret)

    # 移除指定标识的状态，重复删除允许没有记录。
    @traced
    def delete(self, config_id: str) -> None:
        try:
            self.backend.delete_password(SERVICE, config_id)
        except keyring.errors.PasswordDeleteError:
            pass
