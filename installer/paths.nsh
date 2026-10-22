; 文件：paths.nsh
; 层：Windows 安装向导
; 作用：安装前确认路径，保留原数据并支持手动覆盖升级。
; 说明：当前用户安装；不提供静默安装、数据搬家或数据清除。
!include MUI2.nsh
!include nsDialogs.nsh
!include FileFunc.nsh
!include WordFunc.nsh

!ifndef BUILD_UNINSTALLER
Var KBData
Var KBPrevious
Var KBExistingProgram
Var KBRequired
Var KBError
Var KBPage
Var KBProgramInput
Var KBDataInput
Var KBBrowse
!endif

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; 运行中的应用必须由使用者正常关闭，避免丢失未保存操作或孤立后台。
!macro customCheckAppRunning
  kb_check_running:
    nsProcess::_FindProcess "KnowledgeBase.exe"
    Pop $0
    ${If} $0 == 0
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "请先正常关闭知序，再点击重试。安装器不会强制终止后台。" IDRETRY kb_check_running
      Abort "知序仍在运行，操作已取消。"
    ${EndIf}
!macroend

!macro customUnInit
  ; 即使被额外命令行参数调用，也不能删除保留的知识与路径记录。
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "--delete-app-data" $1
  ${IfNot} ${Errors}
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

!macro customInit
  ; 每一次人工安装都必须展示确认页面，不允许参数跳过。
  ${If} ${Silent}
    SetErrorLevel 2
    Quit
  ${EndIf}
  ${If} $installMode != "CurrentUser"
    MessageBox MB_OK|MB_ICONSTOP "知序仅支持当前用户安装，请移除所有用户安装参数。"
    Quit
  ${EndIf}
  ReadRegStr $KBPrevious HKCU "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
  ReadRegStr $KBExistingProgram HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $KBPrevious != ""
    ${VersionCompare} $KBPrevious "${VERSION}" $0
    ${If} $0 == 1
      MessageBox MB_OK|MB_ICONSTOP "已安装版本 $KBPrevious 高于 ${VERSION}，不能覆盖降级。"
      Quit
    ${EndIf}
  ${EndIf}
  ${If} $KBExistingProgram == ""
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\KnowledgeBase"
  ${EndIf}
  StrCpy $KBRequired "0"
  StrCpy $KBData "$APPDATA\KnowledgeBase"
  ${If} ${FileExists} "$APPDATA\KnowledgeBase\storage.ini"
    ClearErrors
    ReadINIStr $KBData "$APPDATA\KnowledgeBase\storage.ini" "KnowledgeBase" "DataDir"
    ReadINIStr $KBRequired "$APPDATA\KnowledgeBase\storage.ini" "KnowledgeBase" "DatabaseRequired"
    ${If} ${Errors}
    ${OrIf} $KBData == ""
      MessageBox MB_OK|MB_ICONSTOP "原数据路径配置损坏，请先恢复 storage.ini；不会改用空知识库。"
      Quit
    ${EndIf}
  ${EndIf}
!macroend

!ifndef BUILD_UNINSTALLER
!macro customPageAfterChangeDir
  Page custom KBLocationPage KBLocationLeave
  Page custom KBReviewPage KBReviewLeave
!macroend

; 展开已有父目录的短名称，避免 PROGRA~1 之类别名绕过目录重叠检查。
Function KBExpandExistingPrefix
  Exch $0
  Push $1
  Push $2
  Push $3
  Push $4
  StrCpy $3 ""
  StrCpy $4 $0
  ${Do}
    System::Call 'kernel32::GetLongPathNameW(w r0, w .r1, i ${NSIS_MAX_STRLEN}) i.r2'
    ${If} $2 > 0
    ${AndIf} $2 < ${NSIS_MAX_STRLEN}
      ; 根目录展开保留尾斜杠，拼接的未创建部分已经带分隔符。
      StrCpy $2 $1 1 -1
      ${If} $3 != ""
      ${AndIf} $2 == "\"
        StrCpy $1 $1 -1
      ${EndIf}
      StrCpy $0 "$1$3"
      ${ExitDo}
    ${EndIf}
    ; 只补回未创建部分；无法展开时保留完整原值供后续报错。
    StrLen $2 $0
    ${If} $2 <= 3
      StrCpy $0 $4
      ${ExitDo}
    ${EndIf}
    ${GetParent} $0 $1
    ${If} $1 == ""
    ${OrIf} $1 == $0
      StrCpy $0 $4
      ${ExitDo}
    ${EndIf}
    ${GetFileName} $0 $2
    StrCpy $3 "\$2$3"
    ; GetParent 对盘符根返回 D:，必须补回反斜杠，不能变成盘内相对路径。
    StrLen $2 $1
    ${If} $2 == 2
      StrCpy $1 "$1\"
    ${EndIf}
    StrCpy $0 $1
  ${Loop}
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Exch $0
FunctionEnd

; 只规范化路径文本，允许目录尚未创建；失败时不把空字符串交给后续比较。
Function KBNormalizePath
  Exch $0
  Push $1
  Push $2
  StrCpy $1 $0 2 1
  ${If} $1 != ":\"
    StrCpy $KBError "请选择本地磁盘上的完整目录，例如 D:\知序数据。"
    Goto kb_normalize_done
  ${EndIf}
  ; NSIS GetFullPathName 要求目标存在，Win32 API 只转换文本，不创建目录。
  System::Call 'kernel32::GetFullPathNameW(w r0, i ${NSIS_MAX_STRLEN}, w .r1, p 0) i.r2'
  ${If} $2 == 0
  ${OrIf} $2 >= ${NSIS_MAX_STRLEN}
    StrCpy $KBError "无法识别所选路径，请检查路径格式或缩短目录层级。"
  ${Else}
    StrCpy $0 $1
    ; 统一尾部分隔符，根目录保留原样交给专门校验。
    StrLen $2 $0
    StrCpy $1 $0 1 -1
    ${If} $2 > 3
    ${AndIf} $1 == "\"
      StrCpy $0 $0 -1
    ${EndIf}
    Push $0
    Call KBExpandExistingPrefix
    Pop $0
  ${EndIf}
  kb_normalize_done:
  Pop $2
  Pop $1
  Exch $0
FunctionEnd

; 返回具体错误，不创建目录；保留防误删与本地 SQLite 所需的边界。
Function KBValidatePath
  Exch $0
  Push $1
  Push $2
  StrCpy $KBError ""
  StrLen $1 $0
  ${If} $1 <= 3
    StrCpy $KBError "不能直接选择磁盘根目录，请选择一个文件夹，例如 D:\知序。"
    Goto kb_path_done
  ${EndIf}
  StrCpy $1 $0 2 1
  ${If} $1 != ":\"
    StrCpy $KBError "仅支持本地磁盘绝对路径，不支持网络目录。"
    Goto kb_path_done
  ${EndIf}
  StrCpy $1 $0 3
  System::Call 'kernel32::GetDriveTypeW(w r1) i.r2'
  ${If} $2 != 3
    StrCpy $KBError "请选择本地固定磁盘上的目录。"
    Goto kb_path_done
  ${EndIf}
  ; 对每个已有父目录检查重解析点，未创建部分继续向上查。
  ${Do}
    System::Call 'kernel32::GetFileAttributesW(w r0) i.r1 ?e'
    Pop $2
    ${If} $1 != -1
      IntOp $2 $1 & 0x400
      ${If} $2 != 0
        StrCpy $KBError "所选路径或父目录是链接，请改用普通目录。"
        ${ExitDo}
      ${EndIf}
      IntOp $2 $1 & 0x10
      ${If} $2 == 0
        StrCpy $KBError "所选路径或父路径是文件，请改选文件夹。"
        ${ExitDo}
      ${EndIf}
    ${Else}
      ; 尚未创建的目录合法，其他错误不能当成目录不存在。
      ${If} $2 != 2
      ${AndIf} $2 != 3
        StrCpy $KBError "无法访问所选路径，请检查目录名称、磁盘状态和访问权限。"
        ${ExitDo}
      ${EndIf}
    ${EndIf}
    StrLen $2 $0
    ${If} $2 <= 3
      ${ExitDo}
    ${EndIf}
    ${GetParent} $0 $1
    ${If} $1 == $0
    ${OrIf} $1 == ""
      ${ExitDo}
    ${EndIf}
    StrLen $2 $1
    ${If} $2 == 2
      StrCpy $1 "$1\"
    ${EndIf}
    StrCpy $0 $1
  ${Loop}
  kb_path_done:
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; 显示两个独立位置；升级与重装已记录的数据路径只读。
Function KBLocationPage
  !insertmacro MUI_HEADER_TEXT "选择安装与存储位置" "确认程序安装目录，以及知识、资料和日志的存放位置。"
  nsDialogs::Create 1018
  Pop $KBPage
  ${NSD_CreateLabel} 0 0 100% 12u "程序安装目录："
  Pop $0
  ${NSD_CreateText} 0 16u 82% 14u "$INSTDIR"
  Pop $KBProgramInput
  ${NSD_CreateBrowseButton} 84% 16u 16% 14u "浏览…"
  Pop $KBBrowse
  ${NSD_OnClick} $KBBrowse KBBrowseProgram
  ${If} $KBExistingProgram != ""
    EnableWindow $KBProgramInput 0
    EnableWindow $KBBrowse 0
  ${EndIf}
  ${NSD_CreateLabel} 0 42u 100% 12u "业务数据目录（数据库、资料副本、日志和临时文件）："
  Pop $0
  ${NSD_CreateText} 0 58u 82% 14u "$KBData"
  Pop $KBDataInput
  ${NSD_CreateBrowseButton} 84% 58u 16% 14u "浏览…"
  Pop $KBBrowse
  ${NSD_OnClick} $KBBrowse KBBrowseData
  ${If} ${FileExists} "$APPDATA\KnowledgeBase\storage.ini"
    EnableWindow $KBDataInput 0
    EnableWindow $KBBrowse 0
  ${EndIf}
  ${NSD_CreateLabel} 0 88u 100% 52u "升级和重装沿用已确认的数据位置，不自动搬家。卸载默认保留数据。$\r$\n下一页会显示全部具体位置，确认后才开始安装。"
  Pop $0
  nsDialogs::Show
FunctionEnd

Function KBBrowseProgram
  nsDialogs::SelectFolderDialog "选择知序的专用程序文件夹" "$INSTDIR"
  Pop $0
  ${If} $0 != error
    ${NSD_SetText} $KBProgramInput $0
  ${EndIf}
FunctionEnd

Function KBBrowseData
  nsDialogs::SelectFolderDialog "选择知序的专用业务数据文件夹" "$KBData"
  Pop $0
  ${If} $0 != error
    ${NSD_SetText} $KBDataInput $0
  ${EndIf}
FunctionEnd

; 空目标或已识别的原安装才允许部署，避免卸载时删除用户其他文件。
Function KBCheckDedicatedDirectories
  ${If} $KBExistingProgram == ""
    FindFirst $0 $1 "$INSTDIR\*"
    ${DoWhile} $1 != ""
      ${If} $1 != "."
      ${AndIf} $1 != ".."
        StrCpy $KBError "程序位置必须是空的专用文件夹，请新建子文件夹。"
        ${ExitDo}
      ${EndIf}
      FindNext $0 $1
    ${Loop}
    FindClose $0
  ${EndIf}
  ; 数据位置可含普通文件，但不能接管其他程序的同名管理目录。
  ${If} $KBError == ""
  ${AndIfNot} ${FileExists} "$KBData\knowledge.sqlite3"
  ${AndIfNot} ${FileExists} "$APPDATA\KnowledgeBase\storage.ini"
    ${If} ${FileExists} "$KBData\sources"
    ${OrIf} ${FileExists} "$KBData\sessions"
    ${OrIf} ${FileExists} "$KBData\logs"
    ${OrIf} ${FileExists} "$KBData\knowledge.sqlite3-wal"
    ${OrIf} ${FileExists} "$KBData\knowledge.sqlite3-shm"
    ${OrIf} ${FileExists} "$KBData\knowledge.sqlite3-journal"
      StrCpy $KBError "数据位置已有 sources、sessions、logs 或数据库辅助文件。请选一个新子文件夹，或选择包含原 knowledge.sqlite3 的知序数据目录。"
    ${EndIf}
  ${EndIf}
FunctionEnd

; 数据目录的固定子项不能是链接或类型冲突，否则运行时可能写到其他位置。
!macro KBCheckDataEntry NAME DIRECTORY_FLAG
  System::Call 'kernel32::GetFileAttributesW(w "$KBData\${NAME}") i.r0'
  ${If} $0 != -1
    IntOp $1 $0 & 0x400
    IntOp $2 $0 & 0x10
    ${If} $1 != 0
      StrCpy $KBError "数据位置的 ${NAME} 是链接，请选择普通目录或恢复原数据。"
      Return
    ${EndIf}
    ${If} $2 != ${DIRECTORY_FLAG}
      StrCpy $KBError "数据位置的 ${NAME} 类型冲突，请选择其他目录或恢复原数据。"
      Return
    ${EndIf}
  ${EndIf}
!macroend

Function KBValidateDataEntries
  !insertmacro KBCheckDataEntry "knowledge.sqlite3" 0
  !insertmacro KBCheckDataEntry "sources" 0x10
  !insertmacro KBCheckDataEntry "sessions" 0x10
  !insertmacro KBCheckDataEntry "logs" 0x10
FunctionEnd

; 页面与回归测试共用完整校验，首个错误一旦出现就停止。
Function KBValidateLocations
  StrCpy $KBError ""
  Push $INSTDIR
  Call KBNormalizePath
  Pop $INSTDIR
  ${If} $KBError != ""
    DetailPrint "path_validation.normalization_failed"
    Return
  ${EndIf}
  Push $KBData
  Call KBNormalizePath
  Pop $KBData
  ${If} $KBError != ""
    DetailPrint "path_validation.normalization_failed"
    Return
  ${EndIf}
  Push $INSTDIR
  Call KBValidatePath
  ${If} $KBError == ""
    Push $KBData
    Call KBValidatePath
  ${EndIf}
  ${If} $KBError != ""
    DetailPrint "path_validation.directory_failed"
    Return
  ${EndIf}
  ; 比较带结尾分隔符的前缀，不能把 D:\Data2 误认为 D:\Data 的子目录。
  StrLen $0 "$INSTDIR\"
  StrCpy $1 "$KBData\" $0
  StrLen $2 "$KBData\"
  StrCpy $3 "$INSTDIR\" $2
  ${If} $1 == "$INSTDIR\"
  ${OrIf} $3 == "$KBData\"
    StrCpy $KBError "程序与数据目录不能相同或相互包含。"
    DetailPrint "path_validation.overlap"
    Return
  ${EndIf}
  ${If} $KBRequired == "1"
  ${AndIfNot} ${FileExists} "$KBData\knowledge.sqlite3"
    StrCpy $KBError "找不到原数据库，请恢复原数据磁盘与目录后重试；不会新建空库。"
  ${EndIf}
  ${If} $KBError == ""
    Call KBCheckDedicatedDirectories
  ${EndIf}
  ${If} $KBError == ""
    Call KBValidateDataEntries
  ${EndIf}
  ${If} $KBError != ""
    DetailPrint "path_validation.storage_failed"
  ${EndIf}
FunctionEnd

Function KBLocationLeave
  ${NSD_GetText} $KBProgramInput $INSTDIR
  ${NSD_GetText} $KBDataInput $KBData
  Call KBValidateLocations
  ${If} $KBError != ""
    MessageBox MB_OK|MB_ICONEXCLAMATION "$KBError"
    Abort
  ${EndIf}
FunctionEnd

Function KBReviewPage
  !insertmacro MUI_HEADER_TEXT "确认安装位置" "请核对以下完整位置；点击安装后才部署程序。"
  nsDialogs::Create 1018
  Pop $KBPage
  StrCpy $0 "首次安装 ${VERSION}"
  ${If} $KBPrevious != ""
    StrCpy $0 "手动升级／修复：$KBPrevious → ${VERSION}"
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 12u "$0"
  Pop $0
  ${NSD_CreateText} 0 16u 100% 101u "程序：$INSTDIR$\r$\n数据：$KBData$\r$\n数据库：$KBData\knowledge.sqlite3$\r$\n资料副本：$KBData\sources$\r$\n日志：$KBData\logs$\r$\n临时副本：$KBData\sessions$\r$\n数据库升级恢复点：$KBData\before-*.sqlite3$\r$\n路径配置与桌面缓存：$APPDATA\KnowledgeBase"
  Pop $0
  SendMessage $0 ${EM_SETREADONLY} 1 0
  ; 多行只读输入便于滚动、选中并核对长路径。
  System::Call 'user32::GetWindowLongW(p r0, i -16) i.r1'
  IntOp $1 $1 | 0x00200804
  System::Call 'user32::SetWindowLongW(p r0, i -16, i r1)'
  ${NSD_CreateLabel} 0 124u 100% 28u "API 密钥：Windows 凭据管理器。系统临时文件由 Windows 管理。$\r$\n不自动更新；升级保留知识和设置，卸载保留数据与密钥。"
  Pop $0
  GetDlgItem $0 $HWNDPARENT 1
  ${NSD_SetText} $0 "确认安装(&I)"
  nsDialogs::Show
FunctionEnd

; 用户确认后探测最近已存在父目录的写权限，不在确认前初始化数据库。
Function KBProbeWritable
  Exch $0
  Push $1
  Push $2
  ${Do}
    IfFileExists "$0\*" kb_probe_found
    ${GetParent} $0 $1
    ${If} $1 == ""
      StrCpy $KBError "目标磁盘不可用。"
      Goto kb_probe_done
    ${EndIf}
    StrLen $2 $1
    ${If} $2 == 2
      StrCpy $1 "$1\"
    ${EndIf}
    ${If} $1 == $0
      StrCpy $KBError "目标磁盘不可用。"
      Goto kb_probe_done
    ${EndIf}
    StrCpy $0 $1
  ${Loop}
  kb_probe_found:
  ClearErrors
  GetTempFileName $1 $0
  ${If} ${Errors}
    StrCpy $KBError "目标位置无法写入，请返回选择有权限的目录。"
  ${Else}
    Delete $1
  ${EndIf}
  kb_probe_done:
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function KBReviewLeave
  StrCpy $KBError ""
  Push $INSTDIR
  Call KBProbeWritable
  ${If} $KBError == ""
    Push $KBData
    Call KBProbeWritable
  ${EndIf}
  ${If} $KBError != ""
    MessageBox MB_OK|MB_ICONSTOP "$KBError"
    Abort
  ${EndIf}
FunctionEnd

!macro customInstall
  ; 程序资源部署成功后才提交数据定位。安装器从不打开业务数据库。
  ClearErrors
  CreateDirectory "$KBData"
  CreateDirectory "$APPDATA\KnowledgeBase"
  ${If} ${Errors}
    Abort "无法创建已确认的数据位置；安装未完成，请检查权限后重试。"
  ${EndIf}
  ${IfNot} ${FileExists} "$APPDATA\KnowledgeBase\storage.ini"
    StrCpy $KBRequired "0"
    ${If} ${FileExists} "$KBData\knowledge.sqlite3"
      StrCpy $KBRequired "1"
    ${EndIf}
    ClearErrors
    FileOpen $0 "$APPDATA\KnowledgeBase\storage.ini.next" w
    FileWriteUTF16LE /BOM $0 "[KnowledgeBase]$\r$\nDataDir=$KBData$\r$\nDatabaseRequired=$KBRequired$\r$\n"
    FileClose $0
    ${If} ${Errors}
      Abort "无法保存数据位置；安装未完成，请检查权限后重试。"
    ${EndIf}
    System::Call 'kernel32::MoveFileExW(w "$APPDATA\KnowledgeBase\storage.ini.next", w "$APPDATA\KnowledgeBase\storage.ini", i 9) i.r0'
    ${If} $0 == 0
      Abort "无法提交数据位置；安装未完成，请检查权限后重试。"
    ${EndIf}
  ${EndIf}
!macroend
!endif
