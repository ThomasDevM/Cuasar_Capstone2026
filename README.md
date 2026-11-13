# Deva Aesthetic House — Sistema de Gestión Integral

Sistema web para el centro **Deva Aesthetic House** (Linderos, Buin): agenda por profesional, fichas con historial, consentimientos digitales, avisos automáticos por correo, cobros, división de ganancias e informes.

Proyecto APT (Capstone PTY4614) · Product Owner: Sandra Sánchez · Backlog en Jira (proyecto `SCRUM`).

---

## 1. Instalación paso a paso (con Docker)

Docker es un programa que ejecuta el sistema y su base de datos en un «contenedor», sin instalar nada más. Hay dos formas: **A) Windows** (la más simple, recomendada para el centro) y **B) servidor Linux**.

### A) En un computador con Windows 10 u 11

**Qué necesita:** un computador con Windows 10/11 de 64 bits, 8 GB de memoria y conexión a internet (solo para instalar).

1. **Instale Docker Desktop.**
   - Entre a <https://www.docker.com/products/docker-desktop> y descargue «Docker Desktop for Windows».
   - Ejecute el instalador, deje las opciones por defecto y **reinicie el computador** cuando lo pida.
   - Abra «Docker Desktop», acepte los términos y espere a que abajo a la izquierda diga **«Engine running»** (verde). Si pide actualizar WSL 2, acepte.
2. **Descargue el sistema.** Descomprima `capstone-sistema-repo.zip` (clic derecho → *Extraer todo*) en una carpeta simple, por ejemplo `C:\Deva`. Debe quedar la carpeta `C:\Deva\capstone` con archivos como `docker-compose.yml` e `iniciar-docker.bat`.
3. **Inicie el sistema.** Haga doble clic en **`iniciar-docker.bat`**.
   - La primera vez crea las claves de seguridad automáticamente, construye el sistema y lo inicia. **Demora entre 5 y 10 minutos**; no cierre la ventana negra.
   - Cuando termina, se abre el navegador en <http://localhost:3000>.
4. **Ingrese.** Las claves iniciales están en el archivo **`CLAVES-INICIALES.txt`** (en la misma carpeta):

   | Persona | Usuario | Perfil |
   |---|---|---|
   | Sandra | `sandra` | Dirección: acceso completo (crea usuarios, cambia claves, porcentajes y precios) |
   | Profesional predeterminado | `profesional` | Profesional: sin permisos de administración; debe cambiar su clave al ingresar |

5. **Haga la configuración inicial** (ver sección 3).
6. **Guarde `CLAVES-INICIALES.txt` en un lugar seguro** (y bórrelo del computador cuando ya haya cambiado las claves).

**Uso diario:** abra Docker Desktop y entre a <http://localhost:3000>. El sistema vuelve a iniciar solo cuando se prende el computador (queda configurado para reiniciarse). Para detenerlo use `detener-docker.bat`; para volver a iniciarlo, `iniciar-docker.bat`. **Los datos se conservan** al detener o reiniciar.

> **Si prefiere hacerlo a mano (sin los .bat):** abra PowerShell en la carpeta, ejecute `copy .env.example .env`, abra `.env` con el Bloc de notas y complete `DB_PASSWORD`, `JWT_SECRET` (un texto largo al azar), `ADMIN_PASSWORD` y `PROFESIONAL_PASSWORD`; guarde y ejecute `docker compose up -d --build`.

**Para que otros computadores del centro entren:** en `.env` cambie `BIND=127.0.0.1` por `BIND=0.0.0.0`, ejecute `docker compose up -d` y desde el otro equipo abra `http://IP-DEL-COMPUTADOR:3000` (la IP se ve con el comando `ipconfig`). Para usarlo por internet o con certificado, use la opción B.

### B) En un servidor Linux (con HTTPS)

1. Contrate un servidor (VPS) con Ubuntu 22.04 o superior y 1–2 GB de memoria, en una región cercana (Santiago o São Paulo). Si desea HTTPS, apunte un dominio (por ejemplo `sistema.sudominio.cl`) a la IP del servidor.
2. Instale Docker: <https://docs.docker.com/engine/install/ubuntu/> y deje su usuario en el grupo `docker`.
3. Copie el proyecto al servidor y entre a la carpeta:
   ```bash
   unzip capstone-sistema-repo.zip && cd capstone
   ```
4. Ejecute el instalador (crea `.env` con claves seguras e inicia el sistema):
   ```bash
   ./instalar.sh
   ```
   Las claves iniciales quedan en `CLAVES-INICIALES.txt`.
5. **HTTPS (recomendado):** edite `.env` y ponga `DOMINIO=sistema.sudominio.cl` y `COOKIE_SECURE=true`; luego:
   ```bash
   docker compose --profile https up -d
   ```
   Abra los puertos 80 y 443 del servidor. El certificado se obtiene solo.
6. Verifique: `curl http://127.0.0.1:3000/api/v1/health` debe responder `{"status":"ok","db":"pg"}`.

> **Importante:** con `COOKIE_SECURE=true` el sistema solo funciona por `https://`. Si lo usa por `http://` déjelo en `false`.

---

## 2. Probar el sistema sin Docker (demostración)

Para mostrarlo en un computador con Windows sin instalar Docker, use el paquete **`Deva-Demo-Windows.zip`**: requiere solo Node.js (<https://nodejs.org>, versión LTS). Descomprima y haga doble clic en `iniciar-sistema.bat`. Trae **datos ficticios** (usuarios `sandra`, `fmunoz`, `dtorres`, `mrojas`, `pcontreras`; clave `Deva2026!`). No ingrese datos reales de pacientes en esa versión.

Para desarrolladores:
```bash
cd backend && npm ci && npm run build
cd ../frontend && npm ci && npm run build
cd ../backend && SEED_DEMO=true node dist/server.js     # http://localhost:3000
```

---

## 3. Primeros pasos después de instalar (Sandra)

1. Entre como `sandra` y vaya a **Mi cuenta** para cambiar su contraseña.
2. **Administración → Usuarios:** cambie la clave del usuario `profesional` o desactívelo; cree una cuenta por cada profesional (*+ Nuevo usuario*). Cada cuenta tiene **Editar**, **Cambiar contraseña**, **Clave temporal**, **Desactivar** y **Eliminar**.
3. **Administración → Profesionales:** edite «Profesional 1» con el nombre real o cree a los demás; defina el **% de cada consulta** de cada uno.
4. **Administración → Tratamientos:** cree los tratamientos con su precio y duración (30, 60, 90 o 120 minutos). **Enfermedades** y **Boxes** también se administran ahí.
5. **Administración → Configuración y correo:** cargue el texto oficial del consentimiento, el horario de la agenda y la cuenta de correo (use «Enviar correo de prueba»).
6. Cree el primer paciente y agende una cita de prueba.

---

## 4. Operación

| Tarea | Comando (en la carpeta del proyecto) |
|---|---|
| Ver si está funcionando | `docker compose ps` |
| Ver mensajes del sistema | `docker compose logs -f app` |
| Detener / iniciar | `docker compose stop` / `docker compose start` |
| Actualizar a una versión nueva | reemplace la carpeta del código (conserve `.env`) y ejecute `docker compose up -d --build` |
| **Respaldo** de la base de datos | `sh deploy/backup.sh` (crea `backups/deva_AAAA-MM-DD.sql.gz`; conviene programarlo a diario) |
| Restaurar un respaldo | `docker compose stop app` · `sh deploy/restore.sh backups/ARCHIVO.sql.gz` · `docker compose start app` |
| Restablecer una clave olvidada | `docker compose exec app node dist/cli/restablecer-clave.js sandra` (entrega una clave temporal; no borra datos) |
| Borrar todo, incluidos los datos | `docker compose down -v` (**irreversible**) |

Copie los respaldos fuera del equipo (pendrive o nube). Antes de usar el sistema con pacientes reales, **pruebe una restauración**. Más detalle en [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md).

---

## 5. Solución de problemas

| Problema | Qué hacer |
|---|---|
| «Docker no está en ejecución» | Abra Docker Desktop y espere a que diga *Engine running*. |
| «Port is already allocated» (puerto en uso) | Cambie `PUERTO=3000` por otro (por ejemplo `3001`) en `.env`, ejecute `docker compose up -d` y entre por ese puerto. |
| La página no abre | Espere 30 segundos tras iniciar; revise `docker compose ps` (debe decir *healthy*) y `docker compose logs app`. |
| No me deja iniciar sesión | Con `http://` el valor `COOKIE_SECURE` debe ser `false`. Si olvidó la clave, otra persona de Dirección puede cambiarla en *Administración → Usuarios*, o use el comando de restablecimiento de la sección 4. |
| Los correos no se envían | Revise *Administración → Configuración y correo* y use «Enviar correo de prueba». Con Gmail se necesita una «contraseña de aplicación». |
| Quedó sin espacio en el disco | `docker system prune` (no borra los datos del sistema). |

---

## 6. Qué incluye

**Agenda** en bloques de 30 minutos (día, por profesional y semana) sin duplicar profesional, box ni paciente · **Pacientes** con buscador por RUT, historial destacado, consentimiento firmado en pantalla y PDF · **Seguimiento** (notas, controles, mantención) · **Avisos por correo** automáticos · **Cobros** y **división de ganancias** por profesional (con % especial por tratamiento) · **Informes** y **reporte semanal** en Excel · **Administración** (profesionales, usuarios, tratamientos, enfermedades, boxes, configuración, auditoría) · **Roles** Dirección / Profesional.

*El sistema no incluye inventario ni stock: se quitó a pedido de la clienta.*

**Tecnología:** React + TypeScript · Node.js 22 + Express · PostgreSQL 16 · Docker. **Pruebas:** `cd backend && npm test` (70 pruebas; con `TEST_DATABASE_URL` se ejecutan contra PostgreSQL).

## 7. Estructura del proyecto

| Carpeta o archivo | Contenido |
|---|---|
| `backend/`, `frontend/` | API y aplicación web |
| `Dockerfile`, `docker-compose.yml`, `.env.example` | Instalación con Docker |
| `iniciar-docker.bat`, `detener-docker.bat`, `instalar.sh` | Instaladores guiados (Windows y Linux) |
| `deploy/` | HTTPS (Caddy), respaldo, restauración y generador de claves |
| `docs/` | Documentación del proyecto (Scrum, arquitectura, despliegue, guion de demostración) |

Flujo de trabajo y convenciones: [CONTRIBUTING.md](CONTRIBUTING.md).
