import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Archive,
  BookOpen,
  Check,
  ClipboardList,
  Database,
  Factory,
  FileSearch,
  Home,
  PackagePlus,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Stethoscope,
  Syringe,
  Trash2
} from "lucide-react";
import "./styles.css";

const api = async (url, options = {}) => {
  const response = await fetch(`/api${url}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  const data = text ? (() => {
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  })() : {};
  if (!response.ok) {
    throw new Error(data.error || `${response.status} ${response.statusText}: ${text.slice(0, 180)}`);
  }
  return data;
};

const fixText = (value) => {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (!/[ÃÂ]/.test(text)) return text;
  try {
    const bytes = Uint8Array.from([...text].map((ch) => ch.charCodeAt(0) & 255));
    return new TextDecoder("utf-8").decode(bytes).replaceAll("�", "");
  } catch {
    return text;
  }
};

const Field = ({ label, children }) => (
  <label className="field">
    <span>{label}</span>
    {children}
  </label>
);

const Empty = ({ text = "Sin resultados" }) => <div className="empty">{text}</div>;

function App() {
  const [active, setActive] = useState("inicio");
  const modules = [
    ["inicio", Home, "Inicio"],
    ["quirofano", Stethoscope, "Quirofano"],
    ["esterilizacion", Factory, "Esterilizacion"],
    ["instrumental", Archive, "Instrumental"],
    ["administracion", Database, "Administracion"],
    ["formacion", BookOpen, "Formacion"]
  ];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/assets/logo_junta.png" alt="" />
          <div>
            <strong>HSJC</strong>
            <span>Bloque quirurgico</span>
          </div>
        </div>
        <nav>
          {modules.map(([id, Icon, label]) => (
            <button key={id} className={active === id ? "active" : ""} onClick={() => setActive(id)} title={label}>
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </aside>
      <section className="workspace">
        {active === "inicio" && <Dashboard setActive={setActive} />}
        {active === "quirofano" && <Quirofano />}
        {active === "esterilizacion" && <Esterilizacion />}
        {active === "instrumental" && <Instrumental />}
        {active === "administracion" && <Administracion />}
        {active === "formacion" && <Formacion />}
      </section>
    </main>
  );
}

function Dashboard({ setActive }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/dashboard").then((result) => {
      setData(result);
      setError("");
    }).catch((err) => {
      console.error(err);
      setError(err.message || "No se pudo cargar la API.");
    });
  }, []);
  const cards = [
    ["quirofano", "Intervenciones", data?.intervenciones?.total ?? "-"],
    ["esterilizacion", "Ciclos activos", data?.ciclos?.total ?? "-"],
    ["instrumental", "Cajas", data?.cajas?.total ?? "-"],
    ["administracion", "Tabla maestra", data?.maestra?.total ?? "-"],
    ["administracion", "Implantes deposito", data?.depositos?.total ?? "-"],
    ["esterilizacion", "Fichas esterilizacion", data?.fichas?.total ?? "-"]
  ];
  return (
    <>
      <Header title="Panel operativo" subtitle="Consulta y registra actividad sobre la SQLite hospital.db" />
      {error && <div className="alert">Error API: {error}</div>}
      <div className="metric-grid">
        {cards.map(([target, label, value]) => (
          <button className="metric-card" key={label} onClick={() => setActive(target)}>
            <span>{label}</span>
            <strong>{value}</strong>
          </button>
        ))}
      </div>
    </>
  );
}

function Header({ title, subtitle, action }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

function Quirofano() {
  const [options, setOptions] = useState({ pacientes: [], especialidades: [], facultativos: [], maquinas: [] });
  const [procedimientos, setProcedimientos] = useState([]);
  const [zonas, setZonas] = useState([]);
  const [form, setForm] = useState({
    paciente_id: "",
    especialidad: "",
    procedimiento: "",
    facultativo_cnp: "",
    fecha_intervencion: new Date().toISOString().slice(0, 10),
    zona_anatomica: "",
    lateralidad: "N/A"
  });
  const [scan, setScan] = useState("");
  const [implantes, setImplantes] = useState([]);
  const [intervenciones, setIntervenciones] = useState([]);
  const [selected, setSelected] = useState(null);
  const [message, setMessage] = useState("");

  const loadOptions = () => api("/options").then((data) => {
    setOptions(data);
    setForm((f) => ({ ...f, especialidad: f.especialidad || data.especialidades[0] || "" }));
  });
  const loadIntervenciones = () => api("/intervenciones").then(setIntervenciones);
  useEffect(() => {
    loadOptions();
    loadIntervenciones();
  }, []);
  useEffect(() => {
    if (!form.especialidad) return;
    api(`/procedimientos?especialidad=${encodeURIComponent(form.especialidad)}`).then((rows) => {
      setProcedimientos(rows);
      setForm((f) => ({ ...f, procedimiento: rows[0]?.nombre_procedimiento || "" }));
    });
    api(`/zonas?especialidad=${encodeURIComponent(form.especialidad)}`).then((rows) => setZonas(rows));
  }, [form.especialidad]);

  const addImplante = async () => {
    setMessage("");
    const data = await api("/gs1", { method: "POST", body: { codigo: scan } });
    if (!data.gtin) throw new Error("No se ha detectado GTIN en el GS1.");
    if (!data.maestra) throw new Error(`El GTIN ${data.gtin} no existe en tabla maestra.`);
    setImplantes((items) => [
      ...items,
      {
        gtin: data.gtin,
        descripcion: data.maestra.nombre,
        referencia: data.deposito?.referencia || data.maestra.referencia,
        lote: data.lote || data.deposito?.lote || "",
        caducidad: data.caducidad || data.deposito?.caducidad || "",
        numero_serie: data.numero_serie || "",
        fabricante: data.maestra.fabricante || "",
        tamano: data.maestra.tamano || "",
        lateralidad: data.maestra.lateralidad || form.lateralidad,
        material: data.maestra.material || ""
      }
    ]);
    setScan("");
  };

  const save = async () => {
    setMessage("");
    const result = await api("/intervenciones", { method: "POST", body: { ...form, implantes } });
    setMessage(`Intervencion registrada #${result.id}`);
    setImplantes([]);
    loadIntervenciones();
  };

  const openDetail = async (id) => setSelected(await api(`/intervenciones/${id}`));
  const sendAdmin = async (id) => {
    await api(`/intervenciones/${id}/enviar-administracion`, { method: "POST" });
    setMessage(`Intervencion #${id} enviada a administracion`);
  };

  return (
    <>
      <Header title="Quirofano" subtitle="Registro de intervenciones, implantes y busqueda historica" />
      <div className="two-column">
        <section className="panel">
          <h2>Nueva intervencion</h2>
          <div className="form-grid">
            <Field label="Paciente">
              <select value={form.paciente_id} onChange={(e) => setForm({ ...form, paciente_id: e.target.value })}>
                <option value="">Seleccionar</option>
                {options.pacientes.map((p) => <option key={p.id} value={p.id}>{fixText(p.apellidos)}, {fixText(p.nombre)} · {p.nhc}</option>)}
              </select>
            </Field>
            <Field label="Especialidad">
              <select value={form.especialidad} onChange={(e) => setForm({ ...form, especialidad: e.target.value })}>
                {options.especialidades.map((e) => <option key={e} value={e}>{fixText(e)}</option>)}
              </select>
            </Field>
            <Field label="Procedimiento">
              <select value={form.procedimiento} onChange={(e) => setForm({ ...form, procedimiento: e.target.value })}>
                {procedimientos.map((p) => <option key={p.id} value={p.nombre_procedimiento}>{fixText(p.nombre_procedimiento)}</option>)}
              </select>
            </Field>
            <Field label="Facultativo">
              <select value={form.facultativo_cnp} onChange={(e) => setForm({ ...form, facultativo_cnp: e.target.value })}>
                <option value="">Seleccionar</option>
                {options.facultativos.map((f) => <option key={f.id} value={f.cnp}>{fixText(f.apellidos)}, {fixText(f.nombre)} ({f.cnp})</option>)}
              </select>
            </Field>
            <Field label="Fecha">
              <input type="date" value={form.fecha_intervencion} onChange={(e) => setForm({ ...form, fecha_intervencion: e.target.value })} />
            </Field>
            <Field label="Zona anatomica">
              <select value={form.zona_anatomica} onChange={(e) => setForm({ ...form, zona_anatomica: e.target.value })}>
                <option value="">Sin zona</option>
                {zonas.map((z) => <option key={z.zona} value={z.zona}>{fixText(z.zona)}</option>)}
              </select>
            </Field>
            <Field label="Lateralidad">
              <select value={form.lateralidad} onChange={(e) => setForm({ ...form, lateralidad: e.target.value })}>
                {["Derecha", "Izquierda", "Bilateral", "N/A"].map((x) => <option key={x}>{x}</option>)}
              </select>
            </Field>
          </div>
          <div className="scan-row">
            <input value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addImplante().catch((err) => setMessage(err.message))} placeholder="Escanear GS1 del implante" />
            <button onClick={() => addImplante().catch((err) => setMessage(err.message))} title="Anadir implante"><Plus size={18} /></button>
          </div>
          <ImplantesTable implantes={implantes} remove={(idx) => setImplantes((items) => items.filter((_, i) => i !== idx))} />
          <div className="button-row">
            <button className="primary" onClick={() => save().catch((err) => setMessage(err.message))}><Save size={18} />Registrar</button>
          </div>
          {message && <p className="status">{message}</p>}
        </section>
        <section className="panel">
          <h2>Historial</h2>
          <DataTable
            rows={intervenciones}
            columns={[
              ["fecha_intervencion", "Fecha"],
              ["apellidos", "Paciente", (r) => `${fixText(r.apellidos)}, ${fixText(r.nombre)}`],
              ["especialidad", "Especialidad", (r) => fixText(r.especialidad)],
              ["procedimiento", "Procedimiento", (r) => fixText(r.procedimiento)],
              ["facultativo_cnp", "CNP"]
            ]}
            actions={(row) => (
              <>
                <button onClick={() => openDetail(row.id)} title="Ver detalle"><FileSearch size={16} /></button>
                <button onClick={() => sendAdmin(row.id)} title="Enviar a administracion"><Send size={16} /></button>
              </>
            )}
          />
        </section>
      </div>
      {selected && <DetailModal data={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function ImplantesTable({ implantes, remove }) {
  if (!implantes.length) return <Empty text="Sin implantes anadidos" />;
  return (
    <table>
      <thead><tr><th>Nombre</th><th>Referencia</th><th>Lote</th><th>Caducidad</th><th>Fabricante</th><th></th></tr></thead>
      <tbody>
        {implantes.map((imp, idx) => (
          <tr key={`${imp.gtin}-${idx}`}>
            <td>{fixText(imp.descripcion)}</td>
            <td>{imp.referencia}</td>
            <td>{imp.lote}</td>
            <td>{imp.caducidad}</td>
            <td>{fixText(imp.fabricante)}</td>
            <td><button onClick={() => remove(idx)} title="Eliminar"><Trash2 size={16} /></button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DetailModal({ data, onClose }) {
  const { intervencion, implantes } = data;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal" onClick={(e) => e.stopPropagation()}>
        <Header title={`Intervencion #${intervencion.id}`} subtitle={`${fixText(intervencion.apellidos)}, ${fixText(intervencion.nombre)} · ${intervencion.fecha_intervencion}`} action={<button onClick={onClose}>Cerrar</button>} />
        <p>{fixText(intervencion.especialidad)} · {fixText(intervencion.procedimiento)} · {intervencion.facultativo_cnp}</p>
        <DataTable
          rows={implantes}
          columns={[
            ["descripcion", "Implante", (r) => fixText(r.descripcion)],
            ["referencia", "Referencia"],
            ["lote", "Lote"],
            ["caducidad", "Caducidad"],
            ["fabricante", "Fabricante", (r) => fixText(r.fabricante)]
          ]}
        />
      </section>
    </div>
  );
}

function Administracion() {
  const [tab, setTab] = useState("maestra");
  const [health, setHealth] = useState("");
  useEffect(() => {
    api("/health")
      .then((data) => setHealth(`API OK - ${data.tables} tablas`))
      .catch((err) => setHealth(`API error - ${err.message}`));
  }, []);
  return (
    <>
      <Header title="Administracion" subtitle="Maestra de implantes, GTIN y deposito" />
      {health && <div className={health.startsWith("API OK") ? "notice" : "alert"}>{health}</div>}
      <div className="tabs">
        <button className={tab === "maestra" ? "active" : ""} onClick={() => setTab("maestra")}><Database size={16} />Tabla maestra</button>
        <button className={tab === "deposito" ? "active" : ""} onClick={() => setTab("deposito")}><PackagePlus size={16} />Deposito</button>
      </div>
      {tab === "maestra" ? <Maestra /> : <Deposito />}
    </>
  );
}

function Maestra() {
  const blank = { referencia: "", nombre: "", especialidad: "", tipo: "", lateralidad: "", material: "", fabricante: "", gtin: "", tamano: "", modelo: "" };
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  const [edit, setEdit] = useState(blank);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const load = () => api(`/maestra?q=${encodeURIComponent(q)}`)
    .then((data) => {
      setRows(data);
      setError("");
    })
    .catch((err) => {
      setRows([]);
      setError(err.message);
    });
  useEffect(() => { load(); }, []);
  const save = async () => {
    setMessage("");
    if (edit.id) await api(`/maestra/${edit.id}`, { method: "PUT", body: edit });
    else await api("/maestra", { method: "POST", body: edit });
    setEdit(blank);
    setMessage("Registro guardado");
    load();
  };
  return (
    <div className="two-column">
      <section className="panel">
        <div className="scan-row">
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} placeholder="Buscar referencia, nombre, GTIN o especialidad" />
          <button onClick={load} title="Buscar"><Search size={18} /></button>
        </div>
        {error && <div className="alert">Error maestra: {error}</div>}
        <DataTable
          rows={rows}
          columns={[
            ["referencia", "Referencia"],
            ["nombre", "Nombre", (r) => fixText(r.nombre)],
            ["especialidad", "Especialidad", (r) => fixText(r.especialidad)],
            ["gtin", "GTIN"]
          ]}
          actions={(row) => <button onClick={() => setEdit(row)} title="Editar"><ClipboardList size={16} /></button>}
        />
      </section>
      <section className="panel">
        <h2>{edit.id ? "Editar registro" : "Nueva adquisicion"}</h2>
        <div className="form-grid compact">
          {Object.keys(blank).map((key) => (
            <Field key={key} label={key}>
              <input value={edit[key] || ""} onChange={(e) => setEdit({ ...edit, [key]: e.target.value })} />
            </Field>
          ))}
        </div>
        <div className="button-row">
          <button className="primary" onClick={() => save().catch((err) => setMessage(err.message))}><Save size={18} />Guardar</button>
          <button onClick={() => setEdit(blank)}>Limpiar</button>
        </div>
        {message && <p className="status">{message}</p>}
      </section>
    </div>
  );
}

function Deposito() {
  const [filters, setFilters] = useState({ gtin: "", referencia: "", lote: "" });
  const [rows, setRows] = useState([]);
  const [codigo, setCodigo] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const load = () => api(`/deposito?${new URLSearchParams(filters)}`)
    .then((data) => {
      setRows(data);
      setError("");
    })
    .catch((err) => {
      setRows([]);
      setError(err.message);
    });
  useEffect(() => { load(); }, []);
  const register = async () => {
    const row = await api("/deposito", { method: "POST", body: { codigo } });
    setCodigo("");
    setMessage(`Entrada registrada #${row.id}`);
    load();
  };
  return (
    <div className="two-column">
      <section className="panel">
        <h2>Entrada de deposito</h2>
        <div className="scan-row">
          <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Escanear codigo GS1" />
          <button className="primary" onClick={() => register().catch((err) => setMessage(err.message))}><PackagePlus size={18} />Registrar</button>
        </div>
        {message && <p className="status">{message}</p>}
      </section>
      <section className="panel">
        <h2>Buscar deposito</h2>
        <div className="filter-row">
          {Object.keys(filters).map((key) => <input key={key} value={filters[key]} onChange={(e) => setFilters({ ...filters, [key]: e.target.value })} placeholder={key} />)}
          <button onClick={load} title="Buscar"><Search size={18} /></button>
        </div>
        {error && <div className="alert">Error deposito: {error}</div>}
        <DataTable rows={rows} columns={[["gtin", "GTIN"], ["referencia", "Referencia"], ["nombre", "Nombre", (r) => fixText(r.nombre)], ["lote", "Lote"], ["caducidad", "Caducidad"], ["fecha_entrada", "Entrada"]]} />
      </section>
    </div>
  );
}

function Esterilizacion() {
  const [maquinas, setMaquinas] = useState([]);
  const [fichas, setFichas] = useState([]);
  const [codigo, setCodigo] = useState("");
  const [contenido, setContenido] = useState([]);
  const [selectedMachine, setSelectedMachine] = useState("");
  const [message, setMessage] = useState("");
  const load = () => {
    api("/esterilizacion/maquinas").then(setMaquinas);
    api("/esterilizacion/fichas").then(setFichas);
  };
  useEffect(() => { load(); }, []);
  const scanCaja = async () => {
    const data = await api(`/cajas/${encodeURIComponent(codigo)}/contenido`);
    setContenido((items) => [...items, { tipo: "caja", id: data.caja.id, nombre: data.caja.nombre }]);
    setCodigo("");
  };
  const start = async () => {
    const result = await api("/esterilizacion/ciclos", { method: "POST", body: { maquina_id: selectedMachine, contenido } });
    setMessage(`Ciclo iniciado #${result.id}`);
    setContenido([]);
    load();
  };
  const finish = async (id) => {
    await api(`/esterilizacion/ciclos/${id}/finalizar`, { method: "POST", body: { testigo_ok: true } });
    setMessage(`Ciclo #${id} finalizado`);
    load();
  };
  return (
    <>
      <Header title="Esterilizacion" subtitle="Maquinas, ciclos, contenido de cajas y fichas" action={<button onClick={load} title="Actualizar"><RefreshCw size={18} /></button>} />
      <div className="machine-grid">
        {maquinas.map((m) => (
          <article className={m.ciclo_id ? "machine active" : "machine"} key={m.id}>
            <strong>{fixText(m.nombre)}</strong>
            <span>{fixText(m.tipo)} · {m.ciclo_id ? `Ciclo #${m.ciclo_id}` : "Disponible"}</span>
            {m.ciclo_id && <button onClick={() => finish(m.ciclo_id)}><Check size={16} />Finalizar</button>}
          </article>
        ))}
      </div>
      <div className="two-column">
        <section className="panel">
          <h2>Nuevo ciclo</h2>
          <Field label="Maquina">
            <select value={selectedMachine} onChange={(e) => setSelectedMachine(e.target.value)}>
              <option value="">Seleccionar</option>
              {maquinas.map((m) => <option key={m.id} value={m.id}>{fixText(m.nombre)} ({fixText(m.tipo)})</option>)}
            </select>
          </Field>
          <div className="scan-row">
            <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Escanear caja por codigo" />
            <button onClick={() => scanCaja().catch((err) => setMessage(err.message))}><Plus size={18} /></button>
          </div>
          <ul className="chip-list">{contenido.map((c, i) => <li key={`${c.id}-${i}`}>{fixText(c.nombre)}</li>)}</ul>
          <button className="primary" onClick={() => start().catch((err) => setMessage(err.message))}><Syringe size={18} />Iniciar ciclo</button>
          {message && <p className="status">{message}</p>}
        </section>
        <section className="panel">
          <h2>Fichas</h2>
          <DataTable rows={fichas} columns={[["id", "#"], ["nombre_item", "Item", (r) => fixText(r.nombre_item || r.item_id)], ["tipo_esterilizacion", "Tipo"], ["fecha_inicio", "Inicio"], ["fecha_caducidad", "Caducidad"], ["estado", "Estado"]]} />
        </section>
      </div>
    </>
  );
}

function Instrumental() {
  const [data, setData] = useState({ especialidades: [], cajas: [], contenido: [] });
  const [especialidad, setEspecialidad] = useState("");
  const [caja, setCaja] = useState("");
  useEffect(() => { api("/instrumental").then(setData); }, []);
  useEffect(() => {
    const params = new URLSearchParams();
    if (especialidad) params.set("especialidad", especialidad);
    if (caja) params.set("caja_id", caja);
    api(`/instrumental?${params}`).then(setData);
  }, [especialidad, caja]);
  return (
    <>
      <Header title="Instrumental" subtitle="Consulta de cajas por especialidad y contenido" />
      <div className="two-column">
        <section className="panel">
          <Field label="Especialidad">
            <select value={especialidad} onChange={(e) => { setEspecialidad(e.target.value); setCaja(""); }}>
              <option value="">Seleccionar</option>
              {data.especialidades.map((e) => <option key={e.especialidad} value={e.especialidad}>{fixText(e.especialidad)}</option>)}
            </select>
          </Field>
          <DataTable rows={data.cajas} columns={[["nombre_caja", "Caja", (r) => fixText(r.nombre_caja)]]} actions={(row) => <button onClick={() => setCaja(row.id)}><FileSearch size={16} /></button>} />
        </section>
        <section className="panel">
          <h2>Contenido</h2>
          <DataTable rows={data.contenido} columns={[["nombre", "Instrumento", (r) => fixText(r.nombre)], ["descripcion", "Descripcion", (r) => fixText(r.descripcion)]]} />
        </section>
      </div>
    </>
  );
}

function Formacion() {
  const [data, setData] = useState({ especialidades: [], equipos: [], intervenciones: [], contenido: [] });
  const [sel, setSel] = useState({ especialidad_id: "", equipo_id: "", intervencion_id: "" });
  const [name, setName] = useState("");
  const load = (next = sel) => {
    const params = new URLSearchParams(Object.entries(next).filter(([, v]) => v));
    api(`/formacion?${params}`).then(setData);
  };
  useEffect(() => { load(); }, []);
  const add = async (tabla) => {
    const body = { nombre: name, ...sel };
    await api(`/formacion/${tabla}`, { method: "POST", body });
    setName("");
    load();
  };
  const setAndLoad = (patch) => {
    const next = { ...sel, ...patch };
    setSel(next);
    load(next);
  };
  return (
    <>
      <Header title="Formacion" subtitle="Arbol de especialidades, equipos, intervenciones y contenido por rol" />
      <section className="panel">
        <div className="form-grid">
          <Field label="Especialidad"><select value={sel.especialidad_id} onChange={(e) => setAndLoad({ especialidad_id: e.target.value, equipo_id: "", intervencion_id: "" })}><option value="">Seleccionar</option>{data.especialidades.map((x) => <option key={x.id} value={x.id}>{fixText(x.nombre)}</option>)}</select></Field>
          <Field label="Equipo"><select value={sel.equipo_id} onChange={(e) => setAndLoad({ equipo_id: e.target.value, intervencion_id: "" })}><option value="">Seleccionar</option>{data.equipos.map((x) => <option key={x.id} value={x.id}>{fixText(x.nombre)}</option>)}</select></Field>
          <Field label="Intervencion"><select value={sel.intervencion_id} onChange={(e) => setAndLoad({ intervencion_id: e.target.value })}><option value="">Seleccionar</option>{data.intervenciones.map((x) => <option key={x.id} value={x.id}>{fixText(x.nombre)}</option>)}</select></Field>
        </div>
        <div className="scan-row">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre nuevo" />
          <button onClick={() => add("especialidades")}><Plus size={16} />Especialidad</button>
          <button onClick={() => add("equipos")}><Plus size={16} />Equipo</button>
          <button onClick={() => add("intervenciones")}><Plus size={16} />Intervencion</button>
        </div>
      </section>
      <section className="panel">
        <h2>Contenido</h2>
        <DataTable rows={data.contenido} columns={[["rol", "Rol"], ["contenido", "Contenido", (r) => fixText(r.contenido)]]} />
      </section>
    </>
  );
}

function DataTable({ rows, columns, actions }) {
  if (!rows?.length) return <Empty />;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{columns.map(([, label]) => <th key={label}>{label}</th>)}{actions && <th></th>}</tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={row.id || idx}>
              {columns.map(([key, , render]) => <td key={key}>{render ? render(row) : fixText(row[key])}</td>)}
              {actions && <td className="actions">{actions(row)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
