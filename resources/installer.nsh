!ifndef BUILD_UNINSTALLER
  Var pilotMovedDefaultInstall

  !macro customInit
    ${If} $installMode == "CurrentUser"
    ${AndIf} $hasPerMachineInstallation == "0"
      !insertmacro GetDParameter $R0
      ${If} $R0 == ""
        StrCpy $0 "$LocalAppData\Programs"
        StrCpy $2 0
        System::Call 'SHELL32::SHGetKnownFolderPath(g "${FOLDERID_UserProgramFiles}", i 0, p 0, *p .r2)i.r1'
        ${If} $1 == 0
          System::Call 'KERNEL32::lstrcpynW(w .r0, p r2, i ${NSIS_MAX_STRLEN})p'
        ${EndIf}
        ${If} $2 != 0
          System::Call 'OLE32::CoTaskMemFree(p r2)'
        ${EndIf}

        ${If} $INSTDIR == "$0\pi Desktop"
        ${OrIf} $INSTDIR == "$0\pi-desktop"
          ${IfNot} ${FileExists} "$0\${APP_FILENAME}"
            # Keep the old registry location for the uninstaller to clean up.
            StrCpy $INSTDIR "$0\${APP_FILENAME}"
            StrCpy $pilotMovedDefaultInstall "1"
          ${EndIf}
        ${EndIf}
      ${EndIf}
    ${EndIf}
  !macroend
!endif

!macro customInstallMode
  !ifndef BUILD_UNINSTALLER
    # The install mode page would otherwise restore the old per-user path.
    ${If} $pilotMovedDefaultInstall == "1"
    ${AndIfNot} ${isForAllUsers}
      Abort
    ${EndIf}
  !endif
!macroend

!define PILOT_FOLDER_VERB "Software\Classes\Directory\shell\dev.pilot.app.openProject"
!define PILOT_BACKGROUND_VERB "Software\Classes\Directory\Background\shell\dev.pilot.app.openProject"

!macro pilotUpdatePath ACTION
  Push $R0
  InitPluginsDir
  File "/oname=$PLUGINSDIR\pilot-installer-path.ps1" "${PROJECT_DIR}\resources\installer-path.ps1"
  ${If} ${isForAllUsers}
    StrCpy $R0 "LocalMachine"
  ${Else}
    StrCpy $R0 "CurrentUser"
  ${EndIf}
  nsExec::ExecToLog /TIMEOUT=15000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\pilot-installer-path.ps1" -Action ${ACTION} -Scope $R0 -InstallDirectory "$INSTDIR\." -InstallKey "${INSTALL_REGISTRY_KEY}"'
  Pop $R0
  ${If} $R0 == "0"
    System::Call 'User32::SendMessageTimeoutW(p 0xffff, i 0x001a, p 0, w "Environment", i 2, i 1000, p 0)'
  ${Else}
    DetailPrint "Could not update the Pilot command on Path ($R0)"
  ${EndIf}
  Pop $R0
!macroend

!macro customInstall
  Push $R0
  ${If} $LANGUAGE == 2052
    StrCpy $R0 "用 Pilot 打开"
  ${Else}
    StrCpy $R0 "Open with Pilot"
  ${EndIf}
  WriteRegStr SHELL_CONTEXT "${PILOT_FOLDER_VERB}" "MUIVerb" "$R0"
  WriteRegStr SHELL_CONTEXT "${PILOT_FOLDER_VERB}" "Icon" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  # The final dot avoids escaping the closing quote when Explorer passes a drive root.
  WriteRegStr SHELL_CONTEXT "${PILOT_FOLDER_VERB}\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --open-project "%1\."'
  WriteRegStr SHELL_CONTEXT "${PILOT_BACKGROUND_VERB}" "MUIVerb" "$R0"
  WriteRegStr SHELL_CONTEXT "${PILOT_BACKGROUND_VERB}" "Icon" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr SHELL_CONTEXT "${PILOT_BACKGROUND_VERB}\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --open-project "%V\."'
  System::Call 'Shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  Pop $R0
  !insertmacro pilotUpdatePath Add
!macroend

!macro customUnInstall
  !insertmacro pilotUpdatePath Remove
  Push $R0
  ReadRegStr $R0 SHELL_CONTEXT "${PILOT_FOLDER_VERB}\command" ""
  ${If} $R0 == '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --open-project "%1\."'
    DeleteRegKey SHELL_CONTEXT "${PILOT_FOLDER_VERB}"
  ${EndIf}
  ReadRegStr $R0 SHELL_CONTEXT "${PILOT_BACKGROUND_VERB}\command" ""
  ${If} $R0 == '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --open-project "%V\."'
    DeleteRegKey SHELL_CONTEXT "${PILOT_BACKGROUND_VERB}"
  ${EndIf}
  Pop $R0
!macroend
