const CONFIG = window.JEO_CONFIG || {};
const sb = window.supabase?.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

let currentUser = null;
let currentProfile = null;
let currentRole = null;
let projects = [];
let activeProjectId = null;
let mapsInitialized = false;

let mainMap, dashboardMap;
let mainBoundaryLayer, mainBoreholeLayer, dashBoundaryLayer, dashBoreholeLayer;

const $ = (id) => document.getElementById(id);

function escapeHtml(value="") {
  return String(value).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

function toast(message, ms=3200) {
  $("toast").textContent = message;
  $("toast").classList.remove("hidden");
  setTimeout(() => $("toast").classList.add("hidden"), ms);
}

function setLoginMessage(message, isError=false) {
  const el = $("loginMessage");
  el.textContent = message || "";
  el.classList.toggle("error", isError);
}

function showAuth() {
  $("authScreen").classList.remove("hidden");
  $("appShell").classList.add("app-hidden");
}

function showApp() {
  $("authScreen").classList.add("hidden");
  $("appShell").classList.remove("app-hidden");
  if (!mapsInitialized) {
    initMaps();
    mapsInitialized = true;
  }
  setTimeout(() => {
    mainMap?.invalidateSize();
    dashboardMap?.invalidateSize();
  }, 120);
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
  const label = currentRole === "admin" ? "Yönetici" : "Firma";
  $("roleBadge").textContent = label;
  $("sidebarRoleBadge").textContent = label;
}

function switchView(view) {
  if (view === "users" && currentRole !== "admin") return;
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(v => v.classList.remove("active"));
  $(view + "View")?.classList.add("active");
  document.querySelector(`.nav-item[data-view="${view}"]`)?.classList.add("active");

  const titles = {
    dashboard: ["Kontrol Paneli", "Tüm işleri, saha durumunu ve ilerlemeyi tek ekrandan izleyin."],
    projects: ["İşler", "Mikrobölgeleme ve jeolojik-jeoteknik işleri yönetin."],
    map: ["Harita", "Çalışma alanlarını ve sondaj/ölçüm noktalarını yönetin."],
    users: ["Kullanıcılar", "Yönetici ve firma yetkilerini yönetin."]
  };
  $("pageTitle").textContent = titles[view]?.[0] || "";
  $("pageSubtitle").textContent = titles[view]?.[1] || "";

  if (view === "map") setTimeout(() => mainMap?.invalidateSize(), 100);
  if (view === "dashboard") setTimeout(() => dashboardMap?.invalidateSize(), 100);
}

async function initializeAuth() {
  if (!sb || !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_PUBLISHABLE_KEY) {
    setLoginMessage("Supabase bağlantı ayarları bulunamadı.", true);
    return;
  }

  const { data, error } = await sb.auth.getSession();
  if (error) {
    setLoginMessage(error.message, true);
    return;
  }

  if (data.session?.user) {
    await enterSession(data.session.user);
  } else {
    showAuth();
  }
}

async function enterSession(user) {
  currentUser = user;

  const { data: profile, error } = await sb
    .from("profiles")
    .select("id,full_name,role,company_id")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    await sb.auth.signOut();
    showAuth();
    setLoginMessage(
      error?.code === "42501"
        ? "Veritabanı erişim izni henüz açılmamış. SQL izin adımını uygulayın."
        : "Bu kullanıcı için profil/yetki kaydı bulunamadı.",
      true
    );
    return;
  }

  currentProfile = profile;
  currentRole = profile.role;

  $("signedUserName").textContent = profile.full_name || "Kullanıcı";
  $("signedUserEmail").textContent = user.email || "";
  applyRole();
  showApp();

  try {
    await loadAppData();
  } catch (err) {
    console.error(err);
    toast(err.message || "Veriler yüklenemedi.", 5000);
  }
}

async function loadAppData() {
  const { data: projectRows, error: projectError } = await sb
    .from("projects")
    .select("id,short_name,area_ha,company_id,status,progress,created_at")
    .order("created_at", { ascending: false });

  if (projectError) throw projectError;

  const companyIds = [...new Set((projectRows || []).map(p => p.company_id).filter(Boolean))];
  let companyMap = {};

  if (companyIds.length) {
    const { data: companyRows, error: companyError } = await sb
      .from("companies")
      .select("id,name")
      .in("id", companyIds);
    if (companyError) throw companyError;
    companyMap = Object.fromEntries((companyRows || []).map(c => [c.id, c.name]));
  }

  const projectIds = (projectRows || []).map(p => p.id);
  let layers = [];
  if (projectIds.length) {
    const { data: layerRows, error: layerError } = await sb
      .from("project_layers")
      .select("id,project_id,layer_type,name,geojson")
      .in("project_id", projectIds)
      .order("created_at", { ascending: true });
    if (layerError) throw layerError;
    layers = layerRows || [];
  }

  projects = (projectRows || []).map(row => {
    const boundary = layers.filter(l => l.project_id === row.id && l.layer_type === "boundary").at(-1)?.geojson || null;
    const boreholes = layers.filter(l => l.project_id === row.id && l.layer_type === "boreholes").at(-1)?.geojson || null;
    return {
      id: row.id,
      name: row.short_name,
      area: Number(row.area_ha || 0),
      companyId: row.company_id,
      company: companyMap[row.company_id] || "Firma atanmadı",
      status: row.status,
      progress: Number(row.progress || 0),
      boundary,
      boreholes
    };
  });

  if (!projects.some(p => p.id === activeProjectId)) {
    activeProjectId = projects[0]?.id || null;
  }
  renderAll();
}

function renderAll() {
  renderStats();
  renderProjects();
  renderProjectSelect();
  renderMapProject();
}

function renderStats() {
  $("statProjects").textContent = projects.length;
  $("statBoreholes").textContent = projects.reduce((n,p) => n + (p.boreholes?.features?.length || 0), 0);
  $("statArea").textContent = projects.reduce((n,p) => n + Number(p.area || 0), 0).toLocaleString("tr-TR") + " ha";
  $("statPending").textContent = projects.filter(p => p.status === "Ofis Kontrolünde").length;
}

function renderProjects() {
  if (!projects.length) {
    $("dashboardProjects").innerHTML = '<div class="empty-state">Henüz görüntülenebilir iş yok.</div>';
    $("projectsTableBody").innerHTML = '<tr><td colspan="7" class="empty-state">Henüz iş oluşturulmadı.</td></tr>';
    return;
  }

  $("dashboardProjects").innerHTML = projects.slice(0,5).map(p => `
    <div class="project-row">
      <div>
        <strong>${escapeHtml(p.name)}</strong>
        <small>${Number(p.area).toLocaleString("tr-TR")} ha · ${escapeHtml(p.company)}</small>
      </div>
      <button class="btn ghost open-map-btn" data-id="${p.id}">Harita</button>
    </div>
  `).join("");

  $("projectsTableBody").innerHTML = projects.map(p => {
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
  $("mapProjectSelect").innerHTML = projects.length
    ? projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)} — ${Number(p.area).toLocaleString("tr-TR")} ha</option>`).join("")
    : '<option value="">İş yok</option>';

  if (activeProjectId) $("mapProjectSelect").value = activeProjectId;
}

function clearMapLayers(map, boundaryLayer, boreholeLayer) {
  if (map && boundaryLayer) map.removeLayer(boundaryLayer);
  if (map && boreholeLayer) map.removeLayer(boreholeLayer);
}

function renderMapProject() {
  if (!mapsInitialized) return;

  clearMapLayers(mainMap, mainBoundaryLayer, mainBoreholeLayer);
  clearMapLayers(dashboardMap, dashBoundaryLayer, dashBoreholeLayer);
  mainBoundaryLayer = mainBoreholeLayer = dashBoundaryLayer = dashBoreholeLayer = null;

  const p = projects.find(x => x.id === activeProjectId);
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
    mainBoundaryLayer = L.geoJSON(p.boundary, { style: { weight: 3, fillOpacity: .08 } }).addTo(mainMap);
    dashBoundaryLayer = L.geoJSON(p.boundary, { style: { weight: 2, fillOpacity: .06 } }).addTo(dashboardMap);
    try { bounds.push(mainBoundaryLayer.getBounds()); } catch {}
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
    try { bounds.push(mainBoreholeLayer.getBounds()); } catch {}
  }

  const valid = bounds.filter(b => b?.isValid?.());
  if (valid.length) {
    const merged = valid[0];
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

async function replaceProjectLayer(projectId, layerType, fileName, geojson) {
  const { error: deleteError } = await sb
    .from("project_layers")
    .delete()
    .eq("project_id", projectId)
    .eq("layer_type", layerType);
  if (deleteError) throw deleteError;

  const { error: insertError } = await sb
    .from("project_layers")
    .insert({
      project_id: projectId,
      layer_type: layerType,
      name: fileName,
      geojson,
      created_by: currentUser.id
    });
  if (insertError) throw insertError;
}

function boreholeCode(feature, index) {
  const p = feature.properties || {};
  return String(p.name || p.Name || p.NAME || p.id || p.ID || `SK-${index + 1}`).trim();
}

async function syncBoreholeRecords(projectId, geojson) {
  const { error: deleteError } = await sb
    .from("borehole_records")
    .delete()
    .eq("project_id", projectId);
  if (deleteError) throw deleteError;

  const rows = [];
  geojson.features.forEach((feature, index) => {
    if (feature.geometry?.type !== "Point") return;
    const [longitude, latitude] = feature.geometry.coordinates || [];
    rows.push({
      project_id: projectId,
      borehole_code: boreholeCode(feature, index),
      longitude,
      latitude,
      status: "Planlandı",
      created_by: currentUser.id
    });
  });

  if (rows.length) {
    const { error } = await sb.from("borehole_records").insert(rows);
    if (error) throw error;
  }
}

async function importLayer(kind) {
  if (currentRole !== "admin") return toast("Bu işlem yalnızca Yönetici rolüne açık.");
  const p = projects.find(x => x.id === activeProjectId);
  if (!p) return toast("Önce bir iş seçin.");

  const input = kind === "boundary" ? $("boundaryFile") : $("boreholeFile");
  const file = input.files[0];

  try {
    const raw = await fileToGeoJSON(file);

    if (kind === "boundary") {
      const features = raw.features.filter(f => ["Polygon","MultiPolygon"].includes(f.geometry?.type));
      if (!features.length) throw new Error("Çalışma alanı için Polygon/MultiPolygon bulunamadı.");
      const geojson = { type:"FeatureCollection", features };
      await replaceProjectLayer(p.id, "boundary", file.name, geojson);
      toast("Çalışma alanı merkezi veritabanına kaydedildi.");
    } else {
      const features = raw.features.filter(f => ["Point","MultiPoint"].includes(f.geometry?.type));
      if (!features.length) throw new Error("Sondaj için Point/MultiPoint bulunamadı.");
      const geojson = { type:"FeatureCollection", features };
      await replaceProjectLayer(p.id, "boreholes", file.name, geojson);
      await syncBoreholeRecords(p.id, geojson);
      toast(`${features.length} sondaj noktası merkezi veritabanına kaydedildi.`);
    }

    input.value = "";
    await loadAppData();
  } catch (err) {
    console.error(err);
    toast(err.message || "Dosya içe aktarılamadı.", 5000);
  }
}

async function getOrCreateCompany(name) {
  const cleanName = name.trim();

  const { data: existing, error: selectError } = await sb
    .from("companies")
    .select("id,name")
    .eq("name", cleanName)
    .maybeSingle();

  if (selectError) throw selectError;
  if (existing) return existing;

  const { data: created, error: insertError } = await sb
    .from("companies")
    .insert({ name: cleanName })
    .select("id,name")
    .single();

  if (insertError) throw insertError;
  return created;
}

async function createProject(event) {
  event.preventDefault();
  if (currentRole !== "admin") return;

  const saveBtn = event.submitter;
  if (saveBtn) saveBtn.disabled = true;

  try {
    const company = await getOrCreateCompany($("projectCompany").value);
    const payload = {
      short_name: $("projectName").value.trim(),
      area_ha: Number($("projectArea").value),
      company_id: company.id,
      status: $("projectStatus").value,
      progress: 0,
      created_by: currentUser.id
    };

    const { data, error } = await sb
      .from("projects")
      .insert(payload)
      .select("id")
      .single();

    if (error) throw error;

    activeProjectId = data.id;
    closeModal();
    await loadAppData();
    switchView("map");
    toast("Yeni iş merkezi veritabanına kaydedildi.");
  } catch (err) {
    console.error(err);
    toast(err.message || "İş kaydedilemedi.", 5000);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}


function normalizeHeader(value="") {
  return String(value)
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g,"i")
    .replace(/ğ/g,"g")
    .replace(/ü/g,"u")
    .replace(/ş/g,"s")
    .replace(/ö/g,"o")
    .replace(/ç/g,"c")
    .replace(/[^a-z0-9]+/g," ")
    .trim();
}

function firstValue(row, aliases) {
  const entries = Object.entries(row || {});
  const normalizedAliases = aliases.map(normalizeHeader);
  for (const [key, value] of entries) {
    const nk = normalizeHeader(key);
    if (normalizedAliases.includes(nk) && value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return "";
}

function parseNumberTR(value) {
  if (typeof value === "number") return value;
  const s = String(value ?? "").trim().replace(/\s/g,"");
  if (!s) return 0;
  if (s.includes(",") && s.includes(".")) {
    return Number(s.replace(/\./g,"").replace(",", ".")) || 0;
  }
  if (s.includes(",")) return Number(s.replace(",", ".")) || 0;
  return Number(s) || 0;
}

function projectNameFromRow(row, index) {
  const name = firstValue(row, [
    "İş Adı","İşin Adı","Kısa İş Adı","İş Kısa Adı","Proje Adı","Proje",
    "İş No","İş Numarası","Evrak Kodu","İş","Adı"
  ]);
  return String(name || `AKTIF-IS-${index + 1}`).trim();
}

async function importProjectsFromExcel(file) {
  if (currentRole !== "admin") return toast("Excel aktarımı yalnızca Yönetici rolüne açık.");
  if (!file) return;

  try {
    if (!window.XLSX) throw new Error("Excel okuyucu yüklenemedi.");

    toast("Excel okunuyor...", 1800);
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    if (!rows.length) throw new Error("Excel dosyasında veri satırı bulunamadı.");

    let added = 0;
    let skipped = 0;
    let failed = 0;
    let firstCreatedId = null;

    const existingNames = new Set(projects.map(p => normalizeHeader(p.name)));

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const name = projectNameFromRow(row, i);
        const nameKey = normalizeHeader(name);

        if (!nameKey || existingNames.has(nameKey)) {
          skipped++;
          continue;
        }

        const area = parseNumberTR(firstValue(row, [
          "Hektar","Ha","Alan (ha)","Alan Ha","Alan_ha","Hektar Bilgisi",
          "Yüzölçümü (ha)","Yuzolcumu Ha","Alan"
        ]));

        const companyNameRaw = firstValue(row, [
          "Firma","Firma Adı","Firma Adi","Yüklenici","Yuklenici",
          "Yüklenici Firma","Yuklenici Firma","Yüklenici Adı","Yuklenici Adi"
        ]);
        const companyName = String(companyNameRaw || "Firma Atanmamış").trim();

        const statusRaw = firstValue(row, [
          "Durum","Aşama","Asama","İş Durumu","Is Durumu","Süreç","Surec","Son Durum"
        ]);
        const status = String(statusRaw || "Planlandı").trim();

        const progress = Math.max(0, Math.min(100, parseNumberTR(firstValue(row, [
          "İlerleme","Ilerleme","İlerleme %","Ilerleme %","Yüzde","Yuzde","Tamamlanma"
        ]))));

        const company = await getOrCreateCompany(companyName);

        const { data, error } = await sb
          .from("projects")
          .insert({
            short_name: name,
            area_ha: area,
            company_id: company.id,
            status,
            progress,
            created_by: currentUser.id
          })
          .select("id")
          .single();

        if (error) throw error;
        if (!firstCreatedId) firstCreatedId = data.id;
        existingNames.add(nameKey);
        added++;
      } catch (rowError) {
        console.error("Excel satırı aktarılamadı:", i + 2, rowError, row);
        failed++;
      }
    }

    if (firstCreatedId) activeProjectId = firstCreatedId;
    await loadAppData();

    toast(
      `Excel aktarımı tamamlandı: ${added} iş eklendi, ${skipped} tekrar/boş satır atlandı${failed ? `, ${failed} satır hata verdi` : ""}.`,
      6500
    );
  } catch (err) {
    console.error(err);
    toast(err.message || "Excel dosyası aktarılamadı.", 6000);
  } finally {
    $("excelImportInput").value = "";
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
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });

  $("loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    setLoginMessage("");
    $("loginBtn").disabled = true;
    try {
      const { data, error } = await sb.auth.signInWithPassword({
        email: $("loginEmail").value.trim(),
        password: $("loginPassword").value
      });
      if (error) throw error;
      await enterSession(data.user);
      $("loginForm").reset();
    } catch (err) {
      setLoginMessage(err.message || "Giriş yapılamadı.", true);
    } finally {
      $("loginBtn").disabled = false;
    }
  });

  $("logoutBtn").addEventListener("click", async () => {
    await sb.auth.signOut();
    currentUser = currentProfile = null;
    currentRole = null;
    projects = [];
    activeProjectId = null;
    showAuth();
  });

  $("newProjectBtn").onclick = openModal;
  $("newProjectBtn2").onclick = openModal;

  $("excelImportBtn").onclick = () => $("excelImportInput").click();
  $("excelImportInput").addEventListener("change", async e => {
    const file = e.target.files?.[0];
    if (file) await importProjectsFromExcel(file);
  });
  $("closeModalBtn").onclick = closeModal;
  $("cancelModalBtn").onclick = closeModal;
  $("goProjectsBtn").onclick = () => switchView("projects");

  $("projectModal").addEventListener("click", e => {
    if (e.target.id === "projectModal") closeModal();
  });

  $("projectForm").addEventListener("submit", createProject);

  $("mapProjectSelect").addEventListener("change", e => {
    activeProjectId = e.target.value || null;
    renderMapProject();
  });

  $("importBoundaryBtn").onclick = () => importLayer("boundary");
  $("importBoreholesBtn").onclick = () => importLayer("borehole");
}

document.addEventListener("DOMContentLoaded", () => {
  wireEvents();
  showAuth();
  initializeAuth();
});
