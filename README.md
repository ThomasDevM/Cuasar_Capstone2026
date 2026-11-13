# Deva Aesthetic House — Sistema de Gestión Integral

Sistema web para el centro **Deva Aesthetic House** (Linderos, Buin): agenda por profesional, fichas con historial, consentimientos digitales, avisos automáticos por correo, cobros, división de ganancias e informes.

Proyecto APT (Capstone PTY4614) · Product Owner: Sandra Sánchez · Backlog en Jira (proyecto `SCRUM`).

---

## 1. Instalación paso a paso (con Docker)

Docker es un programa que ejecuta el sistema y su base de datos en un «contenedor», sin instalar nada más.

### En un computador con Windows 10 u 11

**Qué necesita:** un computador con Windows 10/11 de 64 bits, 8 GB de memoria y conexión a internet (solo para instalar).

1. **Instale Docker Desktop.**
   - Entre a <https://www.docker.com/products/docker-desktop> y descargue «Docker Desktop for Windows».
   - Ejecute el instalador, deje las opciones por defecto y **reinicie el computador** cuando lo pida.
   - Abra «Docker Desktop», acepte los términos y espere a que abajo a la izquierda diga **«Engine running»** (Verde). Si pide actualizar WSL 2, acepte.
2. **Descargue el sistema.** Descomprima `capstone-sistema-repo.zip` (clic derecho → *Extraer todo*) en una carpeta simple, por ejemplo `C:\Deva`. Debe quedar la carpeta `C:\Deva\Cuasar_Capstone2026-main` con archivos como `docker-compose.yml` e `iniciar-docker.bat`.
3. **Inicie el sistema.** Haga doble clic en **`iniciar-docker.bat`**.
   - La primera vez crea las claves de seguridad automáticamente, construye el sistema y lo inicia. **Demora entre 5 y 10 minutos**; no cierre la ventana negra.
   - Cuando termina, se abre el navegador en <http://localhost:3000>.
4. **Ingrese.** Las claves iniciales están en el archivo **`CLAVES-INICIALES.txt`** (en la misma carpeta):

   | Persona | Usuario | Perfil |
   |---|---|---|
   | Sandra | `sandra` | Dirección: acceso completo (crea usuarios, cambia claves, porcentajes y precios) |
   | Profesional predeterminado | `profesional` | Profesional: sin permisos de administración; debe cambiar su clave al ingresar |

5. **Haga la configuración inicial**
6. **Guarde `CLAVES-INICIALES.txt` en un lugar seguro** (y bórrelo del computador cuando ya haya cambiado las claves).

**Uso diario:** abra Docker Desktop y entre a <http://localhost:3000>. El sistema vuelve a iniciar solo cuando se prende el computador (queda configurado para reiniciarse). Para detenerlo use `detener-docker.bat`; para volver a iniciarlo, `iniciar-docker.bat`. **Los datos se conservan** al detener o reiniciar.


## 2. Primeros pasos después de instalar (Sandra)

1. Entre como `sandra` y vaya a **Mi cuenta** para cambiar su contraseña.
2. **Administración → Usuarios:** cambie la clave del usuario `profesional` o desactívelo; cree una cuenta por cada profesional (*+ Nuevo usuario*). Cada cuenta tiene **Editar**, **Cambiar contraseña**, **Clave temporal**, **Desactivar** y **Eliminar**.
3. **Administración → Profesionales:** edite «Profesional 1» con el nombre real o cree a los demás; defina el **% de cada consulta** de cada uno.
4. **Administración → Tratamientos:** cree los tratamientos con su precio y duración (30, 60, 90 o 120 minutos). **Enfermedades** y **Boxes** también se administran ahí.
5. **Administración → Configuración y correo:** cargue el texto oficial del consentimiento, el horario de la agenda y la cuenta de correo (use «Enviar correo de prueba»).
6. Cree el primer paciente y agende una cita de prueba.



## 3. Estructura del proyecto

| Carpeta o archivo | Contenido |
|---|---|
| `backend/`, `frontend/` | API y aplicación web |
| `Dockerfile`, `docker-compose.yml`, `.env.example` | Instalación con Docker |
| `iniciar-docker.bat`, `detener-docker.bat`, `instalar.sh` | Instaladores guiados (Windows y Linux) |
| `deploy/` | HTTPS (Caddy), respaldo, restauración y generador de claves |
| `docs/` | Documentación del proyecto (Scrum, arquitectura, despliegue, guion de demostración) |

Flujo de trabajo y convenciones: [CONTRIBUTING.md](CONTRIBUTING.md).
