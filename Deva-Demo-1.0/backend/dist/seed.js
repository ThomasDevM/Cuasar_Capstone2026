import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { config } from "./config.js";
import { NOMBRE_CANAL, dvRut, formatearRut, hoy, sumarDias, minutos } from "./util.js";
const TEXTO_CONSENTIMIENTO = "Declaro haber sido informado/a por el profesional tratante sobre el procedimiento a realizar, sus objetivos, posibles riesgos, efectos esperados y alternativas.\n" +
    "He tenido la oportunidad de hacer preguntas y estas fueron respondidas satisfactoriamente. Entiendo que puedo retirar mi consentimiento en cualquier momento.\n" +
    "Autorizo el tratamiento de mis datos personales y de salud para fines de mi atención clínica en Deva Aesthetic House.\n" +
    "[TEXTO DE EJEMPLO: reemplazar por el consentimiento oficial del centro desde Administración → Configuración]";
const CONFIG_BASE = {
    nombre_centro: "Deva Aesthetic House",
    version_consentimiento: "v1",
    texto_consentimiento: TEXTO_CONSENTIMIENTO,
    mensaje_recordatorio: "Hola {nombre}, te recordamos tu cita en {centro}: {fecha} a las {hora} ({servicio}). Responde CONFIRMO o avísanos si necesitas reprogramar. ¡Te esperamos!",
    enlace_encuesta: "",
    texto_marketing: "Acepto recibir de Deva Aesthetic House mensajes con novedades, promociones y recordatorios de mantención por WhatsApp o correo. Puedo retirar esta autorización en cualquier momento respondiendo BAJA o pidiéndolo en recepción.",
    pie_campanas: "Si no deseas recibir más mensajes, responde BAJA.",
};
export async function seedBase(db) {
    for (const [k, v] of Object.entries(CONFIG_BASE))
        await db.query("INSERT INTO config(clave,valor) VALUES ($1,$2) ON CONFLICT (clave) DO NOTHING", [k, v]);
    const [{ n: boxes }] = await db.query("SELECT count(*)::int AS n FROM boxes");
    if (!boxes)
        for (const b of ["Box 1", "Box 2", "Box 3"])
            await db.query("INSERT INTO boxes(nombre) VALUES ($1)", [b]);
    const [{ n: usuarios }] = await db.query("SELECT count(*)::int AS n FROM usuarios");
    if (!usuarios) {
        const pass = config.adminPassword || (config.seedDemo ? config.demoPassword : crypto.randomBytes(9).toString("base64url"));
        // Fuera de la demo, la primera clave es temporal: se exige cambiarla en el primer ingreso.
        await db.query("INSERT INTO usuarios(username,nombre,password_hash,rol,debe_cambiar_password) VALUES ($1,$2,$3,'ADMIN',$4)", [config.adminUser, "Sandra Sánchez", await bcrypt.hash(pass, 12), !config.seedDemo]);
        if (!config.adminPassword && !config.seedDemo)
            console.log(`\n[setup] Usuario administrador creado: ${config.adminUser} / ${pass}\n[setup] Guarde esta contraseña y cámbiela al ingresar.\n`);
    }
}
const PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
/** Datos ficticios para la demostración. Nunca usar con datos reales de pacientes. */
export async function seedDemo(db) {
    const [{ n }] = await db.query("SELECT count(*)::int AS n FROM pacientes");
    if (n)
        return;
    const hash = await bcrypt.hash(config.demoPassword, 10);
    const profs = [
        ["Francisca Muñoz", "Kinesiología dermatofuncional", "PORCENTAJE", 40, "Lunes a viernes mañana", "fmunoz"],
        ["Daniela Torres", "Medicina estética", "PORCENTAJE", 30, "Lunes a viernes tarde", "dtorres"],
        ["Marcela Rojas", "Kinesiología", "OTRO", 0, "Turno martes y jueves", "mrojas"],
        ["Paula Contreras", "Estética corporal", "PORCENTAJE", 35, "Turno miércoles y sábado", "pcontreras"],
    ];
    const pid = [];
    for (const [nombre, esp, contrato, pct, turnos, user] of profs) {
        const [p] = await db.query("INSERT INTO profesionales(nombre,especialidad,contrato,porcentaje,turnos) VALUES ($1,$2,$3,$4,$5) RETURNING id", [nombre, esp, contrato, pct, turnos]);
        pid.push(p.id);
        await db.query("INSERT INTO usuarios(username,nombre,password_hash,rol,profesional_id) VALUES ($1,$2,$3,'PROFESIONAL',$4)", [user, nombre, hash, p.id]);
    }
    const servs = [
        ["Evaluación estética facial", 20000, 1, null], ["Evaluación corporal", 20000, 1, null], ["Depilación láser", 30000, 6, 60],
        ["Tratamiento de lipedema", 35000, 10, 90], ["Kinesiología postoperatoria", 25000, 10, null], ["Limpieza facial profunda", 28000, 1, 45],
    ];
    const sid = [];
    for (const [nombre, precio, ses, mant] of servs) {
        const [s] = await db.query("INSERT INTO servicios(nombre,precio,sesiones,intervalo_mantencion_dias) VALUES ($1,$2,$3,$4) RETURNING id", [nombre, precio, ses, mant]);
        sid.push(s.id);
    }
    const prods = [["Protector solar SPF 50", 18900, 6, 3], ["Crema hidratante facial", 24500, 2, 3], ["Sérum vitamina C", 32000, 8, 4]];
    for (const [nombre, precio, stock, min] of prods)
        await db.query("INSERT INTO productos(nombre,precio,stock,stock_minimo) VALUES ($1,$2,$3,$4)", [nombre, precio, stock, min]);
    const [admin] = await db.query("SELECT id FROM usuarios WHERE rol='ADMIN' LIMIT 1");
    const pacs = [
        ["Camila Rojas", "11111111", 34, "+56 9 5555 0001", "camila.demo@example.com", "Evaluación estética facial", ["acne"]],
        ["Javiera Soto", "12222222", 29, "+56 9 5555 0002", "javiera.demo@example.com", "Depilación láser piernas", []],
        ["Valentina Medina", "13333333", 41, "+56 9 5555 0003", "valentina.demo@example.com", "Lipedema, derivación médica", ["resistencia_insulina", "hipertension"]],
        ["Andrea Silva", "14444444", 52, "+56 9 5555 0004", "", "Kinesiología postoperatoria", ["diabetes"]],
        ["Daniela Castro", "15555555", 37, "+56 9 5555 0005", "daniela.demo@example.com", "Evaluación corporal", []],
        ["Constanza Vega", "16666666", 31, "+56 9 5555 0006", "constanza.demo@example.com", "Limpieza facial", ["rosacea"]],
        ["Isidora Paredes", "17777777", 45, "+56 9 5555 0007", "", "Control y mantención", ["alergias"]],
        ["Sofía Herrera", "18888888", 26, "+56 9 5555 0008", "sofia.demo@example.com", "Evaluación estética facial", []],
    ];
    const paid = [];
    for (const [nombre, cuerpo, edad, cel, mail, motivo, ant] of pacs) {
        const [p] = await db.query("INSERT INTO pacientes(rut,nombre,edad,celular,email,motivo,creado_por) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id", [formatearRut(`${cuerpo}${dvRut(String(cuerpo))}`), nombre, edad, cel, mail || null, motivo, admin.id]);
        await db.query("INSERT INTO fichas(paciente_id,antecedentes,medicamentos) VALUES ($1,$2,$3)", [p.id, JSON.stringify(ant), ant.length ? "Según indicación médica" : null]);
        paid.push(p.id);
    }
    for (const i of [0, 1, 2, 3])
        await db.query("INSERT INTO consentimientos(paciente_id,tratamiento,version_texto,texto,firma,firmado_por) VALUES ($1,$2,'v1',$3,$4,$5)", [paid[i], String(pacs[i][5]), TEXTO_CONSENTIMIENTO, PNG_1PX, admin.id]);
    // Planes
    const plan = async (pi, si, total, hechas) => (await db.query("INSERT INTO planes(paciente_id,servicio_id,sesiones_total,sesiones_realizadas,origen) VALUES ($1,$2,$3,$4,$5) RETURNING id", [paid[pi], sid[si], total, hechas, pi === 2 ? "DERIVACION" : "EVALUACION"]))[0].id;
    const plLip = await plan(2, 3, 10, 3), plLaser = await plan(1, 2, 6, 2), plKine = await plan(3, 4, 10, 1);
    const hoyF = hoy();
    const cita = async (off, hora, pi, si, pri, box, estado, planId, nro, pago) => {
        const f = sumarDias(hoyF, off), ini = minutos(hora);
        const [bx] = await db.query("SELECT id FROM boxes WHERE nombre=$1", [`Box ${box}`]);
        const [c] = await db.query("INSERT INTO citas(plan_id,paciente_id,servicio_id,profesional_id,box_id,fecha,hora,inicio_min,fin_min,estado,nro_sesion,creado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id", [planId, paid[pi], sid[si], pid[pri], bx.id, f, hora, ini, ini + 60, estado, nro, admin.id]);
        if (pago) {
            const [s] = await db.query("SELECT precio FROM servicios WHERE id=$1", [sid[si]]);
            const p = profs[pri];
            await db.query("INSERT INTO ventas(fecha,paciente_id,cita_id,descripcion,monto,medio_pago,nro_boleta,vendedor_id,porcentaje_aplicado,registrada_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [f, paid[pi], c.id, String(servs[si][0]) + (nro ? ` (sesión ${nro})` : ""), s.precio, pago[0], pago[1], pid[pri], p[2] === "PORCENTAJE" ? p[3] : null, admin.id]);
        }
    };
    // Historial reciente (para comisiones y mantención)
    await cita(-45, "10:00", 5, 5, 1, 1, "REALIZADA", null, null, ["DEBITO", "10231"]);
    await cita(-12, "15:00", 7, 0, 0, 2, "REALIZADA", null, null, ["EFECTIVO", null]);
    await cita(-9, "09:00", 2, 3, 0, 1, "REALIZADA", plLip, 1, ["TRANSFERENCIA", "10302"]);
    await cita(-6, "11:00", 1, 2, 3, 2, "REALIZADA", plLaser, 1, ["CREDITO", "10315"]);
    await cita(-5, "09:00", 3, 4, 2, 3, "REALIZADA", plKine, 1, ["EFECTIVO", null]);
    await cita(-4, "16:00", 4, 1, 1, 1, "REALIZADA", null, null, ["DEBITO", "10321"]);
    await cita(-3, "10:00", 2, 3, 0, 1, "REALIZADA", plLip, 2, ["TRANSFERENCIA", "10330"]);
    await cita(-2, "12:00", 1, 2, 3, 2, "REALIZADA", plLaser, 2, ["CREDITO", "10338"]);
    await cita(-1, "09:00", 2, 3, 0, 1, "REALIZADA", plLip, 3, ["EFECTIVO", null]);
    await cita(-1, "15:30", 0, 0, 1, 2, "INASISTENCIA", null, null);
    // Hoy y mañana
    await cita(0, "09:00", 0, 5, 1, 1, "CONFIRMADA", null, null);
    await cita(0, "10:30", 1, 2, 3, 2, "AGENDADA", plLaser, 3);
    await cita(0, "11:45", 2, 3, 0, 1, "AGENDADA", plLip, 4);
    await cita(0, "15:00", 3, 4, 2, 3, "CONFIRMADA", plKine, 2);
    await cita(0, "16:30", 4, 1, 1, 1, "AGENDADA", null, null);
    await cita(1, "09:30", 6, 5, 1, 2, "AGENDADA", null, null);
    await cita(1, "11:00", 7, 0, 3, 3, "AGENDADA", null, null);
    await cita(1, "15:00", 2, 3, 0, 1, "AGENDADA", plLip, 5);
    await db.query("INSERT INTO evoluciones(cita_id,paciente_id,profesional_id,observaciones,procedimiento,recomendaciones) SELECT c.id,c.paciente_id,c.profesional_id,'Buena tolerancia al tratamiento. Sin eventos adversos.','Drenaje y presoterapia','Hidratación y control en 1 semana' FROM citas c WHERE c.nro_sesion=1 AND c.plan_id=$1", [plLip]);
    await db.query("INSERT INTO productos(nombre,precio,stock,stock_minimo) VALUES ('Mascarilla calmante',15500,1,2) ON CONFLICT DO NOTHING");
    /* ---- CRM: origen, marketing, prospectos, presupuestos y encuestas (ficticios) ---- */
    const crm = [
        ["INSTAGRAM", true, "1991-" + hoyF.slice(5, 7) + "-18", ["facial"]], ["INSTAGRAM", true, "1996-03-02", ["laser"]],
        ["DERIVACION_MEDICA", false, "1984-07-21", ["lipedema"]], ["REFERIDO", true, null, []], ["GOOGLE", true, "1988-11-30", ["corporal"]],
        ["INSTAGRAM", true, "1994-" + hoyF.slice(5, 7) + "-05", ["facial", "vip"]], ["WHATSAPP", false, null, []], ["FACEBOOK", true, "1999-01-12", ["facial"]],
    ];
    for (const [i, [canal, mkt, nac, etq]] of crm.entries())
        await db.query("UPDATE pacientes SET canal_origen=$2, acepta_marketing=$3, marketing_actualizado_en=CASE WHEN $3 THEN now() END, fecha_nacimiento=$4, etiquetas=$5 WHERE id=$1", [paid[i], canal, mkt, nac, JSON.stringify(etq)]);
    await db.query("UPDATE pacientes SET referido_por=$2 WHERE id=$1", [paid[3], paid[2]]);
    const prospectos = [
        ["Fernanda Lagos", "+56 9 5555 0101", "INSTAGRAM", sid[2], "Consulta por depilación láser de axilas y piernas", "NUEVO", 0],
        ["Catalina Núñez", "+56 9 5555 0102", "WHATSAPP", sid[0], "Quiere evaluación por manchas faciales", "NUEVO", 1],
        ["Josefina Araya", "+56 9 5555 0103", "INSTAGRAM", sid[3], "Diagnóstico de lipedema, busca tratamiento", "CONTACTADO", 2],
        ["Antonia Bravo", "+56 9 5555 0104", "GOOGLE", sid[5], "Limpieza facial antes de un evento", "EVALUACION", 3],
        ["Macarena Fuentes", "+56 9 5555 0105", "REFERIDO", sid[4], "Postoperatorio de abdominoplastia", "CONTACTADO", -1],
        ["Rocío Pizarro", "+56 9 5555 0106", "FACEBOOK", sid[2], "Preguntó precios de láser", "PERDIDO", -20],
    ];
    const prid = [];
    for (const [nombre, cel, canal, serv, interes, estado, dias] of prospectos) {
        const [s] = serv ? await db.query("SELECT precio*sesiones AS v FROM servicios WHERE id=$1", [serv]) : [{ v: null }];
        const [p] = await db.query(`INSERT INTO prospectos(nombre,celular,canal,servicio_id,interes,estado,motivo_perdida,proximo_contacto,valor_estimado,responsable_id,referido_por,acepta_marketing,creado_por,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,$10, now() - make_interval(days => $12::int)) RETURNING id`, [nombre, cel, canal, serv, interes, estado, estado === "PERDIDO" ? "Precio" : null, estado === "PERDIDO" ? null : sumarDias(hoyF, dias), s.v, admin.id, canal === "REFERIDO" ? paid[0] : null, Math.max(0, -dias) + 2]);
        prid.push(p.id);
        const dd = Math.max(0, -dias) + 2;
        await db.query("INSERT INTO prospecto_actividades(prospecto_id,tipo,texto,usuario_id,usuario_nombre,created_at) VALUES ($1,'ESTADO',$2,$3,'Sandra Sánchez', now() - make_interval(days => $4::int))", [p.id, `Prospecto ingresado (llegó por ${NOMBRE_CANAL[canal]})`, admin.id, dd]);
        if (estado !== "NUEVO")
            await db.query("INSERT INTO prospecto_actividades(prospecto_id,tipo,texto,usuario_id,usuario_nombre,created_at) VALUES ($1,'WHATSAPP',$2,$3,'Sandra Sánchez', now() - make_interval(days => $4::int))", [p.id, "Se le enviaron valores y horarios disponibles.", admin.id, Math.max(0, dd - 1)]);
    }
    // Presupuesto enviado a un prospecto y presupuesto aceptado de una paciente (su plan queda con precio pactado)
    const presupuesto = async (dest, si, ses, desc, estado) => {
        const [s] = await db.query("SELECT nombre, precio FROM servicios WHERE id=$1", [sid[si]]);
        const sub = s.precio * ses;
        const [p] = await db.query("INSERT INTO presupuestos(paciente_id,prospecto_id,fecha,validez_dias,estado,subtotal,descuento,total,creado_por,respondido_en) VALUES ($1,$2,$3,30,$4,$5,$6,$7,$8,$9) RETURNING id", [dest.paciente ?? null, dest.prospecto ?? null, sumarDias(hoyF, -3), estado, sub, desc, sub - desc, admin.id, estado === "ACEPTADO" ? new Date() : null]);
        await db.query("INSERT INTO presupuesto_items(presupuesto_id,servicio_id,descripcion,sesiones,precio_unitario,total) VALUES ($1,$2,$3,$4,$5,$6)", [p.id, sid[si], s.nombre, ses, s.precio, sub]);
    };
    await presupuesto({ prospecto: prid[3] }, 5, 3, 9000, "ENVIADO");
    await presupuesto({ prospecto: prid[2] }, 3, 10, 50000, "BORRADOR");
    await presupuesto({ paciente: paid[2] }, 3, 10, 0, "ACEPTADO");
    // Encuestas ya respondidas (los enlaces no se usan: token aleatorio descartado)
    const realizadas = await db.query("SELECT id, paciente_id, profesional_id FROM citas WHERE estado='REALIZADA' ORDER BY fecha LIMIT 6");
    const notas = [[10, "Excelente atención, muy cálida."], [9, null], [6, "Tuve que esperar 25 minutos."], [10, "¡Me encantó el resultado!"], [8, null], [9, "Muy profesional."]];
    for (const [i, c] of realizadas.entries())
        await db.query("INSERT INTO encuestas(cita_id,paciente_id,profesional_id,token_hash,puntaje,comentario,respondida_en,expira_en) VALUES ($1,$2,$3,$4,$5,$6, now() - interval '1 day', now() + interval '29 days')", [c.id, c.paciente_id, c.profesional_id, crypto.randomBytes(32).toString("hex"), notas[i][0], notas[i][1]]);
    console.log(`[demo] Datos de demostración cargados. Usuarios: ${config.adminUser} (Dirección) y fmunoz, dtorres, mrojas, pcontreras (Profesional). Clave: ${config.demoPassword}`);
}
