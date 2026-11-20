@echo off
rem Diagnóstico do áudio por app do ScreenShare: dois cliques para rodar.
rem Baixa e roda scripts/diagnose-win-audio.ps1 da main (não altera nada no sistema).
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/igornunesfontoura/screenshare/main/scripts/diagnose-win-audio.ps1 | iex"
