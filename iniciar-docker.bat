@echo off
chcp 65001 >nul
title Deva Aesthetic House - Instalacion con Docker
cd /d "%~dp0"

where docker >nul 2>nul
if errorlevel 1 (
  echo.
  echo  No se encontro Docker en este equipo.
  echo  Instale "Docker Desktop" desde https://www.docker.com/products/docker-desktop
  echo  reinicie el computador, abra Docker Desktop y vuelva a abrir este archivo.
  echo.
  pause
  exit /b 1
)
docker info >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Docker Desktop esta instalado pero no esta en ejecucion.
  echo  Abralo, espere a que diga "Engine running" y vuelva a abrir este archivo.
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  echo  Creando la configuracion con claves seguras...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\crear-env.ps1"
  if errorlevel 1 (
    echo  No se pudo crear el archivo .env. Siga el paso a paso manual del README.
    pause
    exit /b 1
  )
)

echo.
echo  Construyendo e iniciando el sistema. La primera vez demora entre 5 y 10 minutos...
docker compose up -d --build
if errorlevel 1 (
  echo.
  echo  Ocurrio un error al iniciar. Revise los mensajes de arriba o la seccion "Solucion de problemas" del README.
  pause
  exit /b 1
)

echo.
echo  Listo. El sistema esta funcionando en http://localhost:3000
echo  Las claves iniciales estan en el archivo CLAVES-INICIALES.txt (cambielas al ingresar).
timeout /t 4 /nobreak >nul
start http://localhost:3000
pause
