; Custom NSIS macros for the NestBrain installer.
; electron-builder auto-includes build/installer.nsh if it exists.

; Show the file-by-file detail log during installation so the user can
; see progress and we can diagnose where the installer hangs (if ever).
!macro customInit
  SetDetailsView show
!macroend
