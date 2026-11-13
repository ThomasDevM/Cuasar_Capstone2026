# Prototipo v0.2

Prototipo navegable con **datos demo** (localStorage). No es el sistema final.

Incluye: login demostrativo con perfil, panel con métricas, ficha de ingreso (RUT validado, consentimiento con firma), agenda (estados, pago, nueva cita sin dobles reservas) y comisiones (cálculo y exportación CSV).

Cambios respecto a v0.1: se corrige el `DOMContentLoaded` anidado que dejaba la agenda vacía, se usan fechas locales y se elimina `innerHTML` con datos.
