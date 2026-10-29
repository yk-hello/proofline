!include MUI2.nsh
!include nsDialogs.nsh
!include LogicLib.nsh
!include FileFunc.nsh

!ifndef BUILD_UNINSTALLER
Var ProoflineAssociate
Var ProoflineDesktop
Var ProoflineTaskbar
Var ProoflineAssociateControl
Var ProoflineDesktopControl
Var ProoflineTaskbarControl
!endif

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "安装 Proofline"
  !define MUI_WELCOMEPAGE_TEXT "读、批、改：审阅 AI 生成的文档。$\r$\n$\r$\n升级安装会保留阅读记录、标注和恢复草稿。"
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customInit
  ; Everything is on by default; a reinstall keeps the choices made last time.
  StrCpy $ProoflineAssociate ${BST_CHECKED}
  StrCpy $ProoflineDesktop ${BST_CHECKED}
  StrCpy $ProoflineTaskbar ${BST_CHECKED}
  ClearErrors
  ReadRegDWORD $R3 HKCU "Software\Proofline\Installer" Associate
  ${IfNot} ${Errors}
    StrCpy $ProoflineAssociate $R3
  ${EndIf}
  ClearErrors
  ReadRegDWORD $R3 HKCU "Software\Proofline\Installer" Desktop
  ${IfNot} ${Errors}
    StrCpy $ProoflineDesktop $R3
  ${EndIf}
  ClearErrors
  ReadRegDWORD $R3 HKCU "Software\Proofline\Installer" Taskbar
  ${IfNot} ${Errors}
    StrCpy $ProoflineTaskbar $R3
  ${EndIf}
  ClearErrors
  ${GetParameters} $R0
  ${GetOptions} $R0 "/ASSOCIATE=" $R1
  ${IfNot} ${Errors}
    StrCpy $ProoflineAssociate $R1
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/DESKTOP=" $R1
  ${IfNot} ${Errors}
    StrCpy $ProoflineDesktop $R1
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/TASKBAR=" $R1
  ${IfNot} ${Errors}
    StrCpy $ProoflineTaskbar $R1
  ${EndIf}
  ClearErrors
!macroend

!macro customPageAfterChangeDir
  Page custom ProoflineOptionsPageCreate ProoflineOptionsPageLeave
!macroend

!ifndef BUILD_UNINSTALLER
Function ProoflineOptionsPageCreate
  !insertmacro MUI_HEADER_TEXT "Windows 集成" "默认打开方式和快捷方式"
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  CreateFont $1 "Microsoft YaHei UI" 9 400
  CreateFont $2 "Microsoft YaHei UI" 8 400
  ${NSD_CreateLabel} 0 0 100% 16u "安装后会自动替换旧版。原有文档、阅读位置和标注都会保留。"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $1 0
  ${NSD_CreateCheckbox} 0 22u 100% 12u "设为 .md / .markdown / .txt 文件的默认应用"
  Pop $ProoflineAssociateControl
  SendMessage $ProoflineAssociateControl ${WM_SETFONT} $1 0
  ${NSD_SetState} $ProoflineAssociateControl $ProoflineAssociate
  ${NSD_CreateLabel} 12u 35u 95% 18u "HTML 和 Word 文档会加入右键“打开方式”。如系统要求确认，安装完成后会打开默认应用设置。"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $2 0
  ${NSD_CreateCheckbox} 0 60u 100% 12u "创建桌面快捷方式"
  Pop $ProoflineDesktopControl
  SendMessage $ProoflineDesktopControl ${WM_SETFONT} $1 0
  ${NSD_SetState} $ProoflineDesktopControl $ProoflineDesktop
  ${NSD_CreateCheckbox} 0 78u 100% 12u "固定到任务栏"
  Pop $ProoflineTaskbarControl
  SendMessage $ProoflineTaskbarControl ${WM_SETFONT} $1 0
  ${NSD_SetState} $ProoflineTaskbarControl $ProoflineTaskbar
  ${NSD_CreateLabel} 12u 91u 95% 18u "Windows 11 不允许安装程序直接固定。首次启动 Proofline 时会提示你一键完成。"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $2 0
  nsDialogs::Show
FunctionEnd

Function ProoflineOptionsPageLeave
  ${NSD_GetState} $ProoflineAssociateControl $ProoflineAssociate
  ${NSD_GetState} $ProoflineDesktopControl $ProoflineDesktop
  ${NSD_GetState} $ProoflineTaskbarControl $ProoflineTaskbar
FunctionEnd
!endif

!macro ProoflineRegisterExtension EXT PROGID
  WriteRegNone HKCU "Software\Classes\.${EXT}\OpenWithProgids" "${PROGID}"
  WriteRegStr HKCU "Software\Proofline\Capabilities\FileAssociations" ".${EXT}" "${PROGID}"
  ${If} $ProoflineAssociate == ${BST_CHECKED}
    ReadRegStr $R1 HKCU "Software\Classes\.${EXT}" ""
    ${If} $R1 != "${PROGID}"
      WriteRegStr HKCU "Software\Proofline\Installer\PreviousAssociations" "${EXT}" "$R1"
    ${EndIf}
    WriteRegStr HKCU "Software\Classes\.${EXT}" "" "${PROGID}"
  ${EndIf}
!macroend

; Formats Proofline opens as converted copies are offered in "Open with" only.
!macro ProoflineRegisterOpenWith EXT
  WriteRegNone HKCU "Software\Classes\.${EXT}\OpenWithProgids" "Proofline.Document"
  WriteRegStr HKCU "Software\Proofline\Capabilities\FileAssociations" ".${EXT}" "Proofline.Document"
!macroend

!macro ProoflineRetireExtension EXT PROGID
  DeleteRegValue HKCU "Software\Classes\.${EXT}\OpenWithProgids" "${PROGID}"
  ReadRegStr $R1 HKCU "Software\Classes\.${EXT}" ""
  ${If} $R1 == "${PROGID}"
    DeleteRegValue HKCU "Software\Classes\.${EXT}" ""
  ${EndIf}
!macroend

!macro customInstall
  ; Retire the former product via its registered uninstaller, never a guessed directory.
  ReadRegStr $R2 HKCU "Software\1d68b554-efec-5bfc-b016-852189d384b6" InstallLocation
  ${If} $R2 != ""
    ${If} ${FileExists} "$R2\Uninstall MENG X.exe"
      ExecWait '"$R2\Uninstall MENG X.exe" /S /KEEP_APP_DATA /currentuser _?=$R2' $R3
      ${If} $R3 != 0
        MessageBox MB_ICONEXCLAMATION "旧版本卸载未完成。新版已安装；请关闭旧版后在 Windows 应用列表中卸载 MENG X。" /SD IDOK
      ${EndIf}
    ${Else}
      ${IfNot} ${FileExists} "$R2\MENG X.exe"
        DeleteRegKey HKCU "Software\1d68b554-efec-5bfc-b016-852189d384b6"
        DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\1d68b554-efec-5bfc-b016-852189d384b6"
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Delete "$DESKTOP\MENG X.lnk"
  Delete "$SMPROGRAMS\MENG X.lnk"
  Delete "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\MENG X.lnk"
  ; Proofline was called Redline before 0.4.0: retire its file types and shortcuts.
  !insertmacro ProoflineRetireExtension md Redline.Markdown
  !insertmacro ProoflineRetireExtension markdown Redline.Markdown
  !insertmacro ProoflineRetireExtension mdown Redline.Markdown
  !insertmacro ProoflineRetireExtension mkd Redline.Markdown
  !insertmacro ProoflineRetireExtension txt Redline.Text
  DeleteRegValue HKCU "Software\Classes\.html\OpenWithProgids" "Redline.Document"
  DeleteRegValue HKCU "Software\Classes\.htm\OpenWithProgids" "Redline.Document"
  DeleteRegValue HKCU "Software\Classes\.docx\OpenWithProgids" "Redline.Document"
  DeleteRegKey HKCU "Software\Classes\Redline.Markdown"
  DeleteRegKey HKCU "Software\Classes\Redline.Text"
  DeleteRegKey HKCU "Software\Classes\Redline.Document"
  DeleteRegKey HKCU "Software\Classes\Applications\Redline.exe"
  DeleteRegValue HKCU "Software\RegisteredApplications" "Redline"
  DeleteRegKey HKCU "Software\Redline"
  Delete "$DESKTOP\Redline.lnk"
  Delete "$SMPROGRAMS\Redline.lnk"
  Delete "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Redline.lnk"
  WriteRegStr HKCU "Software\Classes\Proofline.Markdown" "" "Markdown 文档"
  WriteRegStr HKCU "Software\Classes\Proofline.Markdown\DefaultIcon" "" '$\"$appExe$\",0'
  WriteRegStr HKCU "Software\Classes\Proofline.Markdown\shell\open\command" "" '$\"$appExe$\" $\"%1$\"'
  WriteRegStr HKCU "Software\Classes\Proofline.Text" "" "文本文档"
  WriteRegStr HKCU "Software\Classes\Proofline.Text\DefaultIcon" "" '$\"$appExe$\",0'
  WriteRegStr HKCU "Software\Classes\Proofline.Text\shell\open\command" "" '$\"$appExe$\" $\"%1$\"'
  WriteRegStr HKCU "Software\Classes\Proofline.Document" "" "Proofline 文档"
  WriteRegStr HKCU "Software\Classes\Proofline.Document\DefaultIcon" "" '$\"$appExe$\",0'
  WriteRegStr HKCU "Software\Classes\Proofline.Document\shell\open\command" "" '$\"$appExe$\" $\"%1$\"'
  WriteRegStr HKCU "Software\Classes\Applications\Proofline.exe\shell\open\command" "" '$\"$appExe$\" $\"%1$\"'
  WriteRegStr HKCU "Software\Classes\Applications\Proofline.exe" FriendlyAppName "Proofline"
  WriteRegStr HKCU "Software\Proofline\Capabilities" ApplicationName "Proofline"
  WriteRegStr HKCU "Software\Proofline\Capabilities" ApplicationDescription "AI 文档审阅工具"
  WriteRegStr HKCU "Software\RegisteredApplications" "Proofline" "Software\Proofline\Capabilities"
  !insertmacro ProoflineRegisterExtension md Proofline.Markdown
  !insertmacro ProoflineRegisterExtension markdown Proofline.Markdown
  !insertmacro ProoflineRegisterExtension mdown Proofline.Markdown
  !insertmacro ProoflineRegisterExtension mkd Proofline.Markdown
  !insertmacro ProoflineRegisterExtension txt Proofline.Text
  !insertmacro ProoflineRegisterOpenWith html
  !insertmacro ProoflineRegisterOpenWith htm
  !insertmacro ProoflineRegisterOpenWith docx
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ${If} $ProoflineDesktop == ${BST_CHECKED}
    CreateShortCut "$DESKTOP\Proofline.lnk" "$appExe" "" "$appExe" 0
  ${Else}
    Delete "$DESKTOP\Proofline.lnk"
  ${EndIf}
  ; Windows 11 does not let installers pin or claim defaults silently; Proofline's
  ; first-run setup checks both and walks the user through the one required click.
  WriteRegDWORD HKCU "Software\Proofline\Installer" Associate $ProoflineAssociate
  WriteRegDWORD HKCU "Software\Proofline\Installer" Desktop $ProoflineDesktop
  WriteRegDWORD HKCU "Software\Proofline\Installer" Taskbar $ProoflineTaskbar
!macroend

!macro ProoflineUnregisterExtension EXT PROGID
  DeleteRegValue HKCU "Software\Classes\.${EXT}\OpenWithProgids" "${PROGID}"
  ReadRegStr $R1 HKCU "Software\Classes\.${EXT}" ""
  ${If} $R1 == "${PROGID}"
    ReadRegStr $R2 HKCU "Software\Proofline\Installer\PreviousAssociations" "${EXT}"
    ${If} $R2 != ""
      WriteRegStr HKCU "Software\Classes\.${EXT}" "" "$R2"
    ${Else}
      DeleteRegValue HKCU "Software\Classes\.${EXT}" ""
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnInstall
  ; An upgrade runs this uninstaller first; keep shortcuts and file types in place
  ; so the new version takes over without a gap.
  ${If} ${isUpdated}
    Goto proofline_uninstall_done
  ${EndIf}
  Delete "$DESKTOP\Proofline.lnk"
  !insertmacro ProoflineUnregisterExtension md Proofline.Markdown
  !insertmacro ProoflineUnregisterExtension markdown Proofline.Markdown
  !insertmacro ProoflineUnregisterExtension mdown Proofline.Markdown
  !insertmacro ProoflineUnregisterExtension mkd Proofline.Markdown
  !insertmacro ProoflineUnregisterExtension txt Proofline.Text
  DeleteRegValue HKCU "Software\Classes\.html\OpenWithProgids" "Proofline.Document"
  DeleteRegValue HKCU "Software\Classes\.htm\OpenWithProgids" "Proofline.Document"
  DeleteRegValue HKCU "Software\Classes\.docx\OpenWithProgids" "Proofline.Document"
  DeleteRegKey HKCU "Software\Classes\Proofline.Markdown"
  DeleteRegKey HKCU "Software\Classes\Proofline.Text"
  DeleteRegKey HKCU "Software\Classes\Proofline.Document"
  DeleteRegKey HKCU "Software\Classes\Applications\Proofline.exe"
  DeleteRegValue HKCU "Software\RegisteredApplications" "Proofline"
  DeleteRegKey HKCU "Software\Proofline\Capabilities"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  proofline_uninstall_done:
!macroend

; Marks and settings live in $INSTDIR\ProoflineData by default. The stock uninstaller
; deletes the whole $INSTDIR, which on every upgrade would erase them, so remove
; the program files one by one and leave ProoflineData alone.
!macro customRemoveFiles
  SetOutPath $TEMP
  ClearErrors
  FindFirst $R1 $R2 "$INSTDIR\*.*"
  proofline_remove_loop:
    StrCmp $R2 "" proofline_remove_done
    StrCmp $R2 "." proofline_remove_next
    StrCmp $R2 ".." proofline_remove_next
    StrCmp $R2 "ProoflineData" proofline_remove_next
    StrCmp $R2 "RedlineData" proofline_remove_next
    ${If} ${FileExists} "$INSTDIR\$R2\*.*"
      RMDir /r "$INSTDIR\$R2"
    ${Else}
      Delete "$INSTDIR\$R2"
    ${EndIf}
  proofline_remove_next:
    FindNext $R1 $R2
    Goto proofline_remove_loop
  proofline_remove_done:
  FindClose $R1
  ; Removed only when empty, that is when no ProoflineData was ever written here.
  RMDir "$INSTDIR"
!macroend
