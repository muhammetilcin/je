const STORAGE_KEY = "je_projects_v1";

let projects = loadProjects();
let currentRole = "admin";
let activeProjectId = projects[0]?.id || null;

let mainMap, dashboardMap;
let mainBoundaryLayer, mainBoreholeLayer, dashBoundaryLayer, dashBoreholeLayer;

const $ = (id) => document.getElementById(id);

function loadProjects() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}
function saveProjects() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}
function uid() {
  return "p_" + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
}
function escapeHtml(value="") {
  return value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.remove("hidden");
  setTimeout(() => $("toast").classList.add("hidden"), 2800);
}
function visibleProjects() {
  if (currentRole === "admin") return projects;
  const assignedCompany = localStorage.getItem("je_demo_company") || projects[0]?.company || "";
  return projects.filter(p => p.company === assignedCompany);
}

function initMaps() {
  mainMap = L.map("mainMap").setView([38.42, 27.14], 10);
  dashboardMap = L.map("dashboardMap", { zoomControl: false }).setView([38.42, 27.14], 9);

  const tiles = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  const attr = '&copy; OpenStreetMap katkıcıları';
  L.tileLayer(tiles, { attribution: attr, maxZoom: 20 }).addTo(mainMap);
  L.tileLayer(tiles, { attribution: attr, maxZoom: 20 }).addTo(dashboardMap);
}

function applyRole() {
  document.querySelectorAll(".admin-only").forEach(el => {
    el.classList.toggle("company-hidden", currentRole !== "admin");
  });
  $("roleBadge").textContent = currentRole === "admin" ? "Yönetici" : "Firma";
  renderAll();
}

function switchView(view) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(v => v.classList.remove("active"));
  $(view + "View").classList.add("active");
  document.querySelector(`.nav-item[data-view="${view}"]`)?.classList.add("active");

  const titles = {
    dashboard: ["Kontrol Paneli", "Tüm işleri, saha durumunu ve ilerlemeyi tek ekrandan izleyin."],
    projects: ["İşler", "Mikrobölgeleme ve jeolojik-jeoteknik işleri yönetin."],
    map: ["Harita", "Çalışma alanlarını ve sondaj/ölçüm noktalarını yönetin."],
    users: ["Kullanıcılar", "Yönetici ve firma yetkilerini yönetin."]
  };
  $("pageTitle").textContent = titles[view][0];
  $("pageSubtitle").textContent = titles[view][1];

  if (view === "map") setTimeout(() => mainMap.invalidateSize(), 100);
  if (view === "dashboard") setTimeout(() => dashboardMap.invalidateSize(), 100);
}

function renderAll() {
  renderStats();
  renderProjects();
  renderProjectSelect();
  renderMapProject();
}

function renderStats() {
  const list = visibleProjects();
  $("statProjects").textContent = list.length;
  $("statBoreholes").textContent = list.reduce((n,p) => n + (p.boreholes?.features?.length || 0), 0);
  $("statArea").textContent = list.reduce((n,p) => n + Number(p.area || 0), 0).toLocaleString("tr-TR") + " ha";
  $("statPending").textContent = list.filter(p => p.status === "Ofis Kontrolünde").length;
}

function renderProjects() {
  const list = visibleProjects();

  if (!list.length) {
    $("dashboardProjects").innerHTML = '<div class="empty-state">Henüz görüntülenebilir iş yok.</div>';
    $("projectsTableBody").innerHTML = '<tr><td colspan="7" class="empty-state">Henüz iş oluşturulmadı.</td></tr>';
    return;
  }

  $("dashboardProjects").innerHTML = list.slice(0,5).map(p => `
    <div class="project-row">
      <div>
        <strong>${escapeHtml(p.name)}</strong>
        <small>${Number(p.area).toLocaleString("tr-TR")} ha · ${escapeHtml(p.company)}</small>
      </div>
      <button class="btn ghost open-map-btn" data-id="${p.id}">Harita</button>
    </div>
  `).join("");

  $("projectsTableBody").innerHTML = list.map(p => {
    const count = p.boreholes?.features?.length || 0;
    const progress = Number(p.progress || 0);
    return `
      <tr>
        <td><strong>${escapeHtml(p.name)}</strong></td>
        <td>${Number(p.area).toLocaleString("tr-TR")} ha</td>
        <td>${escapeHtml(p.company)}</td>
        <td>${count}</td>
        <td><span class="status">${escapeHtml(p.status)}</span></td>
        <td><div class="progress"><span style="width:${progress}%"></span></div><small>${progress}%</small></td>
        <td><button class="btn ghost open-map-btn" data-id="${p.id}">Aç</button></td>
      </tr>`;
  }).join("");

  document.querySelectorAll(".open-map-btn").forEach(btn => {
    btn.onclick = () => {
      activeProjectId = btn.dataset.id;
      $("mapProjectSelect").value = activeProjectId;
      renderMapProject();
      switchView("map");
    };
  });
}

function renderProjectSelect() {
  const list = visibleProjects();
  $("mapProjectSelect").innerHTML = list.length
    ? list.map(p => `<option value="${p.id}">${escapeHtml(p.name)} — ${Number(p.area).toLocaleString("tr-TR")} ha</option>`).join("")
    : '<option value="">İş yok</option>';

  if (!list.some(p => p.id === activeProjectId)) activeProjectId = list[0]?.id || null;
  if (activeProjectId) $("mapProjectSelect").value = activeProjectId;
}

function clearMapLayers(map, boundaryLayer, boreholeLayer) {
  if (boundaryLayer) map.removeLayer(boundaryLayer);
  if (boreholeLayer) map.removeLayer(boreholeLayer);
}

function renderMapProject() {
  clearMapLayers(mainMap, mainBoundaryLayer, mainBoreholeLayer);
  clearMapLayers(dashboardMap, dashBoundaryLayer, dashBoreholeLayer);
  mainBoundaryLayer = mainBoreholeLayer = dashBoundaryLayer = dashBoreholeLayer = null;

  const p = visibleProjects().find(x => x.id === activeProjectId);
  if (!p) {
    $("mapProjectName").textContent = "İş seçilmedi";
    $("mapProjectMeta").textContent = "—";
    $("mapBoreholeCount").textContent = "0 sondaj";
    return;
  }

  $("mapProjectName").textContent = p.name;
  $("mapProjectMeta").textContent = `${Number(p.area).toLocaleString("tr-TR")} ha · ${p.company}`;
  $("mapBoreholeCount").textContent = `${p.boreholes?.features?.length || 0} sondaj`;

  const bounds = [];

  if (p.boundary) {
    mainBoundaryLayer = L.geoJSON(p.boundary, {
      style: { weight: 3, fillOpacity: .08 }
    }).addTo(mainMap);
    dashBoundaryLayer = L.geoJSON(p.boundary, {
      style: { weight: 2, fillOpacity: .06 }
    }).addTo(dashboardMap);
    try {
      bounds.push(mainBoundaryLayer.getBounds());
    } catch {}
  }

  if (p.boreholes) {
    const pointToLayer = (feature, latlng) => L.circleMarker(latlng, { radius: 7, weight: 2, fillOpacity: .9 });
    const onEachFeature = (feature, layer) => {
      const props = feature.properties || {};
      const name = props.name || props.Name || props.NAME || props.id || props.ID || "Sondaj";
      layer.bindPopup(`<strong>${escapeHtml(String(name))}</strong><br>${escapeHtml(p.name)}`);
    };

    mainBoreholeLayer = L.geoJSON(p.boreholes, { pointToLayer, onEachFeature }).addTo(mainMap);
    dashBoreholeLayer = L.geoJSON(p.boreholes, { pointToLayer }).addTo(dashboardMap);
    try {
      bounds.push(mainBoreholeLayer.getBounds());
    } catch {}
  }

  const valid = bounds.filter(b => b && b.isValid && b.isValid());
  if (valid.length) {
    let merged = valid[0];
    valid.slice(1).forEach(b => merged.extend(b));
    mainMap.fitBounds(merged.pad(.12));
    dashboardMap.fitBounds(merged.pad(.15));
  }
}

async function fileToGeoJSON(file) {
  if (!file) throw new Error("Dosya seçilmedi.");
  const lower = file.name.toLowerCase();
  let kmlText = "";

  if (lower.endsWith(".kml")) {
    kmlText = await file.text();
  } else if (lower.endsWith(".kmz")) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const kmlName = Object.keys(zip.files).find(n => n.toLowerCase().endsWith(".kml"));
    if (!kmlName) throw new Error("KMZ içinde KML bulunamadı.");
    kmlText = await zip.files[kmlName].async("text");
  } else {
    throw new Error("Yalnızca KML veya KMZ dosyası seçin.");
  }

  const xml = new DOMParser().parseFromString(kmlText, "text/xml");
  if (xml.querySelector("parsererror")) throw new Error("KML okunamadı.");
  const geojson = toGeoJSON.kml(xml);
  if (!geojson?.features?.length) throw new Error("Dosyada harita verisi bulunamadı.");
  return geojson;
}

async function importLayer(kind) {
  if (currentRole !== "admin") return toast("Bu işlem yalnızca Yönetici rolüne açık.");
  const p = projects.find(x => x.id === activeProjectId);
  if (!p) return toast("Önce bir iş seçin.");

  const input = kind === "boundary" ? $("boundaryFile") : $("boreholeFile");
  const file = input.files[0];

  try {
    const geojson = await fileToGeoJSON(file);

    if (kind === "boundary") {
      const polygonFeatures = geojson.features.filter(f =>
        ["Polygon","MultiPolygon"].includes(f.geometry?.type)
      );
      if (!polygonFeatures.length) throw new Error("Çalışma alanı için Polygon/MultiPolygon bulunamadı.");
      p.boundary = { type:"FeatureCollection", features:polygonFeatures };
      toast("Çalışma alanı içe aktarıldı.");
    } else {
      const pointFeatures = geojson.features.filter(f =>
        ["Point","MultiPoint"].includes(f.geometry?.type)
      );
      if (!pointFeatures.length) throw new Error("Sondaj için Point/MultiPoint bulunamadı.");
      p.boreholes = { type:"FeatureCollection", features:pointFeatures };
      toast(`${pointFeatures.length} sondaj noktası içe aktarıldı.`);
    }

    saveProjects();
    renderAll();
  } catch (err) {
    toast(err.message || "Dosya içe aktarılamadı.");
  }
}

function openModal() {
  if (currentRole !== "admin") return;
  $("projectModal").classList.remove("hidden");
  $("projectName").focus();
}
function closeModal() {
  $("projectModal").classList.add("hidden");
  $("projectForm").reset();
}

function wireEvents() {
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.dataset.view === "users" && currentRole !== "admin") return;
      switchView(btn.dataset.view);
    });
  });

  $("roleSelect").addEventListener("change", e => {
    currentRole = e.target.value;
    if (currentRole === "company") {
      const firstCompany = projects[0]?.company || "";
      localStorage.setItem("je_demo_company", firstCompany);
    }
    applyRole();
  });

  $("newProjectBtn").onclick = openModal;
  $("newProjectBtn2").onclick = openModal;
  $("closeModalBtn").onclick = closeModal;
  $("cancelModalBtn").onclick = closeModal;
  $("goProjectsBtn").onclick = () => switchView("projects");

  $("projectModal").addEventListener("click", e => {
    if (e.target.id === "projectModal") closeModal();
  });

  $("projectForm").addEventListener("submit", e => {
    e.preventDefault();
    const project = {
      id: uid(),
      name: $("projectName").value.trim(),
      area: Number($("projectArea").value),
      company: $("projectCompany").value.trim(),
      status: $("projectStatus").value,
      progress: 0,
      boundary: null,
      boreholes: null,
      createdAt: new Date().toISOString()
    };
    projects.unshift(project);
    activeProjectId = project.id;
    saveProjects();
    closeModal();
    renderAll();
    switchView("map");
    toast("Yeni iş oluşturuldu.");
  });

  $("mapProjectSelect").addEventListener("change", e => {
    activeProjectId = e.target.value || null;
    renderMapProject();
  });

  $("importBoundaryBtn").onclick = () => importLayer("boundary");
  $("importBoreholesBtn").onclick = () => importLayer("borehole");
}

document.addEventListener("DOMContentLoaded", () => {
  initMaps();
  wireEvents();
  applyRole();
  renderAll();
});
