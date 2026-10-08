/* ==========================================================================
   Deva Aesthetic House — Prototipo v0.2
   Prototipo navegable con datos DEMO guardados en el navegador (localStorage).
   NO es el sistema final: login, datos y cálculos serán reemplazados por la
   API real (ver docs/2.3_Arquitectura_de_Desarrollo.docx).
   Cambios v0.2:
   - Se corrige el DOMContentLoaded anidado que dejaba la agenda vacía.
   - Fechas locales (antes se usaba UTC y "hoy" podía quedar desfasado).
   - Datos persistentes, RUT validado, firma digital, estados de cita,
     control de dobles reservas y cálculo de comisiones.
   - Se evita innerHTML con datos (riesgo de XSS).
   ========================================================================== */

/* ---------- Utilidades ---------- */
const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  });
  [].concat(children).forEach((c) => n.append(c));
  return n;
}

const pad = (n) => String(n).padStart(2, "0");
function fechaLocal(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function hoyStr() { return fechaLocal(new Date()); }
function sumarDias(dias) { const d = new Date(); d.setDate(d.getDate() + dias); return fechaLocal(d); }
function fmtCLP(n) { return "$" + Math.round(n).toLocaleString("es-CL"); }
function fmtFecha(s) { const [y, m, d] = s.split("-"); return `${d}-${m}-${y}`; }

/* ---------- RUT chileno ---------- */
function limpiarRut(r) { return String(r).replace(/[^0-9kK]/g, "").toUpperCase(); }
function dvRut(cuerpo) {
  let suma = 0, mult = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) { suma += Number(cuerpo[i]) * mult; mult = mult === 7 ? 2 : mult + 1; }
  const r = 11 - (suma % 11);
  return r === 11 ? "0" : r === 10 ? "K" : String(r);
}
function validarRut(r) {
  const c = limpiarRut(r);
  if (c.length < 8 || c.length > 9) return false;
  return dvRut(c.slice(0, -1)) === c.slice(-1);
}
function formatearRut(r) {
  const c = limpiarRut(r);
  if (c.length < 2) return c;
  const cuerpo = c.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${cuerpo}-${c.slice(-1)}`;
}

/* ---------- "Base de datos" demo (localStorage) ---------- */
const DB_KEY = "deva_proto_v2";
const SES_KEY = "deva_sesion";

function seed() {
  const rutDemo = (n) => formatearRut(n + dvRut(n));
  const pacientes = [
    ["Camila Rojas", "11111111"], ["Javiera Soto", "12222222"], ["Valentina Medina", "13333333"],
    ["Andrea Silva", "14444444"], ["Daniela Castro", "15555555"],
  ].map(([nombre, cuerpo], i) => ({
    id: i + 1, nombre, rut: rutDemo(cuerpo), edad: 28 + i * 3, celular: "+56 9 5555 000" + i, email: "demo" + (i + 1) + "@example.com",
    motivo: "Paciente DEMO", historial: [], medicamentos: "", otras: "", consentimiento: null,
  }));
  const profesionales = [
    { id: 1, nombre: "Profesional A", contrato: "porcentaje", pct: 40 },
    { id: 2, nombre: "Profesional B", contrato: "porcentaje", pct: 30 },
    { id: 3, nombre: "Profesional C (turno)", contrato: "otro", pct: 0 },
    { id: 4, nombre: "Profesional D (turno)", contrato: "porcentaje", pct: 35 },
  ];
  const servicios = [
    { id: 1, nombre: "Evaluación Estética Facial", precio: 20000, sesiones: 1 },
    { id: 2, nombre: "Depilación Láser", precio: 30000, sesiones: 6 },
    { id: 3, nombre: "Tratamiento Lipedema", precio: 35000, sesiones: 10 },
    { id: 4, nombre: "Kinesiología Postoperatoria", precio: 25000, sesiones: 10 },
    { id: 5, nombre: "Evaluación Corporal", precio: 20000, sesiones: 1 },
  ];
  const c = (id, off, hora, pac, srv, prof, box, estado, pagado, nro) => ({
    id, fecha: sumarDias(off), hora, pacienteId: pac, servicioId: srv, profesionalId: prof, box, estado, pagado, nroSesion: nro,
  });
  const citas = [
    c(1, 0, "09:00", 1, 1, 1, "Box 1", "confirmada", false, 1),
    c(2, 0, "10:30", 2, 2, 2, "Box 2", "agendada", false, 2),
    c(3, 0, "11:45", 3, 3, 1, "Box 1", "agendada", false, 3),
    c(4, 1, "15:00", 4, 4, 4, "Box 3", "agendada", false, 1),
    c(5, 1, "16:30", 5, 5, 3, "Box 1", "agendada", false, 1),
    c(6, -1, "09:00", 2, 2, 2, "Box 2", "realizada", true, 1),
    c(7, -1, "11:00", 3, 3, 1, "Box 1", "realizada", true, 2),
    c(8, -2, "10:00", 4, 4, 4, "Box 3", "realizada", true, 0),
    c(9, -3, "12:00", 1, 1, 1, "Box 1", "realizada", true, 1),
    c(10, -3, "15:00", 5, 5, 3, "Box 2", "realizada", true, 1),
    c(11, -4, "09:30", 3, 3, 2, "Box 2", "inasistencia", false, 0),
  ];
  return { version: 2, pacientes, profesionales, servicios, boxes: ["Box 1", "Box 2", "Box 3"], citas };
}
function cargarDB() {
  try { const raw = localStorage.getItem(DB_KEY); if (raw) { const d = JSON.parse(raw); if (d.version === 2) return d; } } catch (e) { /* datos corruptos: se regeneran */ }
  const d = seed(); guardarDB(d); return d;
}
function guardarDB(d) { localStorage.setItem(DB_KEY, JSON.stringify(d)); }
function resetDB() { localStorage.removeItem(DB_KEY); cargarDB(); }

/* ---------- Sesión demo ---------- */
function getSesion() { try { return JSON.parse(sessionStorage.getItem(SES_KEY)); } catch (e) { return null; } }
function esAdmin(s) { return s && s.rol === "admin"; }

/* ---------- Lógica de negocio ---------- */
function porId(lista, id) { return lista.find((x) => x.id === Number(id)); }
function comisionDeCita(db, cita) {
  const prof = porId(db.profesionales, cita.profesionalId);
  const srv = porId(db.servicios, cita.servicioId);
  if (!prof || !srv || prof.contrato !== "porcentaje") return 0;
  return srv.precio * (prof.pct / 100);   // RN-03: comisión = valor × %
}
function citasPagadas(db, mes) {
  return db.citas.filter((c) => c.estado === "realizada" && c.pagado && c.fecha.startsWith(mes));
}
function citasVisibles(db, sesion) {
  return esAdmin(sesion) ? db.citas : db.citas.filter((c) => c.profesionalId === sesion.profId);   // RN-05
}

/* ---------- Mensajes ---------- */
function mostrarMensaje(id, texto, tipo) {
  const box = $(id); if (!box) return;
  box.textContent = texto; box.className = "alert alert-" + tipo; box.hidden = false;
}

/* ---------- Páginas ---------- */
function initLogin() {
  const form = $("loginForm"); if (!form) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const usuario = $("usuario").value.trim(), clave = $("clave").value;
    if (!$("ubicacion").value || !usuario || !clave) { mostrarMensaje("loginError", "Complete sucursal, usuario y clave.", "error"); return; }
    const perfil = $("perfil").value;                       // demo: sin credenciales reales
    const sesion = perfil === "admin" ? { rol: "admin", nombre: "Sandra" } : { rol: "profesional", profId: Number(perfil), nombre: "" };
    if (sesion.rol === "profesional") sesion.nombre = porId(cargarDB().profesionales, sesion.profId).nombre;
    sessionStorage.setItem(SES_KEY, JSON.stringify(sesion));
    window.location.href = "dashboard.html";
  });
  const sel = $("perfil");
  cargarDB().profesionales.forEach((p) => sel.append(el("option", { value: String(p.id), text: p.nombre })));
}

function initDashboard(db, s) {
  if (!$("metricCitas")) return;
  $("saludo").textContent = s.nombre || "";
  const hoy = hoyStr(), mes = hoy.slice(0, 7);
  $("metricCitas").textContent = citasVisibles(db, s).filter((c) => c.fecha === hoy).length;
  $("metricFichas").textContent = db.pacientes.filter((p) => !p.consentimiento).length;
  const lblCom = $("metricComisionLabel");
  if (esAdmin(s)) {
    lblCom.textContent = "Comisiones del mes";
    $("metricComision").textContent = fmtCLP(citasPagadas(db, mes).reduce((a, c) => a + comisionDeCita(db, c), 0));
  } else {
    const prof = porId(db.profesionales, s.profId);
    lblCom.textContent = "Mi comisión del mes";
    $("metricComision").textContent = prof.contrato === "porcentaje"
      ? fmtCLP(citasPagadas(db, mes).filter((c) => c.profesionalId === prof.id).reduce((a, c) => a + comisionDeCita(db, c), 0)) : "No aplica";
  }
  const reset = $("resetDemo");
  if (reset) reset.addEventListener("click", (e) => { e.preventDefault(); if (confirm("¿Restablecer los datos DEMO?")) { resetDB(); location.reload(); } });
}

/* Firma digital en canvas (consentimiento) */
function initFirma() {
  const cv = $("firmaCanvas"); if (!cv) return { vacia: () => true, dataURL: () => "", limpiar() {} };
  const ctx = cv.getContext("2d"); let dibujando = false, trazos = 0;
  ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.strokeStyle = "#3A2E40";
  const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * (cv.width / r.width), y: (e.clientY - r.top) * (cv.height / r.height) }; };
  cv.addEventListener("pointerdown", (e) => { dibujando = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); cv.setPointerCapture(e.pointerId); });
  cv.addEventListener("pointermove", (e) => { if (!dibujando) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); trazos++; });
  const fin = () => { dibujando = false; };
  cv.addEventListener("pointerup", fin); cv.addEventListener("pointerleave", fin);
  const limpiar = () => { ctx.clearRect(0, 0, cv.width, cv.height); trazos = 0; };
  const btn = $("limpiarFirma"); if (btn) btn.addEventListener("click", limpiar);
  return { vacia: () => trazos < 5, dataURL: () => cv.toDataURL("image/png"), limpiar };
}

function initFicha(db) {
  const form = $("fichaClinica"); if (!form) return;
  const firma = initFirma();
  const idParam = new URLSearchParams(location.search).get("paciente");
  const editando = idParam ? porId(db.pacientes, idParam) : null;
  $("rut").addEventListener("blur", (e) => { if (e.target.value) e.target.value = formatearRut(e.target.value); });

  if (editando) {
    $("tituloFicha").textContent = "Ficha de " + editando.nombre;
    ["nombre", "rut", "edad", "celular", "email", "motivo", "medicamentos", "otras"].forEach((k) => { if ($(k)) $(k).value = editando[k] ?? ""; });
    form.querySelectorAll('input[name="historial"]').forEach((cb) => { cb.checked = editando.historial.includes(cb.value); });
    if (editando.consentimiento) {
      $("consentimientoEstado").textContent = "Consentimiento firmado el " + editando.consentimiento.fecha + " (no se puede modificar).";
      $("consentimientoEstado").hidden = false; $("bloqueFirma").hidden = true;
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const rut = formatearRut(fd.get("rut"));
    if (!fd.get("nombre").trim()) return mostrarMensaje("fichaMsg", "Ingrese el nombre completo.", "error");
    if (!validarRut(rut)) return mostrarMensaje("fichaMsg", "El RUT no es válido (revise el dígito verificador).", "error");
    if (db.pacientes.some((p) => p.rut === rut && (!editando || p.id !== editando.id))) return mostrarMensaje("fichaMsg", "Ya existe un paciente con ese RUT.", "error");   // HU-01
    const acepta = $("aceptaConsentimiento") && $("aceptaConsentimiento").checked && !(editando && editando.consentimiento);
    if (acepta && firma.vacia()) return mostrarMensaje("fichaMsg", "Falta la firma del paciente en el recuadro.", "error");

    const datos = {
      nombre: fd.get("nombre").trim(), rut, edad: fd.get("edad"), celular: fd.get("celular"), email: fd.get("email"),
      motivo: fd.get("motivo"), historial: fd.getAll("historial"), medicamentos: fd.get("medicamentos"), otras: fd.get("otras"),
    };
    if (editando) Object.assign(editando, datos);
    else db.pacientes.push({ id: Math.max(0, ...db.pacientes.map((p) => p.id)) + 1, ...datos, consentimiento: null });
    const reg = editando || db.pacientes[db.pacientes.length - 1];
    if (acepta) reg.consentimiento = { fecha: new Date().toLocaleString("es-CL"), firma: firma.dataURL() };
    guardarDB(db);
    mostrarMensaje("fichaMsg", "Ficha guardada correctamente (datos DEMO en este navegador).", "ok");
    setTimeout(() => { window.location.href = "agenda.html"; }, 900);
  });
}

function initAgenda(db, s) {
  const lista = $("listaAgenda"); if (!lista) return;
  const filtroFecha = $("filtroFecha"), contador = $("contadorCitas"), filtroProf = $("filtroProf");
  const admin = esAdmin(s);

  if (admin) db.profesionales.forEach((p) => filtroProf.append(el("option", { value: String(p.id), text: p.nombre })));
  else filtroProf.parentElement.hidden = true;

  const ESTADOS = [["agendada", "Agendada"], ["confirmada", "Confirmada"], ["realizada", "Realizada"], ["cancelada", "Cancelada"], ["reprogramada", "Reprogramada"], ["inasistencia", "Inasistencia"]];

  function render() {
    const fecha = filtroFecha.value, pf = admin ? filtroProf.value : "";
    const citas = citasVisibles(db, s).filter((c) => c.fecha === fecha && (!pf || c.profesionalId === Number(pf))).sort((a, b) => a.hora.localeCompare(b.hora));
    lista.replaceChildren();
    contador.textContent = citas.length === 1 ? "1 cita programada" : `${citas.length} citas programadas`;
    if (!citas.length) { lista.append(el("p", { class: "vacio", text: "No hay pacientes agendados para esta fecha." })); return; }
    citas.forEach((c) => {
      const pac = porId(db.pacientes, c.pacienteId), srv = porId(db.servicios, c.servicioId), prof = porId(db.profesionales, c.profesionalId);
      const total = srv.sesiones;
      const detalle = `${srv.nombre} · ${prof.nombre}` + (total > 1 && c.nroSesion ? ` · sesión ${c.nroSesion} de ${total}` : "");
      const sel = el("select", { class: "status-select", "aria-label": "Estado de la cita" }, ESTADOS.map(([v, t]) => { const o = el("option", { value: v, text: t }); if (v === c.estado) o.selected = true; return o; }));
      sel.addEventListener("change", () => { c.estado = sel.value; guardarDB(db); render(); });
      const pago = el("button", { type: "button", class: "btn-chip" + (c.pagado ? " on" : ""), text: c.pagado ? "Pagado ✓" : "Marcar pagado" });
      pago.addEventListener("click", () => { c.pagado = !c.pagado; guardarDB(db); render(); });
      lista.append(el("div", { class: "agenda-card estado-" + c.estado }, [
        el("div", { class: "agenda-time", text: c.hora }),
        el("div", { class: "agenda-info" }, [el("h4", { text: pac.nombre + " " }, [el("span", { class: "box-badge", text: c.box })]), el("p", { text: detalle })]),
        el("div", { class: "agenda-controls" }, [sel, pago]),
        el("a", { class: "agenda-action", href: "ficha.html?paciente=" + pac.id, text: "Ver Ficha" }),
      ]));
    });
  }

  filtroFecha.value = hoyStr(); render();
  filtroFecha.addEventListener("change", render);
  if (admin) filtroProf.addEventListener("change", render);
  $("btnHoy").addEventListener("click", () => { filtroFecha.value = hoyStr(); render(); });
  $("btnAnterior").addEventListener("click", () => { const d = new Date(filtroFecha.value + "T00:00:00"); d.setDate(d.getDate() - 1); filtroFecha.value = fechaLocal(d); render(); });
  $("btnSiguiente").addEventListener("click", () => { const d = new Date(filtroFecha.value + "T00:00:00"); d.setDate(d.getDate() + 1); filtroFecha.value = fechaLocal(d); render(); });

  /* Nueva cita (HU-05): valida doble reserva por profesional y box (RN-07) */
  const form = $("nuevaCita"), btnNueva = $("btnNuevaCita");
  if (!admin) { btnNueva.hidden = true; return; }
  const llenar = (id, items, fn) => items.forEach((x) => $(id).append(el("option", { value: fn.v(x), text: fn.t(x) })));
  llenar("ncPaciente", db.pacientes, { v: (p) => p.id, t: (p) => `${p.nombre} (${p.rut})` });
  llenar("ncServicio", db.servicios, { v: (x) => x.id, t: (x) => `${x.nombre} · ${fmtCLP(x.precio)}` });
  llenar("ncProfesional", db.profesionales, { v: (p) => p.id, t: (p) => p.nombre });
  llenar("ncBox", db.boxes, { v: (b) => b, t: (b) => b });
  btnNueva.addEventListener("click", () => { form.hidden = !form.hidden; $("ncFecha").value = filtroFecha.value; });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const nueva = { fecha: $("ncFecha").value, hora: $("ncHora").value, pacienteId: Number($("ncPaciente").value), servicioId: Number($("ncServicio").value), profesionalId: Number($("ncProfesional").value), box: $("ncBox").value };
    if (!nueva.fecha || !nueva.hora) return mostrarMensaje("ncMsg", "Indique fecha y hora.", "error");
    const choque = db.citas.find((c) => c.fecha === nueva.fecha && c.hora === nueva.hora && !["cancelada", "reprogramada"].includes(c.estado) && (c.profesionalId === nueva.profesionalId || c.box === nueva.box));
    if (choque) return mostrarMensaje("ncMsg", choque.profesionalId === nueva.profesionalId ? "El profesional ya tiene una cita en ese horario." : "El box ya está ocupado en ese horario.", "error");
    const srv = porId(db.servicios, nueva.servicioId);
    const previas = db.citas.filter((c) => c.pacienteId === nueva.pacienteId && c.servicioId === nueva.servicioId && c.estado !== "cancelada").length;
    nueva.nroSesion = previas + 1;
    if (srv.sesiones > 1 && nueva.nroSesion > srv.sesiones && !confirm(`El plan tiene ${srv.sesiones} sesiones y esta sería la ${nueva.nroSesion}. ¿Agendar igualmente?`)) return;
    db.citas.push({ id: Math.max(0, ...db.citas.map((c) => c.id)) + 1, estado: "agendada", pagado: false, ...nueva });
    guardarDB(db); filtroFecha.value = nueva.fecha; form.hidden = true; render();
  });
}

function initComisiones(db, s) {
  const tabla = $("tablaComisiones"); if (!tabla) return;
  if (!esAdmin(s)) { window.location.href = "dashboard.html"; return; }   // RN-05
  const selMes = $("mesComision");
  const meses = [...new Set([hoyStr().slice(0, 7), ...db.citas.map((c) => c.fecha.slice(0, 7))])].sort().reverse();
  meses.forEach((m) => selMes.append(el("option", { value: m, text: m })));
  let ultimo = [];

  function render() {
    const mes = selMes.value, cuerpo = $("cuerpoComisiones"); cuerpo.replaceChildren(); ultimo = [];
    let totalVentas = 0, totalCom = 0;
    db.profesionales.forEach((p) => {
      const cs = citasPagadas(db, mes).filter((c) => c.profesionalId === p.id);
      const base = cs.reduce((a, c) => a + porId(db.servicios, c.servicioId).precio, 0);
      const com = cs.reduce((a, c) => a + comisionDeCita(db, c), 0);
      totalVentas += base; totalCom += com;
      const aplica = p.contrato === "porcentaje";
      ultimo.push([p.nombre, aplica ? "Porcentaje" : "Otro", aplica ? p.pct + "%" : "—", cs.length, base, aplica ? com : 0]);
      cuerpo.append(el("tr", {}, [
        el("td", { text: p.nombre }), el("td", { text: aplica ? "Porcentaje" : "Otro" }), el("td", { text: aplica ? p.pct + "%" : "—" }),
        el("td", { text: String(cs.length) }), el("td", { text: fmtCLP(base) }), el("td", { class: "num", text: aplica ? fmtCLP(com) : "No aplica" }),
      ]));
    });
    cuerpo.append(el("tr", { class: "total" }, [el("td", { text: "Total", colspan: "4" }), el("td", { text: fmtCLP(totalVentas) }), el("td", { class: "num", text: fmtCLP(totalCom) })]));
  }
  selMes.addEventListener("change", render); render();
  $("btnExportar").addEventListener("click", () => {
    const filas = [["Profesional", "Contrato", "Porcentaje", "Atenciones pagadas", "Ventas", "Comisión"], ...ultimo];
    const csv = "\uFEFF" + filas.map((f) => f.join(";")).join("\r\n");   // separador ; para Excel es-CL
    const a = el("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })), download: `comisiones_${selMes.value}.csv` });
    document.body.append(a); a.click(); a.remove();
  });
}

/* ---------- Navbar global ---------- */
function cargarNavbar(s) {
  const ph = $("navbar-placeholder"); if (!ph) return Promise.resolve();
  return fetch("navbar.html").then((r) => r.text()).then((html) => {
    ph.innerHTML = html;   // contenido propio y estático (no proviene del usuario)
    const pag = location.pathname.split("/").pop() || "index.html";
    ph.querySelectorAll(".nav-links a").forEach((a) => {
      if (a.getAttribute("href") === pag) a.classList.add("active");
      if (a.dataset.role === "admin" && !esAdmin(s)) a.hidden = true;
    });
    const u = $("navUsuario"); if (u && s) u.textContent = s.nombre + (esAdmin(s) ? " · Dirección" : " · Profesional");
    const out = ph.querySelector("[data-logout]"); if (out) out.addEventListener("click", () => sessionStorage.removeItem(SES_KEY));
  }).catch(() => { ph.textContent = "No se pudo cargar el menú. Abra el sistema con iniciar.bat (servidor local)."; });
}

/* ---------- Arranque (un único DOMContentLoaded) ---------- */
document.addEventListener("DOMContentLoaded", () => {
  const pagina = document.body.dataset.page;
  if (pagina === "login") { initLogin(); return; }
  const s = getSesion();
  if (!s) { window.location.href = "index.html"; return; }   // acceso solo con sesión
  const db = cargarDB();
  cargarNavbar(s);
  initDashboard(db, s); initFicha(db); initAgenda(db, s); initComisiones(db, s);
});
