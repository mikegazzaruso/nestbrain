; Custom NSIS directives for the NestBrain installer.
; electron-builder auto-includes build/installer.nsh if it exists.

; Show the file-by-file extraction log during installation.
; MUI2 (used by electron-builder) defaults to hiding the details view
; behind the progress bar. This compile-time directive overrides that.
ShowInstDetails show
ShowUninstDetails show
