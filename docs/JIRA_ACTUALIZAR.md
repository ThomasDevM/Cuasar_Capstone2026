# Cómo dejar Jira al día (≈ 15 minutos)

Las escrituras en Jira no pudieron aplicarse desde el asistente (no hubo aprobación), así que este es el paso a paso para hacerlo en el tablero. Estado de referencia: **12 de noviembre de 2026**. Proyecto `SCRUM`, tablero 1.

## 1. Crear las historias nuevas (importar CSV)
1. En Jira: **Configuración del proyecto → Importar** (o ⋯ → *Importar issues*), cargue `jira_importar_historias.csv`.
2. Asigne cada columna al campo del mismo nombre: Summary, Issue Type, Description, Priority, Parent, Story point estimate, Sprint, Status.
3. Resultado: 13 historias de las mejoras (HU-24 a HU-36), HU-37, HU-38, HU-39, TEC-08, TEC-09, TEC-10 y 7 hitos (HITO 1 a 7).
4. Si Jira no permite importar el estado, déjelas como están y cámbielas en el paso 2 (JQL: `summary ~ "HU-24"` etc.).
5. Opcional: cree un epic «Hitos del proyecto» y arrastre dentro los 7 hitos.

## 2. Pasar a RESUELTO lo terminado (cambio masivo)
1. En **Filtros → Búsqueda avanzada** pegue:

```
key in (SCRUM-19, SCRUM-15, SCRUM-16, SCRUM-17, SCRUM-18, SCRUM-45, SCRUM-46, SCRUM-20, SCRUM-21, SCRUM-22, SCRUM-23, SCRUM-39, SCRUM-24, SCRUM-47, SCRUM-25, SCRUM-26, SCRUM-27, SCRUM-41, SCRUM-29, SCRUM-30, SCRUM-31, SCRUM-32, SCRUM-42, SCRUM-28, SCRUM-34, SCRUM-36, SCRUM-37, SCRUM-38)
```

2. **⋯ → Cambio masivo → Transición** → RESUELTO (lo que ya está resuelto se ignora).
3. En **SCRUM-28 (HU-13, stock)** agregue el comentario: *«Descartada: la clienta pidió quitar el inventario. Se eliminó del sistema (ver HU-39).»*

Quedan **En curso** a propósito (pendientes reales): SCRUM-44 (publicar en GitHub), SCRUM-40 (los turnos no bloquean la agenda), SCRUM-43 (probar respaldos en un servidor), SCRUM-48 (aceptación de la clienta), SCRUM-49 (capacitación) y SCRUM-50 (despliegue), y los epics EP-1 y EP-3.

## 3. Corregir textos que ya no son ciertos
- **SCRUM-26** (HU-11): quitar «o producto» del título y de la descripción.
- **SCRUM-45** (TEC-02): cambiar «PostgreSQL + Prisma» por «PostgreSQL + SQL con migraciones».

## 4. Sprints (tablero → Backlog)
1. Arrastre **SCRUM-44** y **SCRUM-40** (incompletas) al *Sprint 3*.
2. **Sprint 1 «Ficha Clinica»** → *Iniciar sprint* → *Completar sprint*.
3. **Sprint 2** → *Iniciar sprint* → *Completar sprint*.
4. **Sprint 3** → *Iniciar sprint* (10-11 al 23-11). Meta sugerida: *«Entregar la versión 1.2 instalable con Docker: gestión de usuarios, profesional predeterminado, inventario eliminado y documentación; lista para la demostración a la clienta.»*
5. Sprint 4 y 5 quedan planificados.

## 5. Revisión final
- Tablero: Sprint 3 activo con 45 puntos terminados de 45 más 5 arrastrados.
- Backlog: **48 elementos, 177 puntos, 160 terminados (90 %)**.
- `SCRUM-4` («Subtarea 2.1») es una subtarea de prueba antigua: puede eliminarse.
