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
