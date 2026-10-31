; SPDX-License-Identifier: GPL-3.0-or-later
; Installer hooks for the Windows setup .exe (bundle.windows.nsis.installerHooks).
;
; Until 0.3.2 the app was called "Monks Central". NSIS keys an install by its
; product name, so the first "WP Sites HQ" install (by the in-app updater or by
; hand) would sit beside the old one. After installing, remove the old install
; silently. Silent mode never shows the "Delete app data" box, so the shared
; data folder (%APPDATA%\com.classicmonks.monks-central) is kept.
!macro NSIS_HOOK_POSTINSTALL
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Monks Central" "UninstallString"
  ReadRegStr $R1 HKCU "Software\Classic Monks\Monks Central" ""
  ${If} $R0 != ""
  ${AndIf} $R1 != ""
  ${AndIf} $R1 != $INSTDIR
    ; _?= runs the uninstaller in place, so ExecWait really waits for it; it
    ; then cannot delete itself or its folder, so do that here.
    ExecWait '$R0 /S _?=$R1'
    Delete "$R1\uninstall.exe"
    RMDir "$R1"
    DeleteRegKey HKCU "Software\Classic Monks\Monks Central"
    DeleteRegKey /ifempty HKCU "Software\Classic Monks"
  ${EndIf}
!macroend
