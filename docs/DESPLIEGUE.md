# Guía de despliegue a producción

## 1. Requisitos
- Un servidor Linux (VPS) con **Docker** y **Docker Compose**. 1 vCPU y 1–2 GB de RAM bastan (1–2 usuarios, ~20 pacientes diarios).
- Recomendado: región sudamericana (Santiago o São Paulo) por tratarse de datos de salud.
- Un dominio (por ejemplo `sistema.sudominio.cl`) apuntando a la IP del servidor, si se desea HTTPS.

## 2. Primera instalación
```bash
git clone https://github.com/<usuario>/capstone.git && cd capstone
cp .env.example .env
```
Edite `.env`:

| Variable | Qué poner |
|---|---|
| `DB_PASSWORD` | Clave larga y única para PostgreSQL |
| `JWT_SECRET` | Resultado de `openssl rand -hex 48` |
| `ADMIN_USER` / `ADMIN_PASSWORD` | Primer usuario de Dirección (se crea una sola vez) |
| `COOKIE_SECURE` | `true` cuando se use HTTPS |
| `DOMINIO` | Dominio para HTTPS automático |
| `SMTP_*` | Opcional: correo saliente por variables de entorno. **Lo habitual es configurarlo después desde el sistema** (Administración → Configuración y correo), sin tocar el servidor |
| `SEED_DEMO` | **`false`** en producción real |

Levantar:
```bash
docker compose up -d --build                 # aplicación + PostgreSQL
docker compose --profile https up -d         # además HTTPS automático (requiere DOMINIO y puertos 80/443)
curl http://127.0.0.1:3000/api/v1/health     # {"status":"ok","db":"pg"}
```
Las tablas se crean solas al iniciar (migraciones). Ingrese con `ADMIN_USER` y cambie la clave en cuanto pueda.

## 3. Configuración inicial dentro del sistema (Administración)
1. **Profesionales y usuarios**: tipo de contrato y % de cada consulta de cada profesional; una cuenta por persona. El usuario `profesional` predeterminado puede renombrarse, cambiarse o desactivarse.
2. **Tratamientos**: precio por sesión, N° de sesiones, duración y mantención.
3. **Usuarios**: una cuenta por profesional, vinculada a su ficha de profesional.
4. **Enfermedades** (casillas de la ficha) y **Boxes**.
5. **Configuración y correo**: horario de la agenda, texto oficial del consentimiento, mensaje de recordatorio, enlace de la encuesta y la **cuenta de correo** que enviará los avisos.

### Avisos automáticos por correo
En *Administración → Configuración y correo* complete servidor, puerto, usuario y contraseña de la cuenta que enviará los avisos y use **Enviar correo de prueba**. Ejemplo Gmail: servidor `smtp.gmail.com`, puerto `587`, usuario el correo del centro y como contraseña una **«contraseña de aplicación»** (requiere verificación en dos pasos). La contraseña se guarda cifrada.

Una vez configurado, el sistema envía solo: confirmación al agendar, aviso al reprogramar o cancelar, y el recordatorio del día anterior (desde la hora que se elija; por defecto 18:00). Si se indica un correo para el informe, cada **lunes desde las 8:00** llega el reporte semanal en Excel. Las tareas corren una vez por hora dentro de la aplicación, en horario de Chile; el servidor debe permanecer encendido.

## 4. Respaldos y restauración
```bash
sh deploy/backup.sh                           # crea backups/deva_AAAA-MM-DD_HHMM.sql.gz (conserva 30 días)
# Programar a diario (crontab -e):  0 2 * * *  cd /ruta/capstone && sh deploy/backup.sh
docker compose stop app
sh deploy/restore.sh backups/deva_2026-12-01_0200.sql.gz
docker compose start app
```
Copie los respaldos fuera del servidor (otro equipo o almacenamiento en la nube). **Pruebe una restauración antes de la puesta en marcha.**

## 5. Actualizar a una versión nueva
```bash
git pull && sh deploy/backup.sh && docker compose up -d --build
```

## 6. Lista de verificación antes de usar con pacientes reales
- [ ] `SEED_DEMO=false` y sin usuarios demo.
- [ ] `JWT_SECRET` y `DB_PASSWORD` únicos; `.env` fuera de GitHub.
- [ ] HTTPS activo y `COOKIE_SECURE=true`.
- [ ] Texto de consentimiento oficial cargado.
- [ ] Respaldo diario programado y restauración probada.
- [ ] Servidor con actualizaciones al día y acceso SSH solo con llave.
- [ ] Cuentas individuales para cada persona; los profesionales cambian su clave temporal al primer ingreso.
- [ ] Correo de avisos configurado y probado.
- [ ] Revisión de la normativa de datos de salud (Ley 19.628, Ley 20.584 y Ley 21.719, según su vigencia).

## 7. Limitaciones conocidas
- **WhatsApp** funciona de forma asistida (abre WhatsApp con el mensaje listo). El envío automático requiere la API de WhatsApp Business (Meta) y no está integrado.
- **Boletas**: no se integra el sistema de pago actual (decisión de la clienta); el N° de boleta se ingresa a mano.
- El correo automático solo opera si se configura la cuenta de correo (pantalla de Configuración o variables `SMTP_*`).
- Los horarios de la agenda son bloques de 30 minutos; no hay bloqueo de vacaciones ni feriados por profesional.
- Los archivos (firmas) se guardan en la base de datos; para volúmenes mayores conviene un almacenamiento de objetos.
