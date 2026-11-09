!include MUI2.nsh
!include nsDialogs.nsh
!include LogicLib.nsh
!include FileFunc.nsh

!ifndef BUILD_UNINSTALLER
Var StetwiseAssociate
Var StetwiseDesktop
Var StetwiseTaskbar
Var StetwiseAssociateControl
Var StetwiseDesktopControl
Var StetwiseTaskbarControl
!endif

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "安装 Stetwise"
  !define MUI_WELCOMEPAGE_TEXT "读、批、改：审阅 AI 生成的文档。$\r$\n$\r$\n升级安装会保留阅读记录、标注和恢复草稿。"
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customInit
  ; Everything is on by default; a reinstall keeps the choices made last time.
  StrCpy $StetwiseAssociate ${BST_CHECKED}
  StrCpy $StetwiseDesktop ${BST_CHECKED}
  StrCpy $StetwiseTaskbar ${BST_CHECKED}
  ClearErrors
  ReadRegDWORD $R3 HKCU "Software\Proofline\Installer" Associate
  ${IfNot} ${Errors}
    StrCpy $StetwiseAssociate $R3
  ${EndIf}
  ClearErrors
  ReadRegDWORD $R3 HKCU "Software\Stetwise\Installer" Associate
  ${IfNot} ${Errors}
    StrCpy $StetwiseAssociate $R3
  ${EndIf}
  ClearErrors
  ReadRegDWORD $R3 HKCU "Software\Proofline\Installer" Desktop
  ${IfNot} ${Errors}
    StrCpy $StetwiseDesktop $R3
  ${EndIf}
  ClearErrors
  ReadRegDWORD $R3 HKCU "Software\Stetwise\Installer" Desktop
  ${IfNot} ${Errors}
    StrCpy $StetwiseDesktop $R3
  ${EndIf}
  ClearErrors
  ReadRegDWORD $R3 HKCU "Software\Proofline\Installer" Taskbar
  ${IfNot} ${Errors}
    StrCpy $StetwiseTaskbar $R3
  ${EndIf}
  ClearErrors
  ReadRegDWORD $R3 HKCU "Software\Stetwise\Installer" Taskbar
  ${IfNot} ${Errors}
    StrCpy $StetwiseTaskbar $R3
  ${EndIf}
  ClearErrors
  ${GetParameters} $R0
  ${GetOptions} $R0 "/ASSOCIATE=" $R1
  ${IfNot} ${Errors}
    StrCpy $StetwiseAssociate $R1
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/DESKTOP=" $R1
  ${IfNot} ${Errors}
    StrCpy $StetwiseDesktop $R1
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/TASKBAR=" $R1
  ${IfNot} ${Errors}
    StrCpy $StetwiseTaskbar $R1
  ${EndIf}
  ClearErrors
!macroend

!macro customPageAfterChangeDir
  Page custom StetwiseOptionsPageCreate StetwiseOptionsPageLeave
!macroend

!ifndef BUILD_UNINSTALLER
Function StetwiseOptionsPageCreate
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
  Pop $StetwiseAssociateControl
  SendMessage $StetwiseAssociateControl ${WM_SETFONT} $1 0
  ${NSD_SetState} $StetwiseAssociateControl $StetwiseAssociate
  ${NSD_CreateLabel} 12u 35u 95% 18u "HTML 和 Word 文档会加入右键“打开方式”。如系统要求确认，安装完成后会打开默认应用设置。"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $2 0
  ${NSD_CreateCheckbox} 0 60u 100% 12u "创建桌面快捷方式"
  Pop $StetwiseDesktopControl
  SendMessage $StetwiseDesktopControl ${WM_SETFONT} $1 0
  ${NSD_SetState} $StetwiseDesktopControl $StetwiseDesktop
  ${NSD_CreateCheckbox} 0 78u 100% 12u "固定到任务栏"
  Pop $StetwiseTaskbarControl
  SendMessage $StetwiseTaskbarControl ${WM_SETFONT} $1 0
  ${NSD_SetState} $StetwiseTaskbarControl $StetwiseTaskbar
  ${NSD_CreateLabel} 12u 91u 95% 18u "Windows 11 不允许安装程序直接固定。首次启动 Stetwise 时会提示你一键完成。"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $2 0
  nsDialogs::Show
FunctionEnd

Function StetwiseOptionsPageLeave
  ${NSD_GetState} $StetwiseAssociateControl $StetwiseAssociate
  ${NSD_GetState} $StetwiseDesktopControl $StetwiseDesktop
  ${NSD_GetState} $StetwiseTaskbarControl $StetwiseTaskbar
FunctionEnd
!endif

!macro StetwiseRegisterExtension EXT PROGID
  WriteRegNone HKCU "Software\Classes\.${EXT}\OpenWithProgids" "${PROGID}"
  WriteRegStr HKCU "Software\Stetwise\Capabilities\FileAssociations" ".${EXT}" "${PROGID}"
  ${If} $StetwiseAssociate == ${BST_CHECKED}
    ReadRegStr $R1 HKCU "Software\Classes\.${EXT}" ""
    ${If} $R1 != "${PROGID}"
      WriteRegStr HKCU "Software\Stetwise\Installer\PreviousAssociations" "${EXT}" "$R1"
    ${EndIf}
    WriteRegStr HKCU "Software\Classes\.${EXT}" "" "${PROGID}"
  ${EndIf}
!macroend

; Formats Stetwise opens as converted copies are offered in "Open with" only.
!macro StetwiseRegisterOpenWith EXT
  WriteRegNone HKCU "Software\Classes\.${EXT}\OpenWithProgids" "Stetwise.Document"
  WriteRegStr HKCU "Software\Stetwise\Capabilities\FileAssociations" ".${EXT}" "Stetwise.Document"
!macroend

!macro StetwiseRetireExtension EXT PROGID
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
  ; Stetwise was called Proofline before the rename: retire its file types, shortcuts and registry keys.
  ; The program itself is the same installation (same id), so an upgrade replaces it in place.
  !insertmacro StetwiseRetireExtension md Proofline.Markdown
  !insertmacro StetwiseRetireExtension markdown Proofline.Markdown
  !insertmacro StetwiseRetireExtension mdown Proofline.Markdown
  !insertmacro StetwiseRetireExtension mkd Proofline.Markdown
  !insertmacro StetwiseRetireExtension txt Proofline.Text
  DeleteRegValue HKCU "Software\Classes\.html\OpenWithProgids" "Proofline.Document"
  DeleteRegValue HKCU "Software\Classes\.htm\OpenWithProgids" "Proofline.Document"
  DeleteRegValue HKCU "Software\Classes\.docx\OpenWithProgids" "Proofline.Document"
  DeleteRegKey HKCU "Software\Classes\Proofline.Markdown"
  DeleteRegKey HKCU "Software\Classes\Proofline.Text"
  DeleteRegKey HKCU "Software\Classes\Proofline.Document"
  DeleteRegKey HKCU "Software\Classes\Applications\Proofline.exe"
  DeleteRegValue HKCU "Software\RegisteredApplications" "Proofline"
  DeleteRegKey HKCU "Software\Proofline"
  Delete "$DESKTOP\Proofline.lnk"
  Delete "$SMPROGRAMS\Proofline.lnk"
  Delete "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Proofline.lnk"
  Delete "$INSTDIR\Proofline.exe"
  Delete "$INSTDIR\Uninstall Proofline.exe"
  ; Stetwise was called Redline before 0.4.0: retire its file types and shortcuts.
  !insertmacro StetwiseRetireExtension md Redline.Markdown
  !insertmacro StetwiseRetireExtension markdown Redline.Markdown
  !insertmacro StetwiseRetireExtension mdown Redline.Markdown
  !insertmacro StetwiseRetireExtension mkd Redline.Markdown
  !insertmacro StetwiseRetireExtension txt Redline.Text
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
  WriteRegStr HKCU "Software\Classes\Stetwise.Markdown" "" "Markdown 文档"
  WriteRegStr HKCU "Software\Classes\Stetwise.Markdown\DefaultIcon" "" '$\"$appExe$\",0'
  WriteRegStr HKCU "Software\Classes\Stetwise.Markdown\shell\open\command" "" '$\"$appExe$\" $\"%1$\"'
  WriteRegStr HKCU "Software\Classes\Stetwise.Text" "" "文本文档"
  WriteRegStr HKCU "Software\Classes\Stetwise.Text\DefaultIcon" "" '$\"$appExe$\",0'
  WriteRegStr HKCU "Software\Classes\Stetwise.Text\shell\open\command" "" '$\"$appExe$\" $\"%1$\"'
  WriteRegStr HKCU "Software\Classes\Stetwise.Document" "" "Stetwise 文档"
  WriteRegStr HKCU "Software\Classes\Stetwise.Document\DefaultIcon" "" '$\"$appExe$\",0'
  WriteRegStr HKCU "Software\Classes\Stetwise.Document\shell\open\command" "" '$\"$appExe$\" $\"%1$\"'
  WriteRegStr HKCU "Software\Classes\Applications\Stetwise.exe\shell\open\command" "" '$\"$appExe$\" $\"%1$\"'
  WriteRegStr HKCU "Software\Classes\Applications\Stetwise.exe" FriendlyAppName "Stetwise"
  WriteRegStr HKCU "Software\Stetwise\Capabilities" ApplicationName "Stetwise"
  WriteRegStr HKCU "Software\Stetwise\Capabilities" ApplicationDescription "AI 文档审阅工具"
  WriteRegStr HKCU "Software\RegisteredApplications" "Stetwise" "Software\Stetwise\Capabilities"
  !insertmacro StetwiseRegisterExtension md Stetwise.Markdown
  !insertmacro StetwiseRegisterExtension markdown Stetwise.Markdown
  !insertmacro StetwiseRegisterExtension mdown Stetwise.Markdown
  !insertmacro StetwiseRegisterExtension mkd Stetwise.Markdown
  !insertmacro StetwiseRegisterExtension txt Stetwise.Text
  !insertmacro StetwiseRegisterOpenWith html
  !insertmacro StetwiseRegisterOpenWith htm
  !insertmacro StetwiseRegisterOpenWith docx
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ${If} $StetwiseDesktop == ${BST_CHECKED}
    CreateShortCut "$DESKTOP\Stetwise.lnk" "$appExe" "" "$appExe" 0
  ${Else}
    Delete "$DESKTOP\Stetwise.lnk"
  ${EndIf}
  ; Windows 11 does not let installers pin or claim defaults silently; Stetwise's
  ; first-run setup checks both and walks the user through the one required click.
  WriteRegDWORD HKCU "Software\Stetwise\Installer" Associate $StetwiseAssociate
  WriteRegDWORD HKCU "Software\Stetwise\Installer" Desktop $StetwiseDesktop
  WriteRegDWORD HKCU "Software\Stetwise\Installer" Taskbar $StetwiseTaskbar
!macroend

!macro StetwiseUnregisterExtension EXT PROGID
  DeleteRegValue HKCU "Software\Classes\.${EXT}\OpenWithProgids" "${PROGID}"
  ReadRegStr $R1 HKCU "Software\Classes\.${EXT}" ""
  ${If} $R1 == "${PROGID}"
    ReadRegStr $R2 HKCU "Software\Stetwise\Installer\PreviousAssociations" "${EXT}"
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
    Goto stetwise_uninstall_done
  ${EndIf}
  Delete "$DESKTOP\Stetwise.lnk"
  !insertmacro StetwiseUnregisterExtension md Stetwise.Markdown
  !insertmacro StetwiseUnregisterExtension markdown Stetwise.Markdown
  !insertmacro StetwiseUnregisterExtension mdown Stetwise.Markdown
  !insertmacro StetwiseUnregisterExtension mkd Stetwise.Markdown
  !insertmacro StetwiseUnregisterExtension txt Stetwise.Text
  DeleteRegValue HKCU "Software\Classes\.html\OpenWithProgids" "Stetwise.Document"
  DeleteRegValue HKCU "Software\Classes\.htm\OpenWithProgids" "Stetwise.Document"
  DeleteRegValue HKCU "Software\Classes\.docx\OpenWithProgids" "Stetwise.Document"
  DeleteRegKey HKCU "Software\Classes\Stetwise.Markdown"
  DeleteRegKey HKCU "Software\Classes\Stetwise.Text"
  DeleteRegKey HKCU "Software\Classes\Stetwise.Document"
  DeleteRegKey HKCU "Software\Classes\Applications\Stetwise.exe"
  DeleteRegValue HKCU "Software\RegisteredApplications" "Stetwise"
  DeleteRegKey HKCU "Software\Stetwise\Capabilities"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  stetwise_uninstall_done:
!macroend

; Marks and settings live in $INSTDIR\StetwiseData by default. The stock uninstaller
; deletes the whole $INSTDIR, which on every upgrade would erase them, so remove
; the program files one by one and leave StetwiseData alone.
!macro customRemoveFiles
  SetOutPath $TEMP
  ClearErrors
  FindFirst $R1 $R2 "$INSTDIR\*.*"
  stetwise_remove_loop:
    StrCmp $R2 "" stetwise_remove_done
    StrCmp $R2 "." stetwise_remove_next
    StrCmp $R2 ".." stetwise_remove_next
    StrCmp $R2 "StetwiseData" stetwise_remove_next
    ; Data folders from before the renames; the app moves them to StetwiseData on its first start.
    StrCmp $R2 "ProoflineData" stetwise_remove_next
    StrCmp $R2 "RedlineData" stetwise_remove_next
    ${If} ${FileExists} "$INSTDIR\$R2\*.*"
      RMDir /r "$INSTDIR\$R2"
    ${Else}
      Delete "$INSTDIR\$R2"
    ${EndIf}
  stetwise_remove_next:
    FindNext $R1 $R2
    Goto stetwise_remove_loop
  stetwise_remove_done:
  FindClose $R1
  ; Removed only when empty, that is when no StetwiseData was ever written here.
  RMDir "$INSTDIR"
!macroend
