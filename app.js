// ========= SUPABASE CONFIG =========
const SUPABASE_URL  = 'https://lnjfnknciydxfgnyhfnf.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxuamZua25jaXlkeGZnbnloZm5mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwNDcxMjQsImV4cCI6MjA4OTYyMzEyNH0.HRkZcoDpAbzO8U36Lo_5E1_i6aA7oWEX5lg4PO6SjlQ';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ========= ESTADO GLOBAL =========
let currentUser   = null;
let currentPerfil = null;
let rawData       = [];
let filteredData  = [];
let repoData      = [];
let reunionesData = [];  // reuniones por eje
let ejesData      = [];  // catálogo de ejes
let hitosData     = [];  // catálogo de hitos
let editingId     = null;
let currentView   = 'actividades';
let categoriaSeleccionada = 'Planificación';

// ========= INIT =========
window.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return; }

  currentUser = session.user;
  await loadPerfil();

  // Bloquear acceso si cuenta desactivada
  if (currentPerfil && currentPerfil.activo === false) {
    await sb.auth.signOut();
    window.location.href = 'login.html?msg=desactivado';
    return;
  }
  // Usuario POI no puede acceder a index.html — redirigir a reportes
  if (currentPerfil?.rol === 'poi') {
    window.location.href = 'reportes.html';
    return;
  }
  bindNav();
  bindEvents();
  await loadActividades();
  await loadEquipoUsuarios();
  updateDateBadge();

  // Todo cargado — ocultar loader y mostrar app
  const loader = document.getElementById('appLoader');
  if (loader) {
    loader.classList.add('fade-out');
    setTimeout(() => { loader.style.display = 'none'; }, 300);
  }
  document.body.style.opacity = '1';
  document.body.style.transition = 'opacity .2s ease';

  // ========= TIEMPO REAL =========
  // Actualiza automáticamente cuando cualquier usuario cambia datos
  sb.channel('promovilidad-cambios')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'actividades' }, () => {
      const ejeAntes = ejeSeleccionado;
      loadActividades().then(() => { ejeSeleccionado = ejeAntes; });
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ejes' }, () => {
      const ejeAntes = ejeSeleccionado;
      loadActividades().then(() => { ejeSeleccionado = ejeAntes; });
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'hitos' }, () => {
      const ejeAntes = ejeSeleccionado;
      loadActividades().then(() => { ejeSeleccionado = ejeAntes; });
    })
    .subscribe();
});

// ========= PERFIL =========
async function loadPerfil() {
  const { data } = await sb.from('perfiles').select('*').eq('id', currentUser.id).single();
  currentPerfil = data;

  const nombre = data?.nombre || currentUser.email.split('@')[0];
  const rol    = data?.rol    || 'tecnico';

  document.getElementById('userName').textContent  = nombre;
  document.getElementById('userRole').textContent  = rol.charAt(0).toUpperCase() + rol.slice(1);
  document.getElementById('userAvatar').textContent = nombre.charAt(0).toUpperCase();

  // Mostrar sección de usuarios solo a admin
  if (rol === 'admin') {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
  }
}

// ========= COMISIÓN =========
function calcularComision() {
  const personas   = parseInt(document.getElementById('fComisionPersonasVal')?.value) || 0;
  const dias       = parseInt(document.getElementById('fComisionDiasVal')?.value)     || 0;
  const costoDia   = parseInt(document.getElementById('fComisionCostoDiario')?.value) || 320;
  const total      = personas * dias * costoDia;
  const el = document.getElementById('fComisionTotal');
  if (el) el.textContent = 'S/. ' + total.toLocaleString('es-PE', {minimumFractionDigits:2});
}

function autocompletarComisionDesdeFechas() {
  const ini = document.getElementById('fFechaInicio')?.value;
  const fin = document.getElementById('fFechaFin')?.value;
  if (ini && fin) {
    const d1   = new Date(ini + 'T00:00:00');
    const d2   = new Date(fin + 'T00:00:00');
    const dias = Math.max(1, Math.round((d2 - d1) / 86400000) + 1);
    const elDiv = document.getElementById('fComisionDias');
    const elVal = document.getElementById('fComisionDiasVal');
    if (elDiv) elDiv.textContent = dias + ' día' + (dias !== 1 ? 's' : '');
    if (elVal) elVal.value = dias;
  }
}

function autocompletarComisionDesdeEquipo() {
  const equipo = document.getElementById('fEquipo')?.value.trim();
  const personas = equipo ? (equipo.split(',').map(s => s.trim()).filter(Boolean).length || 1) : 0;
  const elDiv = document.getElementById('fComisionPersonas');
  const elVal = document.getElementById('fComisionPersonasVal');
  if (elDiv) elDiv.textContent = personas > 0 ? personas + ' persona' + (personas !== 1 ? 's' : '') : '—';
  if (elVal) elVal.value = personas;
}

// ========= NAVEGACIÓN =========
function bindNav() {
  document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
}

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelector(`.nav-item[data-view="${view}"]`)?.classList.add('active');

  const views = ['actividades','repositorio','gantt','usuarios','auditoria','manual'];
  views.forEach(v => {
    const el = document.getElementById('view' + v.charAt(0).toUpperCase() + v.slice(1));
    if (el) el.classList.toggle('hidden', v !== view);
  });

  const titles = { actividades: 'Ejes de Trabajo', repositorio: 'Repositorio de Documentos', gantt: 'Cronograma', usuarios: 'Gestión de Usuarios', auditoria: 'Auditoría', manual: 'Manual de uso' };
  document.getElementById('viewTitle').textContent = titles[view] || '';

  const filters = document.getElementById('sidebarFilters');
  filters.style.display = view === 'actividades' ? 'block' : 'none';

  if (view === 'repositorio') loadRepositorio();
  if (view === 'gantt')       initGanttView();
  if (view === 'usuarios')    loadUsuarios();
  if (view === 'auditoria')   loadAuditoria();
}

// ========= HELPERS =========
function esc(s) { return (s||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s + 'T00:00:00');
  if (isNaN(d)) return s;
  return d.toLocaleDateString('es-PE', { day:'2-digit', month:'2-digit', year:'numeric' });
}

function updateDateBadge() {
  const now = new Date();
  document.getElementById('dateBadge').textContent = 'Actualizado ' + now.toLocaleDateString('es-PE', { day:'2-digit', month:'long', year:'numeric' });
}

function getAlertStatus(row) {
  if ((row.estado||'').toLowerCase().includes('completado')) return null;
  if ((row.estado||'').toLowerCase().includes('bloqueado')) return null;
  if (!row.fecha_fin) return null;
  const fin = new Date(row.fecha_fin + 'T00:00:00');
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const diff = Math.ceil((fin - hoy) / 86400000);
  if (diff < 0)  return 'vencida';
  if (diff <= 7) return 'por-vencer';
  return null;
}

function estadoColor(e) {
  const m = { 'completado':'#22c55e', 'en proceso':'#3b82f6', 'pendiente':'#f59e0b', 'bloqueado':'#ef4444' };
  return m[(e||'').toLowerCase()] || '#64748b';
}

function estadoEmoji(e) {
  const m = { 'Completado':'🟢', 'En proceso':'🔵', 'Pendiente':'🟡', 'Bloqueado':'🔴' };
  return m[e] || '⚪';
}

function rolLabel(r) {
  const m = { admin:'Administrador', director:'Director', tecnico:'Técnico' };
  return m[r] || r;
}

// ========= SISTEMA DE LOG =========

// Campos con etiquetas legibles para el historial
const CAMPOS_LABEL = {
  subactividad:      'Subactividad',
  actividad_general: 'Eje de Trabajo',
  hito:              'Hito',
  responsable:       'Responsable',
  equipo_tecnico:    'Equipo técnico',
  ciudad:            'Ciudad',
  direccion:         'Dirección',
  fecha_inicio:      'Fecha inicio',
  fecha_fin:         'Fecha fin',
  estado:            'Estado',
  avance:            'Avance (%)',
  prioridad:         'Prioridad',
  producto:          'Producto/Entregable',
  evidencia:         'Evidencia',
  comentarios:       'Comentarios',
};

// Campos que requieren justificación obligatoria
const CAMPOS_CON_JUSTIFICACION = ['fecha_inicio', 'fecha_fin'];

// Inserta uno o varios registros en actividades_log
async function insertarLog(registros) {
  if (!registros.length) return;
  const { error } = await sb.from('actividades_log').insert(registros);
  if (error) console.error('Error al insertar log:', error);
}

// Compara payload nuevo con row anterior y devuelve lista de cambios
function detectarCambios(rowAnterior, payloadNuevo) {
  const cambios = [];
  const campos = Object.keys(CAMPOS_LABEL);
  campos.forEach(campo => {
    const antes  = rowAnterior[campo] != null ? String(rowAnterior[campo]) : '';
    const despues = payloadNuevo[campo]  != null ? String(payloadNuevo[campo])  : '';
    if (antes !== despues) {
      cambios.push({ campo, antes, despues });
    }
  });
  return cambios;
}

// Abre modal de justificación y resuelve con el texto ingresado (o rechaza si cancela)
function pedirJustificacion(camposCambiados) {
  return new Promise((resolve, reject) => {
    const detalles = camposCambiados.map(c =>
      `<strong>${CAMPOS_LABEL[c.campo] || c.campo}:</strong> "${c.antes || '—'}" → "${c.despues || '—'}"`
    ).join('<br>');

    document.getElementById('justModalSub').textContent  = 'Se detectaron cambios en fechas que requieren justificación';
    document.getElementById('justDetalle').innerHTML      = detalles;
    document.getElementById('justTexto').value            = '';
    openModal('justModal');

    const btnConfirm = document.getElementById('btnConfirmJust');
    const btnCancel  = document.getElementById('btnCancelJust');
    const btnClose   = document.getElementById('btnCloseJust');

    const cleanup = () => {
      btnConfirm.replaceWith(btnConfirm.cloneNode(true));
      btnCancel.replaceWith(btnCancel.cloneNode(true));
      btnClose.replaceWith(btnClose.cloneNode(true));
      closeModal('justModal');
    };

    document.getElementById('btnConfirmJust').addEventListener('click', () => {
      const texto = document.getElementById('justTexto').value.trim();
      if (!texto) { document.getElementById('justTexto').focus(); return; }
      cleanup();
      resolve(texto);
    }, { once: true });

    document.getElementById('btnCancelJust').addEventListener('click', () => {
      cleanup(); reject();
    }, { once: true });

    document.getElementById('btnCloseJust').addEventListener('click', () => {
      cleanup(); reject();
    }, { once: true });
  });
}

// Muestra historial de una actividad específica
async function verHistorialActividad(actividadId, actividadNombre) {
  document.getElementById('historialModalSub').textContent = actividadNombre || '—';
  document.getElementById('historialContent').innerHTML = '<div class="log-loading">Cargando historial...</div>';
  openModal('historialModal');

  const { data, error } = await sb.from('actividades_log')
    .select('*')
    .eq('actividad_id', actividadId)
    .order('fecha_log', { ascending: false });

  if (error || !data?.length) {
    document.getElementById('historialContent').innerHTML =
      `<div class="log-empty">Sin cambios registrados para esta actividad.</div>`;
    return;
  }

  document.getElementById('historialContent').innerHTML = renderLogTabla(data);
}

// Muestra historial de todas las actividades de un eje
async function verHistorialEje(ejeNombre) {
  document.getElementById('historialEjeModalSub').textContent = ejeNombre;
  document.getElementById('historialEjeContent').innerHTML = '<div class="log-loading">Cargando historial...</div>';
  openModal('historialEjeModal');

  const { data, error } = await sb.from('actividades_log')
    .select('*')
    .eq('actividad_nombre', ejeNombre)
    .order('fecha_log', { ascending: false });

  // También traer por actividades que pertenezcan al eje
  const idsDelEje = rawData.filter(r => r.actividad_general === ejeNombre).map(r => r.id);
  let dataEje = data || [];
  if (idsDelEje.length) {
    const { data: data2 } = await sb.from('actividades_log')
      .select('*')
      .in('actividad_id', idsDelEje)
      .order('fecha_log', { ascending: false });
    // Combinar y deduplicar por id
    const ids = new Set(dataEje.map(r => r.id));
    (data2 || []).forEach(r => { if (!ids.has(r.id)) { dataEje.push(r); ids.add(r.id); } });
    dataEje.sort((a,b) => new Date(b.fecha_log) - new Date(a.fecha_log));
  }

  if (!dataEje.length) {
    document.getElementById('historialEjeContent').innerHTML =
      `<div class="log-empty">Sin cambios registrados para este eje.</div>`;
    return;
  }

  document.getElementById('historialEjeContent').innerHTML = renderLogTabla(dataEje, true);
}

function renderLogTabla(rows, mostrarActividad = false) {
  const accionLabel = { edicion: '✏️ Edición', eliminacion: '🗑️ Eliminación', creacion: '➕ Creación' };
  const accionStyle = { edicion: 'color:var(--blue)', eliminacion: 'color:var(--red)', creacion: 'color:var(--signal-dk)' };

  return `
    <table class="repo-table log-table">
      <thead><tr>
        <th style="width:140px">Fecha</th>
        <th style="width:120px">Usuario</th>
        <th style="width:90px">Acción</th>
        ${mostrarActividad ? '<th>Actividad</th>' : ''}
        <th>Campo</th>
        <th>Antes</th>
        <th>Después</th>
        <th>Justificación</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td class="muted-text" style="font-size:11px;white-space:nowrap">
              ${r.fecha_log ? new Date(r.fecha_log).toLocaleString('es-PE', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—'}
            </td>
            <td style="font-weight:600;font-size:12px">${esc(r.usuario_nombre || '—')}</td>
            <td style="font-size:12px;${accionStyle[r.tipo_accion]||''}">
              ${accionLabel[r.tipo_accion] || r.tipo_accion}
            </td>
            ${mostrarActividad ? `<td style="font-size:12px">${esc(r.actividad_nombre||'—')}</td>` : ''}
            <td style="font-size:12px;font-weight:500">${esc(CAMPOS_LABEL[r.campo_modificado] || r.campo_modificado || '—')}</td>
            <td class="muted-text" style="font-size:12px">${esc(r.valor_anterior || '—')}</td>
            <td style="font-size:12px">${esc(r.valor_nuevo || '—')}</td>
            <td style="font-size:12px;color:var(--text-muted);font-style:${r.justificacion?'normal':'italic'}">
              ${esc(r.justificacion || '—')}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}


async function loadActividades() {
  document.getElementById('countBadge').textContent = 'Cargando...';
  try {
    const [resActs, resEjes, resHitos] = await Promise.all([
      sb.from('actividades').select('*').order('id'),
      sb.from('ejes').select('*').order('nombre'),
      sb.from('hitos').select('*').order('eje_nombre,nombre'),
    ]);

    if (resActs.error) console.error('actividades error:', resActs.error);
    if (resEjes.error) console.error('ejes error:', resEjes.error);
    if (resHitos.error) console.error('hitos error:', resHitos.error);

    rawData   = resActs.data  || [];
    ejesData  = resEjes.data  || [];
    hitosData = resHitos.data || [];

    // Si ejesData está vacío pero hay actividades, reconstruir ejes desde actividades (fallback)
    if (!ejesData.length && rawData.length) {
      const nombresEjes = [...new Set(rawData.map(r => r.actividad_general).filter(Boolean))];
      ejesData = nombresEjes.map(n => ({ nombre: n }));
    }
    if (!hitosData.length && rawData.length) {
      const pairs = [...new Set(rawData.filter(r=>r.hito).map(r => `${r.actividad_general}|||${r.hito}`))];
      hitosData = pairs.map(p => { const [e,h] = p.split('|||'); return { eje_nombre: e, nombre: h }; });
    }

  } catch(err) {
    console.error('loadActividades error:', err);
  }
  populateSelects();
  applyFilters();
}

// ========= SELECTS DINÁMICOS =========
function populateSelects() {
  const unique = (key) => [...new Set(rawData.map(r => r[key]).filter(Boolean))].sort((a,b) => a.localeCompare(b,'es'));

  const fill = (id, vals) => {
    const sel = document.getElementById(id);
    const cur = sel.value;
    const first = sel.options[0].outerHTML;
    sel.innerHTML = first + vals.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    // Solo restaurar si el valor actual sigue siendo válido en la nueva lista
    if (cur && vals.includes(cur)) sel.value = cur;
  };

  fill('fResp',   unique('responsable'));
  fill('fCiudad', unique('ciudad'));
  fill('fActGen', unique('actividad_general'));

  // Gantt select
  const gSel = document.getElementById('ganttActividad');
  const gCur = gSel.value;
  gSel.innerHTML = '<option value="">Todas las actividades</option>' +
    unique('actividad_general').map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  if (gCur) gSel.value = gCur;
}

// ========= FILTROS =========
function applyFilters() {
  const q      = (document.getElementById('q').value || '').toLowerCase().trim();
  const estado = document.getElementById('fEstado').value;
  const resp   = document.getElementById('fResp').value;
  const ciudad = document.getElementById('fCiudad').value;
  const actGen = document.getElementById('fActGen').value;
  const desde  = document.getElementById('fDesde').value;
  const hasta  = document.getElementById('fHasta').value;

  filteredData = rawData.filter(r => {
    const txt = [r.actividad_general, r.hito, r.subactividad, r.responsable, r.equipo_tecnico, r.ciudad, r.comentarios].join(' ').toLowerCase();
    if (q      && !txt.includes(q))                      return false;
    if (estado && r.estado !== estado)                   return false;
    if (resp   && r.responsable !== resp)                return false;
    if (ciudad && r.ciudad !== ciudad)                   return false;
    if (actGen && r.actividad_general !== actGen)        return false;
    if (desde  && r.fecha_fin && r.fecha_fin < desde)   return false;
    if (hasta  && r.fecha_inicio && r.fecha_inicio > hasta) return false;
    return true;
  });

  renderList();
  document.getElementById('countBadge').textContent = `${filteredData.length} de ${rawData.length} actividades`;
}

// ========= LISTA ACTIVIDADES — diseño dos paneles =========
let ejeSeleccionado = null;

function renderList() {
  const list = document.getElementById('list');
  const data = filteredData.filter(r => r.subactividad && r.subactividad !== '__placeholder__');

  if (!data.length) {
    list.innerHTML = `<div class="empty-state">No se encontraron actividades con estos filtros.</div>`;
    document.getElementById('countBadge').textContent = '0 Actividades';
    return;
  }

  // Agrupar por Actividad General — incluir ejes del catálogo aunque estén vacíos
  const byAct = new Map();
  const hayFiltroActivo = data.length < rawData.filter(r => r.subactividad && r.subactividad !== '__placeholder__').length;
  // Solo inicializar ejes vacíos del catálogo si NO hay filtro activo
  if (!hayFiltroActivo) {
    ejesData.forEach(e => { if (!byAct.has(e.nombre)) byAct.set(e.nombre, []); });
  }
  // Agregar las actividades reales
  data.forEach(r => {
    const k = (r.actividad_general || '—').trim();
    if (!byAct.has(k)) byAct.set(k, []);
    byAct.get(k).push(r);
  });

  const pctAvg = (rows) => {
    const activas = rows.filter(r => !(r.estado||'').toLowerCase().includes('bloqueado'));
    const n = activas.length; if (!n) return 0;
    return Math.round(activas.reduce((s,r) => s+(r.avance||0),0)/n);
  };

  const hitoNum = (h) => { const m=(h||'').match(/(\d+)/); return m?parseInt(m[1]):9999; };

  const acts = [...byAct.keys()]
    .filter(actName => {
      if (!categoriaSeleccionada) return true;
      const eje = ejesData.find(e => e.nombre === actName);
      return (eje?.tipo || 'Planificación') === categoriaSeleccionada;
    })
    .sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'}));

  // Si el eje seleccionado ya no existe, ir al primero
  if (ejeSeleccionado && !acts.includes(ejeSeleccionado)) ejeSeleccionado = acts[0] || null;
  if (!ejeSeleccionado && acts.length) ejeSeleccionado = acts[0];

  // ── Generar HTML panel izquierdo ──
  const buildLeftHTML = () => {
    const cardsHTML = acts.map(actName => {
    const allRows = byAct.get(actName);
    const rows = allRows.filter(r => r.subactividad !== '__placeholder__');
    const pct  = pctAvg(rows);
    const comp = rows.filter(r=>(r.estado||'').includes('Completado')).length;
    const proc = rows.filter(r=>(r.estado||'').includes('proceso')).length;
    const pend = rows.filter(r=>(r.estado||'').includes('Pendiente')).length;
    const bloq = rows.filter(r=>(r.estado||'').includes('Bloqueado')).length;
    const alert= rows.some(r=>getAlertStatus(r));
    const isActive = actName === ejeSeleccionado;
    return `
      <div class="eje-card${isActive?' active':''}" data-eje="${esc(actName)}" onclick="selectEje('${esc(actName).replace(/'/g,"\'")}')">
        <div class="eje-card-title">${esc(actName)}</div>
        <div class="eje-bar-wrap"><div class="eje-bar" style="width:${pct}%"></div></div>
        <div class="eje-card-meta">
          <span class="eje-pct">${pct}%</span>
          <div style="display:flex;gap:4px;align-items:center">
            ${comp ? `<span class="eje-dot" style="background:var(--signal)" title="${comp} completada(s)"></span>` : ''}
            ${proc ? `<span class="eje-dot" style="background:var(--blue)"   title="${proc} en proceso"></span>` : ''}
            ${pend ? `<span class="eje-dot" style="background:var(--amber)"  title="${pend} pendiente(s)"></span>` : ''}
            ${bloq ? `<span class="eje-dot" style="background:var(--red)"    title="${bloq} bloqueada(s)"></span>` : ''}
            ${alert ? `<span style="font-size:11px" title="Tiene alertas">⚠️</span>` : ''}
            <span class="eje-count">${rows.length} act.</span>
          </div>
        </div>
      </div>
    `;

    }).join('');
    return `
      <button class="btn-nueva-eje" onclick="abrirNuevaEstrategia()" title="Nueva estrategia">
        ＋ Nueva estrategia
      </button>
    ` + cardsHTML;
  };

  // ── Generar HTML panel derecho ──
  const buildRightHTML = (actName) => {
    if (!actName || !byAct.has(actName)) return `<div class="empty-state">Selecciona un eje de la izquierda.</div>`;

    const allRows = byAct.get(actName) || [];
    const rows = allRows.filter(r => r.subactividad !== '__placeholder__');
    const hitosDelEje = hitosData.filter(h => h.eje_nombre === actName);

    if (!rows.length && !hitosDelEje.length) return `
      <div class="eje-right-header">
        <div><div class="eje-right-title">${esc(actName)}</div>
        <div class="eje-right-sub" style="color:var(--text-muted)">Sin hitos aún — usa ＋ Hito para agregar</div></div>
        <div style="display:flex;gap:6px">
          <button class="btn-add-inline" data-eje="${esc(actName)}" onclick="abrirNuevoHito(this.dataset.eje)">＋ Hito</button>
          <button class="btn-eje-action" style="opacity:1;font-size:14px" data-eje="${esc(actName)}" onclick="abrirConfigEje(this.dataset.eje)">⚙️</button>
        </div>
      </div>`;
    const comp = rows.filter(r=>(r.estado||'').includes('Completado')).length;
    const proc = rows.filter(r=>(r.estado||'').includes('proceso')).length;
    const pend = rows.filter(r=>(r.estado||'').includes('Pendiente')).length;
    const bloq = rows.filter(r=>(r.estado||'').includes('Bloqueado')).length;

    const byHito = new Map();
    // Inicializar hitos del catálogo para este eje
    hitosData.filter(h => h.eje_nombre === actName).forEach(h => {
      if (!byHito.has(h.nombre)) byHito.set(h.nombre, []);
    });
    // Agregar actividades reales
    rows.forEach(r => {
      const k = (r.hito||'Sin hito').trim();
      if (!byHito.has(k)) byHito.set(k, []);
      byHito.get(k).push(r);
    });

    // Detectar si hay filtro activo
    const hayFiltro = filteredData.length < rawData.length;

    const hitosHTML = [...byHito.keys()]
      .sort((a,b)=>hitoNum(a)-hitoNum(b)||a.localeCompare(b,'es',{sensitivity:'base'}))
      .map(hitoName => {
        const rowsH = byHito.get(hitoName);
        const pctH  = pctAvg(rowsH);

        const realTasks = rowsH
          .filter(r => r.subactividad !== '__placeholder__')
          .sort((a,b) => {
            const n = s => { const m=(s||'').match(/^[\s(]*(\d+)\.(\d+)/); return m ? parseInt(m[1])*1000+parseInt(m[2]) : (s||'').match(/^[\s(]*(\d+)/) ? parseInt((s||'').match(/^[\s(]*(\d+)/)[1])*1000 : 9999000; };
            return n(a.subactividad) - n(b.subactividad) || (a.id - b.id);
          });

        // Si hay filtro activo y el hito no tiene actividades que coincidan, ocultarlo
        if (hayFiltro && !realTasks.length) return '';

        const emptyHito = !realTasks.length ? `
          <div class="eje-task" style="color:var(--text-muted);font-style:italic;cursor:default">
            Sin actividades — usa ＋ para agregar
          </div>` : '';
        const tasksHTML = (emptyHito ? [emptyHito] : []).concat(realTasks.map(row => {
          if (!row.subactividad) return '';
          const realIdx = filteredData.indexOf(row);
          const estado  = row.estado || 'Pendiente';
          const alert   = getAlertStatus(row);
          let badgeClass = 'bg-pend';
          if (estado.toLowerCase().includes('proceso'))    badgeClass = 'bg-proc';
          if (estado.toLowerCase().includes('completado')) badgeClass = 'bg-comp';
          if (estado.toLowerCase().includes('bloqueado'))  badgeClass = 'bg-block';
          return `
            <div class="eje-task" onclick="openDetailRow(${realIdx})">
              <div class="task-dot-sm" style="background:${estadoColor(estado)}"></div>
              <div class="eje-task-name">${esc(row.subactividad)}</div>
              <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
                ${alert==='vencida' ? '<span style="font-size:11px">🚨</span>' : alert==='por-vencer' ? '<span style="font-size:11px">⚠️</span>' : ''}
                <span class="badge ${badgeClass}" style="font-size:10px;padding:1px 6px">${esc(estado)}</span>
                <span class="task-pct-sm">${row.avance??0}%</span>
              </div>
            </div>
          `;
        })).join('');

        return `
          <div class="eje-hito-block">
            <div class="eje-hito-label">
              <span>${esc(hitoName)}</span>
              <div style="display:flex;align-items:center;gap:6px">
                <span class="shPct" style="font-size:11px;padding:2px 8px">${pctH}%</span>
                <button class="btn-eje-action btn-eje-edit" style="opacity:1;padding:2px 5px;font                <button class="btn-eje-action" style="opacity:1;padding:2px 6px;font-size:13px"
                  title="Configurar hito"
                <button class="btn-add-inline btn-add-sm" title="Nueva actividad en este hito"
                  data-eje="${esc(actName)}" data-hito="${esc(hitoName)}"
                  onclick="event.stopPropagation();abrirNuevaActividad(this.dataset.eje, this.dataset.hito)">＋</button>
                ${(currentPerfil?.rol==='admin' || hitosData.find(h=>h.eje_nombre===actName&&h.nombre===hitoName)?.creado_por===currentUser?.id) ? `
                <button class="btn-eje-action" style="opacity:1;padding:2px 6px;font-size:13px"
                  title="Configurar hito"
                  data-eje="${esc(actName)}" data-hito="${esc(hitoName)}"
                  onclick="event.stopPropagation();abrirConfigHito(this.dataset.eje, this.dataset.hito)">⚙️</button>` : ''}
              </div>
            </div>
            ${tasksHTML}
          </div>
        `;
      }).join('');

    return `
      <div class="eje-right-header">
        <div>
          <div class="eje-right-title">${esc(actName)}</div>
          <div class="eje-right-sub">${rows.length} actividades · ${byHito.size} hitos</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          ${comp ? `<span class="badge bg-comp">${comp} completada${comp>1?'s':''}</span>` : ''}
          ${proc ? `<span class="badge bg-proc">${proc} en proceso</span>` : ''}
          ${pend ? `<span class="badge bg-pend">${pend} pendiente${pend>1?'s':''}</span>` : ''}
          ${bloq ? `<span class="badge" style="background:var(--red-lt);color:var(--red)">${bloq} bloqueada${bloq>1?'s':''}</span>` : ''}
          <button class="btn-eje-action bt              <button class="btn-eje-action" style="opacity:1;font-size:14px" title="Configurar eje"
              <button class="btn-add-inline" title="Nuevo hito"
                data-eje="${esc(actName)}"
                onclick="event.stopPropagation();abrirNuevoHito(this.dataset.eje)">＋ Hito</button>
          <button class="btn-add-inline" title="Reuniones del eje" style="background:#eef2ff;color:#4f46e5"
            data-eje="${esc(actName)}"
            onclick="event.stopPropagation();togglePanelReuniones(this.dataset.eje)">📅 Reuniones</button>
          ${(currentPerfil?.rol==='admin' || ejesData.find(e=>e.nombre===actName)?.creado_por===currentUser?.id) ? `
          <button class="btn-eje-action" style="opacity:1;font-size:14px"
                title="Configurar eje"
                data-eje="${esc(actName)}"
                onclick="event.stopPropagation();abrirConfigEje(this.dataset.eje)">⚙️</button>` : ''}
          <button class="btn-eje-action" style="opacity:1;font-size:13px;padding:2px 8px"
            title="Ver historial del eje"
            data-eje="${esc(actName)}"
            onclick="event.stopPropagation();verHistorialEje(this.dataset.eje)">🕓 Historial</button>
        </div>
      </div>
      <div id="panelReuniones_${esc(actName).replace(/[^a-zA-Z0-9]/g,'_')}" class="panel-reuniones" style="display:none"></div>
      <div class="eje-right-body">${hitosHTML}</div>
    `;
  };

  // ── Renderizar: siempre reconstruir estructura completa pero de forma eficiente ──
  const leftHTML  = buildLeftHTML();
  const rightHTML = buildRightHTML(ejeSeleccionado);

  // Siempre reconstruir completo — más simple y confiable
  list.innerHTML = `
    <div class="two-panel">
      <div class="panel-left"  id="panelLeft">${leftHTML}</div>
      <div class="panel-right" id="panelRight">${rightHTML}</div>
    </div>
  `;

  document.getElementById('countBadge').textContent = `${data.length} de ${rawData.length} actividades`;
}

window.selectEje = function(actName) {
  ejeSeleccionado = actName;
  renderList();
};


window.eliminarActividad = async function(id) {
  if (!confirm('¿Eliminar esta actividad? Esta acción no se puede deshacer.')) return;
  const { error } = await sb.from('actividades').delete().eq('id', id);
  if (error) { alert('Error al eliminar: ' + error.message); return; }
  const ejeAntes = ejeSeleccionado;
  await loadActividades();
  if (ejeAntes) ejeSeleccionado = ejeAntes;
};

// ========= EDITAR EJE (modal con nombre + URLs) =========


// Submit del form de eje
document.getElementById('ejeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('btnSaveEje');
  btn.disabled = true; btn.textContent = 'Guardando...';

  const nombreOriginal = document.getElementById('ejeNombreOriginal').value.trim();
  const nuevoNombre    = document.getElementById('ejeNombre').value.trim();
  const urlAyuda       = document.getElementById('ejeUrlAyuda').value.trim() || null;
  const urlFicha       = document.getElementById('ejeUrlFicha').value.trim() || null;
  const tipo           = document.getElementById('ejeTipo').value;

  if (!nuevoNombre) { alert('El nombre no puede estar vacío.'); btn.disabled = false; btn.textContent = 'Guardar'; return; }

  let error;
  if (nombreOriginal) {
    // Actualizar nombre y URLs en tabla ejes
    ({ error } = await sb.from('ejes')
      .update({ nombre: nuevoNombre, url_ayuda: urlAyuda, url_ficha: urlFicha, tipo: tipo })
      .eq('nombre', nombreOriginal));
    if (error) { alert('Error: ' + error.message); btn.disabled=false; btn.textContent='Guardar eje'; return; }
    // Actualizar actividades solo si cambió el nombre
    if (nombreOriginal !== nuevoNombre) {
      await sb.from('hitos').update({ eje_nombre: nuevoNombre }).eq('eje_nombre', nombreOriginal);
      await sb.from('actividades')
        .update({ actividad_general: nuevoNombre, url_ayuda_memoria: urlAyuda, url_ficha_actividad: urlFicha })
        .eq('actividad_general', nombreOriginal);
      // Actualizar POI programado con el nuevo nombre
      await sb.from('poi_programado').update({ eje_nombre: nuevoNombre }).eq('eje_nombre', nombreOriginal);
      // Actualizar reuniones y evidencias POI con el nuevo nombre
      await sb.from('reuniones').update({ eje_nombre: nuevoNombre }).eq('eje_nombre', nombreOriginal);
      await sb.from('poi_evidencias').update({ eje_nombre: nuevoNombre }).eq('eje_nombre', nombreOriginal);
    } else {
      await sb.from('actividades')
        .update({ url_ayuda_memoria: urlAyuda, url_ficha_actividad: urlFicha })
        .eq('actividad_general', nombreOriginal);
    }
    // Log de edición del eje
    const logEje = [];
    if (nombreOriginal !== nuevoNombre) logEje.push({ campo: 'nombre', antes: nombreOriginal, despues: nuevoNombre });
    if (logEje.length) {
      await insertarLog(logEje.map(c => ({
        actividad_id:     null,
        actividad_nombre: nuevoNombre,
        usuario_id:       currentUser.id,
        usuario_nombre:   currentPerfil?.nombre || currentUser.email,
        campo_modificado: 'eje_' + c.campo,
        valor_anterior:   c.antes,
        valor_nuevo:      c.despues,
        justificacion:    null,
        tipo_accion:      'edicion',
      })));
    }
  } else {
    // Nueva estrategia — insertar en tabla ejes
    ({ error } = await sb.from('ejes').insert({
      nombre:    nuevoNombre,
      url_ayuda: urlAyuda,
      url_ficha: urlFicha,
      tipo:      tipo,
      creado_por: currentUser.id,
    }));
    if (!error) {
      await insertarLog([{
        actividad_id:     null,
        actividad_nombre: nuevoNombre,
        usuario_id:       currentUser.id,
        usuario_nombre:   currentPerfil?.nombre || currentUser.email,
        campo_modificado: 'eje_creacion',
        valor_anterior:   null,
        valor_nuevo:      nuevoNombre,
        justificacion:    null,
        tipo_accion:      'creacion',
      }]);
    }
  }

  btn.disabled = false; btn.textContent = 'Guardar eje';
  if (error) { alert('Error: ' + error.message); return; }

  ejeSeleccionado = nuevoNombre;
  // Restaurar modal para próxima edición
  document.querySelector('#ejeModal .modalTitle').textContent = '⚙️ Configurar Eje de Trabajo';
  document.getElementById('btnDeleteEje').style.display = '';
  closeModal('ejeModal');
  await loadActividades();
});
window.editarHito = async function(actividadGeneral, nombreHitoActual) {
  const nuevoNombre = prompt('Nuevo nombre del hito:', nombreHitoActual);
  if (!nuevoNombre || nuevoNombre.trim() === '' || nuevoNombre.trim() === nombreHitoActual) return;
  const { error } = await sb.from('actividades')
    .update({ hito: nuevoNombre.trim() })
    .eq('actividad_general', actividadGeneral)
    .eq('hito', nombreHitoActual);
  if (error) { alert('Error al renombrar hito: ' + error.message); return; }
  const ejeAntes = ejeSeleccionado;
  await loadActividades();
  if (ejeAntes) ejeSeleccionado = ejeAntes;
};

// ========= ELIMINAR HITO COMPLETO =========
window.openDetailRow = function(idx) {
  const row = filteredData[idx];
  if (row) openDetail(row);
};

function openDetail(row) {
  editingId = row.id;

  // Mostrar/ocultar botones según si el usuario es dueño o admin
  const esAdmin  = currentPerfil?.rol === 'admin';
  const esDuenio = row.creado_por === currentUser?.id;
  const puedeEditar = esAdmin || esDuenio;
  document.getElementById('btnEditActividad').style.display   = puedeEditar ? '' : 'none';
  document.getElementById('btnDeleteActividad').style.display = puedeEditar ? '' : 'none';
  document.getElementById('dSub').textContent    = row.subactividad || '—';
  document.getElementById('dAct').textContent    = row.actividad_general || '—';
  document.getElementById('dHito').textContent   = row.hito || '—';
  document.getElementById('dResp').textContent   = row.responsable || '—';
  document.getElementById('dEquipo').textContent = row.equipo_tecnico || '—';
  document.getElementById('dProg').textContent   = (row.avance != null ? row.avance + '%' : '—');
  document.getElementById('dCiudad').textContent = row.ciudad || '—';
  document.getElementById('dProd').textContent   = row.producto || '—';
  document.getElementById('dComm').textContent   = row.comentarios || '—';
  document.getElementById('dInicio').textContent = fmtDate(row.fecha_inicio);
  document.getElementById('dFin').textContent    = fmtDate(row.fecha_fin);

  const est = document.getElementById('dEstado');
  est.textContent = `${estadoEmoji(row.estado)} ${row.estado || '—'}`;
  est.style.background = estadoColor(row.estado) + '22';
  est.style.color = estadoColor(row.estado);
  est.style.border = `1px solid ${estadoColor(row.estado)}44`;

  document.getElementById('dPrio').textContent = row.prioridad || '—';

  // ── Alerta de vencimiento en el modal ──
  const existingAlert = document.getElementById('dAlertBadge');
  if (existingAlert) existingAlert.remove();
  const alertStatus = getAlertStatus(row);
  if (alertStatus) {
    const chipRow = document.querySelector('#detailContent .chip-row');
    if (chipRow) {
      const alertEl = document.createElement('span');
      alertEl.id = 'dAlertBadge';
      alertEl.className = `badge-alert ${alertStatus === 'vencida' ? 'alert-vencida' : 'alert-por-vencer'}`;
      alertEl.textContent = alertStatus === 'vencida' ? '🚨 Vencida' : '⚠️ Por vencer';
      chipRow.appendChild(alertEl);
    }
  }

  const ev = (row.evidencia||'').trim();
  document.getElementById('dLink').innerHTML = ev
    ? `<a href="${esc(ev)}" target="_blank" rel="noopener" class="link-ext">Ver evidencia ↗</a>`
    : '—';

  openModal('detailModal');
}

// ========= NUEVA ESTRATEGIA (desde panel izquierdo) =========
window.abrirNuevaEstrategia = function() {
  document.getElementById('ejeNombreOriginal').value = '';
  document.getElementById('ejeNombre').value         = '';
  document.getElementById('ejeTipo').value           = categoriaSeleccionada || 'Planificación';
  document.getElementById('ejeUrlAyuda').value       = '';
  document.getElementById('ejeUrlFicha').value       = '';
  document.getElementById('ejeModalSub').textContent = 'Nueva estrategia — ' + (categoriaSeleccionada || 'Planificación');
  document.querySelector('#ejeModal .modalTitle').textContent = '⚙️ Nueva Estrategia';
  document.getElementById('btnDeleteEje').style.display = 'none';
  document.getElementById('ejetipoGroup').style.display = 'none';
  openModal('ejeModal');
};

// ========= NUEVO HITO (desde panel derecho de una estrategia) =========
window.abrirNuevoHito = function(actividadGeneral) {
  // Calcular número siguiente de hito en este eje
  const hitosEje = hitosData.filter(h => h.eje_nombre === actividadGeneral);
  const siguienteHito = hitosEje.length + 1;
  const prefijo = `${siguienteHito}. `;

  document.getElementById('hitoActividadGeneral').value = actividadGeneral;
  document.getElementById('hitoNombreOriginal').value   = '';
  document.getElementById('hitoNombre').value           = prefijo;
  document.getElementById('hitoEsPoi').checked          = false;
  document.getElementById('hitoModalSub').textContent   = `En: ${actividadGeneral}`;
  document.querySelector('#hitoModal .modalTitle').textContent = '⚙️ Nuevo Hito';
  document.getElementById('btnDeleteHito').style.display = 'none';
  openModal('hitoModal');
  // Posicionar cursor al final del prefijo
  const inp = document.getElementById('hitoNombre');
  setTimeout(() => { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }, 50);
};

// ========= NUEVA ACTIVIDAD con contexto pre-cargado =========
window.abrirNuevaActividad = function(actividadGeneral, hito) {
  editingId = null;
  document.getElementById('formTitle').textContent = 'Nueva Actividad';
  document.getElementById('actForm').reset();
  document.getElementById('fId').value = '';
  document.getElementById('fFechaInicio').value = new Date().toISOString().split('T')[0];
  document.getElementById('fBloqueado').checked = false;
  // Limpiar comisión
  const chkComision = document.getElementById('fEsComision');
  if (chkComision) { chkComision.checked = false; document.getElementById('comisionFields').style.display = 'none'; }
  document.getElementById('fComisionTransporte') && (document.getElementById('fComisionTransporte').value = 'Bus');
  document.getElementById('fComisionPersonas')    && (document.getElementById('fComisionPersonas').textContent = '—');
  document.getElementById('fComisionPersonasVal') && (document.getElementById('fComisionPersonasVal').value  = '0');
  document.getElementById('fComisionDias')        && (document.getElementById('fComisionDias').textContent   = '—');
  document.getElementById('fComisionDiasVal')     && (document.getElementById('fComisionDiasVal').value       = '0');
  document.getElementById('fComisionCostoDiario') && (document.getElementById('fComisionCostoDiario').value = '320');
  document.getElementById('fComisionTotal')       && (document.getElementById('fComisionTotal').textContent  = 'S/. 0.00');

  // Calcular prefijo jerárquico X.Y basado en el número del hito y el conteo de actividades en ese hito
  const actsHito = rawData.filter(r => r.actividad_general === actividadGeneral && r.hito === hito && r.subactividad && r.subactividad !== '__placeholder__');
  const siguienteAct = actsHito.length + 1;
  const mHito = (hito || '').match(/(\d+)/);
  const numHito = mHito ? mHito[1] : '';
  const prefijo = numHito ? `${numHito}.${siguienteAct} ` : `${siguienteAct}. `;
  document.getElementById('fSubactividad').value = prefijo;

  populateFormSelects(actividadGeneral, hito);
  actualizarEstadoDisplay();
  openModal('formModal');
  // Posicionar cursor al final del prefijo
  const inp = document.getElementById('fSubactividad');
  setTimeout(() => { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }, 50);
};
function populateFormSelects(actividadSeleccionada = '', hitoSeleccionado = '') {
  const acts = ejesData.map(e => e.nombre)
    .sort((a,b) => a.localeCompare(b,'es',{sensitivity:'base'}));

  const selAct = document.getElementById('fActividadGeneral');

  // Desactivar onchange durante la inicialización para evitar que se dispare al asignar el valor
  selAct.onchange = null;

  selAct.innerHTML = '<option value="">— Selecciona una estrategia —</option>' +
    acts.map(a => `<option value="${esc(a)}" ${a === actividadSeleccionada ? 'selected' : ''}>${esc(a)}</option>`).join('');

  // Cargar hitos del eje actual con el hito pre-seleccionado
  updateHitoSelect(actividadSeleccionada, hitoSeleccionado);

  // Activar evento cascada DESPUÉS de inicializar
  selAct.onchange = () => {
    const val = selAct.value;
    updateHitoSelect(val, '');
  };
}

function updateHitoSelect(actividad, hitoSeleccionado = '') {
  const selHito    = document.getElementById('fHito');
  const inputNuevo = document.getElementById('fHitoNuevo');

  const hitos = actividad
    ? hitosData.filter(h => h.eje_nombre === actividad).map(h => h.nombre)
        .sort((a,b) => { const n = h => { const m=(h||'').match(/(\d+)/); return m?parseInt(m[1]):9999; }; return n(a)-n(b)||a.localeCompare(b,'es',{sensitivity:'base'}); })
    : [];

  // Construir opciones SIN atributo selected — se asigna después
  let optsHTML = '<option value="">— Sin hito / Selecciona —</option>';
  hitos.forEach(h => {
    optsHTML += `<option value="${esc(h)}">${esc(h)}</option>`;
  });

  selHito.innerHTML = optsHTML;

  // Asignar valor después de renderizar las opciones
  if (hitoSeleccionado && hitos.includes(hitoSeleccionado)) {
    selHito.value = hitoSeleccionado;
  } else {
    selHito.value = '';
  }


}

function getFormActividadGeneral() {
  return document.getElementById('fActividadGeneral').value.trim();
}

function getFormHito() {
  return document.getElementById('fHito').value.trim();
}

// ========= ESTADO AUTOMÁTICO =========
function calcEstado(avance) {
  const pct = parseInt(avance) || 0;
  if (pct >= 100) return 'Completado';
  if (pct >= 1)   return 'En proceso';
  return 'Pendiente';
}

const ESTADO_DISPLAY = {
  'Pendiente':  '🟡 Pendiente',
  'En proceso': '🔵 En proceso',
  'Completado': '🟢 Completado',
  'Bloqueado':  '🔴 Bloqueado',
};

function actualizarEstadoDisplay() {
  const bloqueado = document.getElementById('fBloqueado')?.checked;
  const avance    = document.getElementById('fAvance')?.value;
  const estado    = bloqueado ? 'Bloqueado' : calcEstado(avance);
  const display   = document.getElementById('fEstadoDisplay');
  const hidden    = document.getElementById('fEstadoForm');
  if (display) display.textContent = ESTADO_DISPLAY[estado];
  if (hidden)  hidden.value = estado;

  // Color del display
  const colors = {
    'Pendiente':  { bg:'var(--amber-lt)', color:'#b45309', border:'var(--amber)' },
    'En proceso': { bg:'var(--blue-lt)',  color:'var(--blue)', border:'var(--blue)' },
    'Completado': { bg:'var(--signal-lt)',color:'var(--signal-dk)', border:'var(--signal)' },
    'Bloqueado':  { bg:'var(--red-lt)',   color:'var(--red)', border:'var(--red)' },
  };
  const c = colors[estado];
  if (display && c) {
    display.style.background   = c.bg;
    display.style.color        = c.color;
    display.style.borderColor  = c.border;
  }
}

function bindEstadoAutomatic() {
  document.getElementById('fAvance')?.addEventListener('input', actualizarEstadoDisplay);
  document.getElementById('fFechaInicio')?.addEventListener('change', () => { autocompletarComisionDesdeFechas(); calcularComision(); });
  document.getElementById('fFechaFin')?.addEventListener('change',    () => { autocompletarComisionDesdeFechas(); calcularComision(); });
  document.getElementById('fEquipo')?.addEventListener('input',       () => { autocompletarComisionDesdeEquipo(); calcularComision(); });

  // ── Comisión: mostrar/ocultar campos y calcular total ──
  document.getElementById('fEsComision')?.addEventListener('change', function() {
    const fields = document.getElementById('comisionFields');
    if (fields) fields.style.display = this.checked ? 'contents' : 'none';
    if (this.checked) {
      autocompletarComisionDesdeEquipo();
      autocompletarComisionDesdeFechas();
      calcularComision();
    }
  });
  ['fComisionPersonas','fComisionDias','fComisionCostoDiario'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', calcularComision);
  });

  document.getElementById('fBloqueado')?.addEventListener('change', () => {
    const bloqueado = document.getElementById('fBloqueado').checked;
    const avanceInput = document.getElementById('fAvance');
    // Si se desmarca bloqueado, recalcular desde avance
    actualizarEstadoDisplay();
  });
}

function openFormNew() {
  editingId = null;
  document.getElementById('formTitle').textContent = 'Nueva Actividad';
  document.getElementById('actForm').reset();
  document.getElementById('fId').value = '';
  document.getElementById('fFechaInicio').value = new Date().toISOString().split('T')[0];
  document.getElementById('fBloqueado').checked = false;
  populateFormSelects();
  actualizarEstadoDisplay();
  openModal('formModal');
}

function openFormEdit() {
  const row = rawData.find(r => r.id == editingId);
  if (!row) { alert('No se encontró la actividad. Recarga la página.'); return; }
  closeModal('detailModal');
  document.getElementById('formTitle').textContent = 'Editar Actividad';
  document.getElementById('fId').value              = row.id;
  document.getElementById('fSubactividad').value     = row.subactividad || '';
  document.getElementById('fResponsable').value      = row.responsable || '';
  document.getElementById('fEquipo').value           = row.equipo_tecnico || '';
  document.getElementById('fCiudadForm').value = row.ciudad || '';
  document.getElementById('fDireccion').value        = row.direccion || '';
  document.getElementById('fFechaInicio').value      = row.fecha_inicio || '';
  document.getElementById('fFechaFin').value         = row.fecha_fin || '';
  document.getElementById('fAvance').value           = row.avance ?? 0;
  // Estado: si es bloqueado marcar checkbox, sino calcular automático
  const esBloqueado = (row.estado || '').toLowerCase().includes('bloqueado');
  document.getElementById('fBloqueado').checked = esBloqueado;
  actualizarEstadoDisplay();
  document.getElementById('fPrioridad').value        = row.prioridad || 'Alta';
  document.getElementById('fProducto').value         = row.producto || '';
  document.getElementById('fEvidencia').value        = row.evidencia || '';
  document.getElementById('fComentarios').value      = row.comentarios || '';
  // Comisión
  const esComision = !!row.es_comision;
  document.getElementById('fEsComision').checked = esComision;
  document.getElementById('comisionFields').style.display = esComision ? 'contents' : 'none';
  document.getElementById('fComisionTransporte').value  = row.comision_transporte  || 'Bus';
  const _per = row.comision_personas || 0;
  const _dias = row.comision_dias || 0;
  document.getElementById('fComisionPersonas').textContent    = _per  > 0 ? _per  + ' persona'  + (_per  !== 1 ? 's' : '') : '—';
  document.getElementById('fComisionPersonasVal').value       = _per;
  document.getElementById('fComisionDias').textContent        = _dias > 0 ? _dias + ' día'      + (_dias !== 1 ? 's' : '') : '—';
  document.getElementById('fComisionDiasVal').value           = _dias;
  document.getElementById('fComisionCostoDiario').value = row.comision_costo_diario || 320;

  calcularComision();

  // Selects en cascada con valores actuales
  populateFormSelects(row.actividad_general || '', row.hito || '');

  openModal('formModal');
}

document.getElementById('actForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('btnSaveForm');
  btn.disabled = true; btn.textContent = 'Guardando...';

  const actividadGeneral = getFormActividadGeneral();
  const hitoVal          = getFormHito();

  if (!actividadGeneral) {
    alert('Debes seleccionar o escribir una Actividad General.');
    btn.disabled = false; btn.textContent = 'Guardar actividad';
    return;
  }

  const payload = {
    actividad_general:   actividadGeneral,
    hito:                hitoVal || null,
    subactividad:        document.getElementById('fSubactividad').value.trim(),
    responsable:         document.getElementById('fResponsable').value.trim() || null,
    equipo_tecnico:      document.getElementById('fEquipo').value.trim() || null,
    ciudad:              document.getElementById('fCiudadForm').value.trim() || null,
    direccion:           document.getElementById('fDireccion').value.trim() || null,
    fecha_inicio:        document.getElementById('fFechaInicio').value || null,
    fecha_fin:           document.getElementById('fFechaFin').value || null,
    estado:              document.getElementById('fEstadoForm').value,
    avance:              parseInt(document.getElementById('fAvance').value) || 0,
    prioridad:           document.getElementById('fPrioridad').value,
    producto:            document.getElementById('fProducto').value.trim() || null,
    evidencia:           document.getElementById('fEvidencia').value.trim() || null,
    comentarios:         document.getElementById('fComentarios').value.trim() || null,
    es_comision:         document.getElementById('fEsComision')?.checked || false,
    comision_transporte: document.getElementById('fEsComision')?.checked ? (document.getElementById('fComisionTransporte')?.value || null) : null,
    comision_personas:   document.getElementById('fEsComision')?.checked ? (parseInt(document.getElementById('fComisionPersonasVal')?.value) || null) : null,
    comision_dias:       document.getElementById('fEsComision')?.checked ? (parseInt(document.getElementById('fComisionDiasVal')?.value) || null) : null,
    comision_costo_diario: document.getElementById('fEsComision')?.checked ? (parseInt(document.getElementById('fComisionCostoDiario')?.value) || 320) : null,
    comision_total:      document.getElementById('fEsComision')?.checked ? (parseInt(document.getElementById('fComisionPersonasVal')?.value)||0) * (parseInt(document.getElementById('fComisionDiasVal')?.value)||0) * (parseInt(document.getElementById('fComisionCostoDiario')?.value)||320) : null,
    creado_por:          currentUser.id,
    fecha_registro:      new Date().toISOString().split('T')[0],
  };

  const id = document.getElementById('fId').value.trim();
  let error;

  try {
    if (id && id !== '' && id !== 'undefined' && id !== 'null') {
      // ── EDICIÓN: detectar cambios y loguear ──
      const rowAnterior = rawData.find(r => r.id == parseInt(id));
      const cambios     = rowAnterior ? detectarCambios(rowAnterior, payload) : [];

      // Si hay cambios en fechas, pedir justificación
      const cambiosFecha = cambios.filter(c => CAMPOS_CON_JUSTIFICACION.includes(c.campo));
      let justificacion  = null;

      if (cambiosFecha.length) {
        btn.disabled = false; btn.textContent = 'Guardar actividad';
        try {
          justificacion = await pedirJustificacion(cambiosFecha);
        } catch {
          // Usuario canceló
          return;
        }
        btn.disabled = true; btn.textContent = 'Guardando...';
      }

      btn.textContent = `Actualizando ID ${id}...`;
      ({ error } = await sb.from('actividades').update(payload).eq('id', parseInt(id)));

      if (!error && cambios.length && rowAnterior) {
        const nombreUsuario = currentPerfil?.nombre || currentUser.email;
        const logRows = cambios.map(c => ({
          actividad_id:      parseInt(id),
          actividad_nombre:  rowAnterior.actividad_general,
          usuario_id:        currentUser.id,
          usuario_nombre:    nombreUsuario,
          campo_modificado:  c.campo,
          valor_anterior:    c.antes,
          valor_nuevo:       c.despues,
          justificacion:     CAMPOS_CON_JUSTIFICACION.includes(c.campo) ? justificacion : null,
          tipo_accion:       'edicion',
        }));
        await insertarLog(logRows);
      }

    } else {
      // ── CREACIÓN ──
      btn.textContent = 'Creando nueva...';
      const { data: inserted, error: insError } = await sb.from('actividades').insert(payload).select().single();
      error = insError;
      if (!error && inserted) {
        await insertarLog([{
          actividad_id:     inserted.id,
          actividad_nombre: payload.actividad_general,
          usuario_id:       currentUser.id,
          usuario_nombre:   currentPerfil?.nombre || currentUser.email,
          campo_modificado: 'creacion',
          valor_anterior:   null,
          valor_nuevo:      payload.subactividad,
          justificacion:    null,
          tipo_accion:      'creacion',
        }]);
      }
    }
  } catch(err) {
    btn.disabled = false; btn.textContent = 'Guardar actividad';
    alert('Error inesperado: ' + err.message);
    return;
  }

  btn.disabled = false; btn.textContent = 'Guardar actividad';
  if (error) { alert('Error al guardar: ' + error.message); return; }

  const ejeAntes = ejeSeleccionado;
  await sb.from('actividades')
    .delete()
    .eq('actividad_general', actividadGeneral)
    .eq('subactividad', '__placeholder__');
  closeModal('formModal');
  await loadActividades();
  ejeSeleccionado = ejeAntes;
});

// ========= EQUIPO TÉCNICO DROPDOWN =========
let equipoUsuarios = [];

async function loadEquipoUsuarios() {
  const { data } = await sb.from('perfiles').select('nombre, rol').order('nombre');
  equipoUsuarios = (data || []).filter(u => u.rol !== 'admin' && u.nombre).map(u => u.nombre);
}

window.showEquipoList = function() {
  filterEquipoList(document.getElementById('fEquipo').value);
};

window.filterEquipoList = function(query) {
  const dropdown = document.getElementById('equipoDropdown');
  const options  = document.getElementById('equipoOptions');
  const current  = document.getElementById('fEquipo').value.split(',').map(s=>s.trim()).filter(Boolean);
  const lastWord = query.split(',').pop().trim().toLowerCase();

  const filtered = equipoUsuarios.filter(u =>
    !lastWord || u.toLowerCase().includes(lastWord)
  );

  if (!filtered.length) { dropdown.style.display='none'; return; }

  options.innerHTML = filtered.map(u => {
    const selected = current.includes(u);
    return `<div onclick="selectEquipoUser('${u.replace(/'/g,"\\'")}') "
      style="padding:9px 14px;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:8px;
      background:${selected?'#eff6ff':'#fff'};color:${selected?'var(--blue)':'var(--text)'}"
      onmouseover="this.style.background='#f5f7ff'"
      onmouseout="this.style.background='${selected?'#eff6ff':'#fff'}'">
      <span style="font-size:11px">${selected?'✓':''}</span>
      ${u}
    </div>`;
  }).join('');

  dropdown.style.display = 'block';
};

window.selectEquipoUser = function(nombre) {
  const input   = document.getElementById('fEquipo');
  const parts   = input.value.split(',').map(s=>s.trim()).filter(Boolean);
  const idx     = parts.indexOf(nombre);
  if (idx >= 0) parts.splice(idx, 1); // deselect
  else parts.push(nombre);             // select
  input.value = parts.join(', ');
  filterEquipoList(input.value);
  input.focus();
  // Actualizar conteo de comisión si está activo
  if (document.getElementById('fEsComision')?.checked) {
    autocompletarComisionDesdeEquipo();
    calcularComision();
  }
};

window.showResponsableList = function() {
  filterResponsableList(document.getElementById('fResponsable').value);
};

window.filterResponsableList = function(query) {
  const dropdown = document.getElementById('responsableDropdown');
  const options  = document.getElementById('responsableOptions');
  const q = query.trim().toLowerCase();
  const filtered = equipoUsuarios.filter(u => !q || u.toLowerCase().includes(q));
  if (!filtered.length) { dropdown.style.display='none'; return; }
  options.innerHTML = filtered.map(u =>
    `<div onclick="selectResponsable('${u.replace(/'/g,"\\'")}')"
      style="padding:9px 14px;cursor:pointer;font-size:13px;background:#fff"
      onmouseover="this.style.background='#f5f7ff'"
      onmouseout="this.style.background='#fff'">
      ${u}
    </div>`
  ).join('');
  dropdown.style.display = 'block';
};

window.selectResponsable = function(nombre) {
  document.getElementById('fResponsable').value = nombre;
  document.getElementById('responsableDropdown').style.display = 'none';
};

// Cerrar dropdown al click fuera
document.addEventListener('click', e => {
  if (!e.target.closest('#fEquipo') && !e.target.closest('#equipoDropdown')) {
    const dd = document.getElementById('equipoDropdown');
    if (dd) dd.style.display = 'none';
  }
  if (!e.target.closest('#fResponsable') && !e.target.closest('#responsableDropdown')) {
    const dd = document.getElementById('responsableDropdown');
    if (dd) dd.style.display = 'none';
  }
});

async function loadRepositorio() {
  const el = document.getElementById('repoList');
  el.innerHTML = `<div class="empty-state">Cargando...</div>`;

  const { data, error } = await sb.from('repositorio').select('*').order('fecha', { ascending: false });

  if (error) {
    el.innerHTML = `<div class="empty-state" style="color:var(--red)">Error al cargar repositorio: ${esc(error.message)}</div>`;
    console.error('Repositorio error:', error);
    return;
  }

  repoData = data || [];

  // Poblar filtro tipo
  const tipos = [...new Set(repoData.map(r => r.tipo).filter(Boolean))].sort();
  const sel   = document.getElementById('repoFiltroTipo');
  const cur   = sel.value;
  sel.innerHTML = '<option value="">Tipo (Todos)</option>' + tipos.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  if (cur) sel.value = cur;

  renderRepo(repoData);
}

function renderRepo(rows) {
  const el = document.getElementById('repoList');
  if (!rows.length) {
    el.innerHTML = `<div class="empty-state">No hay documentos en el repositorio.</div>`;
    return;
  }

  const tipoIcon = { Drive:'🗂️', Word:'📝', Excel:'📊', PPT:'📑', PDF:'📄', Otro:'📎' };

  el.innerHTML = `
    <table class="repo-table">
      <thead><tr>
        <th style="width:100px">Fecha</th>
        <th style="width:130px">Tipo</th>
        <th>Título</th>
        <th style="width:220px">Participantes</th>
        <th>Comentarios</th>
        <th style="width:60px"></th>
      </tr></thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>${fmtDate(r.fecha)}</td>
            <td><span class="tipo-chip"><span style="font-size:12px;line-height:1">${tipoIcon[r.tipo]||'📎'}</span> ${esc(r.tipo||'—')}</span></td>
            <td>
              ${r.enlace
                ? `<a href="${esc(r.enlace)}" target="_blank" rel="noopener" class="link-ext">${esc(r.titulo)}</a>`
                : esc(r.titulo)}
            </td>
            <td><span class="muted-text">${esc(r.participantes||'—')}</span></td>
            <td class="comment-cell">${esc(r.comentarios||'—')}</td>
            <td>
              <button class="btn-icon-sm" onclick="openRepoEdit(${r.id})" title="Configurar">⚙️</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function openRepoEdit(id) {
  const row = repoData.find(r => r.id === id);
  if (!row) return;
  document.getElementById('repoModalTitle').textContent = 'Editar documento';
  document.getElementById('rId').value           = row.id;
  document.getElementById('rTitulo').value       = row.titulo || '';
  document.getElementById('rTipo').value         = row.tipo || 'Drive';
  document.getElementById('rFecha').value        = row.fecha || '';
  document.getElementById('rEnlace').value       = row.enlace || '';
  document.getElementById('rParticipantes').value= row.participantes || '';
  document.getElementById('rComentarios').value  = row.comentarios || '';
  document.getElementById('btnDeleteRepo').style.display = 'block';
  openModal('repoModal');
}

window.eliminarRepo = async function(id, titulo) {
  if (!confirm(`¿Eliminar "${titulo}"?\n\nEsta acción no se puede deshacer.`)) return;
  closeModal('repoModal');
  const { error } = await sb.from('repositorio').delete().eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  await loadRepositorio();
};

function openRepoNew() {
  document.getElementById('repoModalTitle').textContent = 'Agregar documento';
  document.getElementById('repoForm').reset();
  document.getElementById('rId').value  = '';
  document.getElementById('rFecha').value = new Date().toISOString().split('T')[0];
  document.getElementById('btnDeleteRepo').style.display = 'none';
  openModal('repoModal');
}

document.getElementById('repoForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    titulo:       document.getElementById('rTitulo').value.trim(),
    tipo:         document.getElementById('rTipo').value,
    fecha:        document.getElementById('rFecha').value || null,
    enlace:       document.getElementById('rEnlace').value.trim() || null,
    participantes:document.getElementById('rParticipantes').value.trim() || null,
    comentarios:  document.getElementById('rComentarios').value.trim() || null,
    subido_por:   currentUser.id,
  };
  const id = document.getElementById('rId').value;
  let error;
  if (id) {
    ({ error } = await sb.from('repositorio').update(payload).eq('id', id));
  } else {
    ({ error } = await sb.from('repositorio').insert(payload));
  }
  if (error) { alert('Error: ' + error.message); return; }
  closeModal('repoModal');
  await loadRepositorio();
});

// ========= GANTT — diseño original profesional =========
function renderGantt() {
  const container = document.getElementById('ganttChart');
  if (!container) return;

  const filtroAct = (document.getElementById('ganttActividad').value || '').trim();
  const view      = document.getElementById('ganttView').value;

  // Zoom según vista
  let zoom;
  if (view === 'days')   zoom = 16;   // px por día
  else if (view === 'weeks') zoom = 40; // px por semana
  else zoom = 90; // px por mes — ancho fijo legible

  // Actualizar botones docs
  updateGanttDocButtons(filtroAct);

  if (!filtroAct) {
    container.innerHTML = `<div style="padding:16px;color:var(--text-muted)">Selecciona una Actividad General para ver el cronograma.</div>`;
    return;
  }

  let data = filteredData.filter(r => r.subactividad && (r.actividad_general||'').trim() === filtroAct);
  if (!data.length) {
    container.innerHTML = `<div style="padding:16px;color:var(--text-muted)">Sin actividades con fechas para este filtro.</div>`;
    return;
  }

  // Parsear fechas
  const tasks = data.map(r => ({
    row:    r,
    name:   r.subactividad || '',
    hito:   r.hito || '—',
    estado: r.estado || 'Pendiente',
    pct:    r.avance || 0,
    start:  r.fecha_inicio ? new Date(r.fecha_inicio + 'T00:00:00') : null,
    end:    r.fecha_fin    ? new Date(r.fecha_fin    + 'T00:00:00') : null,
  })).filter(t => t.start && t.end && !isNaN(t.start) && !isNaN(t.end));

  if (!tasks.length) {
    container.innerHTML = `<div style="padding:16px;color:var(--text-muted)">Sin fechas válidas para mostrar.</div>`;
    return;
  }

  // Rango global
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
  const daysBetween = (a,b) => Math.round((startOfDay(b)-startOfDay(a))/86400000);

  const allDates = tasks.flatMap(t => [t.start, t.end]);
  let minD = startOfDay(new Date(Math.min(...allDates)));
  let maxD = startOfDay(new Date(Math.max(...allDates)));
  minD.setDate(minD.getDate() - 2);
  maxD.setDate(maxD.getDate() + 4);

  const totalDays  = daysBetween(minD, maxD) + 1;
  const totalWeeks = Math.ceil(totalDays / 7);
  const totalMonths = (maxD.getFullYear()-minD.getFullYear())*12 + maxD.getMonth() - minD.getMonth() + 1;

  let colCount;
  if (view === 'days')   colCount = totalDays;
  else if (view === 'weeks') colCount = totalWeeks;
  else colCount = totalMonths;

  const colW_px = zoom;

  // Ticks y meses
  const ticks = [];
  const monthSpans = [];

  if (view === 'days') {
    let curMonth = null; let mStart = 1;
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(minD.getTime() + i*86400000);
      ticks.push({ col: i+2, label: d.getDate() });
      const mk = d.getFullYear()+'-'+d.getMonth();
      if (mk !== curMonth) {
        if (curMonth !== null) monthSpans.push({ startCol: mStart+1, span: i-mStart+1, label: fmtMonthEs(new Date(minD.getTime()+(mStart-1)*86400000)) + ' ' + new Date(minD.getTime()+(mStart-1)*86400000).getFullYear() });
        curMonth = mk; mStart = i+1;
      }
    }
    monthSpans.push({ startCol: mStart+1, span: totalDays-mStart+1, label: fmtMonthEs(new Date(minD.getTime()+(mStart-1)*86400000)) + ' ' + new Date(minD.getTime()+(mStart-1)*86400000).getFullYear() });
  } else if (view === 'weeks') {
    for (let i = 0; i < totalWeeks; i++) {
      const d = new Date(minD.getTime() + i*7*86400000);
      ticks.push({ col: i+2, label: d.getDate()+'/'+String(d.getMonth()+1).padStart(2,'0') });
    }
    let curY = null; let mStart = 1;
    ticks.forEach((t,i) => {
      const d = new Date(minD.getTime() + i*7*86400000);
      const yk = d.getFullYear();
      if (yk !== curY) {
        if (curY !== null) monthSpans.push({ startCol: mStart+1, span: i-mStart+1, label: String(curY) });
        curY = yk; mStart = i+1;
      }
    });
    monthSpans.push({ startCol: mStart+1, span: totalWeeks-mStart+1, label: String(new Date(minD.getTime()+(mStart-1)*7*86400000).getFullYear()) });
  } else {
    for (let i = 0; i < totalMonths; i++) {
      const d = new Date(minD.getFullYear(), minD.getMonth()+i, 1);
      ticks.push({ col: i+2, label: fmtMonthEs(d) });
    }
    let curY = null; let mStart = 1;
    ticks.forEach((t,i) => {
      const d = new Date(minD.getFullYear(), minD.getMonth()+i, 1);
      const yk = d.getFullYear();
      if (yk !== curY) {
        if (curY !== null) monthSpans.push({ startCol: mStart+1, span: i-mStart+1, label: String(curY) });
        curY = yk; mStart = i+1;
      }
    });
    monthSpans.push({ startCol: mStart+1, span: totalMonths-mStart+1, label: String(new Date(minD.getFullYear(), minD.getMonth()+(mStart-1), 1).getFullYear()) });
  }

  // Calcular col y dur de cada tarea
  const getStartCol = (t) => {
    if (view === 'days')   return 2 + daysBetween(minD, t.start);
    if (view === 'weeks')  return 2 + Math.floor(daysBetween(minD, t.start)/7);
    return 2 + (t.start.getFullYear()-minD.getFullYear())*12 + t.start.getMonth() - minD.getMonth();
  };
  const getDur = (t) => {
    let d;
    if (view === 'days')   d = daysBetween(t.start, t.end) + 1;
    else if (view === 'weeks') d = Math.max(1, Math.ceil(daysBetween(t.start,t.end)/7));
    else d = Math.max(1, (t.end.getFullYear()-t.start.getFullYear())*12 + t.end.getMonth()-t.start.getMonth()+1);
    return Math.max(1, d);
  };

  // Agrupar por hito
  const byHito = new Map();
  tasks.forEach(t => {
    const k = t.hito || '—';
    if (!byHito.has(k)) byHito.set(k, []);
    byHito.get(k).push(t);
  });
  const hitoNum = (h) => { const m = (h||'').match(/(\d+)/); return m ? parseInt(m[1]) : 9999; };
  const sortedHitos = [...byHito.keys()].sort((a,b)=>hitoNum(a)-hitoNum(b)||a.localeCompare(b,'es',{sensitivity:'base'}));

  let rows = [];
  const actNum = s => { const m=(s||'').match(/^[\s(]*(\d+)\.(\d+)/); return m ? parseInt(m[1])*1000+parseInt(m[2]) : (s||'').match(/^[\s(]*(\d+)/) ? parseInt((s||'').match(/^[\s(]*(\d+)/)[1])*1000 : 9999000; };
  sortedHitos.forEach(h => {
    rows.push({ type:'group', label: h });
    byHito.get(h)
      .sort((a,b) => actNum(a.name) - actNum(b.name))
      .forEach(t => rows.push({ type:'task', task: t }));
  });

  // HOY
  const today = startOfDay(new Date());
  let todayIdxDays = daysBetween(minD, today);
  let hasToday = todayIdxDays >= 0 && todayIdxDays < colCount;
  let todayX;
  if (view === 'days')   todayX = todayIdxDays * colW_px + 'px';
  else if (view === 'weeks') todayX = Math.floor(todayIdxDays/7) * colW_px + 'px';
  else {
    const todayM = (today.getFullYear()-minD.getFullYear())*12 + today.getMonth()-minD.getMonth();
    todayX = todayM * colW_px + 'px';
  }

  // Fines de semana (solo vista días)
  let weekendHTML = '';
  if (view === 'days') {
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(minD.getTime() + i*86400000);
      if (d.getDay() === 0 || d.getDay() === 6) {
        weekendHTML += `<div class="ganttWeekend" style="grid-column:${i+2}"></div>`;
      }
    }
  }

  const gridStyle = `
    --cols: ${colCount};
    --colW: ${colW_px}px;
    --rows: ${rows.length};
    ${hasToday ? `--todayX: ${todayX};` : ''}
  `.replace(/\s+/g,' ').trim();

  // Leyenda
  const legendHTML = `
    <div class="ganttLegend">
      <span class="legendChip" style="--c:var(--st-done)">   <span class="legendDot"></span>Completado</span>
      <span class="legendChip" style="--c:var(--st-process)"><span class="legendDot"></span>En proceso</span>
      <span class="legendChip" style="--c:var(--st-pending)"><span class="legendDot"></span>Pendiente</span>
      <span class="legendChip" style="--c:var(--st-block)">  <span class="legendDot"></span>Bloqueado</span>
      <span class="legendChip legend-sep">🚨 Vencida</span>
      <span class="legendChip legend-sep">⚠️ Por vencer</span>
    </div>
  `;

  let html = legendHTML + `<div class="ganttScroll" id="ganttScroll"><div class="ganttGrid" style="${gridStyle}">`;

  html += `<div class="ganttCorner r1">Actividades</div>`;
  html += `<div class="ganttCorner r2">${view === 'days' ? 'Día' : view === 'weeks' ? 'Semana' : 'Mes'}</div>`;

  monthSpans.forEach(h => {
    html += `<div class="ganttMonth" style="grid-column:${h.startCol} / span ${h.span}">${esc(h.label)}</div>`;
  });
  ticks.forEach(t => {
    html += `<div class="ganttTick" style="grid-column:${t.col}">${esc(String(t.label))}</div>`;
  });

  html += weekendHTML;
  if (hasToday) html += `<div class="ganttToday"></div>`;

  // Filas
  rows.forEach((r, rIndex) => {
    const rowGrid = 3 + rIndex;
    if (r.type === 'group') {
      html += `<div class="ganttLabel group" style="grid-row:${rowGrid}" title="${esc(r.label)}">${esc(r.label)}</div>`;
      return;
    }
    const t     = r.task;
    const label = t.name || '(Sin nombre)';
    const startCol = getStartCol(t);
    const dur      = Math.max(1, getDur(t));
    const color    = estadoColorOriginal(t.estado);
    const idx      = filteredData.indexOf(t.row);
    const title    = `${t.estado} • ${t.pct}% • ${label}`;
    const alertG   = getAlertStatus(t.row);
    const alertIcon = alertG === 'vencida' ? '🚨' : alertG === 'por-vencer' ? '⚠️' : '';

    html += `<div class="ganttLabel" style="grid-row:${rowGrid}" title="${esc(label)}">${esc(label)}</div>`;
    html += `
      <div class="gbar-wrap" style="grid-row:${rowGrid}; grid-column:${startCol} / span ${dur};">
        <div class="gbar${alertG ? ' gbar-alert-'+alertG : ''}" style="--bar:${color}; --pct:${t.pct}%"
          title="${esc(title)}" ${idx >= 0 ? `onclick="openDetailRow(${idx})"` : ''}>
          <div class="fill"></div>
          <div class="txt">${esc(t.pct + '% • ' + t.estado)}</div>
        </div>
        ${alertIcon ? `<span class="gbar-alert-icon" title="${esc(title)}" ${idx>=0?`onclick="openDetailRow(${idx})"`:''}>${alertIcon}</span>` : ''}
      </div>
    `;
  });

  html += `</div></div>`;
  container.innerHTML = html;

  // Auto-scroll hacia hoy
  if (hasToday && view === 'days') {
    const scroller = document.getElementById('ganttScroll');
    if (scroller) scroller.scrollLeft = Math.max(0, todayIdxDays * colW_px - 200);
  }
}

function estadoColorOriginal(e) {
  const n = (e||'').toLowerCase();
  if (n.includes('bloque'))   return 'var(--st-block)';
  if (n.includes('complet'))  return 'var(--st-done)';
  if (n.includes('proceso'))  return 'var(--st-process)';
  return 'var(--st-pending)';
}

function fmtMonthEs(d) {
  const m = d.toLocaleString('es-PE', { month:'short' });
  return (m.charAt(0).toUpperCase() + m.slice(1)).replace('.','');
}

function updateGanttDocButtons(actividadGeneral) {
  const btnAM = document.getElementById('btnAyudaMemoria');
  const btnFA = document.getElementById('btnFichaActividad');
  if (!btnAM || !btnFA) return;

  // Buscar URL en tabla ejes
  const eje = ejesData.find(e => e.nombre === actividadGeneral);
  const urlAM = eje?.url_ayuda || (rawData||[]).find(r => (r.actividad_general||'').trim() === actividadGeneral && r.url_ayuda_memoria)?.url_ayuda_memoria || '';
  const urlFA = eje?.url_ficha || (rawData||[]).find(r => (r.actividad_general||'').trim() === actividadGeneral && r.url_ficha_actividad)?.url_ficha_actividad || '';
  btnAM.href = urlAM?.startsWith('http') ? urlAM : '#';
  btnFA.href = urlFA?.startsWith('http') ? urlFA : '#';
  btnAM.classList.toggle('btn-doc-disabled', !urlAM?.startsWith('http'));
  btnFA.classList.toggle('btn-doc-disabled', !urlFA?.startsWith('http'));
}


// ========= USUARIOS =========
window.switchTabUsuarios = function(tab) {
  const lista  = document.getElementById('usuariosList');
  const guia   = document.getElementById('usuariosGuia');
  const btnL   = document.getElementById('btnTabUsuarios');
  const btnA   = document.getElementById('btnTabAgregar');
  if (tab === 'lista') {
    lista.classList.remove('hidden');
    guia.classList.add('hidden');
    btnL.style.fontWeight = '600';
    btnA.style.fontWeight = '400';
  } else {
    lista.classList.add('hidden');
    guia.classList.remove('hidden');
    btnA.style.fontWeight = '600';
    btnL.style.fontWeight = '400';
  }
};

async function loadUsuarios() {
  if (!currentPerfil || currentPerfil.rol !== 'admin') return;
  const { data } = await sb.from('perfiles').select('*').order('nombre');
  const list = document.getElementById('usuariosList');
  if (!data?.length) { list.innerHTML = `<div class="empty-state">Sin usuarios registrados.</div>`; return; }

  const rolLabel = { admin: 'Admin', director: 'Director', tecnico: 'Técnico' };
  const rolStyle = { admin: 'background:#FEE2E2;color:#991B1B', director: 'background:#EFF6FF;color:#1E40AF', tecnico: 'background:var(--signal-lt);color:var(--signal-dk)' };

  list.innerHTML = `
    <table class="repo-table">
      <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Estado</th><th style="width:60px"></th></tr></thead>
      <tbody>
        ${data.map(u => `
          <tr style="${u.activo === false ? 'opacity:0.5' : ''}">
            <td><strong>${esc(u.nombre)}</strong></td>
            <td class="muted-text">${esc(u.email)}</td>
            <td><span class="tipo-chip" style="${rolStyle[u.rol]||''}">${rolLabel[u.rol]||u.rol}</span></td>
            <td>
              <span style="font-size:12px;font-weight:600;color:${u.activo === false ? 'var(--red)' : 'var(--signal-dk)'}">
                ${u.activo === false ? '🔴 Desactivado' : '🟢 Activo'}
              </span>
            </td>
            <td>
              ${u.id !== currentUser.id
                ? `<button class="btn-icon-sm" data-uid="${u.id}" onclick="abrirConfigUsuario('${u.id}')" title="Configurar">⚙️</button>`
                : `<span style="font-size:11px;color:var(--text-muted)">Tú</span>`}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div style="padding:12px 16px;font-size:12px;color:var(--text-muted);border-top:1px solid var(--border)">
      💡 Para crear o eliminar usuarios ve a <strong>Supabase → Authentication → Users</strong>
    </div>
  `;
}

window.abrirConfigUsuario = function(uid) {
  sb.from('perfiles').select('*').eq('id', uid).single().then(({ data }) => {
    if (!data) return;
    document.getElementById('uId').value            = data.id;
    document.getElementById('uNombre').value        = data.nombre || '';
    document.getElementById('uEmail').value         = data.email || '';
    document.getElementById('uRol').value           = data.rol || 'tecnico';
    document.getElementById('uActivo').value        = data.activo === false ? '0' : '1';
    document.getElementById('usuarioModalSub').textContent = data.email;
    openModal('usuarioModal');
  });
};

document.getElementById('usuarioForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const uid    = document.getElementById('uId').value;
  const nombre = document.getElementById('uNombre').value.trim();
  const rol    = document.getElementById('uRol').value;
  const activo = document.getElementById('uActivo').value === '1';

  const { error } = await sb.from('perfiles').update({ nombre, rol, activo }).eq('id', uid);
  if (error) { alert('Error: ' + error.message); return; }
  closeModal('usuarioModal');
  await loadUsuarios();
});

async function changeRol(uid, rol) {
  await sb.from('perfiles').update({ rol }).eq('id', uid);
}

async function deleteUsuario(uid, nombre) {
  await sb.from('perfiles').delete().eq('id', uid);
  await loadUsuarios();
}

async function invitarUsuario() {}


async function deleteActividad() {
  if (!editingId) return;
  const row = rawData.find(r => r.id == editingId);
  const nombre = row?.subactividad || 'esta actividad';

  if (!confirm(`¿Eliminar "${nombre}"?\n\nSe te pedirá una justificación en el siguiente paso.`)) return;

  // Pedir justificación obligatoria
  let justificacion;
  try {
    document.getElementById('justModalSub').textContent  = 'Eliminación de actividad';
    document.getElementById('justDetalle').innerHTML      = `Estás eliminando: <strong>${esc(nombre)}</strong>`;
    document.getElementById('justTexto').value            = '';
    openModal('justModal');

    justificacion = await new Promise((resolve, reject) => {
      const btnC = document.getElementById('btnConfirmJust');
      const btnX = document.getElementById('btnCancelJust');
      const btnCl= document.getElementById('btnCloseJust');
      const cleanup = () => {
        btnC.replaceWith(btnC.cloneNode(true));
        btnX.replaceWith(btnX.cloneNode(true));
        btnCl.replaceWith(btnCl.cloneNode(true));
        closeModal('justModal');
      };
      document.getElementById('btnConfirmJust').addEventListener('click', () => {
        const texto = document.getElementById('justTexto').value.trim();
        if (!texto) { document.getElementById('justTexto').focus(); return; }
        cleanup(); resolve(texto);
      }, { once: true });
      document.getElementById('btnCancelJust').addEventListener('click', () => { cleanup(); reject(); }, { once: true });
      document.getElementById('btnCloseJust').addEventListener('click', () => { cleanup(); reject(); }, { once: true });
    });
  } catch {
    return; // usuario canceló
  }

  // Loguear eliminación ANTES de borrar (para conservar los datos)
  if (row) {
    await insertarLog([{
      actividad_id:     row.id,
      actividad_nombre: row.actividad_general,
      usuario_id:       currentUser.id,
      usuario_nombre:   currentPerfil?.nombre || currentUser.email,
      campo_modificado: 'eliminacion',
      valor_anterior:   row.subactividad,
      valor_nuevo:      null,
      justificacion:    justificacion,
      tipo_accion:      'eliminacion',
    }]);
  }

  const { error } = await sb.from('actividades').delete().eq('id', parseInt(editingId));
  if (error) { alert('Error al eliminar: ' + error.message); return; }

  closeModal('detailModal');
  const ejeAntes = ejeSeleccionado;
  await loadActividades();
  ejeSeleccionado = ejeAntes;
}

async function deleteUsuario(uid, nombre) {
  if (!confirm(`¿Eliminar el usuario "${nombre}"? Esta acción no se puede deshacer.`)) return;
  await sb.from('perfiles').delete().eq('id', uid);
  await loadUsuarios();
}

async function invitarUsuario() {
  const email = prompt('Email del nuevo usuario:');
  if (!email) return;
  const { error } = await sb.auth.admin.inviteUserByEmail(email);
  if (error) {
    alert('No se pudo enviar la invitación desde el cliente.\nHazlo desde Supabase → Authentication → Users → Invite user.\nEmail: ' + email);
  } else {
    alert('Invitación enviada a ' + email);
  }
}

// ========= AUDITORÍA GLOBAL =========
let auditData    = [];
let auditPagina  = 0;
const AUDIT_PAGE = 500;

async function loadAuditoria() {
  auditPagina = 0;
  auditData   = [];
  const el = document.getElementById('auditList');
  el.innerHTML = '<div class="log-loading">Cargando auditoría...</div>';
  await fetchAuditPage();
}

async function fetchAuditPage() {
  const desde  = document.getElementById('auditDesde')?.value || '';
  const hasta  = document.getElementById('auditHasta')?.value || '';

  let query = sb.from('actividades_log')
    .select('*')
    .order('fecha_log', { ascending: false })
    .range(auditPagina * AUDIT_PAGE, (auditPagina + 1) * AUDIT_PAGE - 1);

  if (desde) query = query.gte('fecha_log', desde + 'T00:00:00');
  if (hasta) query = query.lte('fecha_log', hasta + 'T23:59:59');

  const { data, error } = await query;

  if (error) {
    document.getElementById('auditList').innerHTML =
      `<div class="log-empty" style="color:var(--red)">Error al cargar: ${esc(error.message)}</div>`;
    return;
  }

  if (auditPagina === 0) {
    auditData = data || [];
  } else {
    auditData = [...auditData, ...(data || [])];
  }

  // Poblar filtro de usuarios con los que ya cargamos
  const usuarios = [...new Set(auditData.map(r => r.usuario_nombre).filter(Boolean))].sort();
  const selU = document.getElementById('auditFiltroUsuario');
  const curU = selU.value;
  selU.innerHTML = '<option value="">Todos los usuarios</option>' +
    usuarios.map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join('');
  if (curU) selU.value = curU;

  renderAuditoria(data?.length === AUDIT_PAGE);
}

function renderAuditoria(hayMas = false) {
  const el      = document.getElementById('auditList');
  const accion  = document.getElementById('auditFiltroAccion').value;
  const usuario = document.getElementById('auditFiltroUsuario').value;

  let rows = auditData;
  if (accion)  rows = rows.filter(r => r.tipo_accion === accion);
  if (usuario) rows = rows.filter(r => r.usuario_nombre === usuario);

  if (!rows.length) {
    el.innerHTML = '<div class="log-empty">No hay registros con estos filtros.</div>';
    return;
  }

  const accionLabel = { edicion: '✏️ Edición', eliminacion: '🗑️ Eliminación', creacion: '➕ Creación' };
  const accionStyle = { edicion: `color:var(--blue)`, eliminacion: `color:var(--red)`, creacion: `color:var(--signal-dk)` };

  const campoLabel = (c) => {
    const mapa = {
      ...CAMPOS_LABEL,
      creacion:         'Actividad creada',
      eliminacion:      'Actividad eliminada',
      eje_creacion:     'Eje creado',
      eje_eliminacion:  'Eje eliminado',
      eje_nombre:       'Nombre del eje',
      hito_creacion:    'Hito creado',
      hito_eliminacion: 'Hito eliminado',
      hito_nombre:      'Nombre del hito',
    };
    return mapa[c] || c || '—';
  };

  el.innerHTML = `
    <table class="repo-table log-table">
      <thead><tr>
        <th style="width:145px">Fecha y hora</th>
        <th style="width:120px">Usuario</th>
        <th style="width:95px">Acción</th>
        <th style="width:160px">Eje / Estrategia</th>
        <th>Detalle</th>
        <th>Antes</th>
        <th>Después</th>
        <th>Justificación</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td class="muted-text" style="font-size:11px;white-space:nowrap">
              ${r.fecha_log ? new Date(r.fecha_log).toLocaleString('es-PE',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—'}
            </td>
            <td style="font-weight:600;font-size:12px">${esc(r.usuario_nombre || '—')}</td>
            <td style="font-size:12px;${accionStyle[r.tipo_accion]||''}">
              ${accionLabel[r.tipo_accion] || r.tipo_accion || '—'}
            </td>
            <td style="font-size:12px;color:var(--text-muted)">${esc(r.actividad_nombre || '—')}</td>
            <td style="font-size:12px;font-weight:500">${esc(campoLabel(r.campo_modificado))}</td>
            <td class="muted-text" style="font-size:12px">${esc(r.valor_anterior || '—')}</td>
            <td style="font-size:12px">${esc(r.valor_nuevo || '—')}</td>
            <td style="font-size:12px;color:var(--text-muted);font-style:${r.justificacion?'normal':'italic'}">
              ${esc(r.justificacion || '—')}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div style="padding:10px 16px;font-size:11px;color:var(--text-muted);border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
      <span>Mostrando ${rows.length} registro${rows.length !== 1 ? 's' : ''}</span>
      ${hayMas ? `<button class="btn-ghost btn-sm" id="btnCargarMasAudit">Cargar más registros ↓</button>` : ''}
    </div>
  `;

  // Botón cargar más
  document.getElementById('btnCargarMasAudit')?.addEventListener('click', async () => {
    auditPagina++;
    document.getElementById('btnCargarMasAudit').textContent = 'Cargando...';
    document.getElementById('btnCargarMasAudit').disabled = true;
    await fetchAuditPage();
  });
}

// ========= MODALES =========
function openModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.setAttribute('aria-hidden','false');
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.setAttribute('aria-hidden','true');
  const anyOpen = [...document.querySelectorAll('.modal')].some(m => m.getAttribute('aria-hidden')==='false');
  if (!anyOpen) document.body.style.overflow = '';
}

// Cerrar al click fuera — se llama desde bindEvents
function bindModalBackdrops() {
  document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('mousedown', e => { if (e.target === m) closeModal(m.id); });
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const open = [...document.querySelectorAll('.modal')].find(m => m.getAttribute('aria-hidden') === 'false');
    if (open) closeModal(open.id);
  });
}

// ========= INICIALIZAR VISTA GANTT (inline) =========
function initGanttView() {
  const sel = document.getElementById('ganttActividad');
  if (sel) {
    const unicos = [...new Set(
      filteredData.filter(r => r.subactividad).map(r => (r.actividad_general||'').trim())
    )].filter(Boolean).sort((a,b) => a.localeCompare(b,'es',{sensitivity:'base'}));

    const mainFilter = (document.getElementById('fActGen')?.value||'').trim();
    const prev       = (sel.value||'').trim();
    const preferred  = (mainFilter && unicos.includes(mainFilter)) ? mainFilter
                     : (unicos.includes(prev) ? prev : (unicos[0]||''));

    sel.innerHTML = '<option value="">Todas las actividades</option>' +
      unicos.map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join('');
    if (preferred) sel.value = preferred;
  }

  updateGanttDocButtons((sel?.value||'').trim());
  renderGantt();
}

// ========= EVENTS =========
function bindEvents() {
  // Filtros
  ['q','fEstado','fResp','fCiudad','fActGen','fDesde','fHasta'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.addEventListener('input', applyFilters); el.addEventListener('change', applyFilters); }
  });

  document.getElementById('btnReset').addEventListener('click', () => {
    ['q','fEstado','fResp','fCiudad','fActGen','fDesde','fHasta'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    applyFilters();
  });

  document.getElementById('btnCloseEje')?.addEventListener('click', () => closeModal('ejeModal'));
  document.getElementById('btnCancelEje')?.addEventListener('click', () => closeModal('ejeModal'));
  document.getElementById('btnDeleteEje')?.addEventListener('click', () => {
    const nombre = document.getElementById('ejeNombreOriginal').value;
    eliminarEje(nombre);
  });
  document.getElementById('btnCloseHito')?.addEventListener('click', () => closeModal('hitoModal'));
  document.getElementById('btnCancelHito')?.addEventListener('click', () => closeModal('hitoModal'));
  document.getElementById('btnDeleteHito')?.addEventListener('click', () => {
    const actGen = document.getElementById('hitoActividadGeneral').value;
    const nombre = document.getElementById('hitoNombreOriginal').value;
    eliminarHito(actGen, nombre);
  });
  document.getElementById('btnNueva')?.addEventListener('click', abrirNuevaEstrategia);
  document.getElementById('btnGantt')?.addEventListener('click', () => switchView('gantt'));
  document.getElementById('btnCloseDetail').addEventListener('click', () => closeModal('detailModal'));
  document.getElementById('btnEditActividad').addEventListener('click', openFormEdit);
  document.getElementById('btnDeleteActividad')?.addEventListener('click', deleteActividad);
  document.getElementById('btnHistorialActividad')?.addEventListener('click', () => {
    const row = rawData.find(r => r.id == editingId);
    if (row) verHistorialActividad(row.id, row.subactividad);
  });
  document.getElementById('btnCloseHistorial')?.addEventListener('click', () => closeModal('historialModal'));
  document.getElementById('btnCloseHistorialEje')?.addEventListener('click', () => closeModal('historialEjeModal'));
  document.getElementById('btnCloseForm').addEventListener('click', () => closeModal('formModal'));
  document.getElementById('btnCancelForm').addEventListener('click', () => closeModal('formModal'));
  bindEstadoAutomatic();
  document.getElementById('btnCloseRepo').addEventListener('click', () => closeModal('repoModal'));
  document.getElementById('btnCancelRepo').addEventListener('click', () => closeModal('repoModal'));
  document.getElementById('btnDeleteRepo')?.addEventListener('click', () => {
    const id    = document.getElementById('rId').value;
    const titulo = document.getElementById('rTitulo').value;
    eliminarRepo(parseInt(id), titulo);
  });
  document.getElementById('btnNuevoDoc').addEventListener('click', openRepoNew);
  document.getElementById('btnInvitar')?.addEventListener('click', invitarUsuario);
  document.getElementById('btnCambiarClave')?.addEventListener('click', () => {
    document.getElementById('claveForm').reset();
    openModal('claveModal');
  });
  document.getElementById('btnCloseClave')?.addEventListener('click', () => closeModal('claveModal'));
  document.getElementById('btnCancelClave')?.addEventListener('click', () => closeModal('claveModal'));
  document.getElementById('claveForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn      = document.getElementById('btnSaveClave');
    const nueva    = document.getElementById('claveNueva').value;
    const confirma = document.getElementById('claveConfirmar').value;

    if (nueva.length < 6) { alert('La contraseña debe tener al menos 6 caracteres.'); return; }
    if (nueva !== confirma) { alert('Las contraseñas no coinciden.'); return; }

    btn.disabled = true; btn.textContent = 'Guardando...';
    const { error } = await sb.auth.updateUser({ password: nueva });
    btn.disabled = false; btn.textContent = 'Guardar contraseña';

    if (error) { alert('Error: ' + error.message); return; }
    alert('✅ Contraseña actualizada correctamente.');
    closeModal('claveModal');
    document.getElementById('claveForm').reset();
  });
  document.getElementById('btnCancelUsuario')?.addEventListener('click', () => closeModal('usuarioModal'));

  document.getElementById('repoFiltroTipo').addEventListener('change', e => {
    const tipo = e.target.value;
    renderRepo(tipo ? repoData.filter(r => r.tipo === tipo) : repoData);
  });

  document.getElementById('ganttView').addEventListener('change', renderGantt);
  document.getElementById('ganttActividad').addEventListener('change', () => {
    updateGanttDocButtons((document.getElementById('ganttActividad').value||'').trim());
    renderGantt();
  });

  document.getElementById('categoryTabs').addEventListener('click', e => {
    const tab = e.target.closest('.cat-tab');
    if (!tab) return;
    categoriaSeleccionada = tab.dataset.cat;
    document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    ejeSeleccionado = null;
    renderList();
  });

  document.getElementById('auditFiltroAccion')?.addEventListener('change', renderAuditoria);
  document.getElementById('auditFiltroUsuario')?.addEventListener('change', renderAuditoria);
  document.getElementById('auditDesde')?.addEventListener('change', () => { auditPagina = 0; auditData = []; fetchAuditPage(); });
  document.getElementById('auditHasta')?.addEventListener('change', () => { auditPagina = 0; auditData = []; fetchAuditPage(); });
  document.getElementById('btnAuditReset')?.addEventListener('click', () => {
    document.getElementById('auditDesde').value = '';
    document.getElementById('auditHasta').value = '';
    document.getElementById('auditFiltroAccion').value = '';
    document.getElementById('auditFiltroUsuario').value = '';
    auditPagina = 0;
    auditData = [];
    fetchAuditPage();
  });

  document.getElementById('btnLogout').addEventListener('click', async () => {
    await sb.auth.signOut();
    window.location.href = 'login.html';
  });

  bindModalBackdrops();
}
// ========= CONFIGURAR EJE (modal) =========
window.abrirConfigEje = function(nombreActual) {
  const fila = rawData.find(r => r.actividad_general === nombreActual && (r.url_ayuda_memoria || r.url_ficha_actividad))
            || rawData.find(r => r.actividad_general === nombreActual);
  const count = rawData.filter(r => r.actividad_general === nombreActual).length;

  document.getElementById('ejeNombreOriginal').value = nombreActual;
  document.getElementById('ejeNombre').value         = nombreActual;
  const ejeActual = ejesData.find(e => e.nombre === nombreActual);
  document.getElementById('ejeTipo').value = ejeActual?.tipo || 'Planificación';
  document.getElementById('ejetipoGroup').style.display = '';
  document.getElementById('ejeUrlAyuda').value       = fila?.url_ayuda_memoria || '';
  document.getElementById('ejeUrlFicha').value       = fila?.url_ficha_actividad || '';
  document.getElementById('ejeModalSub').textContent = `${count} actividad${count!==1?'es':''} en este eje`;
  document.querySelector('#ejeModal .modalTitle').textContent = '⚙️ Configurar Eje de Trabajo';
  document.getElementById('btnDeleteEje').style.display = '';
  openModal('ejeModal');
};

// ========= CONFIGURAR HITO (modal) =========
window.abrirConfigHito = function(actividadGeneral, nombreHito) {
  const count = rawData.filter(r => r.actividad_general === actividadGeneral && r.hito === nombreHito).length;
  const hitoData = hitosData.find(h => h.eje_nombre === actividadGeneral && h.nombre === nombreHito);
  document.getElementById('hitoActividadGeneral').value = actividadGeneral;
  document.getElementById('hitoNombreOriginal').value   = nombreHito;
  document.getElementById('hitoNombre').value           = nombreHito;
  document.getElementById('hitoEsPoi').checked          = hitoData?.es_poi || false;
  document.getElementById('hitoModalSub').textContent   = `${count} actividad${count!==1?'es':''} en este hito`;
  document.querySelector('#hitoModal .modalTitle').textContent = '⚙️ Configurar Hito';
  document.getElementById('btnDeleteHito').style.display = '';
  openModal('hitoModal');
};

document.getElementById('hitoForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('btnSaveHito');
  btn.disabled = true; btn.textContent = 'Guardando...';

  const actGen   = document.getElementById('hitoActividadGeneral').value;
  const original = document.getElementById('hitoNombreOriginal').value.trim();
  const nuevo    = document.getElementById('hitoNombre').value.trim();

  if (!nuevo) { btn.disabled=false; btn.textContent='Guardar'; return; }

  const esPoi = document.getElementById('hitoEsPoi').checked;

  let error;
  if (original) {
    // Renombrar hito
    const { error: updError, count } = await sb.from('hitos')
      .update({ nombre: nuevo, es_poi: esPoi })
      .eq('eje_nombre', actGen)
      .eq('nombre', original)
      .select();
    error = updError;
    if (error) { alert('Error: ' + error.message); btn.disabled=false; btn.textContent='Guardar'; return; }
    if (original !== nuevo) {
      await sb.from('actividades')
        .update({ hito: nuevo })
        .eq('actividad_general', actGen)
        .eq('hito', original);
      await sb.from('poi_evidencias')
        .update({ hito_nombre: nuevo })
        .eq('eje_nombre', actGen)
        .eq('hito_nombre', original);
      await insertarLog([{
        actividad_id:     null,
        actividad_nombre: actGen,
        usuario_id:       currentUser.id,
        usuario_nombre:   currentPerfil?.nombre || currentUser.email,
        campo_modificado: 'hito_nombre',
        valor_anterior:   original,
        valor_nuevo:      nuevo,
        justificacion:    null,
        tipo_accion:      'edicion',
      }]);
    }
  } else {
    // Nuevo hito
    console.log('Insertando hito:', { eje_nombre: actGen, nombre: nuevo });
    ({ error } = await sb.from('hitos').insert({
      eje_nombre: actGen,
      nombre:     nuevo,
      es_poi:     esPoi,
      creado_por: currentUser.id,
    }));
    if (!error) {
      await insertarLog([{
        actividad_id:     null,
        actividad_nombre: actGen,
        usuario_id:       currentUser.id,
        usuario_nombre:   currentPerfil?.nombre || currentUser.email,
        campo_modificado: 'hito_creacion',
        valor_anterior:   null,
        valor_nuevo:      nuevo,
        justificacion:    null,
        tipo_accion:      'creacion',
      }]);
    }
    if (error) console.error('Error hito insert:', error);
  }

  btn.disabled=false; btn.textContent='Guardar';
  if (error) { alert('Error al guardar hito: ' + error.message); return; }

  // Restaurar modal para próxima vez
  document.querySelector('#hitoModal .modalTitle').textContent = '⚙️ Configurar Hito';
  document.getElementById('btnDeleteHito').style.display = '';
  closeModal('hitoModal');
  const ejeAntes = ejeSeleccionado;
  await loadActividades();
  ejeSeleccionado = ejeAntes;
});


// ========= REUNIONES POR EJE =========

let reunionesEjeActual = null;

window.togglePanelReuniones = async function(ejeNombre) {
  const panelId = 'panelReuniones_' + ejeNombre.replace(/[^a-zA-Z0-9]/g, '_');
  const panel = document.getElementById(panelId);
  if (!panel) return;

  if (panel.style.display !== 'none') {
    panel.style.display = 'none';
    reunionesEjeActual = null;
    return;
  }

  reunionesEjeActual = ejeNombre;
  panel.style.display = 'block';
  panel.innerHTML = '<div class="log-loading" style="padding:12px">Cargando reuniones...</div>';

  const { data, error } = await sb.from('reuniones')
    .select('*')
    .eq('eje_nombre', ejeNombre)
    .order('fecha', { ascending: false });

  if (error) {
    panel.innerHTML = `<div style="color:var(--red);padding:12px">Error: ${esc(error.message)}</div>`;
    return;
  }

  reunionesData = data || [];
  renderPanelReuniones(panel, ejeNombre, reunionesData);
};

function renderPanelReuniones(panel, ejeNombre, rows) {
  const canDelete = (r) =>
    currentPerfil?.rol === 'admin' || r.creado_por === currentUser?.id;

  const filas = rows.length
    ? rows.map(r => `
      <tr>
        <td style="white-space:nowrap">${fmtDate(r.fecha)}</td>
        <td><strong>${esc(r.nombre)}</strong></td>
        <td class="comment-cell">${esc(r.comentario || '—')}</td>
        <td>
          ${r.url
            ? `<a href="${esc(r.url)}" target="_blank" rel="noopener" class="link-ext" title="${esc(r.url)}">🔗 Ver</a>`
            : '—'}
        </td>
        <td>
          <button class="btn-icon-sm" title="Editar reunión"
              onclick="abrirEditarReunion(${r.id})">⚙️</button>
        </td>
      </tr>`).join('')
    : `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:12px">Sin reuniones registradas aún.</td></tr>`;

  panel.innerHTML = `
    <div class="panel-reuniones-inner">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <span style="font-weight:600;font-size:13px;color:#4f46e5">📅 Reuniones — ${esc(ejeNombre)}</span>
        <button class="btn-add-inline" style="background:#4f46e5;color:#fff;font-size:12px"
          onclick="abrirModalReunion('${esc(ejeNombre).replace(/'/g,"\'")}')">＋ Agregar reunión</button>
      </div>
      <table class="repo-table" style="font-size:12px">
        <thead><tr>
          <th style="width:90px">Fecha</th>
          <th>Nombre / Asunto</th>
          <th>Comentario / Objetivo</th>
          <th style="width:70px">URL</th>
          <th style="width:40px"></th>
        </tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>
  `;
}

window.abrirModalReunion = function(ejeNombre) {
  document.getElementById('reunionId').value        = '';
  document.getElementById('reunionEjeNombre').value = ejeNombre;
  document.getElementById('reunionNombre').value    = '';
  document.getElementById('reunionFecha').value     = new Date().toISOString().split('T')[0];
  document.getElementById('reunionComentario').value= '';
  document.getElementById('reunionUrl').value       = '';
  document.querySelector('#reunionModal .modalTitle').textContent = '📅 Agregar reunión';
  document.getElementById('btnDeleteReunion').style.display = 'none';
  openModal('reunionModal');
};

window.abrirEditarReunion = function(id) {
  const r = reunionesData.find(x => x.id === id);
  if (!r) return;
  const canDelete = currentPerfil?.rol === 'admin' || r.creado_por === currentUser?.id;
  document.getElementById('reunionId').value        = r.id;
  document.getElementById('reunionEjeNombre').value = r.eje_nombre;
  document.getElementById('reunionNombre').value    = r.nombre || '';
  document.getElementById('reunionFecha').value     = r.fecha || '';
  document.getElementById('reunionComentario').value= r.comentario || '';
  document.getElementById('reunionUrl').value       = r.url || '';
  document.querySelector('#reunionModal .modalTitle').textContent = '📅 Editar reunión';
  document.getElementById('btnDeleteReunion').style.display = canDelete ? 'block' : 'none';
  openModal('reunionModal');
};

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('reunionForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ejeNombre  = document.getElementById('reunionEjeNombre').value;
    const nombre     = document.getElementById('reunionNombre').value.trim();
    const fecha      = document.getElementById('reunionFecha').value || null;
    const comentario = document.getElementById('reunionComentario').value.trim() || null;
    const url        = document.getElementById('reunionUrl').value.trim() || null;

    if (!nombre) { alert('El nombre de la reunión es obligatorio.'); return; }

    const reunionId = document.getElementById('reunionId').value;
    let error;
    if (reunionId) {
      ({ error } = await sb.from('reuniones').update({ nombre, fecha, comentario, url }).eq('id', reunionId));
    } else {
      ({ error } = await sb.from('reuniones').insert({
        eje_nombre: ejeNombre, nombre, fecha, comentario, url, creado_por: currentUser.id,
      }));
    }

    if (error) { alert('Error al guardar: ' + error.message); return; }
    closeModal('reunionModal');

    // Refrescar el panel abierto
    const panelId = 'panelReuniones_' + ejeNombre.replace(/[^a-zA-Z0-9]/g, '_');
    const panel   = document.getElementById(panelId);
    if (panel && panel.style.display !== 'none') {
      const { data } = await sb.from('reuniones')
        .select('*').eq('eje_nombre', ejeNombre).order('fecha', { ascending: false });
      reunionesData = data || [];
      renderPanelReuniones(panel, ejeNombre, reunionesData);
    }
  });
});

window.eliminarReunionDesdeModal = async function() {
  const id     = document.getElementById('reunionId').value;
  const nombre = document.getElementById('reunionNombre').value;
  if (!id) return;
  if (!confirm(`¿Eliminar la reunión "${nombre}"?\n\nEsta acción no se puede deshacer.`)) return;
  closeModal('reunionModal');
  const { error } = await sb.from('reuniones').delete().eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  if (reunionesEjeActual) {
    const panelId = 'panelReuniones_' + reunionesEjeActual.replace(/[^a-zA-Z0-9]/g, '_');
    const panel   = document.getElementById(panelId);
    if (panel) {
      const { data } = await sb.from('reuniones')
        .select('*').eq('eje_nombre', reunionesEjeActual).order('fecha', { ascending: false });
      reunionesData = data || [];
      renderPanelReuniones(panel, reunionesEjeActual, reunionesData);
    }
  }
};

window.eliminarReunion = async function(id, nombre) {
  if (!confirm(`¿Eliminar la reunión "${nombre}"?\n\nEsta acción no se puede deshacer.`)) return;
  const { error } = await sb.from('reuniones').delete().eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }

  // Refrescar panel
  if (reunionesEjeActual) {
    const panelId = 'panelReuniones_' + reunionesEjeActual.replace(/[^a-zA-Z0-9]/g, '_');
    const panel   = document.getElementById(panelId);
    if (panel) {
      const { data } = await sb.from('reuniones')
        .select('*').eq('eje_nombre', reunionesEjeActual).order('fecha', { ascending: false });
      reunionesData = data || [];
      renderPanelReuniones(panel, reunionesEjeActual, reunionesData);
    }
  }
};

// ========= ELIMINAR EJE COMPLETO =========
window.eliminarEje = async function(nombreEje) {
  const ids = rawData.filter(r => r.actividad_general === nombreEje).map(r => r.id);
  const msg = ids.length
    ? `¿Eliminar el eje "${nombreEje}" y todas sus ${ids.length} actividades?\n\nEsta acción NO se puede deshacer.`
    : `¿Eliminar el eje "${nombreEje}"?\n\nEsta acción NO se puede deshacer.`;
  if (!confirm(msg)) return;
  closeModal('ejeModal');

  // Log de eliminación del eje ANTES de borrar
  await insertarLog([{
    actividad_id:     null,
    actividad_nombre: nombreEje,
    usuario_id:       currentUser.id,
    usuario_nombre:   currentPerfil?.nombre || currentUser.email,
    campo_modificado: 'eje_eliminacion',
    valor_anterior:   nombreEje,
    valor_nuevo:      null,
    justificacion:    null,
    tipo_accion:      'eliminacion',
  }]);

  await sb.from('reuniones').delete().eq('eje_nombre', nombreEje);
  await sb.from('poi_programado').delete().eq('eje_nombre', nombreEje);
  await sb.from('poi_evidencias').delete().eq('eje_nombre', nombreEje);
  await sb.from('hitos').delete().eq('eje_nombre', nombreEje);
  await sb.from('ejes').delete().eq('nombre', nombreEje);
  if (ids.length) {
    const { error } = await sb.from('actividades').delete().eq('actividad_general', nombreEje);
    if (error) { alert('Error: ' + error.message); return; }
  }
  ejeSeleccionado = null;
  await loadActividades();
};

// ========= ELIMINAR HITO COMPLETO =========
window.eliminarHito = async function(actividadGeneral, nombreHito) {
  const count = rawData.filter(r => r.actividad_general === actividadGeneral && r.hito === nombreHito).length;
  const msg = count
    ? `¿Eliminar el hito "${nombreHito}" y sus ${count} actividades?\n\nEsta acción NO se puede deshacer.`
    : `¿Eliminar el hito "${nombreHito}"?\n\nEsta acción NO se puede deshacer.`;
  if (!confirm(msg)) return;
  closeModal('hitoModal');

  // Log de eliminación del hito ANTES de borrar
  await insertarLog([{
    actividad_id:     null,
    actividad_nombre: actividadGeneral,
    usuario_id:       currentUser.id,
    usuario_nombre:   currentPerfil?.nombre || currentUser.email,
    campo_modificado: 'hito_eliminacion',
    valor_anterior:   nombreHito,
    valor_nuevo:      null,
    justificacion:    null,
    tipo_accion:      'eliminacion',
  }]);

  await sb.from('hitos').delete().eq('eje_nombre', actividadGeneral).eq('nombre', nombreHito);
  if (count) {
    await sb.from('actividades').delete().eq('actividad_general', actividadGeneral).eq('hito', nombreHito);
  }
  const ejeAntes = ejeSeleccionado;
  await loadActividades();
  ejeSeleccionado = ejeAntes;
};


