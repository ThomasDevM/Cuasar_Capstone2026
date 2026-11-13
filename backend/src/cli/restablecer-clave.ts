/**
 * Restablece la contraseña de un usuario (por ejemplo, si Sandra olvidó la suya y no hay otra cuenta de Dirección).
 * Uso:  docker compose exec app node dist/cli/restablecer-clave.js sandra
 * Deja una clave temporal que debe cambiarse al ingresar. No borra ningún dato.
 */
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { config } from "../config.js";
import { createDb } from "../db.js";

const username = process.argv[2];
if (!username) { console.error("Uso: node dist/cli/restablecer-clave.js <usuario>"); process.exit(1); }
const db = await createDb(config.databaseUrl ? { url: config.databaseUrl } : { dataDir: config.dataDir });
const pass = crypto.randomBytes(8).toString("base64url").slice(0, 10);
const r = await db.query("UPDATE usuarios SET password_hash=$2, debe_cambiar_clave=TRUE, intentos_fallidos=0, bloqueado_hasta=NULL, activo=TRUE WHERE lower(username)=lower($1) RETURNING username", [username, await bcrypt.hash(pass, 10)]);
if (!r.length) { console.error(`No existe el usuario "${username}".`); await db.close(); process.exit(1); }
await db.query("INSERT INTO auditoria(accion, entidad, detalle) VALUES ('RESET_PASSWORD_CONSOLA','usuario',$1)", [username]);
console.log(`\nClave temporal para "${r[0].username}": ${pass}\nAl ingresar el sistema le pedirá cambiarla.\n`);
await db.close();
