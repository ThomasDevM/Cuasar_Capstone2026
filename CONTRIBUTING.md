# Guía de contribución

## Ramas
- `main`: protegida; solo recibe Pull Requests con CI en verde y al menos una revisión.
- `feature/SCRUM-<n>-descripcion-corta`: una rama por historia de Jira.

## Commits
Formato: `SCRUM-15: registrar ficha clínica con validación de RUT`

## Pull Request
1. Referenciar la clave de Jira en el título.
2. Cumplir los criterios de aceptación de la historia.
3. Pruebas de la lógica crítica (comisiones, dobles reservas, plan de sesiones).
4. Actualizar la documentación y mover la historia a RESUELTO tras la aprobación.

## Definition of Done
Ver `docs/2.1_Metodologia_Scrum.docx`, sección 5.2.

## Seguridad
Nunca subir credenciales, tokens ni datos reales de pacientes. Usar datos ficticios.
