import { beforeAll, afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import os from "node:os";
import path from "node:path";

process.env.SEED_DEMO = "true";
process.env.DEMO_PASSWORD = "Test1234!";
process.env.CRON_ENABLED = "false";
process.env.DATA_DIR = path.join(os.tmpdir(), "deva-test-" + process.pid);

let app: any, db: any, hoy: () => string, sumarDias: (f: string, n: number) => string, validarRut: (r: string) => boolean;
let admin: ReturnType<typeof request.agent>, fran: ReturnType<typeof request.agent>;

async function login(user: string) {
  const a = request.agent(app);
  const r = await a.post("/api/v1/auth/login").send({ username: user, password: "Test1234!" });
  expect(r.status).toBe(200);
  return a;
}

beforeAll(async () => {
  const { createDb } = await import("../src/db.js");
  const { createApp } = await import("../src/app.js");
  const { seedBase, seedDemo } = await import("../src/seed.js");
  const util = await import("../src/util.js");
  hoy = util.hoy; sumarDias = util.sumarDias; validarRut = util.validarRut;
  db = await createDb(process.env.TEST_DATABASE_URL ? { url: process.env.TEST_DATABASE_URL } : { memory: true });
  await seedBase(db); await seedDemo(db);
  app = createApp(db);
  admin = await login("sandra"); fran = await login("fmunoz");
});
afterAll(async () => { await db.close(); });

describe("utilidades", () => {
  it("valida el RUT con dígito verificador", () => {
    expect(validarRut("11.111.111-1")).toBe(true);
    expect(validarRut("11111111-2")).toBe(false);
    expect(validarRut("12")).toBe(false);
  });
});

describe("autenticación y permisos", () => {
  it("health responde", async () => { const r = await request(app).get("/api/v1/health"); expect(r.body.status).toBe("ok"); });
  it("rechaza credenciales incorrectas", async () => {
    const r = await request(app).post("/api/v1/auth/login").send({ username: "sandra", password: "mala" });
    expect(r.status).toBe(401);
  });
  it("exige sesión", async () => { expect((await request(app).get("/api/v1/pacientes")).status).toBe(401); });
  it("un profesional no accede a usuarios ni a ventas de otros ni a auditoría", async () => {
    expect((await fran.get("/api/v1/usuarios")).status).toBe(403);
    expect((await fran.get("/api/v1/auditoria")).status).toBe(403);
    expect((await fran.get("/api/v1/seguimiento/mantencion")).status).toBe(403);
  });
  it("bloquea la cuenta tras 5 intentos fallidos", async () => {
    for (let i = 0; i < 5; i++) await request(app).post("/api/v1/auth/login").send({ username: "pcontreras", password: "x" });
    const r = await request(app).post("/api/v1/auth/login").send({ username: "pcontreras", password: "Test1234!" });
    expect(r.status).toBe(423);
  });
});

describe("pacientes y ficha", () => {
  it("rechaza RUT inválido, crea y evita duplicados", async () => {
    const base = { nombre: "Paciente Prueba", antecedentes: ["acne"] };
    expect((await admin.post("/api/v1/pacientes").send({ ...base, rut: "11.111.111-9" })).status).toBe(400);
    const ok = await admin.post("/api/v1/pacientes").send({ ...base, rut: "9.999.999-3" });
    expect(ok.status).toBe(201);
    expect((await admin.post("/api/v1/pacientes").send({ ...base, rut: "9999999-3" })).status).toBe(409);
  });
  it("un profesional solo ve pacientes que atiende", async () => {
    const lista = (await fran.get("/api/v1/pacientes")).body;
    const todos = (await admin.get("/api/v1/pacientes")).body;
    expect(lista.length).toBeGreaterThan(0); expect(lista.length).toBeLessThan(todos.length);
    const ajeno = todos.find((p: any) => !lista.some((q: any) => q.id === p.id));
    expect((await fran.get(`/api/v1/pacientes/${ajeno.id}`)).status).toBe(403);
  });
  it("firma consentimiento y genera el PDF", async () => {
    const pacs = (await admin.get("/api/v1/pacientes?q=Constanza")).body;
    expect(pacs).toHaveLength(1); expect(pacs[0].nombre).toBe("Constanza Vega");
    expect((await admin.get("/api/v1/pacientes?q=16666666")).body).toHaveLength(1);
    expect((await admin.get("/api/v1/pacientes?q=zzzz")).body).toHaveLength(0);
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const c = await admin.post(`/api/v1/pacientes/${pacs[0].id}/consentimientos`).send({ tratamiento: "Limpieza facial", firma: png });
    expect(c.status).toBe(201);
    const pdf = await admin.get(`/api/v1/consentimientos/${c.body.id}/pdf`);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect(pdf.body.slice(0, 4).toString()).toBe("%PDF");
  });
});

describe("agenda, plan de sesiones y estados", () => {
  let ids: any = {};
  beforeAll(async () => {
    const [pr, sv, bx, pc] = await Promise.all(["profesionales", "servicios", "boxes", "pacientes?q=Sofía"].map(async (x) => (await admin.get(`/api/v1/${x}`)).body));
    ids = { fran: pr.find((p: any) => p.nombre.startsWith("Francisca")).id, dani: pr.find((p: any) => p.nombre.startsWith("Daniela")).id, laser: sv.find((s: any) => s.nombre === "Depilación láser").id, eval: sv.find((s: any) => s.nombre === "Evaluación estética facial").id, box1: bx[0].id, box2: bx[1].id, box3: bx[2].id, sofia: pc[0].id, otra: (await admin.get("/api/v1/pacientes?q=Constanza")).body[0].id };
  });
  const f = () => sumarDias(hoy(), 20);

  it("impide dobles reservas de profesional y de box", async () => {
    const base = { paciente_id: ids.sofia, servicio_id: ids.eval, fecha: f(), hora: "10:00", duracion_min: 60, profesional_id: ids.fran, box_id: ids.box1 };
    expect((await admin.post("/api/v1/citas").send(base)).status).toBe(201);
    const p = await admin.post("/api/v1/citas").send({ ...base, box_id: ids.box2, hora: "10:30" });
    expect(p.status).toBe(409); expect(p.body.code).toBe("CONFLICTO_PROFESIONAL");
    const pac = await admin.post("/api/v1/citas").send({ ...base, profesional_id: ids.dani, box_id: ids.box2, hora: "10:30" });
    expect(pac.status).toBe(409); expect(pac.body.code).toBe("CONFLICTO_PACIENTE");   // el paciente no puede estar en dos citas a la vez
    const b = await admin.post("/api/v1/citas").send({ ...base, paciente_id: ids.otra, profesional_id: ids.dani, hora: "10:30" });
    expect(b.status).toBe(409); expect(b.body.code).toBe("CONFLICTO_BOX");
    expect((await admin.post("/api/v1/citas").send({ ...base, profesional_id: ids.dani, box_id: ids.box2, hora: "11:00" })).status).toBe(201);
  });

  it("controla el N° de sesiones del plan y su avance", async () => {
    const pl = await admin.post(`/api/v1/pacientes/${ids.sofia}/planes`).send({ servicio_id: ids.laser, sesiones_total: 2, origen: "EVALUACION" });
    expect(pl.status).toBe(201);
    const mk = (hora: string, extra: any = {}) => admin.post("/api/v1/citas").send({ paciente_id: ids.sofia, servicio_id: ids.laser, profesional_id: ids.fran, box_id: ids.box3, fecha: sumarDias(f(), 1), hora, plan_id: pl.body.id, ...extra });
    const c1 = await mk("09:00"), c2 = await mk("10:00");
    expect([c1.body.nro_sesion, c2.body.nro_sesion]).toEqual([1, 2]);
    const c3 = await mk("11:00"); expect(c3.status).toBe(409); expect(c3.body.code).toBe("PLAN_EXCEDIDO");
    expect((await mk("11:00", { forzar: true })).body.nro_sesion).toBe(3);
    await admin.post(`/api/v1/citas/${c1.body.id}/estado`).send({ estado: "REALIZADA" });
    await admin.post(`/api/v1/citas/${c2.body.id}/estado`).send({ estado: "REALIZADA" });
    let plan = (await admin.get(`/api/v1/pacientes/${ids.sofia}`)).body.planes.find((p: any) => p.id === pl.body.id);
    expect([plan.sesiones_realizadas, plan.estado]).toEqual([2, "COMPLETADO"]);
    await admin.post(`/api/v1/citas/${c2.body.id}/estado`).send({ estado: "AGENDADA" });
    plan = (await admin.get(`/api/v1/pacientes/${ids.sofia}`)).body.planes.find((p: any) => p.id === pl.body.id);
    expect([plan.sesiones_realizadas, plan.estado]).toEqual([1, "ACTIVO"]);
  });

  it("reprograma respetando disponibilidad y deja historial", async () => {
    const c = await admin.post("/api/v1/citas").send({ paciente_id: ids.sofia, servicio_id: ids.eval, profesional_id: ids.dani, box_id: ids.box2, fecha: sumarDias(f(), 5), hora: "15:00" });
    const mov = await admin.patch(`/api/v1/citas/${c.body.id}`).send({ hora: "16:00" });
    expect(mov.status).toBe(200); expect(mov.body.hora).toBe("16:00");
    const h = (await admin.get(`/api/v1/citas/${c.body.id}/historial`)).body;
    expect(h.map((x: any) => x.accion)).toEqual(["CREADA", "REPROGRAMADA"]);
  });

  it("un profesional no puede cambiar la cita de otro", async () => {
    const hoyCitas = (await admin.get(`/api/v1/citas?fecha=${hoy()}`)).body;
    const ajena = hoyCitas.find((c: any) => c.profesional_id !== (undefined as any) && c.profesional !== "Francisca Muñoz");
    expect((await fran.post(`/api/v1/citas/${ajena.id}/estado`).send({ estado: "CANCELADA" })).status).toBe(403);
    const propias = (await fran.get(`/api/v1/citas?fecha=${hoy()}`)).body;
    expect(propias.every((c: any) => c.profesional === "Francisca Muñoz")).toBe(true);
  });

  it("registra la evolución de la sesión", async () => {
    const c = (await fran.get(`/api/v1/citas?fecha=${hoy()}`)).body[0];
    expect((await fran.post(`/api/v1/citas/${c.id}/evolucion`).send({ observaciones: "Buena respuesta al tratamiento" })).status).toBe(201);
  });
});

describe("ventas y comisiones", () => {
  it("calcula la comisión por porcentaje y evita cobros duplicados", async () => {
    const mes = hoy().slice(0, 7);
    const antes = (await admin.get(`/api/v1/comisiones?mes=${mes}`)).body.resumen.find((x: any) => x.nombre.startsWith("Francisca"));
    const [pr, sv, bx, pc] = await Promise.all(["profesionales", "servicios", "boxes", "pacientes?q=Sofía"].map(async (x) => (await admin.get(`/api/v1/${x}`)).body));
    const cita = await admin.post("/api/v1/citas").send({ paciente_id: pc[0].id, servicio_id: sv.find((s: any) => s.nombre === "Evaluación corporal").id, profesional_id: pr.find((p: any) => p.nombre.startsWith("Francisca")).id, box_id: bx[0].id, fecha: hoy(), hora: "20:00" });
    await admin.post(`/api/v1/citas/${cita.body.id}/estado`).send({ estado: "REALIZADA" });
    const v = await admin.post("/api/v1/ventas").send({ cita_id: cita.body.id, medio_pago: "EFECTIVO" });
    expect(v.status).toBe(201); expect(v.body.monto).toBe(20000);
    expect((await admin.post("/api/v1/ventas").send({ cita_id: cita.body.id, medio_pago: "EFECTIVO" })).status).toBe(409);
    const despues = (await admin.get(`/api/v1/comisiones?mes=${mes}`)).body.resumen.find((x: any) => x.nombre.startsWith("Francisca"));
    expect(despues.comision - antes.comision).toBe(8000);   // 40% de $20.000
    expect(despues.ventas - antes.ventas).toBe(20000);
    const propia = (await fran.get(`/api/v1/comisiones?mes=${mes}`)).body.resumen;
    expect(propia).toHaveLength(1);
  });

  it("no calcula comisión a profesionales con otro tipo de contrato", async () => {
    const r = (await admin.get(`/api/v1/comisiones?mes=${hoy().slice(0, 7)}`)).body.resumen.find((x: any) => x.contrato === "OTRO");
    expect(r.comision).toBe(0);
  });

  it("exporta comisiones a Excel", async () => {
    const r = await admin.get(`/api/v1/comisiones/export?mes=${hoy().slice(0, 7)}`).buffer(true).parse((res, cb) => { const d: Buffer[] = []; res.on("data", (c) => d.push(c)); res.on("end", () => cb(null, Buffer.concat(d))); });
    expect(r.headers["content-type"]).toContain("spreadsheetml");
    expect(r.body.slice(0, 2).toString()).toBe("PK");
  });
});

describe("seguimiento y panel", () => {
  it("genera recordatorios de forma idempotente", async () => {
    const a = await admin.post("/api/v1/seguimiento/recordatorios/generar").send({});
    const b = await admin.post("/api/v1/seguimiento/recordatorios/generar").send({});
    expect(a.body.notificaciones_creadas).toBeGreaterThan(0);
    expect(b.body.notificaciones_creadas).toBe(0);
    const l = (await admin.get("/api/v1/seguimiento/recordatorios")).body;
    expect(l.items[0].wa_link).toContain("https://wa.me/56");
  });
  it("lista pacientes por contactar para mantención", async () => {
    const m = (await admin.get("/api/v1/seguimiento/mantencion")).body;
    expect(Array.isArray(m)).toBe(true);
    expect(m.some((x: any) => x.servicio === "Limpieza facial profunda")).toBe(true);
  });
  it("entrega el panel según el rol", async () => {
    const a = (await admin.get("/api/v1/reportes/dashboard")).body, p = (await fran.get("/api/v1/reportes/dashboard")).body;
    expect(a.rol).toBe("ADMIN"); expect(a.pacientes).toBeGreaterThan(5);
    expect(p.rol).toBe("PROFESIONAL"); expect(p).not.toHaveProperty("ventas_mes");
  });
  it("registra auditoría de accesos a fichas", async () => {
    const a = (await admin.get("/api/v1/auditoria?limit=200")).body;
    expect(a.some((x: any) => x.accion === "VER_FICHA")).toBe(true);
  });
});
