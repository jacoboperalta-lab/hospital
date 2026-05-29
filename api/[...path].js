import express from "express";
import pg from "pg";

const { Pool } = pg;
const app = express();
const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
const pool = new Pool({
  connectionString,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined
});

app.use(express.json({ limit: "2mb" }));
app.use((req, res, next) => {
  if (!connectionString) {
    return res.status(500).json({
      error: "No hay DATABASE_URL/POSTGRES_URL configurada en Vercel. Conecta una base de datos Postgres al proyecto o añade la variable de entorno."
    });
  }
  next();
});

const like = (value) => `%${String(value || "").trim()}%`;
const today = () => new Date().toISOString().slice(0, 10);
const nowSql = () => new Date().toISOString().slice(0, 19).replace("T", " ");
const one = async (sql, params = []) => (await pool.query(sql, params)).rows[0] || null;
const all = async (sql, params = []) => (await pool.query(sql, params)).rows;

function gs1Date(raw) {
  if (!raw || !/^\d{6}$/.test(raw)) return "";
  const yy = Number(raw.slice(0, 2));
  const year = yy < 80 ? 2000 + yy : 1900 + yy;
  const month = Number(raw.slice(2, 4));
  const day = Number(raw.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseGs1(input) {
  const text = String(input || "").replace(/\u001d/g, "");
  const data = text.replace(/[^a-zA-Z0-9]/g, "");
  const readFixed = (ai, len) => {
    const idx = data.indexOf(ai);
    return idx >= 0 ? data.slice(idx + ai.length, idx + ai.length + len) : "";
  };
  const readVariable = (ai) => {
    const idx = data.indexOf(ai);
    if (idx < 0) return "";
    const start = idx + ai.length;
    let end = data.length;
    for (const other of ["01", "17", "10", "21"].filter((x) => x !== ai)) {
      const pos = data.indexOf(other, start);
      if (pos > start) end = Math.min(end, pos);
    }
    return data.slice(start, end);
  };
  return {
    gtin: readFixed("01", 14),
    caducidad: gs1Date(readFixed("17", 6)),
    lote: readVariable("10"),
    numero_serie: readVariable("21")
  };
}

function buildWhere(filters, fields, startAt = 1) {
  const clauses = [];
  const params = [];
  let index = startAt;
  for (const [key, column] of Object.entries(fields)) {
    if (filters[key]) {
      clauses.push(`${column} ILIKE $${index++}`);
      params.push(like(filters[key]));
    }
  }
  return { sql: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "", params, index };
}

app.get("/api/health", async (req, res) => {
  const row = await one("SELECT COUNT(*)::int AS total FROM information_schema.tables WHERE table_schema='public'");
  res.json({ ok: true, database: "postgres", tables: row.total });
});

app.get("/api/dashboard", async (req, res) => {
  const [cajas, intervenciones, depositos, ciclos, fichas, maestra] = await Promise.all([
    one("SELECT COUNT(*)::int AS total FROM cajas"),
    one("SELECT COUNT(*)::int AS total FROM intervenciones"),
    one("SELECT COUNT(*)::int AS total FROM implantes_deposito"),
    one("SELECT COUNT(*)::int AS total FROM ciclos_esterilizacion WHERE estado='en_proceso'"),
    one("SELECT COUNT(*)::int AS total FROM fichas_esterilizacion"),
    one("SELECT COUNT(*)::int AS total FROM tabla_maestra")
  ]);
  res.json({ cajas, intervenciones, depositos, ciclos, fichas, maestra });
});

app.get("/api/options", async (req, res) => {
  const [pacientes, especialidades, facultativos, maquinas] = await Promise.all([
    all("SELECT id, nombre, apellidos, nhc, nuhsa FROM pacientes ORDER BY apellidos, nombre"),
    all("SELECT DISTINCT especialidad FROM procedimientos ORDER BY especialidad"),
    all("SELECT id, nombre, apellidos, especialidad, cnp FROM facultativos ORDER BY apellidos, nombre"),
    all("SELECT id, nombre, tipo, codigo_interno FROM maquinas_esterilizacion ORDER BY id")
  ]);
  res.json({ pacientes, especialidades: especialidades.map((r) => r.especialidad), facultativos, maquinas });
});

app.get("/api/procedimientos", async (req, res) => {
  res.json(await all("SELECT id, nombre_procedimiento FROM procedimientos WHERE especialidad=$1 ORDER BY nombre_procedimiento", [req.query.especialidad || ""]));
});

app.get("/api/zonas", async (req, res) => {
  res.json(await all("SELECT zona FROM zonas_anatomicas WHERE especialidad=$1 ORDER BY zona", [req.query.especialidad || ""]));
});

app.get("/api/pacientes/buscar", async (req, res) => {
  const { nhc, nuhsa } = req.query;
  if (!nhc && !nuhsa) return res.status(400).json({ error: "Indica NHC o NUHSA." });
  const column = nhc ? "nhc" : "nuhsa";
  const row = await one(`SELECT id, nombre, apellidos, nhc, nuhsa, fecha_nacimiento FROM pacientes WHERE ${column}=$1`, [nhc || nuhsa]);
  if (!row) return res.status(404).json({ error: "Paciente no encontrado." });
  res.json(row);
});

app.get("/api/maestra", async (req, res) => {
  const q = req.query.q || "";
  res.json(await all(
    `SELECT referencia AS id, referencia, nombre, especialidad, tipo, lateralidad, material, fabricante, gtin, tamano, modelo
     FROM tabla_maestra
     WHERE $1 = '' OR referencia ILIKE $2 OR nombre ILIKE $2 OR gtin ILIKE $2 OR especialidad ILIKE $2
     ORDER BY nombre LIMIT 300`,
    [q, like(q)]
  ));
});

app.post("/api/maestra", async (req, res) => {
  const fields = ["referencia", "nombre", "especialidad", "tipo", "lateralidad", "material", "fabricante", "gtin", "tamano", "modelo"];
  const item = Object.fromEntries(fields.map((f) => [f, String(req.body[f] || "").trim()]));
  if (!item.referencia || !item.nombre) return res.status(400).json({ error: "Referencia y nombre son obligatorios." });
  if (item.gtin && await one("SELECT referencia FROM tabla_maestra WHERE gtin=$1", [item.gtin])) {
    return res.status(409).json({ error: "El GTIN ya existe en tabla maestra." });
  }
  await pool.query(
    `INSERT INTO tabla_maestra (${fields.join(",")}) VALUES (${fields.map((_, i) => `$${i + 1}`).join(",")})`,
    fields.map((f) => item[f])
  );
  res.status(201).json({ id: item.referencia });
});

app.put("/api/maestra/:id", async (req, res) => {
  const fields = ["referencia", "nombre", "especialidad", "tipo", "lateralidad", "material", "fabricante", "gtin", "tamano", "modelo"];
  const item = Object.fromEntries(fields.map((f) => [f, String(req.body[f] || "").trim()]));
  if (item.gtin && await one("SELECT referencia FROM tabla_maestra WHERE gtin=$1 AND referencia<>$2", [item.gtin, req.params.id])) {
    return res.status(409).json({ error: "El GTIN ya existe en otro registro." });
  }
  await pool.query(
    `UPDATE tabla_maestra SET ${fields.map((f, i) => `${f}=$${i + 1}`).join(", ")} WHERE referencia=$${fields.length + 1}`,
    [...fields.map((f) => item[f]), req.params.id]
  );
  res.json({ ok: true });
});

app.post("/api/gs1", async (req, res) => {
  const parsed = parseGs1(req.body.codigo);
  let maestra = null;
  let deposito = null;
  if (parsed.gtin) {
    maestra = await one("SELECT referencia AS id, referencia, nombre, fabricante, tamano, lateralidad, material, especialidad FROM tabla_maestra WHERE gtin=$1", [parsed.gtin]);
    deposito = await one("SELECT lote, referencia, caducidad, fecha_entrada FROM implantes_deposito WHERE gtin=$1 ORDER BY fecha_entrada DESC, id DESC LIMIT 1", [parsed.gtin]);
  }
  res.json({ ...parsed, maestra, deposito });
});

app.get("/api/deposito", async (req, res) => {
  const { sql, params } = buildWhere(req.query, { gtin: "gtin", referencia: "referencia", lote: "lote", nombre: "nombre" });
  res.json(await all(`SELECT * FROM implantes_deposito${sql} ORDER BY fecha_entrada DESC, id DESC LIMIT 500`, params));
});

app.post("/api/deposito", async (req, res) => {
  const data = { ...req.body };
  if (data.codigo) Object.assign(data, parseGs1(data.codigo));
  if (!data.gtin) return res.status(400).json({ error: "El GTIN es obligatorio." });
  const master = await one("SELECT referencia, nombre, especialidad, lateralidad, material FROM tabla_maestra WHERE gtin=$1", [data.gtin]);
  const row = {
    gtin: data.gtin,
    referencia: data.referencia || master?.referencia || "",
    nombre: data.nombre || master?.nombre || "",
    lote: data.lote || "",
    caducidad: data.caducidad || "",
    lateralidad: data.lateralidad || master?.lateralidad || "",
    material: data.material || master?.material || "",
    especialidad: data.especialidad || master?.especialidad || "",
    fecha_entrada: data.fecha_entrada || today()
  };
  const result = await one(
    `INSERT INTO implantes_deposito (gtin, referencia, nombre, lote, caducidad, lateralidad, material, especialidad, fecha_entrada)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [row.gtin, row.referencia, row.nombre, row.lote, row.caducidad, row.lateralidad, row.material, row.especialidad, row.fecha_entrada]
  );
  res.status(201).json(result);
});

app.get("/api/intervenciones", async (req, res) => {
  const clauses = [];
  const params = [];
  const add = (sql, value) => { params.push(value); clauses.push(sql.replace("?", `$${params.length}`)); };
  if (req.query.especialidad) add("i.especialidad=?", req.query.especialidad);
  if (req.query.procedimiento) add("i.procedimiento ILIKE ?", like(req.query.procedimiento));
  if (req.query.paciente) {
    params.push(like(req.query.paciente), like(req.query.paciente), like(req.query.paciente), like(req.query.paciente));
    clauses.push(`(p.nombre ILIKE $${params.length - 3} OR p.apellidos ILIKE $${params.length - 2} OR p.nhc ILIKE $${params.length - 1} OR p.nuhsa ILIKE $${params.length})`);
  }
  if (req.query.desde) add("i.fecha_intervencion>=?", req.query.desde);
  if (req.query.hasta) add("i.fecha_intervencion<=?", req.query.hasta);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  res.json(await all(
    `SELECT i.id, i.fecha_intervencion, i.especialidad, i.procedimiento, i.facultativo_cnp,
            i.zona_anatomica, i.lateralidad, p.nombre, p.apellidos, p.nhc, p.nuhsa
     FROM intervenciones i JOIN pacientes p ON p.id=i.paciente_id
     ${where}
     ORDER BY i.fecha_intervencion DESC, i.id DESC LIMIT 300`,
    params
  ));
});

app.get("/api/intervenciones/:id", async (req, res) => {
  const intervencion = await one(
    `SELECT i.*, p.nombre, p.apellidos, p.nhc, p.nuhsa, p.fecha_nacimiento
     FROM intervenciones i JOIN pacientes p ON p.id=i.paciente_id WHERE i.id=$1`,
    [req.params.id]
  );
  if (!intervencion) return res.status(404).json({ error: "Intervencion no encontrada." });
  const implantes = await all("SELECT * FROM implantes_intervencion WHERE intervencion_id=$1 ORDER BY id", [req.params.id]);
  res.json({ intervencion, implantes });
});

app.post("/api/intervenciones", async (req, res) => {
  const client = await pool.connect();
  try {
    const { paciente_id, especialidad, procedimiento, facultativo_cnp, fecha_intervencion, zona_anatomica, lateralidad, implantes = [] } = req.body;
    if (!paciente_id || !especialidad || !procedimiento || !facultativo_cnp || !fecha_intervencion) {
      return res.status(400).json({ error: "Paciente, especialidad, procedimiento, facultativo y fecha son obligatorios." });
    }
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO intervenciones (paciente_id, especialidad, procedimiento, facultativo_cnp, fecha_intervencion, zona_anatomica, lateralidad)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [paciente_id, especialidad, procedimiento, facultativo_cnp, fecha_intervencion, zona_anatomica || "", lateralidad || ""]
    );
    for (const imp of implantes) {
      if (!imp.gtin || !imp.descripcion) continue;
      await client.query(
        `INSERT INTO implantes_intervencion
         (intervencion_id, gtin, descripcion, numero_serie, lote, caducidad, fabricante, referencia, tamano, lateralidad, material, especialidad)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [result.rows[0].id, imp.gtin, imp.descripcion, imp.numero_serie || "", imp.lote || "", imp.caducidad || "", imp.fabricante || "", imp.referencia || "", imp.tamano || "", imp.lateralidad || "", imp.material || "", especialidad]
      );
    }
    await client.query("COMMIT");
    res.status(201).json({ id: result.rows[0].id });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

app.post("/api/intervenciones/:id/enviar-administracion", async (req, res) => {
  await pool.query("INSERT INTO administracion_log (intervencion_id, fecha_envio) VALUES ($1, $2)", [req.params.id, nowSql()]);
  res.json({ ok: true });
});

app.get("/api/cajas", async (req, res) => {
  const { sql, params } = buildWhere(req.query, { q: "nombre", especialidad: "especialidad", codigo: "codigo_barras" });
  res.json(await all(`SELECT * FROM cajas${sql} ORDER BY especialidad, nombre LIMIT 500`, params));
});

app.get("/api/cajas/:codigo/contenido", async (req, res) => {
  const caja = await one("SELECT * FROM cajas WHERE codigo_barras=$1 OR codigo_contenido=$1 OR id::text=$1", [req.params.codigo]);
  if (!caja) return res.status(404).json({ error: "Caja no encontrada." });
  const contenido = await all("SELECT instrumento, cantidad FROM caja_contenido WHERE id_caja=$1 ORDER BY instrumento", [caja.id]);
  res.json({ caja, contenido });
});

app.get("/api/instrumental", async (req, res) => {
  const especialidades = await all("SELECT DISTINCT especialidad FROM cajas_instrumental ORDER BY especialidad");
  const cajas = req.query.especialidad ? await all("SELECT id, nombre_caja FROM cajas_instrumental WHERE especialidad=$1 ORDER BY nombre_caja", [req.query.especialidad]) : [];
  const contenido = req.query.caja_id ? await all("SELECT id, nombre, descripcion, imagen FROM instrumental WHERE caja_id=$1 ORDER BY nombre", [req.query.caja_id]) : [];
  res.json({ especialidades, cajas, contenido });
});

app.get("/api/esterilizacion/maquinas", async (req, res) => {
  res.json(await all(
    `SELECT m.*, c.id AS ciclo_id, c.fecha_inicio, c.fecha_fin, c.estado
     FROM maquinas_esterilizacion m
     LEFT JOIN LATERAL (
       SELECT * FROM ciclos_esterilizacion WHERE maquina_id=m.id AND estado='en_proceso' ORDER BY id DESC LIMIT 1
     ) c ON true
     ORDER BY m.id`
  ));
});

app.post("/api/esterilizacion/ciclos", async (req, res) => {
  const client = await pool.connect();
  try {
    const { maquina_id, tipo_esterilizacion = "vapor", usuario = "admin", contenido = [] } = req.body;
    if (!maquina_id) return res.status(400).json({ error: "Selecciona una maquina." });
    const active = await client.query("SELECT id FROM ciclos_esterilizacion WHERE maquina_id=$1 AND estado='en_proceso'", [maquina_id]);
    if (active.rows[0]) return res.status(409).json({ error: "La maquina ya tiene un ciclo en proceso." });
    await client.query("BEGIN");
    const cycle = await client.query(
      `INSERT INTO ciclos_esterilizacion (maquina_id, tipo_esterilizacion, fecha_inicio, estado, usuario, testigo_ok)
       VALUES ($1,$2,$3,'en_proceso',$4,0) RETURNING id`,
      [maquina_id, tipo_esterilizacion, nowSql(), usuario]
    );
    for (const item of contenido) {
      await client.query(
        "INSERT INTO ciclo_contenido (ciclo_id, caja_id, instrumento_id, cantidad) VALUES ($1,$2,$3,$4)",
        [cycle.rows[0].id, item.tipo === "caja" ? item.id : null, item.tipo === "instrumento" ? item.id : null, item.cantidad || 1]
      );
    }
    await client.query("COMMIT");
    res.status(201).json({ id: cycle.rows[0].id });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

app.post("/api/esterilizacion/ciclos/:id/finalizar", async (req, res) => {
  const client = await pool.connect();
  try {
    const cycleResult = await client.query("SELECT * FROM ciclos_esterilizacion WHERE id=$1", [req.params.id]);
    const cycle = cycleResult.rows[0];
    if (!cycle) return res.status(404).json({ error: "Ciclo no encontrado." });
    const fin = nowSql();
    const caducidad = new Date();
    caducidad.setDate(caducidad.getDate() + (cycle.tipo_esterilizacion === "plasma" ? 14 : 30));
    await client.query("BEGIN");
    await client.query("UPDATE ciclos_esterilizacion SET estado='finalizado', fecha_fin=$1, testigo_ok=$2 WHERE id=$3", [fin, req.body.testigo_ok ? 1 : 0, req.params.id]);
    const contenido = await client.query("SELECT caja_id, instrumento_id, cantidad FROM ciclo_contenido WHERE ciclo_id=$1", [req.params.id]);
    for (const item of contenido.rows) {
      const tipo = item.caja_id ? "caja" : "instrumental";
      const itemId = item.caja_id || item.instrumento_id;
      const nombreResult = item.caja_id
        ? await client.query("SELECT nombre FROM cajas WHERE id=$1", [item.caja_id])
        : await client.query("SELECT nombre FROM instrumental WHERE id=$1", [item.instrumento_id]);
      const nombre = nombreResult.rows[0]?.nombre || "";
      await client.query(
        `INSERT INTO fichas_esterilizacion
         (tipo, item_id, ciclo_id, maquina_id, tipo_esterilizacion, fecha_inicio, fecha_fin, fecha_caducidad, estado, testigo_ok, incidencia, usuario, ubicacion, nombre_item)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Finalizado',$9,$10,$11,$12,$13)`,
        [tipo, itemId, cycle.id, cycle.maquina_id, cycle.tipo_esterilizacion, cycle.fecha_inicio, fin, caducidad.toISOString().slice(0, 10), req.body.testigo_ok ? "OK" : "NO OK", req.body.incidencia || "", cycle.usuario || "admin", "Almacen", nombre]
      );
    }
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

app.get("/api/esterilizacion/fichas", async (req, res) => {
  res.json(await all("SELECT * FROM fichas_esterilizacion ORDER BY fecha_inicio DESC, id DESC LIMIT 300"));
});

app.get("/api/formacion", async (req, res) => {
  const especialidades = await all("SELECT id, nombre FROM formacion_especialidades ORDER BY nombre");
  const equipos = req.query.especialidad_id ? await all("SELECT id, nombre FROM formacion_equipos WHERE especialidad_id=$1 ORDER BY nombre", [req.query.especialidad_id]) : [];
  const intervenciones = req.query.equipo_id ? await all("SELECT id, nombre FROM formacion_intervenciones WHERE equipo_id=$1 ORDER BY nombre", [req.query.equipo_id]) : [];
  const contenido = req.query.intervencion_id ? await all("SELECT id, rol, contenido, imagen FROM formacion_contenido WHERE intervencion_id=$1 ORDER BY rol", [req.query.intervencion_id]) : [];
  res.json({ especialidades, equipos, intervenciones, contenido });
});

app.post("/api/formacion/:tabla", async (req, res) => {
  const { tabla } = req.params;
  const nombre = String(req.body.nombre || "").trim();
  if (!nombre) return res.status(400).json({ error: "Nombre obligatorio." });
  const allowed = {
    especialidades: ["formacion_especialidades", ["nombre"], [nombre]],
    equipos: ["formacion_equipos", ["especialidad_id", "nombre"], [req.body.especialidad_id, nombre]],
    intervenciones: ["formacion_intervenciones", ["equipo_id", "nombre"], [req.body.equipo_id, nombre]]
  }[tabla];
  if (!allowed) return res.status(404).json({ error: "Tabla no permitida." });
  const [table, cols, params] = allowed;
  const result = await one(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`, params);
  res.status(201).json({ id: result.id });
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: error.message || "Error interno." });
});

export default app;
