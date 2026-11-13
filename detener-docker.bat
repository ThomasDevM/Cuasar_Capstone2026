@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo  Deteniendo el sistema (los datos se conservan)...
docker compose stop
echo  Listo. Para volver a iniciarlo use "iniciar-docker.bat".
pause
