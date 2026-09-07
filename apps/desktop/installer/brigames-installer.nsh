; Extend electron-builder's assisted installer, preserving its upgrade,
; elevation, directory, shortcut and uninstall handling.
!include "${__FILEDIR__}\update-window.nsh"
!define MUI_BGCOLOR "14161D"
!define MUI_TEXTCOLOR "F3F4F8"
; The Windows theme otherwise paints checkbox/radio text black on dark pages.
!define MUI_FORCECLASSICCONTROLS
!define MUI_INSTFILESPAGE_COLORS "F3F4F8 14161D"
!ifdef BUILD_UNINSTALLER
  !define MUI_CUSTOMFUNCTION_UNGUIINIT un.BrigamesGUIInit
!else
  !define MUI_CUSTOMFUNCTION_GUIINIT BrigamesGUIInit
!endif

; The native outer dialog and its footer use system colors by default.
!macro BrigamesThemeOuter
  SetCtlColors $HWNDPARENT "F3F4F8" "14161D"
  EnableWindow $mui.Branding.Text 1
  SetCtlColors $mui.Branding.Text "A3ABBC" "14161D"
  SetCtlColors $mui.Branding.Background "F3F4F8" "14161D"
!macroend

; This hook runs immediately before electron-builder declares the actual
; installation page. Keep its PRE callback (directory sanitization) intact.
!macro customPageAfterChangeDir
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW BrigamesInstallShow
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE BrigamesInstallLeave
  !define MUI_INSTFILESPAGE_FINISHHEADER_TEXT "Tudo pronto!"
  !define MUI_INSTFILESPAGE_FINISHHEADER_SUBTEXT "O Brigames Station foi instalado."
!macroend

; Emit callbacks after MUI has declared the page control variables.
!macro customHeader
  BrandingText "Brigames Station  |  ${VERSION}"
  Caption "Brigames Station"
  UninstallCaption "Brigames Station"

  !ifdef BUILD_UNINSTALLER
    Function un.BrigamesGUIInit
      !insertmacro BrigamesThemeOuter
    FunctionEnd
  !else
    Function BrigamesGUIInit
      !insertmacro BrigamesThemeOuter
    FunctionEnd
  !endif

  !ifndef BUILD_UNINSTALLER
  !insertmacro BrigamesUpdateWindowFunctions
  Function BrigamesInstallShow
    ${If} ${isUpdated}
      !insertmacro MUI_HEADER_TEXT "Atualizando o Brigames Station" "Instalando a versão ${VERSION}. Aguarde a conclusão."
    ${Else}
      !insertmacro MUI_HEADER_TEXT "Instalando o Brigames Station" "Preparando a versão ${VERSION} para você."
    ${EndIf}
    SetCtlColors $mui.InstFilesPage "F3F4F8" "14161D"
    SetCtlColors $mui.InstFilesPage.Text "A3ABBC" "14161D"

    ; Disable the system theme on this control only so PBM_SETBARCOLOR is
    ; honored. NSIS continues to drive the real installation progress.
    System::Call 'uxtheme::SetWindowTheme(p $mui.InstFilesPage.ProgressBar, w "", w "")'
    SendMessage $mui.InstFilesPage.ProgressBar 0x2001 0 0x3A2C27 ; PBM_SETBKCOLOR (BGR)
    SendMessage $mui.InstFilesPage.ProgressBar 0x0409 0 0xF66C76 ; PBM_SETBARCOLOR (BGR)
    Call BrigamesShowUpdateWindow
  FunctionEnd
  !endif
!macroend

!macro customFinishPage
  Var BrigamesFinishText

  Function BrigamesStartApp
    ${If} ${isUpdated}
      StrCpy $1 "--updated"
    ${Else}
      StrCpy $1 ""
    ${EndIf}
    ; Use the same unelevated launch mechanism as electron-builder.
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  Function BrigamesFinishPre
    ; Every successful visible installation opens the app immediately, including
    ; first installs and updates without --force-run. Silent/deferred updates
    ; do not visit this page and keep electron-builder's existing behavior.
    StrCpy $BrigamesFinishText "O Brigames Station ${VERSION} foi instalado."
    IfAbort brigames_show_finish
    IfRebootFlag brigames_show_finish
    Call BrigamesStartApp
    ${If} $0 == "ok"
    ${OrIf} $0 == "fallback"
      !insertmacro quitSuccess
    ${EndIf}
    StrCpy $BrigamesFinishText "A instalação foi concluída, mas não foi possível abrir o Brigames Station automaticamente.$\r$\n$\r$\nAbra o aplicativo pelo atalho na área de trabalho ou no menu Iniciar."
    brigames_show_finish:
    Call BrigamesRestoreWizard
  FunctionEnd

  !define MUI_PAGE_CUSTOMFUNCTION_PRE BrigamesFinishPre
  !define MUI_FINISHPAGE_TITLE "Instalação concluída"
  !define MUI_FINISHPAGE_TEXT "$BrigamesFinishText"
  !define MUI_FINISHPAGE_BUTTON "Fechar"
  !insertmacro MUI_PAGE_FINISH
!macroend
