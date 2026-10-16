@echo off
chcp 65001 >nul
title Deva Aesthetic House - Sistema de Gestion (DEMO)
cd /d "%~dp0backend"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  No se encontro Node.js en este equipo.
  echo  Descarguelo e instalelo desde https://nodejs.org  ^(version LTS^) y vuelva a abrir este archivo.
  echo.
  pause
  exit /b 1
)

set SEED_DEMO=true
set DATA_DIR=%~dp0datos
set PORT=3000
set CRON_ENABLED=true

echo.
echo  Iniciando el sistema de Deva Aesthetic House...
echo  Se abrira el navegador en unos segundos.
echo  Usuario: sandra     Clave: Deva2026!
echo.
echo  NO CIERRE ESTA VENTANA mientras use el sistema. Para terminar, cierrela.
echo.

start /b cmd /c "timeout /t 5 /nobreak >nul & start http://localhost:3000"
node dist/server.js
echo.
echo  El sistema se detuvo. Si vio un error de "puerto en uso", cierre otras ventanas del sistema e intente de nuevo.
pause
