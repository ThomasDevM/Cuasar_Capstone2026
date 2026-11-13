import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { config } from "./config.js";
import type { Db } from "./db.js";
import { dvRut, formatearRut, hoy, sumarDias, minutos } from "./util.js";

const TEXTO_CONSENTIMIENTO =
  "Declaro haber sido informado/a por el profesional tratante sobre el procedimiento a realizar, sus objetivos, posibles riesgos, efectos esperados y alternativas.\n" +
  "He tenido la oportunidad de hacer preguntas y estas fueron respondidas satisfactoriamente. Entiendo que puedo retirar mi consentimiento en cualquier momento.\n" +
  "Autorizo el tratamiento de mis datos personales y de salud para fines de mi atención clínica en Deva Aesthetic House.\n" +
  "[TEXTO DE EJEMPLO: reemplazar por el consentimiento oficial del centro desde Administración → Configuración]";

const CONFIG_BASE: Record<string, string> = {
  nombre_centro: "Deva Aesthetic House",
  version_consentimiento: "v1",
  texto_consentimiento: TEXTO_CONSENTIMIENTO,
  mensaje_recordatorio: "Hola {nombre}, te recordamos tu cita en {centro}: {fecha} a las {hora} ({servicio}). Responde CONFIRMO o avísanos si necesitas reprogramar. ¡Te esperamos!",
  enlace_encuesta: "",
  horario_inicio: "09:00",
  horario_fin: "19:00",
  hora_recordatorio: "18",
  email_avisos: "true",
};

export async function seedBase(db: Db) {
  for (const [k, v] of Object.entries(CONFIG_BASE)) await db.query("INSERT INTO config(clave,valor) VALUES ($1,$2) ON CONFLICT (clave) DO NOTHING", [k, v]);
  const [{ n: boxes }] = await db.query("SELECT count(*)::int AS n FROM boxes");
  if (!boxes) for (const b of ["Box 1", "Box 2", "Box 3"]) await db.query("INSERT INTO boxes(nombre) VALUES ($1)", [b]);
  const [{ n: usuarios }] = await db.query("SELECT count(*)::int AS n FROM usuarios");
  if (!usuarios) {
    const pass = config.adminPassword || (config.seedDemo ? config.demoPassword : crypto.randomBytes(9).toString("base64url"));
    await db.query("INSERT INTO usuarios(username,nombre,password_hash,rol) VALUES ($1,$2,$3,'ADMIN')", [config.adminUser, "Sandra Sánchez", await bcrypt.hash(pass, 10)]);
    if (!config.adminPassword && !config.seedDemo) console.log(`\n[setup] Usuario administrador creado: ${config.adminUser} / ${pass}\n[setup] Guarde esta contraseña y cámbiela al ingresar.\n`);
  }
  // Usuario de profesional predeterminado (sin permisos de administración). Se crea una sola vez.
  const [{ n: yaInicial }] = await db.query("SELECT count(*)::int AS n FROM config WHERE clave='profesional_inicial'");
  if (!config.seedDemo && !yaInicial) {
    const [{ n: profs }] = await db.query("SELECT count(*)::int AS n FROM usuarios WHERE rol='PROFESIONAL'");
    if (!profs) {
      const pass = config.profesionalPassword || crypto.randomBytes(9).toString("base64url");
      const [p] = await db.query("INSERT INTO profesionales(nombre,contrato,porcentaje) VALUES ('Profesional 1','OTRO',0) RETURNING id");
      await db.query("INSERT INTO usuarios(username,nombre,password_hash,rol,profesional_id,debe_cambiar_clave) VALUES ($1,'Profesional 1',$2,'PROFESIONAL',$3,TRUE)", [config.profesionalUser, await bcrypt.hash(pass, 10), p.id]);
      if (!config.profesionalPassword) console.log(`\n[setup] Usuario de profesional creado: ${config.profesionalUser} / ${pass}  (debe cambiar la clave al ingresar)\n`);
    }
    await db.query("INSERT INTO config(clave,valor) VALUES ('profesional_inicial','1') ON CONFLICT (clave) DO NOTHING");
  }
}

const PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** Datos ficticios para la demostración. Nunca usar con datos reales de pacientes. */
export async function seedDemo(db: Db) {
  const [{ n }] = await db.query("SELECT count(*)::int AS n FROM pacientes");
  if (n) return;
  const hash = await bcrypt.hash(config.demoPassword, 10);
  const profs = [
    ["Francisca Muñoz", "Kinesiología dermatofuncional", "PORCENTAJE", 40, "Lunes a viernes mañana", "fmunoz"],
    ["Daniela Torres", "Medicina estética", "PORCENTAJE", 30, "Lunes a viernes tarde", "dtorres"],
    ["Marcela Rojas", "Kinesiología", "OTRO", 0, "Turno martes y jueves", "mrojas"],
    ["Paula Contreras", "Estética corporal", "PORCENTAJE", 35, "Turno miércoles y sábado", "pcontreras"],
  ];
  const pid: number[] = [];
  for (const [nombre, esp, contrato, pct, turnos, user] of profs) {
    const [p] = await db.query("INSERT INTO profesionales(nombre,especialidad,contrato,porcentaje,turnos) VALUES ($1,$2,$3,$4,$5) RETURNING id", [nombre, esp, contrato, pct, turnos]);
    pid.push(p.id);
    await db.query("INSERT INTO usuarios(username,nombre,password_hash,rol,profesional_id) VALUES ($1,$2,$3,'PROFESIONAL',$4)", [user, nombre, hash, p.id]);
  }
  const servs = [
    ["Evaluación estética facial", 20000, 1, null, 30], ["Evaluación corporal", 20000, 1, null, 30], ["Depilación láser", 30000, 6, 60, 30],
    ["Tratamiento de lipedema", 35000, 10, 90, 60], ["Kinesiología postoperatoria", 25000, 10, null, 60], ["Limpieza facial profunda", 28000, 1, 45, 60],
  ];
  const sid: number[] = [];
  for (const [nombre, precio, ses, mant, dur] of servs) {
    const [s] = await db.query("INSERT INTO servicios(nombre,precio,sesiones,intervalo_mantencion_dias,duracion_min) VALUES ($1,$2,$3,$4,$5) RETURNING id", [nombre, precio, ses, mant, dur]);
    sid.push(s.id);
  }
  await db.query("UPDATE config SET valor='https://forms.gle/ejemplo-encuesta' WHERE clave='enlace_encuesta'");

  const [admin] = await db.query("SELECT id FROM usuarios WHERE rol='ADMIN' LIMIT 1");
  const pacs: [string, string, number, string, string, string, string[]][] = [
    ["Camila Rojas", "11111111", 34, "+56 9 5555 0001", "camila.demo@example.com", "Evaluación estética facial", ["Acné"]],
    ["Javiera Soto", "12222222", 29, "+56 9 5555 0002", "javiera.demo@example.com", "Depilación láser piernas", []],
    ["Valentina Medina", "13333333", 41, "+56 9 5555 0003", "valentina.demo@example.com", "Lipedema, derivación médica", ["Resistencia a la insulina", "Hipertensión"]],
    ["Andrea Silva", "14444444", 52, "+56 9 5555 0004", "", "Kinesiología postoperatoria", ["Diabetes"]],
    ["Daniela Castro", "15555555", 37, "+56 9 5555 0005", "daniela.demo@example.com", "Evaluación corporal", []],
    ["Constanza Vega", "16666666", 31, "+56 9 5555 0006", "constanza.demo@example.com", "Limpieza facial", ["Rosácea"]],
    ["Isidora Paredes", "17777777", 45, "+56 9 5555 0007", "", "Control y mantención", ["Alergias / Dermatitis"]],
    ["Sofía Herrera", "18888888", 26, "+56 9 5555 0008", "sofia.demo@example.com", "Evaluación estética facial", []],
  ];
  const paid: number[] = [];
  for (const [nombre, cuerpo, edad, cel, mail, motivo, ant] of pacs) {
    const [p] = await db.query("INSERT INTO pacientes(rut,nombre,edad,celular,email,motivo,creado_por) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id", [formatearRut(`${cuerpo}${dvRut(String(cuerpo))}`), nombre, edad, cel, mail || null, motivo, admin.id]);
    await db.query("INSERT INTO fichas(paciente_id,antecedentes,medicamentos) VALUES ($1,$2,$3)", [p.id, JSON.stringify(ant), ant.length ? "Según indicación médica" : null]);
    paid.push(p.id);
  }
  for (const i of [0, 1, 2, 3]) await db.query("INSERT INTO consentimientos(paciente_id,tratamiento,version_texto,texto,firma,firmado_por) VALUES ($1,$2,'v1',$3,$4,$5)", [paid[i], String(pacs[i][5]), TEXTO_CONSENTIMIENTO, PNG_1PX, admin.id]);

  // Planes
  const plan = async (pi: number, si: number, total: number, hechas: number) => (await db.query("INSERT INTO planes(paciente_id,servicio_id,sesiones_total,sesiones_realizadas,origen) VALUES ($1,$2,$3,$4,$5) RETURNING id", [paid[pi], sid[si], total, hechas, pi === 2 ? "DERIVACION" : "EVALUACION"]))[0].id as number;
  const plLip = await plan(2, 3, 10, 3), plLaser = await plan(1, 2, 6, 2), plKine = await plan(3, 4, 10, 1);

  const hoyF = hoy();
  const cita = async (off: number, hora: string, pi: number, si: number, pri: number, box: number, estado: string, planId: number | null, nro: number | null, pago?: [string, string | null]) => {
    const f = sumarDias(hoyF, off), ini = minutos(hora);
    const [bx] = await db.query("SELECT id FROM boxes WHERE nombre=$1", [`Box ${box}`]);
    const [c] = await db.query("INSERT INTO citas(plan_id,paciente_id,servicio_id,profesional_id,box_id,fecha,hora,inicio_min,fin_min,estado,nro_sesion,creado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id", [planId, paid[pi], sid[si], pid[pri], bx.id, f, hora, ini, ini + (servs[si][4] as number), estado, nro, admin.id]);
    if (pago) {
      const [s] = await db.query("SELECT precio FROM servicios WHERE id=$1", [sid[si]]); const p = profs[pri];
      await db.query("INSERT INTO ventas(fecha,paciente_id,cita_id,descripcion,monto,medio_pago,nro_boleta,vendedor_id,porcentaje_aplicado,registrada_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [f, paid[pi], c.id, String(servs[si][0]) + (nro ? ` (sesión ${nro})` : ""), s.precio, pago[0], pago[1], pid[pri], p[2] === "PORCENTAJE" ? p[3] : null, admin.id]);
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
  await cita(0, "11:30", 2, 3, 0, 1, "AGENDADA", plLip, 4);
  await cita(0, "15:00", 3, 4, 2, 3, "CONFIRMADA", plKine, 2);
  await cita(0, "16:30", 4, 1, 1, 1, "AGENDADA", null, null);
  await cita(1, "09:30", 6, 5, 1, 2, "AGENDADA", null, null);
  await cita(1, "11:00", 7, 0, 3, 3, "AGENDADA", null, null);
  await cita(1, "15:00", 2, 3, 0, 1, "AGENDADA", plLip, 5);
  await db.query("INSERT INTO evoluciones(cita_id,paciente_id,profesional_id,observaciones,procedimiento,recomendaciones) SELECT c.id,c.paciente_id,c.profesional_id,'Buena tolerancia al tratamiento. Sin eventos adversos.','Drenaje y presoterapia','Hidratación y control en 1 semana' FROM citas c WHERE c.nro_sesion=1 AND c.plan_id=$1", [plLip]);
  console.log(`[demo] Datos de demostración cargados. Usuarios: ${config.adminUser} (Dirección) y fmunoz, dtorres, mrojas, pcontreras (Profesional). Clave: ${config.demoPassword}`);
}
