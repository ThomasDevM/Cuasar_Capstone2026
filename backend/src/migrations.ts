export const MIGRATIONS: { id: number; sql: string }[] = [
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
    id: 3,
    sql: `
ALTER TABLE usuarios ADD COLUMN debe_cambiar_clave BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE servicios ADD COLUMN duracion_min INT NOT NULL DEFAULT 30 CHECK (duracion_min >= 30 AND duracion_min % 30 = 0);
CREATE TABLE enfermedades (id SERIAL PRIMARY KEY, nombre TEXT UNIQUE NOT NULL, activo BOOLEAN NOT NULL DEFAULT TRUE);
INSERT INTO enfermedades(nombre) VALUES ('Hipertensión'),('Diabetes'),('Resistencia a la insulina'),('Alergias / Dermatitis'),('Acné'),('Rosácea');
UPDATE fichas SET antecedentes = COALESCE((
  SELECT jsonb_agg(to_jsonb(CASE e WHEN 'hipertension' THEN 'Hipertensión' WHEN 'diabetes' THEN 'Diabetes' WHEN 'resistencia_insulina' THEN 'Resistencia a la insulina'
    WHEN 'alergias' THEN 'Alergias / Dermatitis' WHEN 'acne' THEN 'Acné' WHEN 'rosacea' THEN 'Rosácea' ELSE e END))
  FROM jsonb_array_elements_text(antecedentes) AS e), '[]'::jsonb);
CREATE TABLE comision_servicio (
  profesional_id INT NOT NULL REFERENCES profesionales(id) ON DELETE CASCADE,
  servicio_id INT NOT NULL REFERENCES servicios(id) ON DELETE CASCADE,
  porcentaje INT NOT NULL CHECK (porcentaje BETWEEN 0 AND 100),
  PRIMARY KEY (profesional_id, servicio_id)
);
ALTER TABLE notificaciones DROP CONSTRAINT IF EXISTS notificaciones_tipo_check;
ALTER TABLE notificaciones ADD CONSTRAINT notificaciones_tipo_check CHECK (tipo IN ('RECORDATORIO','ENCUESTA','CONFIRMACION','REPROGRAMACION','CANCELACION'));
`,
  },
  {
    id: 4,
    sql: `
-- La clienta pidió quitar el inventario: se elimina todo lo relacionado (productos, stock y ventas de productos).
DELETE FROM ventas WHERE cita_id IS NULL AND producto_id IS NOT NULL;
ALTER TABLE ventas DROP COLUMN IF EXISTS producto_id;
ALTER TABLE ventas DROP COLUMN IF EXISTS cantidad;
DROP TABLE IF EXISTS productos;
`,
  },
];
