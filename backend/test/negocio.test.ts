import { beforeAll, afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import os from "node:os";
import path from "node:path";

process.env.SEED_DEMO = "true"; process.env.DEMO_PASSWORD = "Test1234!"; process.env.CRON_ENABLED = "false";
process.env.DATA_DIR = path.join(os.tmpdir(), "deva-test2-" + process.pid);

let app: any, db: any, hoy: () => string, sumarDias: (f: string, n: number) => string;
let admin: ReturnType<typeof request.agent>, fran: ReturnType<typeof request.agent>;
let ids: any = {};
const login = async (u: string) => { const a = request.agent(app); expect((await a.post("/api/v1/auth/login").send({ username: u, password: "Test1234!" })).status).toBe(200); return a; };
const bin = (res: any, cb: any) => { const d: Buffer[] = []; res.on("data", (c: Buffer) => d.push(c)); res.on("end", () => cb(null, Buffer.concat(d))); };

beforeAll(async () => {
  const { createDb } = await import("../src/db.js"); const { createApp } = await import("../src/app.js"); const { seedBase, seedDemo } = await import("../src/seed.js"); const u = await import("../src/util.js");
  hoy = u.hoy; sumarDias = u.sumarDias;
  db = await createDb(process.env.TEST_DATABASE_URL ? { url: process.env.TEST_DATABASE_URL.replace(/\/(\w+)$/, "/$1_b") } : { memory: true });
  await seedBase(db); await seedDemo(db); app = createApp(db);
  admin = await login("sandra"); fran = await login("fmunoz");
  const g = async (x: string) => (await admin.get(`/api/v1/${x}`)).body;
  const [pr, sv, bx, pc] = await Promise.all([g("profesionales"), g("servicios"), g("boxes"), g("pacientes?q=Sofía")]);
  ids = { fran: pr.find((p: any) => p.nombre.startsWith("Francisca")).id, dani: pr.find((p: any) => p.nombre.startsWith("Daniela")).id, marce: pr.find((p: any) => p.nombre.startsWith("Marcela")).id,
    eval: sv.find((s: any) => s.nombre === "Evaluación corporal").id, limp: sv.find((s: any) => s.nombre === "Limpieza facial profunda").id, laser: sv.find((s: any) => s.nombre === "Depilación láser").id, box1: bx[0].id, box2: bx[1].id, sofia: pc[0].id };
});
afterAll(async () => { await db.close(); });
const dia = () => sumarDias(hoy(), 40);
const crear = (o: any = {}) => admin.post("/api/v1/citas").send({ paciente_id: ids.sofia, servicio_id: ids.eval, profesional_id: ids.fran, box_id: ids.box1, fecha: dia(), hora: "09:00", ...o });

describe("agenda: editar y eliminar", () => {
  it("edita servicio, notas, duración y box de una cita", async () => {
    const c = (await crear({ hora: "10:00" })).body;
    const r = await admin.patch(`/api/v1/citas/${c.id}`).send({ servicio_id: ids.limp, notas: "Llega con piel sensible", duracion_min: 60, box_id: ids.box2 });
    expect(r.status).toBe(200);
    expect([r.body.servicio, r.body.notas, r.body.fin_min - r.body.inicio_min, r.body.box]).toEqual(["Limpieza facial profunda", "Llega con piel sensible", 60, "Box 2"]);
  });
  it("al cambiar a un servicio por plan asigna plan y sesión", async () => {
    const c = (await crear({ hora: "11:00" })).body;
    const r = await admin.patch(`/api/v1/citas/${c.id}`).send({ servicio_id: ids.laser });
    expect(r.body.plan_id).not.toBeNull(); expect(r.body.nro_sesion).toBeGreaterThanOrEqual(1);
  });
  it("elimina una cita libre; con cobro o evolución exige anular o cancelar", async () => {
    const libre = (await crear({ hora: "12:00" })).body;
    expect((await admin.delete(`/api/v1/citas/${libre.id}`)).status).toBe(200);
    const conCobro = (await crear({ hora: "13:00" })).body;
    await admin.post(`/api/v1/citas/${conCobro.id}/estado`).send({ estado: "REALIZADA" });
    const venta = await admin.post("/api/v1/ventas").send({ cita_id: conCobro.id, medio_pago: "EFECTIVO" });
    const bloq = await admin.delete(`/api/v1/citas/${conCobro.id}`); expect(bloq.status).toBe(409); expect(bloq.body.code).toBe("TIENE_COBRO");
    await admin.delete(`/api/v1/ventas/${venta.body.id}`);
    await admin.post(`/api/v1/citas/${conCobro.id}/evolucion`).send({ observaciones: "Sesión realizada sin incidentes" });
    expect((await admin.delete(`/api/v1/citas/${conCobro.id}`)).body.code).toBe("TIENE_EVOLUCION");
  });
  it("eliminar una atención realizada sin datos devuelve la sesión al plan", async () => {
    const pl = (await admin.post(`/api/v1/pacientes/${ids.sofia}/planes`).send({ servicio_id: ids.laser, sesiones_total: 4 })).body;
    const c = (await crear({ servicio_id: ids.laser, hora: "14:00", plan_id: pl.id })).body;
    await admin.post(`/api/v1/citas/${c.id}/estado`).send({ estado: "REALIZADA" });
    const antes = (await admin.get(`/api/v1/pacientes/${ids.sofia}`)).body.planes.find((p: any) => p.id === pl.id).sesiones_realizadas;
    await admin.delete(`/api/v1/citas/${c.id}`);
    const despues = (await admin.get(`/api/v1/pacientes/${ids.sofia}`)).body.planes.find((p: any) => p.id === pl.id).sesiones_realizadas;
    expect([antes, despues]).toEqual([1, 0]);
  });
  it("un profesional solo elimina sus citas agendadas", async () => {
    const ajena = (await crear({ profesional_id: ids.dani, box_id: ids.box2, hora: "15:00" })).body;
    expect((await fran.delete(`/api/v1/citas/${ajena.id}`)).status).toBe(403);
    const propia = (await fran.post("/api/v1/citas").send({ paciente_id: ids.sofia, servicio_id: ids.eval, profesional_id: ids.fran, box_id: ids.box1, fecha: dia(), hora: "16:00" })).body;
    expect((await fran.delete(`/api/v1/citas/${propia.id}`)).status).toBe(200);
  });
});

describe("división de ganancias por profesional", () => {
  it("separa comisión del profesional y ganancia del centro", async () => {
    const mes = hoy().slice(0, 7);
    const ant = (await admin.get(`/api/v1/comisiones?mes=${mes}`)).body;
    const c = (await crear({ fecha: hoy(), hora: "21:00" })).body;
    await admin.post(`/api/v1/citas/${c.id}/estado`).send({ estado: "REALIZADA" });
    await admin.post("/api/v1/ventas").send({ cita_id: c.id, medio_pago: "DEBITO" });   // $20.000 con Francisca (40%)
    const des = (await admin.get(`/api/v1/comisiones?mes=${mes}`)).body;
    const f = (x: any) => x.resumen.find((r: any) => r.nombre.startsWith("Francisca"));
    expect(f(des).comision - f(ant).comision).toBe(8000);
    expect(f(des).centro - f(ant).centro).toBe(12000);
    expect(des.total_centro - ant.total_centro).toBe(12000);
    f(des).ventas === f(des).comision + f(des).centro;
    expect(f(des).ventas).toBe(f(des).comision + f(des).centro);
  });
  it("si cambia quien atendió, la ganancia se traslada al profesional correcto", async () => {
    const mes = hoy().slice(0, 7);
    const c = (await crear({ fecha: hoy(), hora: "22:00" })).body;
    await admin.post(`/api/v1/citas/${c.id}/estado`).send({ estado: "REALIZADA" });
    await admin.post("/api/v1/ventas").send({ cita_id: c.id, medio_pago: "EFECTIVO" });
    const get = async () => (await admin.get(`/api/v1/comisiones?mes=${mes}`)).body.resumen;
    const a = await get();
    const r = await admin.patch(`/api/v1/citas/${c.id}`).send({ profesional_id: ids.dani });   // Daniela: 30%
    expect(r.status).toBe(200);
    const b = await get(); const por = (x: any[], n: string) => x.find((p) => p.nombre.startsWith(n));
    expect(por(b, "Francisca").comision - por(a, "Francisca").comision).toBe(-8000);
    expect(por(b, "Daniela").comision - por(a, "Daniela").comision).toBe(6000);
    expect(por(b, "Daniela").centro - por(a, "Daniela").centro).toBe(14000);
    // un profesional no puede corregir una atención ya registrada
    expect((await fran.patch(`/api/v1/citas/${c.id}`).send({ profesional_id: ids.fran })).status).toBe(403);
  });
  it("profesional sin porcentaje: todo el ingreso queda para el centro", async () => {
    const c = (await crear({ fecha: hoy(), hora: "23:00", profesional_id: ids.marce, box_id: ids.box2 })).body;
    await admin.post(`/api/v1/citas/${c.id}/estado`).send({ estado: "REALIZADA" });
    await admin.post("/api/v1/ventas").send({ cita_id: c.id, medio_pago: "EFECTIVO" });
    const m = (await admin.get(`/api/v1/comisiones?mes=${hoy().slice(0, 7)}`)).body.resumen.find((r: any) => r.nombre.startsWith("Marcela"));
    expect(m.comision).toBe(0); expect(m.centro).toBe(m.ventas);
  });
  it("edita una venta (medio de pago y boleta) y deja auditoría", async () => {
    const v = (await admin.get(`/api/v1/ventas?mes=${hoy().slice(0, 7)}`)).body.ventas[0];
    const r = await admin.patch(`/api/v1/ventas/${v.id}`).send({ medio_pago: "TRANSFERENCIA", nro_boleta: "55555" });
    expect([r.body.medio_pago, r.body.nro_boleta]).toEqual(["TRANSFERENCIA", "55555"]);
    expect((await admin.get("/api/v1/auditoria?limit=50")).body.some((a: any) => a.accion === "EDITAR_VENTA")).toBe(true);
    expect((await fran.patch(`/api/v1/ventas/${v.id}`).send({ monto: 1 })).status).toBe(403);
  });
});

describe("historial y seguimiento del paciente", () => {
  it("registra notas, indicaciones y controles, y los devuelve en la ficha", async () => {
    const s1 = await admin.post(`/api/v1/pacientes/${ids.sofia}/seguimientos`).send({ tipo: "LLAMADA", texto: "Se llamó para consultar evolución; refiere mejoría." });
    expect(s1.status).toBe(201);
    expect((await admin.post(`/api/v1/pacientes/${ids.sofia}/seguimientos`).send({ tipo: "CONTROL", texto: "Control de evolución" })).status).toBe(400);
    const c = await admin.post(`/api/v1/pacientes/${ids.sofia}/seguimientos`).send({ tipo: "CONTROL", texto: "Control de evolución en 2 semanas", proximo_control: sumarDias(hoy(), 3) });
    const det = (await admin.get(`/api/v1/pacientes/${ids.sofia}`)).body;
    expect(det.seguimientos.map((s: any) => s.tipo)).toEqual(expect.arrayContaining(["LLAMADA", "CONTROL"]));
    const pend = (await admin.get("/api/v1/seguimiento/controles")).body;
    expect(pend.some((x: any) => x.id === c.body.id && x.wa_link.startsWith("https://wa.me/"))).toBe(true);
    await admin.patch(`/api/v1/seguimientos/${c.body.id}`).send({ control_resuelto: true });
    expect((await admin.get("/api/v1/seguimiento/controles")).body.some((x: any) => x.id === c.body.id)).toBe(false);
  });
  it("un profesional solo modifica sus propios registros", async () => {
    const paciente = (await fran.get("/api/v1/pacientes")).body[0].id;
    const mio = (await fran.post(`/api/v1/pacientes/${paciente}/seguimientos`).send({ tipo: "NOTA", texto: "Nota del profesional" })).body;
    expect((await admin.patch(`/api/v1/seguimientos/${mio.id}`).send({ texto: "Corregido por Dirección" })).status).toBe(200);
    const ajeno = (await admin.post(`/api/v1/pacientes/${paciente}/seguimientos`).send({ tipo: "NOTA", texto: "Nota de Dirección" })).body;
    expect((await fran.delete(`/api/v1/seguimientos/${ajeno.id}`)).status).toBe(403);
  });
  it("guarda versiones anteriores de la ficha al editarla", async () => {
    const p = (await admin.get(`/api/v1/pacientes/${ids.sofia}`)).body;
    const body = { nombre: p.nombre, rut: p.rut, edad: 27, celular: p.celular, email: p.email, motivo: "Control", antecedentes: ["acne"], medicamentos: "Isotretinoína", otras: null };
    expect((await admin.put(`/api/v1/pacientes/${ids.sofia}`).send(body)).status).toBe(200);
    expect((await admin.put(`/api/v1/pacientes/${ids.sofia}`).send(body)).status).toBe(200);   // sin cambios: no duplica
    const det = (await admin.get(`/api/v1/pacientes/${ids.sofia}`)).body;
    expect(det.versiones).toHaveLength(1);
    expect(det.versiones[0].datos.antecedentes).toEqual([]); expect(det.medicamentos).toBe("Isotretinoína");
  });
  it("muestra en una cita futura lo realizado antes (evolución previa)", async () => {
    const c = (await crear({ fecha: hoy(), hora: "08:00" })).body;
    await admin.post(`/api/v1/citas/${c.id}/estado`).send({ estado: "REALIZADA" });
    await admin.post(`/api/v1/citas/${c.id}/evolucion`).send({ observaciones: "Se aplicó mascarilla calmante", recomendaciones: "Evitar sol 48 horas" });
    const det = (await admin.get(`/api/v1/pacientes/${ids.sofia}`)).body;
    const prev = det.citas.find((x: any) => x.id === c.id);
    expect([prev.observaciones, prev.recomendaciones]).toEqual(["Se aplicó mascarilla calmante", "Evitar sol 48 horas"]);
  });
  it("descarga el historial clínico completo en PDF", async () => {
    const r = await admin.get(`/api/v1/pacientes/${ids.sofia}/historial.pdf`).buffer(true).parse(bin);
    expect(r.headers["content-type"]).toContain("application/pdf"); expect(r.body.slice(0, 4).toString()).toBe("%PDF");
  });
  it("archiva un paciente solo si no tiene citas futuras", async () => {
    const nuevo = (await admin.post("/api/v1/pacientes").send({ nombre: "Paciente Temporal", rut: "7.654.321-6", antecedentes: [] })).body;
    expect((await admin.post(`/api/v1/pacientes/${nuevo.id}/archivar`)).status).toBe(200);
    expect((await admin.get("/api/v1/pacientes?q=Temporal")).body).toHaveLength(0);
    expect((await admin.post(`/api/v1/pacientes/${ids.sofia}/archivar`)).status).toBe(409);
  });
});
