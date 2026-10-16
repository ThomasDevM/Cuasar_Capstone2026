@echo off
chcp 65001 >nul
echo.
echo  Esto BORRA los datos de la demostracion (pacientes, citas, ventas ficticias)
echo  y deja el sistema como nuevo la proxima vez que lo inicie.
echo.
choice /m "Desea continuar"
if errorlevel 2 exit /b 0
if exist "%~dp0datos" rmdir /s /q "%~dp0datos"
echo.
echo  Listo. Abra "iniciar-sistema.bat" para comenzar con datos nuevos.
pause
