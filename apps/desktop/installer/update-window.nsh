; A borderless surface over the real NSIS installation page. No browser,
; companion runtime or simulated download/installation percentages are used.
!ifndef BUILD_UNINSTALLER
Var BrigamesWindowActive
Var BrigamesDPI
Var BrigamesOuterRect
Var BrigamesOuterStyle
Var BrigamesOuterExStyle
Var BrigamesHeaderRect
Var BrigamesSubHeaderRect
Var BrigamesFooterRect
Var BrigamesPageRect
Var BrigamesProgressRect
Var BrigamesSurface
Var BrigamesBitmap
Var BrigamesTitleFont
Var BrigamesBodyFont
Var BrigamesFooterFont
Var BrigamesDetailsVisible
Var BrigamesLogVisible

; Save a control's parent-relative rectangle, style and font before moving it.
!macro BrigamesSaveControl HANDLE DEST
  System::Alloc 32
  Pop ${DEST}
  System::Call 'user32::GetWindowRect(p ${HANDLE}, p ${DEST})'
  System::Call 'user32::GetParent(p ${HANDLE}) p .r0'
  System::Call 'user32::MapWindowPoints(p 0, p r0, p ${DEST}, i 2)'
  System::Call 'user32::GetWindowLongW(p ${HANDLE}, i -16) i .r1'
  IntOp $0 ${DEST} + 16
  System::Call '*$0(i r1)'
  SendMessage ${HANDLE} 0x0031 0 0 $1 ; WM_GETFONT
  IntOp $0 ${DEST} + 20
  System::Call '*$0(p r1)'
!macroend

!macro BrigamesRestoreControl HANDLE RECT
  System::Call '*${RECT}(i .r0, i .r1, i .r2, i .r3, i .r4, p .r5)'
  IntOp $2 $2 - $0
  IntOp $3 $3 - $1
  System::Call 'user32::SetWindowLongW(p ${HANDLE}, i -16, i r4)'
  SendMessage ${HANDLE} 0x0030 $5 0 ; WM_SETFONT
  System::Call 'user32::MoveWindow(p ${HANDLE}, i r0, i r1, i r2, i r3, i 1)'
  System::Free ${RECT}
!macroend

!macro BrigamesPlace HANDLE X Y WIDTH HEIGHT
  System::Call 'kernel32::MulDiv(i ${X}, i $BrigamesDPI, i 96) i .r0'
  System::Call 'kernel32::MulDiv(i ${Y}, i $BrigamesDPI, i 96) i .r1'
  System::Call 'kernel32::MulDiv(i ${WIDTH}, i $BrigamesDPI, i 96) i .r2'
  System::Call 'kernel32::MulDiv(i ${HEIGHT}, i $BrigamesDPI, i 96) i .r3'
  System::Call 'user32::MoveWindow(p ${HANDLE}, i r0, i r1, i r2, i r3, i 1)'
!macroend

!macro BrigamesUpdateWindowFunctions
Function BrigamesShowUpdateWindow
  ${If} $BrigamesWindowActive == "1"
    Return
  ${EndIf}
  ; NSIS is a 32-bit process. Get/SetWindowLongW is used for style values only.
  StrCpy $BrigamesDPI 96
  System::Call 'user32::GetDpiForWindow(p $HWNDPARENT) i .r0'
  ${If} $0 > 0
    StrCpy $BrigamesDPI $0
  ${EndIf}
  System::Call 'kernel32::MulDiv(i 520, i $BrigamesDPI, i 96) i .r6'
  System::Call 'kernel32::MulDiv(i 420, i $BrigamesDPI, i 96) i .r7'
  InitPluginsDir
  File /oname=$PLUGINSDIR\brigames-update.bmp "${PROJECT_DIR}\installer\update-surface.bmp"
  System::Call 'user32::LoadImageW(p 0, w "$PLUGINSDIR\brigames-update.bmp", i 0, i r6, i r7, i 0x10) p .s'
  Pop $BrigamesBitmap
  ${If} $BrigamesBitmap == 0
    Return ; retain the working wizard if the artwork cannot be loaded
  ${EndIf}

  !insertmacro BrigamesSaveControl $mui.Header.Text $BrigamesHeaderRect
  !insertmacro BrigamesSaveControl $mui.Header.SubText $BrigamesSubHeaderRect
  !insertmacro BrigamesSaveControl $mui.Branding.Text $BrigamesFooterRect
  !insertmacro BrigamesSaveControl $mui.InstFilesPage $BrigamesPageRect
  !insertmacro BrigamesSaveControl $mui.InstFilesPage.ProgressBar $BrigamesProgressRect
  System::Alloc 16
  Pop $BrigamesOuterRect
  System::Call 'user32::GetWindowRect(p $HWNDPARENT, p $BrigamesOuterRect)'
  System::Call 'user32::GetWindowLongW(p $HWNDPARENT, i -16) i .s'
  Pop $BrigamesOuterStyle
  System::Call 'user32::GetWindowLongW(p $HWNDPARENT, i -20) i .s'
  Pop $BrigamesOuterExStyle

  ; Hide the wizard chrome, preserving NSIS's progress control and page.
  ShowWindow $mui.Header.Background 0
  ShowWindow $mui.Header.Image 0
  ShowWindow $mui.Line.Standard 0
  ShowWindow $mui.Line.FullWindow 0
  GetDlgItem $0 $HWNDPARENT 1036 ; separator beneath the original header
  ShowWindow $0 0
  ShowWindow $mui.Branding.Background 0
  ShowWindow $mui.Button.Back 0
  ShowWindow $mui.Button.Next 0
  ShowWindow $mui.Button.Cancel 0
  ShowWindow $mui.InstFilesPage.Text 0
  System::Call 'user32::ShowWindow(p $mui.InstFilesPage.ShowLogButton, i 0) i .s'
  Pop $BrigamesDetailsVisible
  System::Call 'user32::ShowWindow(p $mui.InstFilesPage.Log, i 0) i .s'
  Pop $BrigamesLogVisible

  ; Remove caption, resizing/system buttons and dialog/client edge styles.
  IntOp $0 $BrigamesOuterStyle & 0xFF30FF7F
  System::Call 'user32::SetWindowLongW(p $HWNDPARENT, i -16, i r0)'
  IntOp $0 $BrigamesOuterExStyle & 0xFFFDFCFE
  System::Call 'user32::SetWindowLongW(p $HWNDPARENT, i -20, i r0)'
  System::Call '*$BrigamesOuterRect(i .r0, i .r1, i .r2, i .r3)'
  IntOp $0 $0 + $2
  IntOp $0 $0 - $6
  IntOp $0 $0 / 2
  IntOp $1 $1 + $3
  IntOp $1 $1 - $7
  IntOp $1 $1 / 2
  System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i r0, i r1, i r6, i r7, i 0x0034)'
  System::Call 'kernel32::MulDiv(i 32, i $BrigamesDPI, i 96) i .r0'
  System::Call 'gdi32::CreateRoundRectRgn(i 0, i 0, i r6, i r7, i r0, i r0) p .r1'
  System::Call 'user32::SetWindowRgn(p $HWNDPARENT, p r1, i 1)'

  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "", i 0x5400000E, i 0, i 0, i r6, i r7, p $HWNDPARENT, p 0, p 0, p 0) p .s'
  Pop $BrigamesSurface
  SendMessage $BrigamesSurface 0x0172 0 $BrigamesBitmap ; STM_SETIMAGE
  ; Put the artwork behind the accessible text and real progress bar.
  System::Call 'user32::SetWindowPos(p $BrigamesSurface, p 1, i 0, i 0, i 0, i 0, i 0x0013)'

  CreateFont $BrigamesTitleFont "Segoe UI" 19 600
  CreateFont $BrigamesBodyFont "Segoe UI" 10 400
  CreateFont $BrigamesFooterFont "Segoe UI" 9 400
  ; SS_CENTER, with no sunken/etched static-control decoration.
  System::Call 'user32::SetWindowLongW(p $mui.Header.Text, i -16, i 0x50000001)'
  System::Call 'user32::SetWindowLongW(p $mui.Header.SubText, i -16, i 0x50000001)'
  System::Call 'user32::SetWindowLongW(p $mui.Branding.Text, i -16, i 0x50000001)'
  SendMessage $mui.Header.Text 0x0030 $BrigamesTitleFont 0
  SendMessage $mui.Header.SubText 0x0030 $BrigamesBodyFont 0
  SendMessage $mui.Branding.Text 0x0030 $BrigamesFooterFont 0
  SetCtlColors $mui.Header.Text "F3F4F8" "14161D"
  SetCtlColors $mui.Header.SubText "A3ABBC" "14161D"
  SetCtlColors $mui.Branding.Text "747D90" "14161D"
  ${If} ${isUpdated}
    SendMessage $mui.Header.Text 0x000C 0 "STR:Atualizando o Brigames"
  ${Else}
    SendMessage $mui.Header.Text 0x000C 0 "STR:Instalando o Brigames"
  ${EndIf}
  SendMessage $mui.Header.SubText 0x000C 0 "STR:Instalando a versão ${VERSION}. Só mais um instante."
  SendMessage $mui.Branding.Text 0x000C 0 "STR:O Brigames Station será aberto automaticamente."
  !insertmacro BrigamesPlace $mui.Header.Text 32 238 456 38
  !insertmacro BrigamesPlace $mui.Header.SubText 32 284 456 28
  ; Clip the classic progress control's two-pixel bevel inside its parent.
  ; NSIS still owns and updates the same progress HWND.
  !insertmacro BrigamesPlace $mui.InstFilesPage 40 334 440 5
  !insertmacro BrigamesPlace $mui.InstFilesPage.ProgressBar -2 -2 444 9
  !insertmacro BrigamesPlace $mui.Branding.Text 32 366 456 22
  ShowWindow $mui.Header.Text 1
  ShowWindow $mui.Header.SubText 1
  ShowWindow $mui.Branding.Text 1
  ; Only the progress bar remains visible in the native installation page.
  StrCpy $BrigamesWindowActive "1"
  System::Call 'user32::RedrawWindow(p $HWNDPARENT, p 0, p 0, i 0x0185)'
FunctionEnd

Function BrigamesRestoreWizard
  ${If} $BrigamesWindowActive != "1"
    Return
  ${EndIf}
  StrCpy $BrigamesWindowActive "0"
  System::Call 'user32::DestroyWindow(p $BrigamesSurface)'
  System::Call 'gdi32::DeleteObject(p $BrigamesBitmap)'
  System::Call 'user32::SetWindowRgn(p $HWNDPARENT, p 0, i 1)'
  ; The first page's SHOW callback precedes the outer window becoming visible.
  ; Restore its frame without restoring that initial hidden visibility bit.
  System::Call 'user32::GetWindowLongW(p $HWNDPARENT, i -16) i .r0'
  IntOp $0 $0 & 0x10000000
  IntOp $1 $BrigamesOuterStyle & 0xEFFFFFFF
  IntOp $0 $0 | $1
  System::Call 'user32::SetWindowLongW(p $HWNDPARENT, i -16, i r0)'
  System::Call 'user32::SetWindowLongW(p $HWNDPARENT, i -20, i $BrigamesOuterExStyle)'
  System::Call '*$BrigamesOuterRect(i .r0, i .r1, i .r2, i .r3)'
  IntOp $2 $2 - $0
  IntOp $3 $3 - $1
  System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i r0, i r1, i r2, i r3, i 0x0034)'
  System::Free $BrigamesOuterRect
  !insertmacro BrigamesRestoreControl $mui.Header.Text $BrigamesHeaderRect
  !insertmacro BrigamesRestoreControl $mui.Header.SubText $BrigamesSubHeaderRect
  !insertmacro BrigamesRestoreControl $mui.Branding.Text $BrigamesFooterRect
  !insertmacro BrigamesRestoreControl $mui.InstFilesPage $BrigamesPageRect
  !insertmacro BrigamesRestoreControl $mui.InstFilesPage.ProgressBar $BrigamesProgressRect
  System::Call 'gdi32::DeleteObject(p $BrigamesTitleFont)'
  System::Call 'gdi32::DeleteObject(p $BrigamesBodyFont)'
  System::Call 'gdi32::DeleteObject(p $BrigamesFooterFont)'
  ShowWindow $mui.Header.Background 1
  ShowWindow $mui.Header.Image 1
  ShowWindow $mui.Line.Standard 1
  GetDlgItem $0 $HWNDPARENT 1036
  ShowWindow $0 1
  ShowWindow $mui.Branding.Background 1
  ShowWindow $mui.Button.Back 1
  ShowWindow $mui.Button.Next 1
  ShowWindow $mui.Button.Cancel 1
  ; The SHOW callback runs before NSIS reveals the page, so the captured
  ; initial page visibility can be false even though the error UI needs it.
  ShowWindow $mui.Header.Text 1
  ShowWindow $mui.Header.SubText 1
  ShowWindow $mui.Branding.Text 1
  ShowWindow $mui.InstFilesPage 1
  ShowWindow $mui.InstFilesPage.Text 1
  ShowWindow $mui.InstFilesPage.ShowLogButton $BrigamesDetailsVisible
  ShowWindow $mui.InstFilesPage.Log $BrigamesLogVisible
  SendMessage $mui.Branding.Text 0x000C 0 "STR:Brigames Station  |  ${VERSION}"
  System::Call 'user32::RedrawWindow(p $HWNDPARENT, p 0, p 0, i 0x0185)'
FunctionEnd

Function BrigamesInstallLeave
  ; Never hide the error result or leave a failed install without a close UI.
  IfAbort 0 +2
    Call BrigamesRestoreWizard
FunctionEnd
!macroend
!endif
