# Guion de demostración para Sandra (≈ 25 minutos)

**Antes de empezar:** abrir `iniciar-sistema.bat` y esperar a que se abra el navegador. Ingresar con `sandra` / `Deva2026!`. Los datos son ficticios. Para repetir la demo desde cero: `reiniciar-datos-demo.bat`.

| # | Qué mostrar | Qué decir / qué debe ver ella |
|---|---|---|
| 1 | **Inicio** | Resumen del día: citas de hoy y mañana, ventas, comisiones, **ganancia del centro**, controles próximos. |
| 2 | **Buscador por RUT** | Arriba, en cualquier pantalla: escribir `11.111.111-1` (o solo `11111111`). Abre la ficha del paciente. |
| 3 | **Historial visible** | Al abrir la ficha: tarjetas con **última atención** (qué se hizo y qué se indicó), **próxima cita**, **plan de sesiones** y **alertas** (enfermedades, control pendiente, consentimiento). Pestañas: Historial y seguimiento · Ficha y consentimientos · Planes · Cambios de la ficha. |
| 4 | **Nuevo paciente** | Ficha de ingreso con las **enfermedades del catálogo** (editable). Probar un RUT mal escrito. Al guardar se abre el **consentimiento**: firmar con el mouse → *Firmar y guardar* → *Descargar PDF*. |
| 5 | **Agenda · Por profesional** | Una columna por profesional y filas de **30 minutos**. Hacer clic en un bloque libre. |
| 6 | **Nueva cita** | Buscar el paciente por RUT, elegir el tratamiento y **con qué profesional** es la atención; el sistema muestra **solo los horarios libres** de ese profesional (los ocupados aparecen tachados). Elegir un bloque y agendar. |
| 7 | **Sin duplicados** | Intentar de nuevo el mismo horario con el mismo profesional: no se ofrece. Tampoco permite dos citas del mismo paciente ni dos en el mismo box a la vez. |
| 8 | **Editar y eliminar** | *Editar*: cambiar horario, tratamiento, box o notas. *Eliminar*: la borra si no tiene cobro ni evolución (si los tiene, explica por qué). |
| 9 | **Agenda · Día y Semana** | Cada cita muestra «con Daniela Torres», la **última visita** del paciente y su estado de pago. |
| 10 | **Atender** | Botón *Ver historial*: antecedentes a tener en cuenta, lo realizado la última vez y controles pendientes. Luego *Evolución*. |
| 11 | **Cobrar** | *Cobrar* → medio de pago y N° de boleta (emitida en su sistema actual). |
| 12 | **Informes · Ganancias por persona** | Elegir *Esta semana*, *Este mes* o un rango. Muestra lo que **se lleva cada persona** y lo que queda para el centro; clic en un nombre → detalle. *Exportar Excel*. |
| 13 | **Informes · Reporte semanal** | Ventas por día, medios de pago, tratamientos más vendidos, atenciones, cancelaciones, inasistencias, pacientes nuevos. **Exportar reporte semanal (Excel)**. Se puede enviar solo cada lunes por correo. |
| 14 | **Administración · Profesionales** | *Nuevo profesional*: nombre, **% de cada consulta** y cuenta de acceso con **clave temporal**. *% por tratamiento*: porcentaje especial para un tratamiento. |
| 15 | **Tratamientos, enfermedades y boxes** | Crear un tratamiento (precio y duración), **cambiar un precio** directamente en la tabla, agregar una enfermedad al catálogo, crear un box. |
| 16 | **Correo automático** | *Configuración y correo*: cuenta que envía los avisos, hora del recordatorio, correo del informe semanal y **Enviar correo de prueba**. Explicar: confirmación al agendar, aviso al reprogramar/cancelar y recordatorio del día anterior, todo automático. |
| 17 | **Rol Profesional** | Cerrar sesión y entrar con una cuenta nueva: **obliga a cambiar la clave temporal**. Muestra que solo ve su agenda, sus pacientes y *Mi ganancia*; **no ve Administración ni puede cambiar porcentajes**. |
| 18 | **Usuarios** | *Administración → Usuarios*: Sandra crea una cuenta, la **edita**, **cambia su contraseña**, la desactiva o la elimina. Mostrar que el usuario `profesional` predeterminado no tiene permisos de administración. |
| 19 | **Seguimiento y WhatsApp** | *Seguimiento*: recordatorios de mañana con el mensaje listo para WhatsApp, controles pendientes y mantención. |

## Qué dejar claro al cerrar
- Los datos de la demo son ficticios; en producción se parte desde cero.
- Los correos automáticos funcionan en cuanto se configura la cuenta de correo del centro; WhatsApp es asistido (abre el mensaje ya redactado) y el envío automático requiere la API de Meta, que tiene costo.
- Falta definir con ella: textos oficiales de consentimiento, listado real de tratamientos con precios y duraciones, % de cada profesional, hosting y cuenta de correo.
- Próximos pasos: instalación en el servidor, prueba con un mes real para **conciliar ganancias con su Excel**, capacitación.

## Preguntas para Sandra
1. ¿El % del profesional se calcula sobre el valor cobrado o sobre el valor de lista del tratamiento?
2. ¿Algún tratamiento tiene un % distinto al base de cada profesional?
3. ¿Hay profesionales con monto fijo o mixto (sueldo + porcentaje)?
4. ¿Quién ingresa los cobros: cada profesional o una sola persona?
5. ¿Qué cuenta de correo usará el centro para los avisos?
6. ¿Algún tratamiento dura más de 30 minutos (para dejar su duración correcta)?
