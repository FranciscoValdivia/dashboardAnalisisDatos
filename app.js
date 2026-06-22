// ── CONFIGURACIÓN DE ORIGEN DE DATOS DIRECTO (GOOGLE SHEETS POR PESTAÑAS) ──
const SPREADSHEET_BASE_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTYiU1nxu_oBNnGxEf8E4NU2_ibEZNq0Pn0o521_28fNTDBb8KBNOKm5KTchiRCjw/pub?output=csv";

// Definición de las pestañas actuales en tu Google Sheet
const HOJAS_CONFIG = [
  { anio: "2024", nombreHoja: "V24" },
  { anio: "2025", nombreHoja: "V25" },
  { anio: "2026", nombreHoja: "V26" }
];

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
  '1':'Enero','2':'Febrero','3':'Marzo','4 HARDWARE':'Abril','4':'Abril','5':'Mayo','6 JUNIO':'Junio','6':'Junio',
  '7':'Julio','8':'Agosto','9':'Septiembre','10':'Octubre','11':'Noviembre','12':'Diciembre',
  '01':'Enero','02':'Febrero','03':'Marzo','04':'Abril','05':'Mayo','06':'Junio',
  '07':'Julio','08':'Agosto','09':'Septiembre','10':'Octubre','11':'Noviembre','12':'Diciembre'
};

function getPortalColor(p) { return PALETTE.mappedPortales[String(p||'').trim().toUpperCase()] || PALETTE.defaultPortales[0]; }

// Formateador de moneda CL completo
function fmtFull(v) { 
  if (!v && v !== 0) return '—'; 
  return '$' + Math.round(v).toLocaleString('es-CL'); 
}

// Limpiador numérico ultra estricto para evitar desajustes de puntos/comas de Excel
function safeNum(v) {
  if (!v) return 0;
  // Elimina el signo $, espacios y puntos de miles (estilo chileno)
  let clean = String(v).replace(/[\$\s]/g, '');
  // Si usa punto como separador de miles, por ejemplo 1.500.000
  if (clean.includes('.') && !clean.includes(',')) {
    clean = clean.replace(/\./g, '');
  } else if (clean.includes('.') && clean.includes(',')) {
    // Si tiene punto de miles y coma decimal (1.500,50)
    clean = clean.replace(/\./g, '').replace(',', '.');
  } else if (clean.includes(',')) {
    // Si solo tiene coma decimal
    clean = clean.replace(',', '.');
  }
  const n = parseFloat(clean);
  return isNaN(n) ? 0 : n;
}

if (typeof Chart !== 'undefined') {
  Chart.defaults.color = PALETTE.text;
  Chart.defaults.font.family = 'Inter';
}
function baseScales() { return { x:{grid:{color:PALETTE.grid}}, y:{grid:{color:PALETTE.grid}, ticks:{callback:v=>fmtFull(v)}} }; }
function destroyChart(id) { if(charts[id]) { charts[id].destroy(); delete charts[id]; } }

// ── Lector Multihoya para Google Sheets ──────────────────────────────────────
async function loadLiveExcelData() {
  const loadingEl = document.getElementById('loadingSection');
  const contentEl = document.getElementById('dashboardContent');

  try {
    console.log("Iniciando descarga en paralelo de pestañas independientes...");
    historicalStore = {}; 

    const fetchPromises = HOJAS_CONFIG.map(async (hoja) => {
      const urlConHoja = `${SPREADSHEET_BASE_URL}&sheet=${encodeURIComponent(hoja.nombreHoja)}`;
      
      const response = await fetch(urlConHoja);
      if (!response.ok) {
        throw new Error(`Error descargando pestaña ${hoja.nombreHoja} (Status ${response.status})`);
      }
      
      const csvText = await response.text();
      
      if (csvText.substring(0, 100).includes("<!DOCTYPE") || csvText.substring(0, 100).includes("<html")) {
        throw new Error(`La pestaña ${hoja.nombreHoja} no está disponible públicamente.`);
      }

      processCSVDataForYear(csvText, hoja.anio);
    });

    await Promise.all(fetchPromises);

    if (loadingEl) loadingEl.classList.add('hidden');
    if (contentEl) contentEl.classList.remove('hidden');
    
    initDashboardSelectors();

  } catch (err) {
    console.error("Error cargando los datos:", err);
    if (loadingEl) {
      loadingEl.innerHTML = `
        <div class="text-center space-y-4 py-16 px-4">
          <div class="text-rose-500 font-bold text-lg">⚠️ Error en Enlace de Google Sheets</div>
          <p class="text-slate-300 text-sm max-w-md mx-auto bg-rose-500/10 border border-rose-500/20 p-3 rounded-lg font-mono">
            ${err.message}
          </p>
          <button onclick="location.reload()" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition-all">
            Reintentar Conexión
          </button>
        </div>
      `;
    }
  }
}

// Parseador tolerante a comas en textos de productos
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

// ── Procesador Adaptativo por Año Específico ────────────────────────────────
function processCSVDataForYear(csvText, yearKey) {
  const json = parseCSVRows(csvText);
  if (json.length < 2) return; 

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

  // Indexadores mapeados con tus nombres exactos
  const idxNV     = col['NV'] ?? 0;
  const idxQTY    = col['QTY'] ?? col['CANTIDAD'] ?? 2;
  const idxPN     = col['PN'] ?? col['PART NUMBER'] ?? 3;
  const idxProd   = col['VALIDACIÓN KIT'] ?? col['VALIDACION KIT'] ?? col['PRODUCTO'] ?? col['DESCRIPCION'] ?? 4;
  const idxPortal = col['PORTAL'] ?? col['CANAL'] ?? 7;
  const idxVenta  = col['PRECIO VENTA'] ?? col['TOTAL'] ?? col['VENTA'] ?? 12;
  const idxDoc    = col['DOCUMENTO INTERNO'] ?? col['DOCUMENTO'] ?? 6;
  const idxMes    = col['MES OC'] ?? col['MES'] ?? 20;
  const idxDia    = col['DIA OC'] ?? col['DIA'] ?? col['DÍA'] ?? -1;

  if (!historicalStore[yearKey]) {
    historicalStore[yearKey] = [];
  }

  for (let i = hdrIdx + 1; i < json.length; i++) {
    const r = json[i];
    if (!r || r.length === 0) continue; 

    const nvVal = String(r[idxNV] || '').trim();
    const prodVal = String(r[idxProd] || '').trim();
    
    // FILTROS CRÍTICOS: Omitir filas vacías, comentarios o totales sumados abajo en tu Excel
    if (!nvVal || nvVal === "" || nvVal.toUpperCase().includes("TOTAL") || nvVal.toUpperCase().includes("SUMA")) continue;
    if (!prodVal || prodVal === "" || prodVal.toUpperCase().includes("TOTAL")) continue;

    let diaCalculado = "15"; 
    if (idxDia !== -1 && r[idxDia]) {
      diaCalculado = String(r[idxDia]).trim();
    }

    const rowObj = {
      nv:       nvVal,
      qty:      safeNum(r[idxQTY]) || 0,
      pn:       String(r[idxPN] || '').trim(),
      producto: prodVal,
      portal:   String(r[idxPortal] || 'Otros').trim().toUpperCase(),
      venta:    safeNum(r[idxVenta]),
      docTipo:  String(r[idxDoc] || 'N/A').trim().toUpperCase().replace(/\s+/g,''),
      mes:      String(r[idxMes] || '').trim(),
      dia:      parseInt(diaCalculado) || 1
    };

    // Solo guardar si el registro tiene un valor monetario o unidades lógicas
    if (rowObj.qty > 0 || rowObj.venta > 0) {
      historicalStore[yearKey].push(rowObj);
    }
  }
}

// ── Inicialización de Controles ──────────────────────────────────────────────
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

  // Vincular cambio dinámico
  if (sSingle) {
    sSingle.addEventListener('change', (e) => {
      activeYear = e.target.value;
      triggerSingleYearCalculations();
    });
  }
  if (sCompA) sCompA.addEventListener('change', runComparison);
  if (sCompB) sCompB.addEventListener('change', runComparison);

  triggerSingleYearCalculations();
}

function changeSingleYear() {
  const select = document.getElementById('selectSingleYear');
  if (select) {
    activeYear = select.value;
    triggerSingleYearCalculations();
  }
}

function switchViewMode(mode) {
  const ts = document.getElementById('tabSingle'), tc = document.getElementById('tabCompare');
  const vs = document.getElementById('viewSingle'), vc = document.getElementById('viewCompare');
  if (mode === 'single') {
    if(ts) ts.className = "pb-3 text-indigo-400 border-b-2 border-indigo-500 font-semibold transition-all cursor-pointer";
    if(tc) tc.className = "pb-3 text-slate-400 hover:text-white transition-all flex items-center gap-2 cursor-pointer";
    if(vs) vs.classList.remove('hidden'); if(vc) vc.classList.add('hidden');
    triggerSingleYearCalculations();
  } else {
    if(tc) tc.className = "pb-3 text-indigo-400 border-b-2 border-indigo-500 font-semibold transition-all flex items-center gap-2 cursor-pointer";
    if(ts) ts.className = "pb-3 text-slate-400 hover:text-white transition-all cursor-pointer";
    if(vc) vc.classList.remove('hidden'); if(vs) vs.classList.add('hidden');
    runComparison();
  }
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
  if(document.getElementById('filterPortal')) document.getElementById('filterPortal').value = ''; 
  if(document.getElementById('filterMes')) document.getElementById('filterMes').value = ''; 
  if(document.getElementById('filterDoc')) document.getElementById('filterDoc').value = '';
  filteredData = [...(historicalStore[activeYear] || [])];
  renderSingleDashboard();
}

function byKey(data, key, limitFn) {
  const map = {};
  data.forEach(r => {
    const k = r[key] || 'Sin especificar';
    if (!map[k]) map[k] = { ventas:0, orders:0, qty:0 };
    map[k].ventas += r.venta; 
    map[k].orders += 1; 
    map[k].qty += r.qty;
  });
  let arr = Object.entries(map).map(([label, v]) => ({ label, ...v }));
  arr.sort((a,b) => b.ventas - a.ventas);
  return limitFn ? limitFn(arr) : arr;
}

// ── ANÁLISIS Y SUMAS EXACTAS SOLICITADAS ─────────────────────────────────────
function renderSingleDashboard() {
  const data = filteredData;
  
  // 1. ¿Cuánto dinero se lleva recaudado? -> SUMA DE PRECIO VENTA
  const totalVentas = data.reduce((s, r) => s + r.venta, 0);
  
  // 2. ¿Cuántas ventas se hicieron? -> Conteo de registros (Excluyendo nulos/totales)
  const totalOrders = data.length;
  
  // 3. ¿Cuántas unidades se vendieron? -> SUMA DE QTY
  const totalQty = data.reduce((s, r) => s + r.qty, 0);

  // Inyectar valores numéricos formateados en las tarjetas superiores de tu HTML
  if(document.getElementById('kpiVentas')) document.getElementById('kpiVentas').textContent = fmtFull(totalVentas);
  if(document.getElementById('kpiVentasOrders')) document.getElementById('kpiVentasOrders').textContent = totalOrders.toLocaleString('es-CL');
  if(document.getElementById('kpiVentasQty')) document.getElementById('kpiVentasQty').textContent = totalQty.toLocaleString('es-CL');
  if(document.getElementById('kpiTicket')) document.getElementById('kpiTicket').textContent = totalOrders > 0 ? fmtFull(totalVentas/totalOrders) : '$0';

  // Actualizar gráficos asociados
  destroyChart('prod');
  const prods = byKey(data, 'producto', a => a.slice(0,10));
  const ctxProd = document.getElementById('chartProductos');
  if (ctxProd) {
    charts['prod'] = new Chart(ctxProd, {
      type: 'bar', data: { labels: prods.map(p=>p.label.substring(0,25)), datasets:[{ label:'Ingresos', data:prods.map(p=>p.ventas), backgroundColor:'#6366f1' }] },
      options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} }, scales:baseScales() }
    });
  }

  destroyChart('donut');
  let ports = byKey(data, 'portal').filter(p => p.label.trim().toUpperCase() !== "TOTAL GENERAL" && p.label.trim().toUpperCase() !== "N/A" && p.ventas > 0);
  const totalP = ports.reduce((s,p)=>s+p.ventas, 0);
  
  const ctxDonut = document.getElementById('chartPortalDonut');
  if (ctxDonut) {
    charts['donut'] = new Chart(ctxDonut, {
      type: 'doughnut', data: { labels:ports.map(p=>p.label), datasets:[{ data:ports.map(p=>p.ventas), backgroundColor:ports.map(p=>getPortalColor(p.label)), borderWidth:0 }] },
      options: { responsive:true, maintainAspectRatio:false, cutout:'70%', plugins:{ legend:{display:false} } }
    });
  }

  const leg = document.getElementById('portalLegend'); 
  if (leg) {
    leg.innerHTML = '';
    ports.forEach(p => {
      leg.innerHTML += `<div class="flex items-center justify-between text-xs text-slate-400"><span class="truncate flex items-center gap-1.5"><span class="w-2 h-2 rounded-sm" style="background:${getPortalColor(p.label)}"></span>${p.label}</span><span class="font-mono text-white font-medium">${fmtFull(p.ventas)} (${totalP > 0 ? ((p.ventas/totalP)*100).toFixed(1) : 0}%)</span></div>`;
    });
  }

  destroyChart('line');
  const mData = {}; data.forEach(r => { if(r.mes) mData[r.mes] = (mData[r.mes]||0)+r.venta; });
  const sortedM = Object.keys(mData).sort((a,b)=>+a-+b);
  const ctxLine = document.getElementById('chartMensual');
  if (ctxLine) {
    charts['line'] = new Chart(ctxLine, {
      type: 'line', data: { labels:sortedM.map(m=>MESES_NAMES[m]||m), datasets:[{ label:'Ventas', data:sortedM.map(m=>mData[m]), borderColor:'#10b981', tension:0.2, fill:false }] },
      options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} }, scales:baseScales() }
    });
  }

  destroyChart('opsO'); destroyChart('opsT');
  const ctxOpsO = document.getElementById('chartOrdenesPortal');
  if(ctxOpsO) charts['opsO'] = new Chart(ctxOpsO, { type: 'bar', data: { labels:ports.map(p=>p.label), datasets:[{ data:ports.map(p=>p.orders), backgroundColor:'#8b5cf6' }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} } } });
  
  const ctxOpsT = document.getElementById('chartTicketPortal');
  if(ctxOpsT) charts['opsT'] = new Chart(ctxOpsT, { type: 'bar', data: { labels:ports.map(p=>p.label), datasets:[{ data:ports.map(p=>Math.round(p.ventas/p.orders)), backgroundColor:'#3b82f6' }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} }, scales:{ y:{ticks:{callback:v=>fmtFull(v)}} } } });

  // 4. ¿Cuáles son los productos (VALIDACIÓN KIT) que se vendieron? -> Rellenar la Tabla
  const allProds = byKey(data, 'producto');
  if(document.getElementById('tableProdCount')) document.getElementById('tableProdCount').textContent = `${allProds.length} SKUs`;
  
  const tbody = document.getElementById('productTableBody'); 
  if (tbody) {
    tbody.innerHTML = '';
    allProds.forEach((p, i) => {
      tbody.innerHTML += `
        <tr class="hover:bg-slate-900 text-slate-300 border-b border-slate-900">
          <td class="p-3 text-slate-600">${i+1}</td>
          <td class="p-3 text-white font-medium truncate max-w-sm" title="${p.label}">${p.label}</td>
          <td class="p-3 text-right font-mono">${p.orders}</td>
          <td class="p-3 text-right font-mono">${p.qty}</td>
          <td class="p-3 text-right text-emerald-400 font-mono font-semibold">${fmtFull(p.ventas)}</td>
        </tr>`;
    });
  }
}

// ── Módulo Comparativo de Años ──────────────────────────────────────────────
function runComparison() {
  const yearA = document.getElementById('compareYearA').value;
  const yearB = document.getElementById('compareYearB').value;
  const dataA = historicalStore[yearA] || []; const dataB = historicalStore[yearB] || [];
  const totalA = dataA.reduce((sum, r) => sum + r.venta, 0); const totalB = dataB.reduce((sum, r) => sum + r.venta, 0);

  if(document.getElementById('kpiCompA')) document.getElementById('kpiCompA').textContent = fmtFull(totalA);
  if(document.getElementById('subCompA')) document.getElementById('subCompA').textContent = `${dataA.length.toLocaleString('es-CL')} órdenes`;
  if(document.getElementById('kpiCompB')) document.getElementById('kpiCompB').textContent = fmtFull(totalB);
  if(document.getElementById('subCompB')) document.getElementById('subCompB').textContent = `${dataB.length.toLocaleString('es-CL')} órdenes`;

  const badge = document.getElementById('badgeCrecimiento');
  if (badge) {
    if (totalA > 0) {
      const delta = ((totalB - totalA) / totalA) * 100;
      badge.textContent = (delta >= 0 ? '▲ +' : '▼ ') + delta.toFixed(1) + '%';
      badge.className = `text-xs px-2 py-1 rounded font-bold ${delta >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`;
    } else {
      badge.textContent = '0%'; badge.className = 'bg-slate-800 text-slate-400 text-xs px-2 py-1 rounded';
    }
  }

  destroyChart('compMeses');
  const mesesA = Array(12).fill(0), mesesB = Array(12).fill(0);
  dataA.forEach(r => { const m = parseInt(r.mes); if(m >= 1 && m <= 12) mesesA[m-1] += r.venta; });
  dataB.forEach(r => { const m = parseInt(r.mes); if(m >= 1 && m <= 12) mesesB[m-1] += r.venta; });

  const ctxCompM = document.getElementById('chartCompMeses');
  if (ctxCompM) {
    charts['compMeses'] = new Chart(ctxCompM, {
      type: 'bar', data: { labels: ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'], datasets: [ { label: `Año ${yearA}`, data: mesesA, backgroundColor: '#6366f1' }, { label: `Año ${yearB}`, data: mesesB, backgroundColor: '#10b981' } ] },
      options: { responsive: true, maintainAspectRatio: false, scales: baseScales() }
    });
  }
}

// ── Inicialización Inicial ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadLiveExcelData();
  
  ['filterPortal','filterMes','filterDoc'].forEach(id => {
    const el = document.getElementById(id); 
    if (el) el.addEventListener('change', applyFilters);
  });

  const tabSingle = document.getElementById('tabSingle');
  const tabCompare = document.getElementById('tabCompare');
  if(tabSingle) tabSingle.addEventListener('click', () => switchViewMode('single'));
  if(tabCompare) tabCompare.addEventListener('click', () => switchViewMode('compare'));
});
