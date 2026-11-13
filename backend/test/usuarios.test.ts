import { beforeAll, afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import os from "node:os";
import path from "node:path";

// Instalación nueva (sin datos de demostración): lo que ve Sandra el primer día.
delete process.env.SEED_DEMO;
process.env.ADMIN_USER = "sandra"; process.env.ADMIN_PASSWORD = "Admin-Inicial-1";
process.env.PROFESIONAL_USER = "profesional"; process.env.PROFESIONAL_PASSWORD = "Prof-Inicial-1";
process.env.CRON_ENABLED = "false"; process.env.DATA_DIR = path.join(os.tmpdir(), "deva-test4-" + process.pid);

let app: any, db: any, seedBase: any;
let admin: ReturnType<typeof request.agent>;
const login = async (u: string, p: string) => { const a = request.agent(app); const r = await a.post("/api/v1/auth/login").send({ username: u, password: p }); return { a, r }; };

beforeAll(async () => {
  const { createDb } = await import("../src/db.js"); const { createApp } = await import("../src/app.js"); ({ seedBase } = await import("../src/seed.js"));
  db = await createDb(process.env.TEST_DATABASE_URL ? { url: process.env.TEST_DATABASE_URL.replace(/\/(\w+)$/, "/$1_d") } : { memory: true });
  await seedBase(db); app = createApp(db);
  admin = (await login("sandra", "Admin-Inicial-1")).a;
});
afterAll(async () => { await db.close(); });

describe("instalación nueva: usuarios iniciales", () => {
  it("crea a Sandra como Dirección y un profesional predeterminado sin permisos de administración", async () => {
    const lista = (await admin.get("/api/v1/usuarios")).body;
    expect(lista.find((u: any) => u.username === "sandra").rol).toBe("ADMIN");
    const p = lista.find((u: any) => u.username === "profesional"); expect(p.rol).toBe("PROFESIONAL"); expect(p.profesional_id).not.toBeNull(); expect(p.debe_cambiar_clave).toBe(true);
  });
  it("el profesional predeterminado debe cambiar su clave y luego no accede a administración", async () => {
    const { a, r } = await login("profesional", "Prof-Inicial-1"); expect(r.status).toBe(200); expect(r.body.debe_cambiar_clave).toBe(true);
    expect((await a.get("/api/v1/pacientes")).body.code).toBe("CAMBIAR_CLAVE");
    expect((await a.post("/api/v1/auth/password").send({ actual: "Prof-Inicial-1", nueva: "Prof-Nueva-2026" })).status).toBe(200);
    expect((await a.get("/api/v1/pacientes")).status).toBe(200);
    for (const [m, ruta] of [["get", "/api/v1/usuarios"], ["get", "/api/v1/auditoria"], ["post", "/api/v1/profesionales"], ["post", "/api/v1/servicios"], ["put", "/api/v1/config"], ["get", "/api/v1/informes/semanal"], ["post", "/api/v1/boxes"]] as const)
      expect((await (a as any)[m](ruta).send({})).status, `${m} ${ruta}`).toBe(403);
  });
  it("no se vuelve a crear el profesional al reiniciar, aunque se elimine", async () => {
    const antes = (await admin.get("/api/v1/usuarios")).body.length; await seedBase(db);
    expect((await admin.get("/api/v1/usuarios")).body).toHaveLength(antes);
  });
  it("ya no existe ninguna ruta de inventario", async () => {
    expect((await admin.get("/api/v1/productos")).status).toBe(404);
    expect((await admin.post("/api/v1/ventas").send({ producto_id: 1, medio_pago: "EFECTIVO" })).status).toBe(400);
    expect((await db.query("SELECT to_regclass('public.productos') AS t"))[0].t).toBeNull();
    const d = (await admin.get("/api/v1/reportes/dashboard")).body; expect(d).not.toHaveProperty("productos_stock_bajo");
  });
});

describe("Sandra administra los usuarios", () => {
  let profId: number, nuevoId: number, claveTemp = "";
  beforeAll(async () => { profId = (await admin.post("/api/v1/profesionales").send({ nombre: "Marta Díaz", contrato: "PORCENTAJE", porcentaje: 30 })).body.id; });

  it("crea un usuario Profesional y exige vincularlo a un profesional", async () => {
    expect((await admin.post("/api/v1/usuarios").send({ username: "mdiaz", nombre: "Marta Díaz", password: "Clave-Inicial-1", rol: "PROFESIONAL" })).status).toBe(400);
    const r = await admin.post("/api/v1/usuarios").send({ username: "mdiaz", nombre: "Marta Díaz", password: "Clave-Inicial-1", rol: "PROFESIONAL", profesional_id: profId });
    expect(r.status).toBe(201); nuevoId = r.body.id; expect(r.body.profesional).toBe("Marta Díaz");
    expect((await admin.post("/api/v1/usuarios").send({ username: "MDIAZ".toLowerCase(), nombre: "Otra", password: "Clave-Inicial-1", rol: "ADMIN" })).status).toBe(409);
    expect((await admin.post("/api/v1/usuarios").send({ username: "corta", nombre: "Otra", password: "123", rol: "ADMIN" })).status).toBe(400);
  });
  it("modifica nombre, usuario y perfil", async () => {
    const r = await admin.patch(`/api/v1/usuarios/${nuevoId}`).send({ nombre: "Marta Díaz Pérez", username: "mdiaz2" });
    expect([r.body.nombre, r.body.username]).toEqual(["Marta Díaz Pérez", "mdiaz2"]);
    expect((await login("mdiaz2", "Clave-Inicial-1")).r.status).toBe(200);
    expect((await login("mdiaz", "Clave-Inicial-1")).r.status).toBe(401);
    const adm = await admin.patch(`/api/v1/usuarios/${nuevoId}`).send({ rol: "ADMIN" }); expect(adm.body.rol).toBe("ADMIN"); expect(adm.body.profesional_id).toBeNull();
    const vuelta = await admin.patch(`/api/v1/usuarios/${nuevoId}`).send({ rol: "PROFESIONAL" }); expect(vuelta.status).toBe(400);   // falta vincular
    expect((await admin.patch(`/api/v1/usuarios/${nuevoId}`).send({ rol: "PROFESIONAL", profesional_id: profId })).body.rol).toBe("PROFESIONAL");
  });
  it("cambia la contraseña de otra persona y puede obligar a cambiarla", async () => {
    const r = await admin.patch(`/api/v1/usuarios/${nuevoId}`).send({ password: "Clave-Elegida-2", debe_cambiar_clave: false }); expect(r.body.debe_cambiar_clave).toBe(false);
    const ok = await login("mdiaz2", "Clave-Elegida-2"); expect(ok.r.status).toBe(200); expect((await ok.a.get("/api/v1/pacientes")).status).toBe(200);
    expect((await login("mdiaz2", "Clave-Inicial-1")).r.status).toBe(401);
    await admin.patch(`/api/v1/usuarios/${nuevoId}`).send({ password: "Clave-Elegida-3" });   // por defecto exige cambio
    const forz = await login("mdiaz2", "Clave-Elegida-3"); expect(forz.r.body.debe_cambiar_clave).toBe(true);
    const tmp = (await admin.post(`/api/v1/usuarios/${nuevoId}/reset-clave`)).body; expect(tmp.password_temporal.length).toBeGreaterThanOrEqual(8);
    claveTemp = tmp.password_temporal; expect((await login("mdiaz2", claveTemp)).r.status).toBe(200);
  });
  it("desactiva y reactiva una cuenta (el acceso se corta al instante)", async () => {
    const sesion = (await login("mdiaz2", claveTemp)).a;
    await admin.patch(`/api/v1/usuarios/${nuevoId}`).send({ activo: false });
    expect((await sesion.get("/api/v1/auth/me")).status).toBe(401);
    expect((await login("mdiaz2", claveTemp)).r.status).toBe(401);
    await admin.patch(`/api/v1/usuarios/${nuevoId}`).send({ activo: true });
    expect((await login("mdiaz2", claveTemp)).r.status).toBe(200);
  });
  it("protege a Dirección: no puede dejarse sin administradores ni eliminarse a sí misma", async () => {
    const yo = (await admin.get("/api/v1/usuarios")).body.find((u: any) => u.username === "sandra").id;
    expect((await admin.patch(`/api/v1/usuarios/${yo}`).send({ activo: false })).status).toBe(400);
    expect((await admin.patch(`/api/v1/usuarios/${yo}`).send({ rol: "PROFESIONAL", profesional_id: profId })).status).toBe(400);
    expect((await admin.delete(`/api/v1/usuarios/${yo}`)).status).toBe(400);
    const otro = (await admin.post("/api/v1/usuarios").send({ username: "ayudante", nombre: "Ayudante", password: "Clave-Ayudante-1", rol: "ADMIN" })).body;
    expect((await admin.patch(`/api/v1/usuarios/${yo}`).send({ nombre: "Sandra Sánchez" })).status).toBe(200);
    const aj = (await login("ayudante", "Clave-Ayudante-1")).a;   // clave temporal: no puede operar hasta cambiarla
    await aj.post("/api/v1/auth/password").send({ actual: "Clave-Ayudante-1", nueva: "Clave-Ayudante-2" });
    expect((await aj.patch(`/api/v1/usuarios/${yo}`).send({ activo: false })).status).toBe(200);   // hay otra Dirección: se permite
    expect((await aj.patch(`/api/v1/usuarios/${otro.id}`).send({ activo: false })).status).toBe(400);   // ahora la última Dirección activa es ayudante
    await aj.patch(`/api/v1/usuarios/${yo}`).send({ activo: true });
  });
  it("elimina un usuario sin historial y rechaza eliminar uno con historial", async () => {
    const temp = (await admin.post("/api/v1/usuarios").send({ username: "temporal", nombre: "Temporal", password: "Clave-Temporal-1", rol: "ADMIN" })).body;
    expect((await admin.delete(`/api/v1/usuarios/${temp.id}`)).status).toBe(200);
    expect((await admin.get("/api/v1/usuarios")).body.some((u: any) => u.username === "temporal")).toBe(false);
    const paciente = await admin.post("/api/v1/pacientes").send({ nombre: "Paciente de Prueba", rut: "9.999.999-3", antecedentes: [] }); expect(paciente.status).toBe(201);
    const yo = (await admin.get("/api/v1/usuarios")).body.find((u: any) => u.username === "ayudante");
    const conHistorial = (await admin.post("/api/v1/usuarios").send({ username: "conhistorial", nombre: "Con Historial", password: "Clave-Historial-1", rol: "ADMIN" })).body;
    const a2 = (await login("conhistorial", "Clave-Historial-1")).a; await a2.post("/api/v1/auth/password").send({ actual: "Clave-Historial-1", nueva: "Clave-Historial-2" });
    expect((await a2.post("/api/v1/pacientes").send({ nombre: "Otro Paciente", rut: "7.654.321-6", antecedentes: [] })).status).toBe(201);
    const r = await admin.delete(`/api/v1/usuarios/${conHistorial.id}`); expect(r.status).toBe(409); expect(r.body.code).toBe("TIENE_HISTORIAL");
    expect(yo).toBeTruthy();
  });
  it("las acciones quedan en la auditoría y un profesional no puede administrar usuarios", async () => {
    const a = (await admin.get("/api/v1/auditoria?limit=200")).body.map((x: any) => x.accion);
    for (const acc of ["CREAR", "EDITAR", "CAMBIAR_CLAVE_USUARIO", "RESET_PASSWORD", "ELIMINAR"]) expect(a).toContain(acc);
    const prof = (await login("mdiaz2", claveTemp)).a; await prof.post("/api/v1/auth/password").send({ actual: claveTemp, nueva: "Clave-Final-2026" });
    expect((await prof.post("/api/v1/usuarios").send({ username: "x1", nombre: "X", password: "Clave-Falsa-1", rol: "ADMIN" })).status).toBe(403);
    expect((await prof.patch(`/api/v1/usuarios/${nuevoId}`).send({ rol: "ADMIN" })).status).toBe(403);
    expect((await prof.delete(`/api/v1/usuarios/${nuevoId}`)).status).toBe(403);
  });
});
