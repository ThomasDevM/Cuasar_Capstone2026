export const MIGRATIONS = [
    {
        id: 1,
        sql: `
CREATE TABLE usuarios (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('ADMIN','PROFESIONAL')),
  profesional_id INT,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  intentos_fallidos INT NOT NULL DEFAULT 0,
  bloqueado_hasta TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE profesionales (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  especialidad TEXT,
  contrato TEXT NOT NULL DEFAULT 'OTRO' CHECK (contrato IN ('PORCENTAJE','OTRO')),
  porcentaje INT NOT NULL DEFAULT 0 CHECK (porcentaje BETWEEN 0 AND 100),
  turnos TEXT,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);
ALTER TABLE usuarios ADD CONSTRAINT fk_usuario_prof FOREIGN KEY (profesional_id) REFERENCES profesionales(id);
CREATE TABLE boxes (id SERIAL PRIMARY KEY, nombre TEXT UNIQUE NOT NULL, activo BOOLEAN NOT NULL DEFAULT TRUE);
CREATE TABLE servicios (
  id SERIAL PRIMARY KEY,
  nombre TEXT UNIQUE NOT NULL,
  precio INT NOT NULL CHECK (precio >= 0),
  sesiones INT NOT NULL DEFAULT 1 CHECK (sesiones >= 1),
  intervalo_mantencion_dias INT,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE pacientes (
  id SERIAL PRIMARY KEY,
  rut TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  edad INT,
  celular TEXT,
  email TEXT,
  motivo TEXT,
  creado_por INT REFERENCES usuarios(id),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE fichas (
  paciente_id INT PRIMARY KEY REFERENCES pacientes(id) ON DELETE CASCADE,
  antecedentes JSONB NOT NULL DEFAULT '[]',
  medicamentos TEXT,
  otras TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE consentimientos (
  id SERIAL PRIMARY KEY,
  paciente_id INT NOT NULL REFERENCES pacientes(id),
  tratamiento TEXT NOT NULL,
  version_texto TEXT NOT NULL,
  texto TEXT NOT NULL,
  firma TEXT NOT NULL,
  firmado_por INT REFERENCES usuarios(id),
  firmado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE planes (
  id SERIAL PRIMARY KEY,
  paciente_id INT NOT NULL REFERENCES pacientes(id),
  servicio_id INT NOT NULL REFERENCES servicios(id),
  sesiones_total INT NOT NULL CHECK (sesiones_total >= 1),
  sesiones_realizadas INT NOT NULL DEFAULT 0,
  origen TEXT NOT NULL DEFAULT 'EVALUACION' CHECK (origen IN ('EVALUACION','DERIVACION')),
  estado TEXT NOT NULL DEFAULT 'ACTIVO' CHECK (estado IN ('ACTIVO','COMPLETADO','CANCELADO')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE citas (
  id SERIAL PRIMARY KEY,
  plan_id INT REFERENCES planes(id),
  paciente_id INT NOT NULL REFERENCES pacientes(id),
  servicio_id INT NOT NULL REFERENCES servicios(id),
  profesional_id INT NOT NULL REFERENCES profesionales(id),
  box_id INT NOT NULL REFERENCES boxes(id),
  fecha TEXT NOT NULL,
  hora TEXT NOT NULL,
  inicio_min INT NOT NULL,
  fin_min INT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'AGENDADA' CHECK (estado IN ('AGENDADA','CONFIRMADA','REALIZADA','CANCELADA','INASISTENCIA')),
  nro_sesion INT,
  creado_por INT REFERENCES usuarios(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_citas_fecha ON citas(fecha);
CREATE INDEX idx_citas_paciente ON citas(paciente_id);
CREATE UNIQUE INDEX uq_cita_prof_inicio ON citas(profesional_id, fecha, inicio_min) WHERE estado NOT IN ('CANCELADA','INASISTENCIA');
CREATE UNIQUE INDEX uq_cita_box_inicio ON citas(box_id, fecha, inicio_min) WHERE estado NOT IN ('CANCELADA','INASISTENCIA');
CREATE TABLE cita_historial (
  id SERIAL PRIMARY KEY,
  cita_id INT NOT NULL REFERENCES citas(id) ON DELETE CASCADE,
  accion TEXT NOT NULL,
  detalle TEXT,
  usuario_id INT REFERENCES usuarios(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE evoluciones (
  id SERIAL PRIMARY KEY,
  cita_id INT UNIQUE NOT NULL REFERENCES citas(id) ON DELETE CASCADE,
  paciente_id INT NOT NULL REFERENCES pacientes(id),
  profesional_id INT NOT NULL REFERENCES profesionales(id),
  observaciones TEXT NOT NULL,
  procedimiento TEXT,
  recomendaciones TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE productos (
  id SERIAL PRIMARY KEY,
  nombre TEXT UNIQUE NOT NULL,
  precio INT NOT NULL CHECK (precio >= 0),
  stock INT NOT NULL DEFAULT 0 CHECK (stock >= 0),
  stock_minimo INT NOT NULL DEFAULT 0,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE ventas (
  id SERIAL PRIMARY KEY,
  fecha TEXT NOT NULL,
  paciente_id INT REFERENCES pacientes(id),
  cita_id INT UNIQUE REFERENCES citas(id),
  producto_id INT REFERENCES productos(id),
  cantidad INT NOT NULL DEFAULT 1,
  descripcion TEXT NOT NULL,
  monto INT NOT NULL CHECK (monto >= 0),
  medio_pago TEXT NOT NULL CHECK (medio_pago IN ('EFECTIVO','TRANSFERENCIA','DEBITO','CREDITO','OTRO')),
  nro_boleta TEXT,
  vendedor_id INT REFERENCES profesionales(id),
  porcentaje_aplicado INT,
  registrada_por INT REFERENCES usuarios(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ventas_fecha ON ventas(fecha);
CREATE TABLE notificaciones (
  id SERIAL PRIMARY KEY,
  cita_id INT NOT NULL REFERENCES citas(id) ON DELETE CASCADE,
  paciente_id INT NOT NULL REFERENCES pacientes(id),
  canal TEXT NOT NULL CHECK (canal IN ('WHATSAPP','EMAIL')),
  tipo TEXT NOT NULL CHECK (tipo IN ('RECORDATORIO','ENCUESTA')),
  estado TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE','ENVIADA','ERROR')),
  mensaje TEXT NOT NULL,
  detalle_error TEXT,
  enviada_en TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cita_id, canal, tipo)
);
CREATE TABLE auditoria (
  id SERIAL PRIMARY KEY,
  usuario_id INT,
  usuario_nombre TEXT,
  accion TEXT NOT NULL,
  entidad TEXT NOT NULL,
  entidad_id INT,
  paciente_id INT,
  detalle TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_auditoria_fecha ON auditoria(created_at);
CREATE TABLE config (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
`,
    },
    {
        id: 2,
        sql: `
ALTER TABLE citas ADD COLUMN notas TEXT;
CREATE TABLE seguimientos (
  id SERIAL PRIMARY KEY,
  paciente_id INT NOT NULL REFERENCES pacientes(id),
  cita_id INT REFERENCES citas(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('NOTA','LLAMADA','INDICACION','CONTROL')),
  texto TEXT NOT NULL,
  proximo_control TEXT,
  control_resuelto BOOLEAN NOT NULL DEFAULT FALSE,
  profesional_id INT REFERENCES profesionales(id),
  usuario_id INT REFERENCES usuarios(id),
  usuario_nombre TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_seg_paciente ON seguimientos(paciente_id);
CREATE TABLE ficha_versiones (
  id SERIAL PRIMARY KEY,
  paciente_id INT NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  datos JSONB NOT NULL,
  usuario_id INT REFERENCES usuarios(id),
  usuario_nombre TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`,
    },
    {
        // Seguridad: sesiones revocables, segundo factor, cambio de clave obligatorio y auditoría inalterable.
        id: 3,
        sql: `
ALTER TABLE usuarios ADD COLUMN debe_cambiar_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE usuarios ADD COLUMN password_cambiada_en TIMESTAMPTZ;
ALTER TABLE usuarios ADD COLUMN mfa_activo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE usuarios ADD COLUMN mfa_secreto TEXT;
ALTER TABLE usuarios ADD COLUMN mfa_secreto_pendiente TEXT;
ALTER TABLE usuarios ADD COLUMN mfa_ultimo_paso BIGINT;
CREATE TABLE sesiones (
  id SERIAL PRIMARY KEY,
  token_hash TEXT UNIQUE NOT NULL,
  usuario_id INT NOT NULL REFERENCES usuarios(id),
  creada_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_uso TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_en TIMESTAMPTZ NOT NULL,
  revocada BOOLEAN NOT NULL DEFAULT FALSE,
  ip TEXT,
  agente TEXT
);
CREATE INDEX idx_sesiones_usuario ON sesiones(usuario_id);

ALTER TABLE auditoria ADD COLUMN hash_anterior TEXT;
ALTER TABLE auditoria ADD COLUMN hash TEXT;
CREATE FUNCTION auditoria_hash(prev TEXT, a auditoria) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $f$
  SELECT encode(sha256(convert_to(
    coalesce(prev, '') || '|' || a.id || '|' || coalesce(a.usuario_id::text, '') || '|' || coalesce(a.usuario_nombre, '') || '|' ||
    a.accion || '|' || a.entidad || '|' || coalesce(a.entidad_id::text, '') || '|' || coalesce(a.paciente_id::text, '') || '|' ||
    coalesce(a.detalle, '') || '|' || (extract(epoch FROM a.created_at) * 1000000)::bigint, 'UTF8')), 'hex')
$f$;
DO $d$
DECLARE r auditoria; prev TEXT := NULL;
BEGIN
  FOR r IN SELECT * FROM auditoria ORDER BY id LOOP
    UPDATE auditoria SET hash_anterior = prev, hash = auditoria_hash(prev, r) WHERE id = r.id RETURNING hash INTO prev;
  END LOOP;
END $d$;
CREATE FUNCTION auditoria_encadenar() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM pg_advisory_xact_lock(7311);
  SELECT hash INTO NEW.hash_anterior FROM auditoria ORDER BY id DESC LIMIT 1;
  NEW.hash := auditoria_hash(NEW.hash_anterior, NEW);
  RETURN NEW;
END $f$;
CREATE TRIGGER trg_auditoria_encadenar BEFORE INSERT ON auditoria FOR EACH ROW EXECUTE FUNCTION auditoria_encadenar();
CREATE FUNCTION auditoria_inmutable() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN RAISE EXCEPTION 'El registro de auditoría no se puede modificar ni borrar'; END $f$;
CREATE TRIGGER trg_auditoria_inmutable BEFORE UPDATE OR DELETE ON auditoria FOR EACH ROW EXECUTE FUNCTION auditoria_inmutable();
CREATE TRIGGER trg_auditoria_truncate BEFORE TRUNCATE ON auditoria FOR EACH STATEMENT EXECUTE FUNCTION auditoria_inmutable();
`,
    },
    {
        // CRM: origen y consentimiento de marketing, prospectos, presupuestos, campañas y encuestas de satisfacción.
        id: 4,
        sql: `
ALTER TABLE pacientes ADD COLUMN fecha_nacimiento TEXT;
ALTER TABLE pacientes ADD COLUMN canal_origen TEXT;
ALTER TABLE pacientes ADD COLUMN referido_por INT REFERENCES pacientes(id);
ALTER TABLE pacientes ADD COLUMN acepta_marketing BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE pacientes ADD COLUMN marketing_actualizado_en TIMESTAMPTZ;
ALTER TABLE pacientes ADD COLUMN etiquetas JSONB NOT NULL DEFAULT '[]';
ALTER TABLE planes ADD COLUMN precio_sesion INT CHECK (precio_sesion >= 0);

CREATE TABLE prospectos (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  celular TEXT,
  email TEXT,
  canal TEXT NOT NULL,
  servicio_id INT REFERENCES servicios(id),
  interes TEXT,
  estado TEXT NOT NULL DEFAULT 'NUEVO' CHECK (estado IN ('NUEVO','CONTACTADO','EVALUACION','CONVERTIDO','PERDIDO')),
  motivo_perdida TEXT,
  proximo_contacto TEXT,
  valor_estimado INT CHECK (valor_estimado >= 0),
  responsable_id INT REFERENCES usuarios(id),
  referido_por INT REFERENCES pacientes(id),
  paciente_id INT REFERENCES pacientes(id),
  acepta_marketing BOOLEAN NOT NULL DEFAULT FALSE,
  creado_por INT REFERENCES usuarios(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  convertido_en TIMESTAMPTZ
);
CREATE INDEX idx_prospectos_estado ON prospectos(estado);
CREATE TABLE prospecto_actividades (
  id SERIAL PRIMARY KEY,
  prospecto_id INT NOT NULL REFERENCES prospectos(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('NOTA','LLAMADA','WHATSAPP','CORREO','ESTADO')),
  texto TEXT NOT NULL,
  usuario_id INT REFERENCES usuarios(id),
  usuario_nombre TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pact_prospecto ON prospecto_actividades(prospecto_id);

CREATE TABLE presupuestos (
  id SERIAL PRIMARY KEY,
  paciente_id INT REFERENCES pacientes(id),
  prospecto_id INT REFERENCES prospectos(id),
  fecha TEXT NOT NULL,
  validez_dias INT NOT NULL DEFAULT 30 CHECK (validez_dias BETWEEN 1 AND 365),
  estado TEXT NOT NULL DEFAULT 'BORRADOR' CHECK (estado IN ('BORRADOR','ENVIADO','ACEPTADO','RECHAZADO')),
  subtotal INT NOT NULL CHECK (subtotal >= 0),
  descuento INT NOT NULL DEFAULT 0 CHECK (descuento >= 0),
  total INT NOT NULL CHECK (total >= 0),
  notas TEXT,
  motivo_rechazo TEXT,
  creado_por INT REFERENCES usuarios(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  respondido_en TIMESTAMPTZ,
  CHECK (paciente_id IS NOT NULL OR prospecto_id IS NOT NULL)
);
CREATE TABLE presupuesto_items (
  id SERIAL PRIMARY KEY,
  presupuesto_id INT NOT NULL REFERENCES presupuestos(id) ON DELETE CASCADE,
  servicio_id INT REFERENCES servicios(id),
  descripcion TEXT NOT NULL,
  sesiones INT NOT NULL DEFAULT 1 CHECK (sesiones >= 1),
  precio_unitario INT NOT NULL CHECK (precio_unitario >= 0),
  total INT NOT NULL CHECK (total >= 0)
);

CREATE TABLE campanas (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  canal TEXT NOT NULL CHECK (canal IN ('WHATSAPP','EMAIL')),
  asunto TEXT,
  mensaje TEXT NOT NULL,
  filtro JSONB NOT NULL DEFAULT '{}',
  creada_por INT REFERENCES usuarios(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE campana_destinatarios (
  id SERIAL PRIMARY KEY,
  campana_id INT NOT NULL REFERENCES campanas(id) ON DELETE CASCADE,
  paciente_id INT NOT NULL REFERENCES pacientes(id),
  estado TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE','ENVIADO','ERROR','EXCLUIDO')),
  detalle TEXT,
  enviado_en TIMESTAMPTZ,
  UNIQUE (campana_id, paciente_id)
);

CREATE TABLE encuestas (
  id SERIAL PRIMARY KEY,
  cita_id INT UNIQUE REFERENCES citas(id) ON DELETE SET NULL,
  paciente_id INT NOT NULL REFERENCES pacientes(id),
  profesional_id INT REFERENCES profesionales(id),
  token_hash TEXT UNIQUE NOT NULL,
  puntaje INT CHECK (puntaje BETWEEN 0 AND 10),
  comentario TEXT,
  gestionada BOOLEAN NOT NULL DEFAULT FALSE,
  creada_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_en TIMESTAMPTZ NOT NULL,
  respondida_en TIMESTAMPTZ
);
`,
    },
    {
        // Fotos clínicas antes/después: la imagen va cifrada en disco (DATA_DIR/fotos); aquí solo se guardan sus datos.
        id: 5,
        sql: `
ALTER TABLE pacientes ADD COLUMN acepta_fotos BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE pacientes ADD COLUMN fotos_actualizado_en TIMESTAMPTZ;

CREATE TABLE fotos (
  id SERIAL PRIMARY KEY,
  paciente_id INT NOT NULL REFERENCES pacientes(id),
  cita_id INT NOT NULL REFERENCES citas(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('ANTES','DESPUES','OTRA')),
  nota TEXT,
  archivo TEXT UNIQUE NOT NULL,
  mime TEXT NOT NULL CHECK (mime IN ('image/jpeg','image/png')),
  bytes INT NOT NULL CHECK (bytes > 0),
  sha256 TEXT NOT NULL,
  autor_id INT REFERENCES usuarios(id),
  autor_nombre TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fotos_paciente ON fotos(paciente_id);
CREATE INDEX idx_fotos_cita ON fotos(cita_id);
`,
    },
];
