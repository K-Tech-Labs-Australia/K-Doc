; @file installer-hooks.nsh
; @purpose NSIS hooks for K-Doc's Windows installer: registers K-Doc with Windows as an app that opens Markdown files
;   (so it is listed under Open with and Default apps) and, on a first install, offers to make it the default.
; @inputs Tauri's NSIS template variables: $INSTDIR, ${MAINBINARYNAME}, $PassiveMode, $UpdateMode and
;   $DeleteAppDataCheckboxState; the K-Doc.Markdown file class written by bundle.fileAssociations in tauri.conf.json.
; @outputs Per-user registry keys: the Capabilities key, the RegisteredApplications entry, OpenWithProgids values per
;   extension, and the marker that records the question was asked.
; @functions
;   - NSIS_HOOK_POSTINSTALL: Registers K-Doc's capabilities and asks, once, whether to open Default apps.
;   - NSIS_HOOK_POSTUNINSTALL: Removes everything the install hook wrote.
; @dataflow tauri.conf.json extensions -> KDOC_EXTENSIONS -> registry; user's answer -> ms-settings Default apps page.
; @controlflow Install: write keys -> notify the shell -> ask only if never asked, not silent and not passive.
;   Uninstall: remove keys unless updating; forget the marker only when the user also deletes app data.
; @version 1
; @date 2026-10-13
;
; Windows does not let an installer choose the default app; only the user can, in Settings. So the installer
; registers K-Doc properly (https://learn.microsoft.com/windows/win32/shell/default-programs) and then opens the
; Default apps page for it. The RegisteredApplications value name ("K-Doc") is the name the ms-settings link and
; launch.rs's DEFAULT_APPS_URI use; change all three together.

!define KDOC_CLASS "K-Doc.Markdown"
!define KDOC_CAPABILITIES "Software\K-Tech Labs\K-Doc\Capabilities"
!define KDOC_INSTALLER_KEY "Software\K-Tech Labs\K-Doc\Installer"
!define KDOC_DEFAULT_APPS_URI "ms-settings:defaultapps?registeredAppUser=K-Doc"
; Must match bundle.fileAssociations[0].ext in tauri.conf.json.
!define KDOC_EXTENSIONS "md markdown mdown mkd mkdn mdwn"

; Registers one extension: K-Doc in its Open with list and in K-Doc's capabilities.
!macro KDOC_REGISTER_EXTENSION EXT
  WriteRegStr SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${KDOC_CLASS}" ""
  WriteRegStr SHCTX "${KDOC_CAPABILITIES}\FileAssociations" ".${EXT}" "${KDOC_CLASS}"
!macroend

; Removes one extension's Open with entry.
!macro KDOC_UNREGISTER_EXTENSION EXT
  DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${KDOC_CLASS}"
  DeleteRegKey /ifempty SHCTX "Software\Classes\.${EXT}\OpenWithProgids"
!macroend

; Applies MACRO to every extension in KDOC_EXTENSIONS (expanded at compile time).
!macro KDOC_FOR_EACH_EXTENSION MACRO
  !insertmacro ${MACRO} "md"
  !insertmacro ${MACRO} "markdown"
  !insertmacro ${MACRO} "mdown"
  !insertmacro ${MACRO} "mkd"
  !insertmacro ${MACRO} "mkdn"
  !insertmacro ${MACRO} "mdwn"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Describe K-Doc to Windows so it appears in Settings > Default apps.
  WriteRegStr SHCTX "${KDOC_CAPABILITIES}" "ApplicationName" "K-Doc"
  WriteRegStr SHCTX "${KDOC_CAPABILITIES}" "ApplicationDescription" "A Markdown word processor that keeps your files plain Markdown."
  WriteRegStr SHCTX "${KDOC_CAPABILITIES}" "ApplicationIcon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  !insertmacro KDOC_FOR_EACH_EXTENSION KDOC_REGISTER_EXTENSION
  WriteRegStr SHCTX "Software\RegisteredApplications" "K-Doc" "${KDOC_CAPABILITIES}"
  !insertmacro UPDATEFILEASSOC

  ; Ask once per user: an upgrade or reinstall has already had its answer.
  ReadRegStr $0 SHCTX "${KDOC_INSTALLER_KEY}" "DefaultAppQuestionAsked"
  ${If} $0 != "1"
  ${AndIfNot} ${Silent}
  ${AndIf} $PassiveMode <> 1
    WriteRegStr SHCTX "${KDOC_INSTALLER_KEY}" "DefaultAppQuestionAsked" "1"
    ; Default button is No: the choice is the user's, so nothing is pre-selected for them.
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Make K-Doc the default app for Markdown files?$\r$\n$\r$\nWindows will open its Default apps settings for K-Doc, where you confirm the choice." IDNO kdoc_default_app_done
      ExecShell "open" "${KDOC_DEFAULT_APPS_URI}"
    kdoc_default_app_done:
  ${Else}
    ; Asked before, or an unattended install: say nothing.
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; An update reinstalls straight away, so the registration is left for it to rewrite.
  ${If} $UpdateMode <> 1
    DeleteRegValue SHCTX "Software\RegisteredApplications" "K-Doc"
    DeleteRegKey SHCTX "${KDOC_CAPABILITIES}"
    !insertmacro KDOC_FOR_EACH_EXTENSION KDOC_UNREGISTER_EXTENSION
    !insertmacro UPDATEFILEASSOC
  ${Else}
    ; Updating: keep everything.
  ${EndIf}

  ; Forget that the question was asked only when the user is removing K-Doc's data too.
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    DeleteRegKey SHCTX "${KDOC_INSTALLER_KEY}"
  ${Else}
    ; Keep the marker, so reinstalling does not ask again.
  ${EndIf}
  DeleteRegKey /ifempty SHCTX "Software\K-Tech Labs\K-Doc"
  DeleteRegKey /ifempty SHCTX "Software\K-Tech Labs"
!macroend
