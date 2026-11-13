import { beforeAll, afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import os from "node:os";
import path from "node:path";
import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";

process.env.SEED_DEMO = "true"; process.env.DEMO_PASSWORD = "Test1234!"; process.env.CRON_ENABLED = "false";
process.env.DATA_DIR = path.join(os.tmpdir(), "deva-test3-" + process.pid);

let app: any, db: any, hoy: () => string, sumarDias: (f: string, n: number) => string, tareas: any;
let admin: ReturnType<typeof request.agent>, fran: ReturnType<typeof request.agent>;
let ids: any = {}; const correos: any[] = []; let smtp: SMTPServer, puerto = 0;
const login = async (u: string, p = "Test1234!") => { const a = request.agent(app); const r = await a.post("/api/v1/auth/login").send({ username: u, password: p }); expect(r.status).toBe(200); return a; };
const bin = (res: any, cb: any) => { const d: Buffer[] = []; res.on("data", (c: Buffer) => d.push(c)); res.on("end", () => cb(null, Buffer.concat(d))); };
const esperar = async (fn: () => boolean, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
const lejos = (n = 70) => sumarDias(hoy(), n);

beforeAll(async () => {
  const { createDb } = await import("../src/db.js"); const { createApp } = await import("../src/app.js"); const { seedBase, seedDemo } = await import("../src/seed.js"); const u = await import("../src/util.js");
  tareas = await import("../src/tareas.js"); hoy = u.hoy; sumarDias = u.sumarDias;
  db = await createDb(process.env.TEST_DATABASE_URL ? { url: process.env.TEST_DATABASE_URL.replace(/\/(\w+)$/, "/$1_c") } : { memory: true });
  await seedBase(db); await seedDemo(db); app = createApp(db);
  admin = await login("sandra"); fran = await login("fmunoz");
  smtp = new SMTPServer({ authOptional: true, disabledCommands: ["STARTTLS"], onData(stream, _s, cb) { simpleParser(stream).then((m) => { correos.push(m); cb(); }).catch(cb); } });
  await new Promise<void>((r) => smtp.listen(0, "127.0.0.1", () => r())); puerto = (smtp.server.address() as any).port;
  const g = async (x: string) => (await admin.get(`/api/v1/${x}`)).body;
  const [pr, sv, bx, pc] = await Promise.all([g("profesionales"), g("servicios"), g("boxes"), g("pacientes?q=Sofía")]);
  ids = { fran: pr.find((p: any) => p.nombre.startsWith("Francisca")).id, dani: pr.find((p: any) => p.nombre.startsWith("Daniela")).id,
    eval: sv.find((s: any) => s.nombre === "Evaluación estética facial").id, lipe: sv.find((s: any) => s.nombre === "Tratamiento de lipedema").id, box1: bx[0].id, box2: bx[1].id, box3: bx[2].id, sofia: pc[0].id, camila: (await g("pacientes?q=Camila"))[0].id };
});
afterAll(async () => { smtp.close(); await db.close(); });
const cita = (o: any = {}) => admin.post("/api/v1/citas").send({ paciente_id: ids.sofia, servicio_id: ids.eval, profesional_id: ids.fran, box_id: ids.box1, fecha: lejos(), hora: "10:00", ...o });

describe("agenda en bloques de 30 minutos", () => {
  it("solo acepta horarios :00 o :30 y duraciones múltiplos de 30", async () => {
    const mala = await cita({ hora: "10:15" }); expect(mala.status).toBe(400); expect(mala.body.code).toBe("FUERA_DE_BLOQUE");
    const dur = await cita({ hora: "10:00", duracion_min: 45 }); expect(dur.status).toBe(400); expect(dur.body.code).toBe("DURACION_INVALIDA");
  });
  it("usa 30 minutos por defecto y la duración del tratamiento si es mayor", async () => {
    const a = (await cita({ hora: "09:00" })).body; expect(a.fin_min - a.inicio_min).toBe(30);
    const b = (await cita({ hora: "11:00", servicio_id: ids.lipe })).body; expect(b.fin_min - b.inicio_min).toBe(60);
  });
  it("no permite dos citas del mismo profesional en el mismo bloque, pero sí en el siguiente", async () => {
    expect((await cita({ hora: "14:00" })).status).toBe(201);
    const dup = await cita({ hora: "14:00", paciente_id: ids.camila, box_id: ids.box2 });
    expect(dup.status).toBe(409); expect(dup.body.code).toBe("CONFLICTO_PROFESIONAL");
    expect((await cita({ hora: "14:30", paciente_id: ids.camila, box_id: ids.box2 })).status).toBe(201);
  });
  it("informa los bloques libres de un profesional", async () => {
    const d = (await admin.get(`/api/v1/citas/disponibilidad?fecha=${lejos()}&profesional_id=${ids.fran}`)).body;
    const por = (h: string) => d.slots.find((s: any) => s.hora === h);
    expect(d.slots[0].hora).toBe("09:00"); expect(por("09:00").libre).toBe(false); expect(por("09:30").libre).toBe(true);
    expect(por("14:00").motivo).toBe("profesional ocupado"); expect(por("09:30").boxes_libres.length).toBeGreaterThan(0);
    expect(por("11:30").libre).toBe(false);   // el lipedema dura 60 min: 11:00-12:00
    const largo = (await admin.get(`/api/v1/citas/disponibilidad?fecha=${lejos()}&profesional_id=${ids.fran}&duracion_min=60`)).body;
    expect(largo.slots.find((s: any) => s.hora === "09:30").libre).toBe(true); expect(largo.slots.find((s: any) => s.hora === "10:30").libre).toBe(false);   // 10:30-11:30 choca con el lipedema de 11:00
  });
  it("indica la fecha de la última atención en cada cita", async () => {
    const c = (await admin.get(`/api/v1/citas?fecha=${hoy()}`)).body[0];
    expect(c).toHaveProperty("ultima_atencion");
  });
});

describe("catálogos: enfermedades, tratamientos y boxes", () => {
  it("crea enfermedades, evita duplicados y solo Dirección puede administrarlas", async () => {
    const e = await admin.post("/api/v1/enfermedades").send({ nombre: "Hipotiroidismo" }); expect(e.status).toBe(201);
    expect((await admin.post("/api/v1/enfermedades").send({ nombre: "Hipotiroidismo" })).status).toBe(409);
    expect((await fran.post("/api/v1/enfermedades").send({ nombre: "Otra" })).status).toBe(403);
    expect((await fran.get("/api/v1/enfermedades")).body.some((x: any) => x.nombre === "Hipotiroidismo")).toBe(true);
    await admin.patch(`/api/v1/enfermedades/${e.body.id}`).send({ activo: false });
    expect((await admin.get("/api/v1/enfermedades")).body.find((x: any) => x.id === e.body.id).activo).toBe(false);
  });
  it("crea tratamientos y modifica su precio sin alterar cobros anteriores", async () => {
    const t = await admin.post("/api/v1/servicios").send({ nombre: "Peeling químico", precio: 40000, sesiones: 1, duracion_min: 30 }); expect(t.status).toBe(201);
    expect((await admin.post("/api/v1/servicios").send({ nombre: "Peeling químico", precio: 1, sesiones: 1, duracion_min: 30 })).status).toBe(409);
    expect((await admin.post("/api/v1/servicios").send({ nombre: "X largo", precio: 1, sesiones: 1, duracion_min: 45 })).status).toBe(400);
    const c1 = (await cita({ servicio_id: t.body.id, hora: "16:00" })).body; await admin.post(`/api/v1/citas/${c1.id}/estado`).send({ estado: "REALIZADA" });
    const v1 = await admin.post("/api/v1/ventas").send({ cita_id: c1.id, medio_pago: "EFECTIVO" }); expect(v1.body.monto).toBe(40000);
    expect((await admin.patch(`/api/v1/servicios/${t.body.id}`).send({ precio: 55000 })).body.precio).toBe(55000);
    const c2 = (await cita({ servicio_id: t.body.id, hora: "16:30" })).body; await admin.post(`/api/v1/citas/${c2.id}/estado`).send({ estado: "REALIZADA" });
    expect((await admin.post("/api/v1/ventas").send({ cita_id: c2.id, medio_pago: "EFECTIVO" })).body.monto).toBe(55000);
    const ventas = (await admin.get(`/api/v1/ventas?mes=${lejos().slice(0, 7)}`)).body.ventas.length + (await admin.get(`/api/v1/ventas?mes=${hoy().slice(0, 7)}`)).body.ventas.length;
    expect(ventas).toBeGreaterThan(0);
    expect((await admin.get("/api/v1/auditoria?limit=100")).body.some((a: any) => a.detalle?.includes("precio 40000→55000"))).toBe(true);
    expect((await fran.patch(`/api/v1/servicios/${t.body.id}`).send({ precio: 1 })).status).toBe(403);
  });
  it("crea y renombra boxes", async () => {
    const b = await admin.post("/api/v1/boxes").send({ nombre: "Box 4" }); expect(b.status).toBe(201);
    expect((await admin.patch(`/api/v1/boxes/${b.body.id}`).send({ nombre: "Box Láser" })).body.nombre).toBe("Box Láser");
    expect((await admin.post("/api/v1/boxes").send({ nombre: "Box Láser" })).status).toBe(409);
    expect((await fran.post("/api/v1/boxes").send({ nombre: "Box 9" })).status).toBe(403);
  });
});

describe("profesionales, cuentas y porcentajes", () => {
  let acceso: any;
  it("crea un profesional con su cuenta predeterminada y clave temporal", async () => {
    const r = await admin.post("/api/v1/profesionales").send({ nombre: "Carolina Ñuñez Pérez", especialidad: "Kinesiología", contrato: "PORCENTAJE", porcentaje: 35, acceso: {} });
    expect(r.status).toBe(201); acceso = r.body.acceso;
    expect(acceso.username).toBe("cperez"); expect(acceso.password_temporal.length).toBeGreaterThanOrEqual(8);
    const otra = await admin.post("/api/v1/profesionales").send({ nombre: "Camila Perez", contrato: "OTRO", porcentaje: 0, acceso: {} });
    expect(otra.body.acceso.username).toBe("cperez2");   // evita nombres de usuario repetidos
  });
  it("la cuenta nueva obliga a cambiar la clave antes de usar el sistema", async () => {
    const a = request.agent(app);
    const l = await a.post("/api/v1/auth/login").send({ username: acceso.username, password: acceso.password_temporal });
    expect(l.body.debe_cambiar_clave).toBe(true);
    const bloqueada = await a.get("/api/v1/pacientes"); expect(bloqueada.status).toBe(403); expect(bloqueada.body.code).toBe("CAMBIAR_CLAVE");
    expect((await a.post("/api/v1/auth/password").send({ actual: acceso.password_temporal, nueva: acceso.password_temporal })).status).toBe(400);
    expect((await a.post("/api/v1/auth/password").send({ actual: acceso.password_temporal, nueva: "ClaveNueva-2026" })).status).toBe(200);
    expect((await a.get("/api/v1/pacientes")).status).toBe(200);
    expect((await a.get("/api/v1/auth/me")).body.debe_cambiar_clave).toBe(false);
  });
  it("un profesional no puede cambiar porcentajes, crear profesionales ni ver usuarios", async () => {
    expect((await fran.patch(`/api/v1/profesionales/${ids.fran}`).send({ porcentaje: 90 })).status).toBe(403);
    expect((await fran.post("/api/v1/profesionales").send({ nombre: "Intruso", contrato: "PORCENTAJE", porcentaje: 99 })).status).toBe(403);
    expect((await fran.put(`/api/v1/profesionales/${ids.fran}/comisiones/${ids.eval}`).send({ porcentaje: 99 })).status).toBe(403);
    expect((await fran.get("/api/v1/usuarios")).status).toBe(403);
  });
  it("Dirección reinicia una clave y la cuenta vuelve a exigir cambio", async () => {
    const u = (await admin.get("/api/v1/usuarios")).body.find((x: any) => x.username === "dtorres");
    const r = (await admin.post(`/api/v1/usuarios/${u.id}/reset-clave`)).body;
    const a = request.agent(app); await a.post("/api/v1/auth/login").send({ username: "dtorres", password: r.password_temporal });
    expect((await a.get("/api/v1/citas?fecha=" + hoy())).body.code).toBe("CAMBIAR_CLAVE");
  });
  it("aplica un porcentaje especial por tratamiento y vuelve al base al quitarlo", async () => {
    const nuevoCobro = async (hora: string) => { const c = (await cita({ hora, fecha: hoy(), servicio_id: ids.eval })).body; await admin.post(`/api/v1/citas/${c.id}/estado`).send({ estado: "REALIZADA" }); return (await admin.post("/api/v1/ventas").send({ cita_id: c.id, medio_pago: "EFECTIVO" })).body; };
    expect((await admin.put(`/api/v1/profesionales/${ids.fran}/comisiones/${ids.eval}`).send({ porcentaje: 50 })).status).toBe(200);
    expect((await nuevoCobro("20:00")).porcentaje_aplicado).toBe(50);
    const lista = (await admin.get(`/api/v1/profesionales/${ids.fran}/comisiones`)).body; expect(lista.find((x: any) => x.servicio_id === ids.eval).porcentaje).toBe(50);
    await admin.delete(`/api/v1/profesionales/${ids.fran}/comisiones/${ids.eval}`);
    expect((await nuevoCobro("20:30")).porcentaje_aplicado).toBe(40);   // % base de Francisca
  });
});

describe("buscador por RUT", () => {
  it("encuentra por RUT completo, con o sin puntos y guion, y parcial", async () => {
    for (const q of ["11.111.111-1", "11111111-1", "111111111", "1111111"]) expect((await admin.get(`/api/v1/pacientes?q=${encodeURIComponent(q)}`)).body.map((p: any) => p.nombre)).toContain("Camila Rojas");
    expect((await admin.get("/api/v1/pacientes?q=99999999")).body).toHaveLength(0);
    expect((await admin.get("/api/v1/pacientes?q=16.666.666-K")).body[0].nombre).toBe("Constanza Vega");
  });
});

describe("informes y reporte semanal", () => {
  it("informa lo que se lleva cada persona en un rango de fechas", async () => {
    const g = (await admin.get(`/api/v1/informes/ganancias?desde=${hoy().slice(0, 8)}01&hasta=${hoy()}`)).body;
    expect(g.resumen.length).toBeGreaterThanOrEqual(4); expect(g.totales.ventas).toBe(g.totales.comision + g.totales.centro);
    const mia = (await fran.get(`/api/v1/informes/ganancias?desde=${hoy().slice(0, 8)}01&hasta=${hoy()}&profesional_id=${ids.dani}`)).body;
    expect(mia.resumen).toHaveLength(1); expect(mia.resumen[0].nombre).toMatch(/^Francisca/);   // un profesional solo ve lo suyo
    expect((await admin.get("/api/v1/informes/ganancias?desde=2026-12-31&hasta=2026-01-01")).status).toBe(400);
  });
  it("entrega y exporta el reporte semanal (solo Dirección)", async () => {
    const r = (await admin.get(`/api/v1/informes/semanal?fecha=${hoy()}`)).body;
    expect(r.por_dia).toHaveLength(7); expect(r.desde <= hoy() && hoy() <= r.hasta).toBe(true); expect(r.ventas_total).toBe(r.comisiones + r.ganancia_centro);
    const x = await admin.get(`/api/v1/informes/semanal/export?fecha=${hoy()}`).buffer(true).parse(bin);
    expect(x.headers["content-disposition"]).toContain("reporte_semanal_"); expect(x.body.slice(0, 2).toString()).toBe("PK");
    expect((await fran.get("/api/v1/informes/semanal")).status).toBe(403);
    expect((await fran.get("/api/v1/informes/semanal/export")).status).toBe(403);
  });
  it("exporta el informe de ganancias a Excel", async () => {
    const x = await admin.get(`/api/v1/informes/ganancias/export?desde=${hoy().slice(0, 8)}01&hasta=${hoy()}`).buffer(true).parse(bin);
    expect(x.body.slice(0, 2).toString()).toBe("PK");
  });
});

describe("avisos automáticos por correo", () => {
  it("la clave del correo se guarda cifrada y nunca se devuelve", async () => {
    const r = await admin.put("/api/v1/config").send({ smtp_host: "127.0.0.1", smtp_port: String(puerto), smtp_user: "", smtp_pass: "secreto-123", smtp_from: "Deva <avisos@deva.test>", smtp_seguro: "false", nombre_centro: "Deva Aesthetic House" });
    expect(r.status).toBe(200);
    const c = (await admin.get("/api/v1/config")).body; expect(c.smtp_pass).toBeUndefined(); expect(c.smtp_pass_configurada).toBe("true"); expect(c.smtp_host).toBe("127.0.0.1");
    const [fila] = await db.query("SELECT valor FROM config WHERE clave='smtp_pass'"); expect(fila.valor.startsWith("enc:")).toBe(true); expect(fila.valor).not.toContain("secreto");
    const prof = (await fran.get("/api/v1/config")).body; expect(prof.smtp_host).toBeUndefined();
    expect((await admin.put("/api/v1/config").send({ horario_inicio: "09:15" })).status).toBe(400);
    expect((await admin.put("/api/v1/config").send({ hora_recordatorio: "30" })).status).toBe(400);
    expect((await admin.put("/api/v1/config").send({ smtp_host: "127.0.0.1" })).status).toBe(200);   // sin clave nueva: conserva la anterior
  });
  it("envía un correo de prueba", async () => {
    const r = await admin.post("/api/v1/correo/prueba").send({ to: "sandra@deva.test" });
    expect(r.body.ok).toBe(true); expect(await esperar(() => correos.some((m) => m.to?.text === "sandra@deva.test"))).toBe(true);
    expect((await fran.post("/api/v1/correo/prueba").send({ to: "x@y.cl" })).status).toBe(403);
  });
  it("avisa al paciente al agendar, reprogramar y cancelar", async () => {
    const c = (await cita({ fecha: sumarDias(hoy(), 3), hora: "12:00" })).body;   // Sofía → sofia.demo@example.com
    expect(await esperar(() => correos.some((m) => m.to?.text === "sofia.demo@example.com" && /Confirmación/.test(m.subject)))).toBe(true);
    const conf = correos.find((m) => /Confirmación/.test(m.subject)); expect(conf.text).toContain("12:00"); expect(conf.html).toContain("Deva Aesthetic House");
    await admin.patch(`/api/v1/citas/${c.id}`).send({ hora: "12:30" });
    expect(await esperar(() => correos.some((m) => /reprogramada/.test(m.subject)))).toBe(true);
    expect(correos.find((m) => /reprogramada/.test(m.subject)).text).toContain("12:30");
    await admin.post(`/api/v1/citas/${c.id}/estado`).send({ estado: "CANCELADA" });
    expect(await esperar(() => correos.some((m) => /cancelada/.test(m.subject)))).toBe(true);
    const n = await db.query("SELECT tipo, estado FROM notificaciones WHERE cita_id=$1 AND canal='EMAIL' ORDER BY tipo", [c.id]);
    expect(n.map((x: any) => `${x.tipo}:${x.estado}`)).toEqual(["CANCELACION:ENVIADA", "CONFIRMACION:ENVIADA", "REPROGRAMACION:ENVIADA"]);
  });
  it("no envía nada si los avisos están desactivados o el paciente no tiene correo", async () => {
    const antes = correos.length;
    const sinCorreo = (await admin.get("/api/v1/pacientes?q=Andrea")).body[0];   // Andrea Silva no tiene correo
    await cita({ paciente_id: sinCorreo.id, fecha: sumarDias(hoy(), 4), hora: "10:00" });
    await admin.put("/api/v1/config").send({ email_avisos: "false" });
    await cita({ fecha: sumarDias(hoy(), 4), hora: "11:00", box_id: ids.box2, profesional_id: ids.dani });
    await new Promise((r) => setTimeout(r, 800)); expect(correos.length).toBe(antes);
    await admin.put("/api/v1/config").send({ email_avisos: "true" });
  });
  it("las tareas automáticas envían los recordatorios del día siguiente una sola vez", async () => {
    const mañana = sumarDias(hoy(), 1);
    await cita({ paciente_id: ids.camila, fecha: mañana, hora: "17:00", box_id: ids.box3 });
    const antes = correos.filter((m) => /Recordatorio/.test(m.subject)).length;
    const h1 = await tareas.ejecutarTareas(db, { fecha: hoy(), hora: 18, dow: 3 });
    expect(h1).toContain("recordatorios");
    expect(await esperar(() => correos.filter((m) => /Recordatorio/.test(m.subject)).length > antes)).toBe(true);
    expect(correos.some((m) => m.to?.text === "camila.demo@example.com" && /Recordatorio/.test(m.subject))).toBe(true);
    const total = correos.length;
    expect(await tareas.ejecutarTareas(db, { fecha: hoy(), hora: 19, dow: 3 })).toEqual([]);   // ya se ejecutó hoy
    expect(correos.length).toBe(total);
    expect(await tareas.ejecutarTareas(db, { fecha: hoy(), hora: 9, dow: 3 })).toEqual([]);
  });
  it("envía el reporte semanal a Sandra los lunes con el Excel adjunto", async () => {
    await admin.put("/api/v1/config").send({ email_informe_semanal: "sandra@deva.test" });
    expect(await tareas.ejecutarTareas(db, { fecha: hoy(), hora: 7, dow: 1 })).toEqual([]);   // antes de las 8:00
    const h = await tareas.ejecutarTareas(db, { fecha: hoy(), hora: 8, dow: 1 }); expect(h).toContain("informe_semanal");
    expect(await esperar(() => correos.some((m) => /Reporte semanal/.test(m.subject)))).toBe(true);
    const m = correos.find((x) => /Reporte semanal/.test(x.subject)); expect(m.attachments[0].filename).toMatch(/^reporte_semanal_.*\.xlsx$/); expect(m.attachments[0].content.slice(0, 2).toString()).toBe("PK");
    expect(await tareas.ejecutarTareas(db, { fecha: hoy(), hora: 9, dow: 1 })).not.toContain("informe_semanal");
  });
});
