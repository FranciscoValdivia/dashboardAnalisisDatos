// ── CONFIGURACIÓN DE ORIGEN DE DATOS DIRECTO (GOOGLE SHEETS PUBLICADO EN CSV) ──
// RECUERDA: Reemplaza esta URL por la nueva que generes al "Guardar como Hoja de cálculo de Google" y "Publicar en la web" como CSV.
const EXCEL_DATA_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTYiU1nxu_oBNnGxEf8E4NU2_ibEZNq0Pn0o521_28fNTDBb8KBNOKm5KTchiRCjw/pub?output=csv";

// ── Almacenamiento Estructurado de Historial ────────────────────────────────
let historicalStore = {}; 
let activeYear = "";      
let filteredData = [];   
let charts = {};

// Paleta Dark Mode Corporativa
const PALETTE = {
  grid: 'rgba(255,255,255,.04)',
  text: '#94a3b8',
  mappedPortales: {
    'FALABELLA': '#10b981', 'AMERICATECH': '#f43f5e', 'PARÍS': '#0ea5e9',         
    'PARIS': '#0ea5e9', 'WALMART': '#3b82f6', 'RIPLEY': '#64748b', 'MERCADO LIBRE': '#eab308'  
  },
  defaultPortales: ['#6366f1', '#8b5cf6', '#d946ef', '#06b6d4']
};

const MESES_NAMES = {
  '1':'Enero','2':'Febrero','3':'Marzo','4':'Abril','5':'Mayo','6 JUNIO':'Junio','6':'Junio',
  '7':'Julio','8':'Agosto','9':'Septiembre','10':'Octubre','11':'Noviembre','12':'Diciembre',
  '01':'Enero','02':'Febrero','03':'Marzo','04':'Abril','05':'Mayo','06':'Junio',
  '07':'Julio','08':'Agosto','09':'Septiembre','10':'Octubre','11':'Noviembre','12':'Diciembre'
};

function getPortalColor(p) { return PALETTE.mappedPortales[String(p||'').trim().toUpperCase()] || PALETTE.defaultPortales[0]; }
function fmtFull(v) { return (!v && v !== 0) ? '—' : '$' + Math.round(v).toLocaleString('es-CL'); }
function safeNum(v) { const n = parseFloat(String(v || '').replace(/[$,\.\s]/g, '')); return isNaN(n) ? 0 : n; }

if (typeof Chart !== 'undefined') {
  Chart.defaults.color = PALETTE.text;
  Chart.defaults.font.family = 'Inter';
}
function baseScales() { return { x:{grid:{color:PALETTE.grid}}, y:{grid:{color:PALETTE.grid}, ticks:{callback:v=>fmtFull(v)}} }; }
function destroyChart(id) { if(charts[id]) { charts[id].destroy(); delete charts[id]; } }

// ── Lector Nativo Directo para CSV de Google Sheets ──────────────────────────
async function loadLiveExcelData() {
  const loadingEl = document.getElementById('loadingSection');
  const contentEl = document.getElementById('dashboardContent');

  try {
    console.log("Conectando directo al CSV de Google Sheets...");
    const response = await fetch(EXCEL_DATA_URL);
    if (!response.ok) {
      throw new Error(`HTTP Error: El servidor de Google Sheets respondió con status ${response.status}`);
    }

    const csvText = await response.text();
    
    // Validar si devolvió un HTML de login en vez del CSV crudo
    if (csvText.substring(0, 100).includes("<!DOCTYPE") || csvText.substring(0, 100).includes("<html")) {
      throw new Error("El enlace público devolvió código HTML en lugar de datos tabulares. Revisa los accesos del documento.");
    }

    // Parsear el CSV crudo de Google Sheets
    processCSVData(csvText);

    if (loadingEl) loadingEl.classList.add('hidden');
    if (contentEl) contentEl.classList.remove('hidden');
    
    initDashboardSelectors();

  } catch (err) {
    console.error("Error cargando el CSV:", err);
    if (loadingEl) {
      loadingEl.innerHTML = `
        <div class="text-center space-y-4 py-16 px-4">
          <div class="text-rose-500 font-bold text-lg">⚠️ Error en Enlace de Google Sheets</div>
          <p class="text-slate-300 text-sm max-w-md mx-auto bg-rose-500/10 border border-rose-500/20 p-3 rounded-lg font-mono">
            ${err.message}
          </p>
          <div class="p-4 bg-slate-900 border border-slate-800 rounded-lg text-left text-xs text-slate-400 max-w-xl mx-auto space-y-2">
            <p class="font-bold text-indigo-400">Verificaciones recomendadas:</p>
            <p>Asegúrate de haber seleccionado <strong>"Publicar en la web"</strong> en el menú Archivo de Sheets, escogiendo la opción de exportar como <strong>Valores separados por comas (.csv)</strong>.</p>
          </div>
          <button onclick="location.reload()" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition-all">
            Reintentar Conexión
          </button>
        </div>
      `;
    }
  }
}

// ── Parseador de CSV Tolerante con Comas Internas ────────────────────────────
function parseCSVRows(text) {
  const lines = text.split(/\r?\n/);
  return lines.map(line => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  });
}

// ── Procesador Adaptativo de Registros ───────────────────────────────────────
function processCSVData(csvText) {
  const json = parseCSVRows(csvText);
  historicalStore = {}; 

  if (json.length < 2) {
    throw new Error("El documento CSV de Google Sheets no contiene filas de datos.");
  }

  // Buscar fila de cabeceras de forma dinámica
  let hdrIdx = -1;
  for (let i = 0; i < Math.min(30, json.length); i++) {
    const rowClean = json[i].map(c => String(c||'').trim().toUpperCase());
    if (rowClean.includes('NV') || rowClean.includes('PORTAL') || rowClean.includes('PRECIO VENTA')) { 
      hdrIdx = i; 
      break; 
    }
  }

  if (hdrIdx === -1) hdrIdx = 0;

  const headers = json[hdrIdx].map(h => String(h||'').trim().toUpperCase().replace(/\s+/g,' '));
  const col = {}; 
  headers.forEach((h, i) => { col[h] = i; });

  const idxNV     = col['NV'] ?? 0;
  const idxQTY    = col['QTY'] ?? col['CANTIDAD'] ?? 2;
  const idxPN     = col['PN'] ?? col['PART NUMBER'] ?? 3;
  const idxProd   = col['VALIDACIÓN KIT'] ?? col['VALIDACION KIT'] ?? col['PRODUCTO'] ?? col['DESCRIPCION'] ?? 4;
  const idxPortal = col['PORTAL'] ?? col['CANAL'] ?? 7;
  const idxVenta  = col['PRECIO VENTA'] ?? col['TOTAL'] ?? col['VENTA'] ?? 12;
  const idxDoc    = col['DOCUMENTO INTERNO'] ?? col['DOCUMENTO'] ?? 6;
  const idxMes    = col['MES OC'] ?? col['MES'] ?? 20;
  const idxDia    = col['DIA OC'] ?? col['DIA'] ?? col['DÍA'] ?? -1;
  const idxAnio   = col['AÑO OC'] ?? col['AÑO'] ?? -1;
  const idxFecha  = col['FECHA'] ?? col['FECHA OC'] ?? 0; 

  for (let i = hdrIdx + 1; i < json.length; i++) {
    const r = json[i];
    if (!r || r.length === 0 || !r[idxNV]) continue; 

    // Extraer el año de forma flexible y adaptada a la escala 2022 - 2026
    let yearKey = ""; 
    
    // 1. Intentar por columna directa de año
    if (idxAnio !== -1 && r[idxAnio]) {
      yearKey = String(r[idxAnio]).trim().match(/\d+/)?.[0] || "";
    } 
    
    // 2. Si falla, intentar extraerlo de la columna de fecha completa o columna 0
    if ((!yearKey || yearKey.length < 2) && r[idxFecha]) {
      const fechaStr = String(r[idxFecha]);
      const matchAnio = fechaStr.match(/\b(202[2-6])\b/) || fechaStr.match(/\b(2[2-6])\b/);
      if (matchAnio) yearKey = matchAnio[0];
    }

    // Normalizar formato de año de dos dígitos (ej: "24" -> "2024")
    if (yearKey.length === 2) yearKey = "20" + yearKey;
    
    // Validar rango objetivo. Si no es un año válido entre 2022 y 2026, se categoriza como "Otros"
    const numAnio = parseInt(yearKey);
    if (isNaN(numAnio) || numAnio < 2022 || numAnio > 2026) {
      yearKey = "Otros"; 
    }

    let diaCalculado = "15"; 
    if (idxDia !== -1 && r[idxDia]) {
      diaCalculado = String(r[idxDia]).trim();
    }

    const rowObj = {
      nv:       String(r[idxNV]),
      qty:      safeNum(r[idxQTY]) || 1,
      pn:       String(r[idxPN] || '').trim(),
      producto: String(r[idxProd] || r[idxPN] || 'Indefinido').trim(),
      portal:   String(r[idxPortal] || 'Otros').trim().toUpperCase(),
      venta:    safeNum(r[idxVenta]),
      docTipo:  String(r[idxDoc] || 'N/A').trim().toUpperCase().replace(/\s+/g,''),
      mes:      String(r[idxMes] || '').trim(),
      dia:      parseInt(diaCalculado) || 1
    };

    if (!historicalStore[yearKey]) {
      historicalStore[yearKey] = [];
    }
    historicalStore[yearKey].push(rowObj);
  }
  
  console.log("Estructura de años cargada:", Object.keys(historicalStore));
}

// ── Inicialización de Controles ──────────────────────────────
function initDashboardSelectors() {
  const disponibles = Object.keys(historicalStore).sort((a,b) => b-a); 
  if (disponibles.length === 0) {
    historicalStore["Datos"] = Object.values(historicalStore).flat();
    disponibles.push("Datos");
  }

  const sSingle  = document.getElementById('selectSingleYear');
  const sCompA   = document.getElementById('compareYearA');
  const sCompB   = document.getElementById('compareYearB');

  if(sSingle) sSingle.innerHTML = ""; 
  if(sCompA) sCompA.innerHTML = ""; 
  if(sCompB) sCompB.innerHTML = "";

  disponibles.forEach(anio => {
    if(sSingle) sSingle.innerHTML += `<option value="${anio}">${anio}</option>`;
    if(sCompA) sCompA.innerHTML  += `<option value="${anio}">${anio}</option>`;
    if(sCompB) sCompB.innerHTML  += `<option value="${anio}">${anio}</option>`;
  });

  activeYear = disponibles[0]; 
  if(sSingle) sSingle.value = activeYear;
  
  if (disponibles.length > 1) {
    if(sCompA) sCompA.value = disponibles[1]; 
    if(sCompB) sCompB.value = disponibles[0]; 
  } else {
    if(sCompA) sCompA.value = disponibles[0];
    if(sCompB) sCompB.value = disponibles[0];
  }

  triggerSingleYearCalculations();
}

// ── Módulo de Filtros y Renderers ────────────────────────────
function switchViewMode(mode) {
  const ts = document.getElementById('tabSingle'), tc = document.getElementById('tabCompare');
  const vs = document.getElementById('viewSingle'), vc = document.getElementById('viewCompare');
  if (mode === 'single') {
    if(ts) ts.className = "pb-3 text-indigo-400 border-b-2 border-indigo-500 font-semibold transition-all";
    if(tc) tc.className = "pb-3 text-slate-400 hover:text-white transition-all flex items-center gap-2";
    if(vs) vs.classList.remove('hidden'); if(vc) vc.classList.add('hidden');
    triggerSingleYearCalculations();
  } else {
    if(tc) tc.className = "pb-3 text-indigo-400 border-b-2 border-indigo-500 font-semibold transition-all flex items-center gap-2";
    if(ts) ts.className = "pb-3 text-slate-400 hover:text-white transition-all";
    if(vc) vc.classList.remove('hidden'); if(vs) vs.classList.add('hidden');
    runComparison();
  }
}

function changeSingleYear() {
  activeYear = document.getElementById('selectSingleYear').value;
  triggerSingleYearCalculations();
}

function triggerSingleYearCalculations() {
  const data = historicalStore[activeYear] || [];
  filteredData = [...data];
  populateFilters(data);
  renderSingleDashboard();
}

function populateFilters(data) {
  let portales = [...new Set(data.map(r => r.portal).filter(Boolean))].sort();
  const meses  = [...new Set(data.map(r => r.mes).filter(Boolean))].sort((a,b)=>+a-+b);
  let docs     = [...new Set(data.map(r => r.docTipo).filter(Boolean))].sort().filter(d => d.trim().toUpperCase() !== "N/A");

  portales = portales.filter(p => {
    const n = p.trim().toUpperCase();
    return n !== "TOTAL GENERAL" && n !== "OTROS" && n !== "";
  });

  const fill = (el, items, map) => {
    if (!el) return;
    el.innerHTML = el.id === "filterPortal" ? '<option value="">Todos los portales</option>' : '<option value="">Todos</option>';
    items.forEach(v => { 
      const o = document.createElement('option'); o.value = v; o.textContent = map ? (map[v] || v) : v; el.appendChild(o); 
    });
  };
  fill(document.getElementById('filterPortal'), portales);
  fill(document.getElementById('filterMes'), meses, MESES_NAMES);
  fill(document.getElementById('filterDoc'), docs);
}

function applyFilters() {
  const p = document.getElementById('filterPortal').value;
  const m = document.getElementById('filterMes').value;
  const d = document.getElementById('filterDoc').value;
  const data = historicalStore[activeYear] || [];
  filteredData = data.filter(r => (!p || r.portal === p) && (!m || r.mes === m) && (!d || r.docTipo === d));
  renderSingleDashboard();
}

function resetFilters() {
  document.getElementById('filterPortal').value = ''; document.getElementById('filterMes').value = ''; document.getElementById('filterDoc').value = '';
  filteredData = [...(historicalStore[activeYear] || [])];
  renderSingleDashboard();
}

function byKey(data, key, limitFn) {
  const map = {};
  data.forEach(r => {
    const k = r[key] || 'Sin especificar';
    if (!map[k]) map[k] = { ventas:0, orders:0, qty:0 };
    map[k].ventas += r.venta; map[k].orders += 1; map[k].qty += r.qty;
  });
  let arr = Object.entries(map).map(([label, v]) => ({ label, ...v }));
  arr.sort((a,b) => b.ventas - a.ventas);
  return limitFn ? limitFn(arr) : arr;
}

function renderSingleDashboard() {
  const data = filteredData;
  const totalVentas = data.reduce((s,r)=>s+r.venta, 0);
  const totalOrders = data.length;

  document.getElementById('kpiVentas').textContent = fmtFull(totalVentas);
  document.getElementById('kpiVentasOrders').textContent = totalOrders.toLocaleString('es-CL');
  document.getElementById('kpiVentasQty').textContent = data.reduce((s,r)=>s+r.qty,0).toLocaleString('es-CL');
  document.getElementById('kpiTicket').textContent = totalOrders > 0 ? fmtFull(totalVentas/totalOrders) : '$0';

  destroyChart('prod');
  const prods = byKey(data, 'producto', a => a.slice(0,10));
  charts['prod'] = new Chart(document.getElementById('chartProductos'), {
    type: 'bar', data: { labels: prods.map(p=>p.label.substring(0,25)), datasets:[{ label:'Ingresos', data:prods.map(p=>p.ventas), backgroundColor:'#6366f1' }] },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} }, scales:baseScales() }
  });

  destroyChart('donut');
  let ports = byKey(data, 'portal').filter(p => p.label.trim().toUpperCase() !== "TOTAL GENERAL" && p.label.trim().toUpperCase() !== "N/A" && p.ventas > 0);
  const totalP = ports.reduce((s,p)=>s+p.ventas, 0);
  
  charts['donut'] = new Chart(document.getElementById('chartPortalDonut'), {
    type: 'doughnut', data: { labels:ports.map(p=>p.label), datasets:[{ data:ports.map(p=>p.ventas), backgroundColor:ports.map(p=>getPortalColor(p.label)), borderWidth:0 }] },
    options: { responsive:true, maintainAspectRatio:false, cutout:'70%', plugins:{ legend:{display:false} } }
  });

  const leg = document.getElementById('portalLegend'); leg.innerHTML = '';
  ports.forEach(p => {
    leg.innerHTML += `<div class="flex items-center justify-between text-xs text-slate-400"><span class="truncate flex items-center gap-1.5"><span class="w-2 h-2 rounded-sm" style="background:${getPortalColor(p.label)}"></span>${p.label}</span><span class="font-mono text-white font-medium">${fmtFull(p.ventas)} (${totalP > 0 ? ((p.ventas/totalP)*100).toFixed(1) : 0}%)</span></div>`;
  });

  destroyChart('line');
  const mData = {}; data.forEach(r => { if(r.mes) mData[r.mes] = (mData[r.mes]||0)+r.venta; });
  const sortedM = Object.keys(mData).sort((a,b)=>+a-+b);
  charts['line'] = new Chart(document.getElementById('chartMensual'), {
    type: 'line', data: { labels:sortedM.map(m=>MESES_NAMES[m]||m), datasets:[{ label:'Ventas', data:sortedM.map(m=>mData[m]), borderColor:'#10b981', tension:0.2, fill:false }] },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} }, scales:baseScales() }
  });

  destroyChart('opsO'); destroyChart('opsT');
  charts['opsO'] = new Chart(document.getElementById('chartOrdenesPortal'), { type: 'bar', data: { labels:ports.map(p=>p.label), datasets:[{ data:ports.map(p=>p.orders), backgroundColor:'#8b5cf6' }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} } } });
  charts['opsT'] = new Chart(document.getElementById('chartTicketPortal'), { type: 'bar', data: { labels:ports.map(p=>p.label), datasets:[{ data:ports.map(p=>Math.round(p.ventas/p.orders)), backgroundColor:'#3b82f6' }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} }, scales:{ y:{ticks:{callback:v=>fmtFull(v)}} } } });

  const allProds = byKey(data, 'producto');
  document.getElementById('tableProdCount').textContent = `${allProds.length} SKUs`;
  const tbody = document.getElementById('productTableBody'); tbody.innerHTML = '';
  allProds.forEach((p,i) => {
    tbody.innerHTML += `<tr class="hover:bg-slate-900 text-slate-300 border-b border-slate-900"><td class="p-3 text-slate-600">${i+1}</td><td class="p-3 text-white font-medium truncate max-w-sm" title="${p.label}">${p.label}</td><td class="p-3 text-right font-mono">${p.orders}</td><td class="p-3 text-right font-mono">${p.qty}</td><td class="p-3 text-right text-emerald-400 font-mono font-semibold">${fmtFull(p.ventas)}</td></tr>`;
  });
}

function runComparison() {
  const yearA = document.getElementById('compareYearA').value;
  const yearB = document.getElementById('compareYearB').value;
  const dataA = historicalStore[yearA] || []; const dataB = historicalStore[yearB] || [];
  const totalA = dataA.reduce((sum, r) => sum + r.venta, 0); const totalB = dataB.reduce((sum, r) => sum + r.venta, 0);

  document.getElementById('kpiCompA').textContent = fmtFull(totalA);
  document.getElementById('subCompA').textContent = `${dataA.length.toLocaleString('es-CL')} órdenes`;
  document.getElementById('kpiCompB').textContent = fmtFull(totalB);
  document.getElementById('subCompB').textContent = `${dataB.length.toLocaleString('es-CL')} órdenes`;

  const badge = document.getElementById('badgeCrecimiento');
  if (totalA > 0) {
    const delta = ((totalB - totalA) / totalA) * 100;
    badge.textContent = (delta >= 0 ? '▲ +' : '▼ ') + delta.toFixed(1) + '%';
    badge.className = `text-xs px-2 py-1 rounded font-bold ${delta >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`;
  } else {
    badge.textContent = '0%'; badge.className = 'bg-slate-800 text-slate-400 text-xs px-2 py-1 rounded';
  }

  destroyChart('compMeses');
  const mesesA = Array(12).fill(0), mesesB = Array(12).fill(0);
  dataA.forEach(r => { const m = parseInt(r.mes); if(m >= 1 && m <= 12) mesesA[m-1] += r.venta; });
  dataB.forEach(r => { const m = parseInt(r.mes); if(m >= 1 && m <= 12) mesesB[m-1] += r.venta; });

  charts['compMeses'] = new Chart(document.getElementById('chartCompMeses'), {
    type: 'bar', data: { labels: ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'], datasets: [ { label: `Año ${yearA}`, data: mesesA, backgroundColor: '#6366f1' }, { label: `Año ${yearB}`, data: mesesB, backgroundColor: '#10b981' } ] },
    options: { responsive: true, maintainAspectRatio: false, scales: baseScales() }
  });

  destroyChart('compDias');
  const diasA = Array(31).fill(0), diasB = Array(31).fill(0);
  dataA.forEach(r => { if(r.dia >= 1 && r.dia <= 31) diasA[r.dia - 1] += r.venta; });
  dataB.forEach(r => { if(r.dia >= 1 && r.dia <= 31) diasB[r.dia - 1] += r.venta; });

  charts['compDias'] = new Chart(document.getElementById('chartCompDias'), {
    type: 'line', data: { labels: Array.from({length: 31}, (_, i) => String(i + 1)), datasets: [ { label: `Año ${yearA}`, data: diasA, borderColor: '#6366f1', tension: 0.2, fill: false }, { label: `Año ${yearB}`, data: diasB, borderColor: '#10b981', tension: 0.2, fill: false } ] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: baseScales() }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadLiveExcelData();
  ['filterPortal','filterMes','filterDoc'].forEach(id => {
    const el = document.getElementById(id); if (el) el.addEventListener('change', applyFilters);
  });
});
