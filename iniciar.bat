@echo off
echo Iniciando el sistema de Deva Aesthetic House...
echo Levantando servidor local...

:: Inicia el servidor en una nueva ventana de comandos
start "Servidor Deva" cmd /k "npx serve -l 3000"

:: Espera 3 segundos para dar tiempo a que el servidor arranque
timeout /t 3 /nobreak > NUL

:: Abre la página de inicio de sesión en el navegador predeterminado
start http://localhost:3000/index.html

exit