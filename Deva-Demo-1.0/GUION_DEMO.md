# Guion de demostración para Sandra (≈ 20 minutos)

**Antes de empezar:** abrir `iniciar-sistema.bat` y esperar a que se abra el navegador. Ingresar con `sandra` / `Deva2026!`. Los datos son ficticios.
Si se quiere repetir la demo desde cero, ejecutar `reiniciar-datos-demo.bat`.

| # | Qué mostrar | Qué decir / qué debe ver ella |
|---|---|---|
| 1 | **Inicio** | Resumen del día: citas de hoy y de mañana, ventas, comisiones, **ganancia del centro**, pacientes por contactar, stock bajo. “Todo lo que hoy revisa en tres planillas, en una pantalla.” |
| 2 | **Pacientes → Nuevo paciente** | Ficha de ingreso digital. Probar un RUT mal escrito (lo rechaza). Marcar antecedentes. Guardar. |
| 3 | **Consentimiento** | Se abre solo: firmar con el mouse (o el dedo en tablet) → *Firmar y guardar* → **Descargar PDF**. “Se acabó el papel.” |
| 4 | **Agenda (día)** | Citas con box, profesional, “sesión 4 de 10”, estado y pago. Cambiar un estado a *Confirmada*. |
| 5 | **Nueva cita** | Elegir paciente, servicio, profesional, box y hora. Repetir la misma hora con el mismo profesional → **el sistema avisa que ya está ocupado**. |
| 6 | **Editar y eliminar** | *Editar*: cambiar hora, servicio o agregar una nota. *Eliminar*: la elimina si no tiene cobro ni evolución (si los tiene, explica por qué y propone cancelar). |
| 7 | **Agenda (semana)** | Vista semanal; clic en una cita para editarla. |
| 8 | **Plan de sesiones** | En un paciente con lipedema o láser: barra de avance. Agendar una sesión de más → pide confirmación. |
| 9 | **Atender: Historial** | Botón *Historial* en una cita: antecedentes a tener en cuenta, **lo que se hizo en la última sesión**, recomendaciones y controles pendientes. |
| 10 | **Evolución** | Registrar lo realizado hoy. Queda en la ficha para la próxima consulta. |
| 11 | **Cobrar** | *Cobrar* → medio de pago y N° de boleta (emitida en su sistema actual). La cita pasa a *Pagada*. |
| 12 | **Ganancias** | Menú *Comisiones*: cada atención se **divide entre el profesional que atendió y el centro**. Clic en un profesional para ver el detalle. *Exportar Excel* para el contador. |
| 13 | **Cambio de profesional** | En una cita realizada y cobrada: *Editar* → cambiar “Profesional que atiende”. La comisión **se traslada** al otro profesional. |
| 14 | **Ficha → Seguimiento** | Registrar una llamada, una indicación y un *control en 2 semanas*. Aparecen en la línea de tiempo junto a las atenciones. Mostrar **Historial PDF**. |
| 15 | **Seguimiento (menú)** | *Recordatorios*: mensaje de mañana ya redactado → **Enviar WhatsApp**. *Controles pendientes*. *Mantención*: pacientes que deben volver. |
| 16 | **Productos y ventas** | Vender un producto: descuenta stock. Mostrar alerta de stock bajo. |
| 17 | **Rol Profesional** | Cerrar sesión, entrar con `fmunoz`: solo ve su agenda, sus pacientes y su ganancia; no ve Administración. |
| 18 | **Administración** | Profesionales y % de comisión, servicios, usuarios, texto del consentimiento y **auditoría** (quién vio qué ficha). Botón **Verificar integridad**: demuestra que nadie puede alterar el registro. |
| 19 | **CRM → Prospectos** | Embudo con las consultas que llegan por Instagram/WhatsApp. Abrir uno: *WhatsApp* con saludo listo, registrar una llamada, crear un **presupuesto** con descuento y *Enviar por WhatsApp*. *Marcar aceptado* → *Convertir en paciente* (pide RUT) → la ficha queda con su plan al precio pactado. |
| 20 | **CRM → Campañas** | Nueva campaña “Reactivación”: filtro *sin venir hace 90 días* o *etiqueta facial* → *Ver destinatarios* (excluye a quienes no autorizaron marketing) → enviar uno por uno por WhatsApp. |
| 21 | **Encuesta** | En la Agenda, cita realizada → *Encuesta*: se abre WhatsApp con un enlace único; el paciente responde 0–10 desde su teléfono. Las malas notas aparecen en *CRM → Satisfacción* para gestionarlas. |
| 22 | **CRM → Indicadores** | Conversión por canal, NPS por profesional, retención, inasistencias, ingresos por mes y mejores clientes. |
| 23 | **Mi cuenta** (clic en su nombre arriba) | Activar **verificación en dos pasos** con Google Authenticator; ver sesiones abiertas y cerrarlas. La sesión se cierra sola tras 30 minutos sin uso. |
| 24 | **Ficha → Relación con el paciente** | Canal de origen, referidos, cumpleaños, **autorización de marketing** (se retira con un clic) y *Exportar datos del paciente* (derecho de acceso y portabilidad, Ley 21.719). |
| 25 | **CRM → Prospectos (arrastrar)** | Arrastrar una tarjeta de *Nuevo* a *Contactado*. Al arrastrar aparecen abajo *Convertir en paciente* y *Se perdió*. El borde de color indica cuánto lleva sin contacto (verde, amarillo, rojo). “Nadie se queda sin respuesta.” |
| 26 | **Ficha → Vista 360°** | Arriba de la ficha: estado (*Activo*, *En riesgo*, *Inactivo*), total comprado, atenciones, última visita, próxima cita, avance del plan y satisfacción. “Todo el paciente en un vistazo antes de atenderlo.” |
| 27 | **Ficha → Fotos clínicas** | *Registrar autorización* de fotos (distinta del consentimiento del tratamiento). *+ Subir fotos* → desde el teléfono abre la cámara. Subir una de *Antes* y otra de *Después* en la misma sesión. |
| 28 | **Comparar antes / después** | *Comparar esta sesión* → arrastrar la línea del **deslizador** sobre las dos fotos; cambiar a *Lado a lado*. Explicar: se guardan **cifradas**, solo las ve quien atiende al paciente y cada vista queda en la auditoría. |

## Qué dejar claro al cerrar
- Los datos de la demo son ficticios; en producción se parte desde cero (como pidió).
- Falta definir con ella: texto oficial de los consentimientos, listado real de servicios/precios/porcentajes, hosting y correo, y si desean WhatsApp automático (tiene costo en Meta).
- Próximos pasos: instalación en el servidor, prueba con sus datos de un mes para **conciliar comisiones con su Excel**, capacitación.

## Preguntas para Sandra
1. ¿Las comisiones se calculan sobre el valor cobrado o sobre el valor de lista del servicio?
2. ¿Hay profesionales con montos fijos o mixtos (sueldo + porcentaje)?
3. ¿Quién ingresa los cobros: cada profesional o una sola persona?
4. ¿Desea recordatorios automáticos por correo (necesita una cuenta de correo del centro)?
5. ¿Quiere que el sistema avise las inasistencias o cobre algún recargo?
