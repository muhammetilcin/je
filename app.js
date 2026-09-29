const CONFIG = window.JEO_CONFIG || {};
const sb = window.supabase?.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

let currentUser = null;
let currentProfile = null;
let currentRole = null;
let projects = [];
let boreholeRecords = [];
let boreholeFilter = "all";
let fieldPointSchemaAvailable = true;
let currentLocation = null;
let locationMarker = null;
let locationAccuracyCircle = null;
let pickingPointFromMap = false;
let activeProjectId = null;
let activeBoreholeId = null;
let editingProjectId = null;
let mapsInitialized = false;

let mainMap, dashboardMap, boreholeMap;
let mainBoundaryLayer, mainBoreholeLayer, dashBoundaryLayer, dashBoreholeLayer;
let boreholeBoundaryLayer, boreholePointsLayer;

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
    boreholeMap?.invalidateSize();
  }, 120);
}

function createBaseLayers() {
  return {
    "Sokak Haritası": L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; OpenStreetMap katkıcıları',
      maxZoom: 20
    }),
    "Uydu": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      attribution: "Tiles &copy; Esri",
      maxZoom: 20
    })
  };
}

function initMaps() {
  mainMap = L.map("mainMap").setView([38.42, 27.14], 10);
  dashboardMap = L.map("dashboardMap", { zoomControl: false }).setView([38.42, 27.14], 9);
  boreholeMap = L.map("boreholeMap").setView([38.42, 27.14], 10);

  const mainBases = createBaseLayers();
  mainBases["Sokak Haritası"].addTo(mainMap);
  L.control.layers(mainBases, null, { position: "topright", collapsed: false }).addTo(mainMap);

  const boreholeBases = createBaseLayers();
  boreholeBases["Sokak Haritası"].addTo(boreholeMap);
  L.control.layers(boreholeBases, null, { position: "topright", collapsed: false }).addTo(boreholeMap);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; OpenStreetMap katkıcıları',
    maxZoom: 20
  }).addTo(dashboardMap);

  boreholeMap.on("click", e => {
    if (!pickingPointFromMap || $("pointModal").classList.contains("hidden")) return;
    $("pointLat").value = e.latlng.lat.toFixed(7);
    $("pointLng").value = e.latlng.lng.toFixed(7);
    $("pointLocationAccuracy").textContent = "Konum: haritadan seçildi";
    pickingPointFromMap = false;
    toast("Nokta konumu haritadan seçildi.");
  });
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
  $(view + "View")?.classList.add("active");

  document.querySelectorAll(".nav-item").forEach(v => v.classList.remove("active"));
  if (view === "users") {
    document.querySelector('.nav-item[data-view="users"]')?.classList.add("active");
  } else {
    document.querySelector('.nav-item[data-view="dashboard"]')?.classList.add("active");
  }

  const titles = {
    dashboard: ["İşler", "Bir işi seçerek durum, harita ve saha noktalarına geçin."],
    boreholes: ["İş Detayı", "İş durumu, harita ve saha işlemleri aynı ekranda."],
    users: ["Yönetim", "Kullanıcı, firma ve yetki ayarlarını yönetin."],
    projects: ["İşler", "İş listesini yönetin."],
    map: ["Harita", "Çalışma alanlarını ve saha noktalarını yönetin."]
  };
  $("pageTitle").textContent = titles[view]?.[0] || "";
  $("pageSubtitle").textContent = titles[view]?.[1] || "";
  $("newProjectBtn")?.classList.toggle("hidden", view === "boreholes" || view === "users");

  if (view === "dashboard") {
    setTimeout(() => dashboardMap?.invalidateSize(), 120);
  }
  if (view === "boreholes") {
    renderProjectDetailSummary();
    setTimeout(() => {
      boreholeMap?.invalidateSize();
      renderBoreholeMap();
    }, 120);
  }
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

  let boreholeRows = [];
  if (projectIds.length) {
    let result = await sb
      .from("borehole_records")
      .select("id,project_id,borehole_code,longitude,latitude,planned_depth_m,actual_depth_m,status,notes,started_at,completed_at,created_at,point_type,method,location_accuracy_m,location_captured_at")
      .in("project_id", projectIds)
      .order("borehole_code", { ascending: true });

    if (result.error) {
      fieldPointSchemaAvailable = false;
      result = await sb
        .from("borehole_records")
        .select("id,project_id,borehole_code,longitude,latitude,planned_depth_m,actual_depth_m,status,notes,started_at,completed_at,created_at")
        .in("project_id", projectIds)
        .order("borehole_code", { ascending: true });
    } else {
      fieldPointSchemaAvailable = true;
    }

    if (result.error) throw result.error;
    boreholeRows = (result.data || []).map(row => ({
      ...row,
      point_type: row.point_type || "Sondaj",
      method: row.method || null,
      location_accuracy_m: row.location_accuracy_m ?? null,
      location_captured_at: row.location_captured_at || null
    }));
  }
  boreholeRecords = boreholeRows;

  projects = (projectRows || []).map(row => {
    const boundaryLayer = layers.filter(l => l.project_id === row.id && l.layer_type === "boundary").at(-1) || null;
    const boreholesLayer = layers.filter(l => l.project_id === row.id && l.layer_type === "boreholes").at(-1) || null;
    return {
      id: row.id,
      name: row.short_name,
      area: Number(row.area_ha || 0),
      companyId: row.company_id,
      company: companyMap[row.company_id] || "Firma atanmadı",
      status: row.status,
      progress: Number(row.progress || 0),
      boundary: boundaryLayer?.geojson || null,
      boreholes: boreholesLayer?.geojson || null,
      boundaryLayerId: boundaryLayer?.id || null,
      boundaryLayerName: boundaryLayer?.name || "",
      boreholesLayerId: boreholesLayer?.id || null,
      boreholesLayerName: boreholesLayer?.name || ""
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
  renderBoreholeProjectSelect();
  renderBoreholes();
  renderProjectDetailSummary();
  renderMapProject();
  renderBoreholeMap();
}
function getStatusKey(status = "") {
  const s = String(status).toLocaleLowerCase("tr-TR");

  if (s.includes("tamam")) return "done";
  if (s.includes("saha")) return "active";
  if (s.includes("kontrol")) return "review";
  return "planned";
}

function getStatusColor(status = "") {
  const key = getStatusKey(status);

  return {
    planned: "#9aa3ad", // gri
    active: "#e0b100",  // sarı
    review: "#3b82f6",  // mavi
    done: "#22a06b"     // yeşil
  }[key];
}

function getPointMarkerStyle(status = "", pointType = "Sondaj") {
  const color = getStatusColor(status);
  const isGeo = pointType === "Jeoteknik";

  return {
    radius: isGeo ? 9 : 7,
    color,
    fillColor: color,
    fillOpacity: 0.9,
    weight: isGeo ? 3 : 2
  };
}

function getProjectProgress(projectId) {
  const rows = boreholeRecords.filter(b => b.project_id === projectId && (b.point_type || "Sondaj") === "Sondaj");
  if (!rows.length) {
    const p = projects.find(x => x.id === projectId);
    return { total: 0, done: 0, percent: Number(p?.progress || 0) };
  }
  const done = rows.filter(b => b.status === "Tamamlandı").length;
  return {
    total: rows.length,
    done,
    percent: Math.round((done / rows.length) * 100)
  };
}

async function syncProjectProgress(projectId) {
  let result = await sb
    .from("borehole_records")
    .select("status,point_type")
    .eq("project_id", projectId);

  if (result.error) {
    result = await sb
      .from("borehole_records")
      .select("status")
      .eq("project_id", projectId);
  }
  if (result.error) throw result.error;

  const sondajRows = (result.data || []).filter(x => (x.point_type || "Sondaj") === "Sondaj");
  const total = sondajRows.length;
  const done = sondajRows.filter(x => x.status === "Tamamlandı").length;
  const percent = total ? Math.round((done / total) * 100) : 0;

  const { error: updateError } = await sb
    .from("projects")
    .update({ progress: percent })
    .eq("id", projectId);

  if (updateError) throw updateError;
  return percent;
}

function renderStats() {
  $("statProjects").textContent = projects.length;
  $("statBoreholes").textContent = boreholeRecords.filter(b => (b.point_type || "Sondaj") === "Sondaj").length;
  $("statArea").textContent = projects.reduce((n,p) => n + Number(p.area || 0), 0).toLocaleString("tr-TR") + " ha";
  $("statPending").textContent = projects.filter(p => p.status === "Ofis Kontrolünde").length;
}

function renderProjects() {
  if (!projects.length) {
    $("dashboardProjects").innerHTML = '<div class="empty-state">Henüz görüntülenebilir iş yok.</div>';
    $("projectsTableBody").innerHTML = '<tr><td colspan="7" class="empty-state">Henüz iş oluşturulmadı.</td></tr>';
    return;
  }

  $("dashboardProjects").innerHTML = projects.map(p => {
    const count = boreholeRecords.filter(b => b.project_id === p.id && (b.point_type || "Sondaj") === "Sondaj").length;
    const progress = getProjectProgress(p.id).percent;
    return `
      <div class="project-row project-open-row" data-id="${p.id}" role="button" tabindex="0">
        <div class="project-row-main">
          <strong>${escapeHtml(p.name)}</strong>
          <small>${Number(p.area).toLocaleString("tr-TR")} ha · ${escapeHtml(p.company)}</small>
          <div class="project-row-meta">
            <span class="status">${escapeHtml(p.status || "—")}</span>
            <span>${count} sondaj</span>
            <span>%${progress} ilerleme</span>
          </div>
        </div>
        <button class="btn secondary open-project-btn" data-id="${p.id}" type="button">İşi Aç</button>
      </div>
    `;
  }).join("");

  $("projectsTableBody").innerHTML = projects.map(p => {
    const count = boreholeRecords.filter(b => b.project_id === p.id && (b.point_type || "Sondaj") === "Sondaj").length;
    const progress = getProjectProgress(p.id).percent;
    return `
      <tr>
        <td><strong>${escapeHtml(p.name)}</strong></td>
        <td>${Number(p.area).toLocaleString("tr-TR")} ha</td>
        <td>${escapeHtml(p.company)}</td>
        <td>${count}</td>
        <td><span class="status">${escapeHtml(p.status)}</span></td>
        <td><div class="progress"><span style="width:${progress}%"></span></div><small>${progress}%</small></td>
        <td>
          <div class="row-actions">
            <button class="btn ghost open-project-btn" data-id="${p.id}">Aç</button>
            ${currentRole === "admin" ? `
              <button class="btn secondary edit-project-btn" data-id="${p.id}">Düzenle</button>
              <button class="btn danger delete-project-btn" data-id="${p.id}">Sil</button>
            ` : ""}
          </div>
        </td>
      </tr>`;
  }).join("");

  document.querySelectorAll(".open-project-btn").forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      openProjectDetail(btn.dataset.id);
    };
  });

  document.querySelectorAll(".project-open-row").forEach(row => {
    row.onclick = () => openProjectDetail(row.dataset.id);
    row.onkeydown = e => {
      if (e.key === "Enter" || e.key === " ") openProjectDetail(row.dataset.id);
    };
  });

  document.querySelectorAll(".edit-project-btn").forEach(btn => {
    btn.onclick = () => openEditModal(btn.dataset.id);
  });

  document.querySelectorAll(".delete-project-btn").forEach(btn => {
    btn.onclick = () => deleteProject(btn.dataset.id);
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
    $("boundaryLayerInfo").textContent = "Yüklü çalışma alanı yok";
    $("boreholeLayerInfo").textContent = "Yüklü sondaj KML/KMZ yok";
    $("deleteBoundaryLayerBtn").disabled = true;
    $("deleteBoreholeLayerBtn").disabled = true;
    return;
  }

  $("mapProjectName").textContent = p.name;
  $("mapProjectMeta").textContent = `${Number(p.area).toLocaleString("tr-TR")} ha · ${p.company}`;
  const projectSondajCount = boreholeRecords.filter(b => b.project_id === p.id && (b.point_type || "Sondaj") === "Sondaj").length;
  const projectGeoCount = boreholeRecords.filter(b => b.project_id === p.id && b.point_type === "Jeoteknik").length;
  $("mapBoreholeCount").textContent = projectGeoCount
    ? `${projectSondajCount} sondaj · ${projectGeoCount} jeoteknik`
    : `${projectSondajCount} sondaj`;

  $("boundaryLayerInfo").textContent = p.boundaryLayerName
    ? `Yüklü: ${p.boundaryLayerName}`
    : "Yüklü çalışma alanı yok";
  $("boreholeLayerInfo").textContent = p.boreholesLayerName
    ? `Yüklü: ${p.boreholesLayerName}`
    : "Yüklü sondaj KML/KMZ yok";
  $("deleteBoundaryLayerBtn").disabled = !p.boundaryLayerId;
  $("deleteBoreholeLayerBtn").disabled = !p.boreholesLayerId;

  const bounds = [];

  if (p.boundary) {
    mainBoundaryLayer = L.geoJSON(p.boundary, { style: { weight: 3, fillOpacity: .08 } }).addTo(mainMap);
    dashBoundaryLayer = L.geoJSON(p.boundary, { style: { weight: 2, fillOpacity: .06 } }).addTo(dashboardMap);
    try { bounds.push(mainBoundaryLayer.getBounds()); } catch {}
  }

  const projectPoints = boreholeRecords.filter(b =>
    b.project_id === p.id &&
    Number.isFinite(Number(b.latitude)) &&
    Number.isFinite(Number(b.longitude))
  );

  if (projectPoints.length) {
    mainBoreholeLayer = L.layerGroup();
    dashBoreholeLayer = L.layerGroup();

    projectPoints.forEach(record => {
      const label = record.point_type === "Jeoteknik" && record.method
        ? `${record.borehole_code} · ${record.method}`
        : record.borehole_code;

      const mainMarker = L.circleMarker(
        [Number(record.latitude), Number(record.longitude)],
        getPointMarkerStyle(record.status, record.point_type || "Sondaj")
      );
      mainMarker.bindTooltip(escapeHtml(label), {
        permanent: true,
        direction: "right",
        offset: [8, 0],
        className: "borehole-label"
      });
      mainMarker.on("click", () => openBoreholeModal(record.id));
      mainMarker.addTo(mainBoreholeLayer);

      L.circleMarker((
        [Number(record.latitude), Number(record.longitude)],
        {
          ...getPointMarkerStyle(record.status, record.point_type || "Sondaj"),
          radius: record.point_type === "Jeoteknik" ? 7 : 5,
          weight: 1.5
        }
      ).addTo(dashBoreholeLayer);

    mainBoreholeLayer.addTo(mainMap);
    dashBoreholeLayer.addTo(dashboardMap);

    try {
      const pointBounds = L.latLngBounds(projectPoints.map(b => [Number(b.latitude), Number(b.longitude)]));
      if (pointBounds.isValid()) bounds.push(pointBounds);
    } catch {}
  }

  const valid = bounds.filter(b => b?.isValid?.());
  if (valid.length) {
    const merged = valid[0];
    valid.slice(1).forEach(b => merged.extend(b));
    mainMap.fitBounds(merged.pad(.12));
    dashboardMap.fitBounds(merged.pad(.15));
  }
}


function nextPointCode(type) {
  const prefix = type === "Jeoteknik" ? "JT-" : "SK-";
  const nums = boreholeRecords
    .filter(b => b.project_id === activeProjectId && (b.point_type || "Sondaj") === type)
    .map(b => {
      const m = String(b.borehole_code || "").match(/(\d+)$/);
      return m ? Number(m[1]) : 0;
    });
  return prefix + String((Math.max(0, ...nums) + 1)).padStart(2, "0");
}

function openPointModal(type) {
  if (!activeProjectId) return toast("Önce bir iş seçin.");
  if (!fieldPointSchemaAvailable) {
    return toast("Yeni saha noktası için Supabase saha noktaları SQL güncellemesini önce çalıştırın.", 6000);
  }

  $("pointForm").reset();
  $("pointType").value = type;
  $("pointCode").value = nextPointCode(type);
  $("pointModalTitle").textContent = type === "Jeoteknik" ? "Yeni Jeoteknik Nokta" : "Yeni Sondaj Noktası";
  $("pointMethodGroup").classList.toggle("hidden", type !== "Jeoteknik");
  $("pointLocationAccuracy").textContent = "Konum doğruluğu: —";
  $("pointModal").classList.remove("hidden");
  pickingPointFromMap = false;
  $("pointCode").focus();
}

function closePointModal() {
  $("pointModal").classList.add("hidden");
  $("pointForm").reset();
  pickingPointFromMap = false;
}

function getDeviceLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Bu cihaz konum bilgisini desteklemiyor."));
    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        capturedAt: new Date(pos.timestamp || Date.now()).toISOString()
      }),
      err => reject(new Error(
        err.code === 1 ? "Konum izni verilmedi." :
        err.code === 2 ? "Konum belirlenemedi." :
        "Konum alınırken zaman aşımı oluştu."
      )),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
  });
}

function showLocationOnMap(location) {
  if (!boreholeMap || !location) return;
  if (locationMarker) boreholeMap.removeLayer(locationMarker);
  if (locationAccuracyCircle) boreholeMap.removeLayer(locationAccuracyCircle);

  locationMarker = L.circleMarker([location.latitude, location.longitude], {
    radius: 9, weight: 3, fillOpacity: .9
  }).addTo(boreholeMap).bindTooltip("Konumum", { permanent: true, direction: "top" });

  if (Number.isFinite(Number(location.accuracy))) {
    locationAccuracyCircle = L.circle([location.latitude, location.longitude], {
      radius: Number(location.accuracy), weight: 1, fillOpacity: .05
    }).addTo(boreholeMap);
  }

  boreholeMap.setView([location.latitude, location.longitude], Math.max(boreholeMap.getZoom(), 17));
}

async function locateMe(fillPointForm=false) {
  try {
    $("currentLocationInfo").textContent = "Konum alınıyor...";
    const loc = await getDeviceLocation();
    currentLocation = loc;
    const accuracyText = Number.isFinite(Number(loc.accuracy)) ? ` ±${Math.round(loc.accuracy)} m` : "";
    $("currentLocationInfo").textContent = `${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}${accuracyText}`;
    showLocationOnMap(loc);

    if (fillPointForm) {
      $("pointLat").value = loc.latitude.toFixed(7);
      $("pointLng").value = loc.longitude.toFixed(7);
      $("pointLocationAccuracy").textContent = `Konum doğruluğu: ${Math.round(loc.accuracy || 0)} m`;
    }
  } catch (err) {
    $("currentLocationInfo").textContent = "Konum alınamadı";
    toast(err.message || "Konum alınamadı.", 5000);
  }
}

async function saveNewPoint(event) {
  event.preventDefault();
  if (!activeProjectId) return;
  if (!fieldPointSchemaAvailable) return toast("Supabase saha noktaları SQL güncellemesi gerekli.", 5000);

  const type = $("pointType").value || "Sondaj";
  const payload = {
    project_id: activeProjectId,
    borehole_code: $("pointCode").value.trim(),
    point_type: type,
    method: type === "Jeoteknik" ? ($("pointMethod").value || null) : null,
    latitude: Number($("pointLat").value),
    longitude: Number($("pointLng").value),
    status: "Planlandı",
    notes: $("pointNotes").value.trim() || null,
    location_accuracy_m: currentLocation &&
      Math.abs(currentLocation.latitude - Number($("pointLat").value)) < 0.000001 &&
      Math.abs(currentLocation.longitude - Number($("pointLng").value)) < 0.000001
        ? currentLocation.accuracy : null,
    location_captured_at: currentLocation &&
      Math.abs(currentLocation.latitude - Number($("pointLat").value)) < 0.000001 &&
      Math.abs(currentLocation.longitude - Number($("pointLng").value)) < 0.000001
        ? currentLocation.capturedAt : null,
    created_by: currentUser.id
  };

  try {
    const { error } = await sb.from("borehole_records").insert(payload);
    if (error) throw error;
    if (type === "Sondaj") await syncProjectProgress(activeProjectId);
    closePointModal();
    await loadAppData();
    toast(type === "Jeoteknik" ? "Jeoteknik nokta eklendi." : "Sondaj noktası eklendi.");
  } catch (err) {
    console.error(err);
    toast(err.message || "Saha noktası eklenemedi.", 5000);
  }
}

function renderBoreholeMap() {
  if (!mapsInitialized || !boreholeMap) return;

  if (boreholeBoundaryLayer) boreholeMap.removeLayer(boreholeBoundaryLayer);
  if (boreholePointsLayer) boreholeMap.removeLayer(boreholePointsLayer);
  boreholeBoundaryLayer = boreholePointsLayer = null;

  const p = projects.find(x => x.id === activeProjectId);
  if (!p) return;

  const bounds = [];

  if (p.boundary) {
    boreholeBoundaryLayer = L.geoJSON(p.boundary, {
      style: { weight: 3, fillOpacity: .06 }
    }).addTo(boreholeMap);
    try { bounds.push(boreholeBoundaryLayer.getBounds()); } catch {}
  }

  const allRows = boreholeRecords.filter(b => b.project_id === p.id);
  const rows = boreholeFilter === "all"
    ? allRows
    : allRows.filter(b => (b.status || "Planlandı") === boreholeFilter);
  if (rows.length) {
    boreholePointsLayer = L.layerGroup();

    rows.forEach(b => {
      if (!Number.isFinite(Number(b.latitude)) || !Number.isFinite(Number(b.longitude))) return;

      const marker = L.circleMarker(
        [Number(b.latitude), Number(b.longitude)],
        getPointMarkerStyle(b.status, b.point_type || "Sondaj")
      );

      const mapLabel = (b.point_type || "Sondaj") === "Jeoteknik" && b.method
        ? `${b.borehole_code} · ${b.method}`
        : b.borehole_code;
      marker.bindTooltip(escapeHtml(mapLabel), {
        permanent: true,
        direction: "right",
        offset: [8, 0],
        className: "borehole-label"
      });

      marker.on("click", () => openBoreholeModal(b.id));
      marker.addTo(boreholePointsLayer);
    });

    boreholePointsLayer.addTo(boreholeMap);
    try {
      const pointBounds = L.latLngBounds(
        rows
          .filter(b => Number.isFinite(Number(b.latitude)) && Number.isFinite(Number(b.longitude)))
          .map(b => [Number(b.latitude), Number(b.longitude)])
      );
      if (pointBounds.isValid()) bounds.push(pointBounds);
    } catch {}
  }

  const valid = bounds.filter(b => b?.isValid?.());
  if (valid.length) {
    const merged = valid[0];
    valid.slice(1).forEach(b => merged.extend(b));
    boreholeMap.fitBounds(merged.pad(.12), { maxZoom: 17 });
  }
}

function toggleMapSidebar() {
  const layout = document.querySelector("#mapView .map-layout");
  if (!layout) return;

  const collapsed = layout.classList.toggle("map-sidebar-collapsed");
  $("toggleMapSidebarBtn").textContent = collapsed ? "›" : "‹";
  $("toggleMapSidebarBtn").title = collapsed ? "Sol paneli aç" : "Sol paneli kapat";

  setTimeout(() => mainMap?.invalidateSize(), 260);
}

function toggleAppSidebar() {
  const shell = $("appShell");
  const collapsed = shell.classList.toggle("sidebar-collapsed");
  $("toggleAppSidebarBtn").textContent = collapsed ? "›" : "‹";
  $("toggleAppSidebarBtn").title = collapsed ? "Menüyü genişlet" : "Menüyü daralt";
  localStorage.setItem("je_sidebar_collapsed", collapsed ? "1" : "0");

  setTimeout(() => {
    mainMap?.invalidateSize();
    dashboardMap?.invalidateSize();
    boreholeMap?.invalidateSize();
  }, 260);
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

async function deleteProjectLayer(layerType) {
  if (currentRole !== "admin") return;
  const p = projects.find(x => x.id === activeProjectId);
  if (!p) return toast("Önce bir iş seçin.");

  const layerId = layerType === "boundary" ? p.boundaryLayerId : p.boreholesLayerId;
  if (!layerId) return toast("Silinecek katman bulunamadı.");

  const label = layerType === "boundary" ? "çalışma alanı KML/KMZ" : "sondaj KML/KMZ";
  const extra = layerType === "boreholes"
    ? "\n\nSondaj saha kayıtları ve fotoğraflar korunur; yalnızca haritadaki yüklenmiş KML/KMZ katmanı silinir."
    : "";

  if (!window.confirm(`${label} silinsin mi?${extra}`)) return;

  try {
    const { error } = await sb.from("project_layers").delete().eq("id", layerId);
    if (error) throw error;
    await loadAppData();
    toast("Katman silindi.");
  } catch (err) {
    console.error(err);
    toast(err.message || "Katman silinemedi.", 5000);
  }
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
  const { data: existingRows, error: existingError } = await sb
    .from("borehole_records")
    .select("id,borehole_code")
    .eq("project_id", projectId);
  if (existingError) throw existingError;

  const existingMap = new Map((existingRows || []).map(r => [String(r.borehole_code), r]));
  const inserts = [];

  for (let index = 0; index < geojson.features.length; index++) {
    const feature = geojson.features[index];
    if (feature.geometry?.type !== "Point") continue;

    const [longitude, latitude] = feature.geometry.coordinates || [];
    const code = boreholeCode(feature, index);
    const existing = existingMap.get(code);

    if (existing) {
      const { error } = await sb
        .from("borehole_records")
        .update({ longitude, latitude })
        .eq("id", existing.id);
      if (error) throw error;
    } else {
      inserts.push({
        project_id: projectId,
        borehole_code: code,
        longitude,
        latitude,
        status: "Planlandı",
        created_by: currentUser.id
      });
    }
  }

  if (inserts.length) {
    const { error } = await sb.from("borehole_records").insert(inserts);
    if (error) throw error;
  }
}

async function importLayer(kind, inputId=null) {
  if (currentRole !== "admin") return toast("Bu işlem yalnızca Yönetici rolüne açık.");
  const p = projects.find(x => x.id === activeProjectId);
  if (!p) return toast("Önce bir iş seçin.");

  const input = inputId
    ? $(inputId)
    : (kind === "boundary" ? $("boundaryFile") : $("boreholeFile"));
  const file = input?.files?.[0];
  if (!file) return toast("Önce KML/KMZ dosyası seçin.");

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

async function saveProject(event) {
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
      status: $("projectStatus").value
    };

    if (editingProjectId) {
      const { error } = await sb
        .from("projects")
        .update(payload)
        .eq("id", editingProjectId);

      if (error) throw error;
      activeProjectId = editingProjectId;
      toast("İş bilgileri güncellendi.");
    } else {
      const { data, error } = await sb
        .from("projects")
        .insert({
          ...payload,
          progress: 0,
          created_by: currentUser.id
        })
        .select("id")
        .single();

      if (error) throw error;
      activeProjectId = data.id;
      toast("Yeni iş merkezi veritabanına kaydedildi.");
    }

    closeModal();
    await loadAppData();
  } catch (err) {
    console.error(err);
    toast(err.message || "İş kaydedilemedi.", 5000);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}



function openProjectDetail(projectId) {
  const p = projects.find(x => x.id === projectId);
  if (!p) return toast("İş bulunamadı.");

  activeProjectId = projectId;
  boreholeFilter = "all";
  renderProjectSelect();
  renderBoreholeProjectSelect();
  renderBoreholes();
  renderProjectDetailSummary();
  renderMapProject();
  renderBoreholeMap();
  switchView("boreholes");
}

function renderProjectDetailSummary() {
  const p = projects.find(x => x.id === activeProjectId);
  if (!p) return;

  const progress = getProjectProgress(p.id).percent;
  const pointCount = boreholeRecords.filter(b => b.project_id === p.id).length;

  $("projectDetailTitle") && ($("projectDetailTitle").textContent = p.name);
  $("projectDetailMeta") && ($("projectDetailMeta").textContent = `${pointCount} saha noktası · ${p.company}`);
  $("projectDetailStatus") && ($("projectDetailStatus").textContent = p.status || "—");
  $("projectDetailArea") && ($("projectDetailArea").textContent = `${Number(p.area).toLocaleString("tr-TR")} ha`);
  $("projectDetailCompany") && ($("projectDetailCompany").textContent = p.company || "—");
  $("projectDetailProgress") && ($("projectDetailProgress").textContent = `%${progress}`);

  if ($("detailBoundaryLayerInfo")) {
    $("detailBoundaryLayerInfo").textContent = p.boundaryLayerName ? `Yüklü: ${p.boundaryLayerName}` : "Yüklü çalışma alanı yok";
    $("detailDeleteBoundaryBtn").disabled = !p.boundaryLayerId;
  }
  if ($("detailBoreholeLayerInfo")) {
    $("detailBoreholeLayerInfo").textContent = p.boreholesLayerName ? `Yüklü: ${p.boreholesLayerName}` : "Yüklü sondaj KML/KMZ yok";
    $("detailDeleteBoreholesBtn").disabled = !p.boreholesLayerId;
  }
}

function renderBoreholeProjectSelect() {
  const select = $("boreholeProjectSelect");
  if (!select) return;

  select.innerHTML = projects.length
    ? projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")
    : '<option value="">İş yok</option>';

  if (activeProjectId) select.value = activeProjectId;
}

function boreholeStatusClass(status="") {
  const s = String(status).toLocaleLowerCase("tr-TR");
  if (s.includes("tamam")) return "done";
  if (s.includes("saha")) return "active";
  if (s.includes("kontrol")) return "review";
  return "planned";
}

function renderBoreholes() {
  const tbody = $("boreholesTableBody");
  if (!tbody) return;

  const allRows = boreholeRecords.filter(b => b.project_id === activeProjectId);
  const planned = allRows.filter(b => (b.status || "Planlandı") === "Planlandı").length;
  const active = allRows.filter(b => b.status === "Sahada").length;
  const done = allRows.filter(b => b.status === "Tamamlandı").length;
  const sondajRows = allRows.filter(b => (b.point_type || "Sondaj") === "Sondaj");
  const doneSondaj = sondajRows.filter(b => b.status === "Tamamlandı").length;
  const progress = sondajRows.length ? Math.round((doneSondaj / sondajRows.length) * 100) : 0;

  $("bhStatTotal").textContent = allRows.length;
  $("bhStatPlanned").textContent = planned;
  $("bhStatActive").textContent = active;
  $("bhStatDone").textContent = done;
  $("bhProgressText").textContent = `${doneSondaj} / ${sondajRows.length} sondaj tamamlandı · %${progress}`;
  $("bhProgressBar").style.width = `${progress}%`;

  document.querySelectorAll(".borehole-stat-card").forEach(card => {
    card.classList.toggle("active", card.dataset.bhFilter === boreholeFilter);
  });

  const rows = boreholeFilter === "all"
    ? allRows
    : allRows.filter(b => (b.status || "Planlandı") === boreholeFilter);

  if (!allRows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Bu iş için saha noktası bulunmuyor. KML/KMZ içe aktarabilir veya sahadan yeni nokta ekleyebilirsiniz.</td></tr>';
    return;
  }

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">${escapeHtml(boreholeFilter)} durumunda saha noktası bulunmuyor.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(b => {
    const lat = Number.isFinite(Number(b.latitude)) ? Number(b.latitude).toFixed(6) : "—";
    const lng = Number.isFinite(Number(b.longitude)) ? Number(b.longitude).toFixed(6) : "—";
    return `
      <tr>
        <td><strong>${escapeHtml(b.borehole_code)}</strong></td>
        <td><span class="point-type-badge ${(b.point_type || "Sondaj") === "Jeoteknik" ? "geotech" : "borehole"}">${escapeHtml(b.point_type || "Sondaj")}${b.method ? " · " + escapeHtml(b.method) : ""}</span></td>
        <td><small>${lat}, ${lng}</small></td>
        <td>${b.planned_depth_m ?? "—"} m</td>
        <td>${b.actual_depth_m ?? "—"} m</td>
        <td><span class="status bh-status ${boreholeStatusClass(b.status)}">${escapeHtml(b.status || "Planlandı")}</span></td>
        <td><button class="btn secondary borehole-detail-btn" data-id="${b.id}">Detay / Saha Girişi</button></td>
      </tr>
    `;
  }).join("");

  document.querySelectorAll(".borehole-detail-btn").forEach(btn => {
    btn.onclick = () => openBoreholeModal(btn.dataset.id);
  });
}

async function openBoreholeModal(id) {
  const b = boreholeRecords.find(x => x.id === id);
  if (!b) return toast("Sondaj kaydı bulunamadı.");

  activeBoreholeId = id;
  const p = projects.find(x => x.id === b.project_id);

  $("boreholeModalTitle").textContent = b.borehole_code;
  $("boreholeModalSubtitle").textContent = p?.name || "Sondaj";
  $("bhCode").value = b.borehole_code || "";
  $("bhPointType").value = b.point_type || "Sondaj";
  $("bhMethod").value = b.method || "—";
  $("bhLat").value = b.latitude ?? "";
  $("bhLng").value = b.longitude ?? "";
  $("bhPlannedDepth").value = b.planned_depth_m ?? "";
  $("bhActualDepth").value = b.actual_depth_m ?? "";
  $("bhStatus").value = b.status || "Planlandı";
  $("bhNotes").value = b.notes || "";
  $("boreholeModal").classList.remove("hidden");

  await Promise.all([
    loadFieldEntries(id),
    loadBoreholeAttachments(id)
  ]);
}

function closeBoreholeModal() {
  $("boreholeModal").classList.add("hidden");
  activeBoreholeId = null;
  $("boreholeForm").reset();
  $("fieldEntryForm").reset();
  $("boreholeFiles").value = "";
  $("fieldEntriesList").innerHTML = "";
  $("boreholeFilesList").innerHTML = "";
}

async function saveBorehole(event) {
  event.preventDefault();
  if (!activeBoreholeId) return;

  const status = $("bhStatus").value;
  const payload = {
    planned_depth_m: $("bhPlannedDepth").value === "" ? null : Number($("bhPlannedDepth").value),
    actual_depth_m: $("bhActualDepth").value === "" ? null : Number($("bhActualDepth").value),
    status,
    notes: $("bhNotes").value.trim() || null,
    updated_at: new Date().toISOString()
  };

  if (status === "Sahada") payload.started_at = new Date().toISOString();
  if (status === "Tamamlandı") payload.completed_at = new Date().toISOString();

  try {
    const record = boreholeRecords.find(x => x.id === activeBoreholeId);
    const { error } = await sb.from("borehole_records").update(payload).eq("id", activeBoreholeId);
    if (error) throw error;
    if (record?.project_id) await syncProjectProgress(record.project_id);
    toast("Sondaj bilgileri kaydedildi.");
    await loadAppData();
  } catch (err) {
    console.error(err);
    toast(err.message || "Sondaj kaydedilemedi.", 5000);
  }
}

async function loadFieldEntries(boreholeId) {
  const { data, error } = await sb
    .from("field_entries")
    .select("id,entry_type,depth_from_m,depth_to_m,value_text,notes,created_at")
    .eq("borehole_id", boreholeId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    $("fieldEntriesList").innerHTML = '<div class="empty-state">Saha kayıtları yüklenemedi.</div>';
    return;
  }

  if (!data?.length) {
    $("fieldEntriesList").innerHTML = '<div class="empty-state">Henüz saha kaydı yok.</div>';
    return;
  }

  $("fieldEntriesList").innerHTML = data.map(e => {
    const depth = e.depth_from_m != null || e.depth_to_m != null
      ? `${e.depth_from_m ?? "?"} – ${e.depth_to_m ?? "?"} m`
      : "Derinlik yok";
    return `
      <article class="entry-card">
        <div>
          <strong>${escapeHtml(e.entry_type)}</strong>
          <span>${escapeHtml(depth)}</span>
        </div>
        <p>${escapeHtml(e.value_text || e.notes || "—")}</p>
        <button class="entry-delete-btn" data-id="${e.id}" title="Kaydı sil">×</button>
      </article>
    `;
  }).join("");

  document.querySelectorAll(".entry-delete-btn").forEach(btn => {
    btn.onclick = () => deleteFieldEntry(btn.dataset.id);
  });
}

async function addFieldEntry(event) {
  event.preventDefault();
  if (!activeBoreholeId) return;

  try {
    const { error } = await sb.from("field_entries").insert({
      borehole_id: activeBoreholeId,
      entry_type: $("entryType").value,
      depth_from_m: $("entryDepthFrom").value === "" ? null : Number($("entryDepthFrom").value),
      depth_to_m: $("entryDepthTo").value === "" ? null : Number($("entryDepthTo").value),
      value_text: $("entryValue").value.trim() || null,
      notes: $("entryNotes").value.trim() || null,
      created_by: currentUser.id
    });
    if (error) throw error;

    $("fieldEntryForm").reset();
    toast("Saha kaydı eklendi.");
    await loadFieldEntries(activeBoreholeId);
  } catch (err) {
    console.error(err);
    toast(err.message || "Saha kaydı eklenemedi.", 5000);
  }
}

async function deleteFieldEntry(entryId) {
  if (!window.confirm("Bu saha kaydı silinsin mi?")) return;
  try {
    const { error } = await sb.from("field_entries").delete().eq("id", entryId);
    if (error) throw error;
    await loadFieldEntries(activeBoreholeId);
    toast("Saha kaydı silindi.");
  } catch (err) {
    console.error(err);
    toast(err.message || "Saha kaydı silinemedi.", 5000);
  }
}

function safeFileName(name="dosya") {
  return name
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-zA-Z0-9._-]+/g,"_");
}

async function uploadBoreholeFiles() {
  if (!activeBoreholeId) return;
  const files = [...($("boreholeFiles").files || [])];
  if (!files.length) return toast("Yüklenecek dosya seçilmedi.");

  const b = boreholeRecords.find(x => x.id === activeBoreholeId);
  if (!b) return toast("Sondaj kaydı bulunamadı.");

  try {
    for (const file of files) {
      const path = `${b.project_id}/${b.id}/${Date.now()}_${safeFileName(file.name)}`;
      const { error: uploadError } = await sb.storage
        .from("field-files")
        .upload(path, file, { upsert: false, contentType: file.type || undefined });
      if (uploadError) throw uploadError;

      const { error: dbError } = await sb.from("attachments").insert({
        project_id: b.project_id,
        borehole_id: b.id,
        file_name: file.name,
        storage_path: path,
        mime_type: file.type || null,
        size_bytes: file.size,
        uploaded_by: currentUser.id
      });
      if (dbError) throw dbError;
    }

    $("boreholeFiles").value = "";
    toast(`${files.length} dosya yüklendi.`);
    await loadBoreholeAttachments(activeBoreholeId);
  } catch (err) {
    console.error(err);
    toast(err.message || "Dosya yüklenemedi.", 5000);
  }
}

async function renameAttachment(id, currentName) {
  const next = window.prompt("Dosya adını değiştir:", currentName);
  if (next === null) return;
  const clean = next.trim();
  if (!clean || clean === currentName) return;

  try {
    const { error } = await sb.from("attachments").update({ file_name: clean }).eq("id", id);
    if (error) throw error;
    await loadBoreholeAttachments(activeBoreholeId);
    toast("Dosya adı güncellendi.");
  } catch (err) {
    console.error(err);
    toast(err.message || "Dosya adı değiştirilemedi.", 5000);
  }
}

async function deleteAttachment(id, storagePath) {
  if (!window.confirm("Bu fotoğraf/belge silinsin mi?")) return;

  try {
    const { error: storageError } = await sb.storage.from("field-files").remove([storagePath]);
    if (storageError) throw storageError;

    const { error: dbError } = await sb.from("attachments").delete().eq("id", id);
    if (dbError) throw dbError;

    await loadBoreholeAttachments(activeBoreholeId);
    toast("Fotoğraf/belge silindi.");
  } catch (err) {
    console.error(err);
    toast(err.message || "Dosya silinemedi.", 5000);
  }
}

async function loadBoreholeAttachments(boreholeId) {
  const { data, error } = await sb
    .from("attachments")
    .select("id,file_name,storage_path,mime_type,size_bytes,created_at")
    .eq("borehole_id", boreholeId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    $("boreholeFilesList").innerHTML = '<div class="empty-state">Dosyalar yüklenemedi.</div>';
    return;
  }

  if (!data?.length) {
    $("boreholeFilesList").innerHTML = '<div class="empty-state">Henüz dosya yok.</div>';
    return;
  }

  const rendered = [];
  for (const file of data) {
    const { data: signed } = await sb.storage.from("field-files").createSignedUrl(file.storage_path, 3600);
    const url = signed?.signedUrl || "#";
    const size = file.size_bytes ? (Number(file.size_bytes) / 1024 / 1024).toFixed(2) + " MB" : "";
    rendered.push(`
      <div class="attachment-card">
        <a class="attachment-main" href="${url}" target="_blank" rel="noopener">
          <strong>${escapeHtml(file.file_name)}</strong>
          <span>${escapeHtml(size)}</span>
        </a>
        <div class="attachment-actions">
          <button class="btn ghost mini rename-attachment-btn"
            data-id="${file.id}"
            data-name="${encodeURIComponent(file.file_name)}"
            type="button">Düzenle</button>
          <button class="btn danger mini delete-attachment-btn"
            data-id="${file.id}"
            data-path="${encodeURIComponent(file.storage_path)}"
            type="button">Sil</button>
        </div>
      </div>
    `);
  }
  $("boreholeFilesList").innerHTML = rendered.join("");

  document.querySelectorAll(".rename-attachment-btn").forEach(btn => {
    btn.onclick = () => renameAttachment(btn.dataset.id, decodeURIComponent(btn.dataset.name));
  });
  document.querySelectorAll(".delete-attachment-btn").forEach(btn => {
    btn.onclick = () => deleteAttachment(btn.dataset.id, decodeURIComponent(btn.dataset.path));
  });
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

function formatAreaLabel(area) {
  if (!Number.isFinite(area) || area <= 0) return "? ha";
  return area.toLocaleString("tr-TR", { maximumFractionDigits: 2 }) + " ha";
}

function extractNeighborhoodFromTitle(title="") {
  const text = String(title || "").replace(/[’‘`]/g, "'");
  if (!text) return "";

  let m = text.match(/İlçe(?:si|leri)\s*,?\s*(.+?)\s+Mahalle(?:si|leri|lerinde|sinde|si'nde|leri'nde)/i);
  if (m?.[1]) {
    return m[1]
      .replace(/^,\s*/,"")
      .replace(/\s+/g," ")
      .replace(/\s*-\s*/g,", ")
      .trim();
  }

  m = text.match(/(?:^|,)\s*([^,.;]+?)\s+Mahalle(?:si|leri|lerinde|sinde|si'nde|leri'nde)/i);
  return m?.[1]?.replace(/\s+/g," ").trim() || "";
}

function projectNameFromRow(row, index) {
  const district = String(firstValue(row, ["İlçe","Ilce","İlçeler","Ilceler"]) || "İlçe belirtilmedi").trim();
  const area = parseNumberTR(firstValue(row, [
    "Hektar","Ha","Alan (ha)","Alan Ha","Alan_ha","Hektar Bilgisi",
    "Yüzölçümü (ha)","Yuzolcumu Ha","Alan"
  ]));
  const title = firstValue(row, ["İş Adı / Konu","İş Adı","İşin Adı","Konu","Proje Adı"]);
  const neighborhood = extractNeighborhoodFromTitle(title) || "Genel";
  return `${district} - ${neighborhood} - ${formatAreaLabel(area)}`;
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

    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    let headerRowIndex = matrix.findIndex(row => {
      const normalized = row.map(normalizeHeader);
      return normalized.includes("is no") &&
        (normalized.includes("hektar") || normalized.includes("is adi konu") || normalized.includes("durum"));
    });
    if (headerRowIndex < 0) headerRowIndex = 0;

    const rows = XLSX.utils.sheet_to_json(sheet, { range: headerRowIndex, defval: "" });
    if (!rows.length) throw new Error("Excel dosyasında veri satırı bulunamadı.");

    let added = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    let firstTouchedId = null;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      try {
        const sourceNo = String(firstValue(row, ["İş No","İş Numarası","Evrak Kodu","Proje No"]) || "").trim();
        const name = projectNameFromRow(row, i);
        const nameKey = normalizeHeader(name);

        if (!nameKey) {
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

        const existing = projects.find(p => {
          const current = normalizeHeader(p.name);
          return current === nameKey || (sourceNo && current === normalizeHeader(sourceNo));
        });

        if (existing) {
          const { error } = await sb
            .from("projects")
            .update({
              short_name: name,
              area_ha: area,
              company_id: company.id,
              status,
              progress
            })
            .eq("id", existing.id);

          if (error) throw error;
          if (!firstTouchedId) firstTouchedId = existing.id;
          updated++;
        } else {
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
          if (!firstTouchedId) firstTouchedId = data.id;
          added++;
        }
      } catch (rowError) {
        console.error("Excel satırı aktarılamadı:", i + 2, rowError, row);
        failed++;
      }
    }

    if (firstTouchedId) activeProjectId = firstTouchedId;
    await loadAppData();

    toast(
      `Excel aktarımı tamamlandı: ${added} yeni iş, ${updated} güncellenen iş${skipped ? `, ${skipped} atlanan satır` : ""}${failed ? `, ${failed} hata` : ""}.`,
      7000
    );
  } catch (err) {
    console.error(err);
    toast(err.message || "Excel dosyası aktarılamadı.", 6000);
  } finally {
    $("excelImportInput").value = "";
  }
}


function exportProjectsToExcel() {
  if (currentRole !== "admin") return toast("Excel dışa aktarımı yalnızca Yönetici rolüne açık.");
  if (!projects.length) return toast("Dışa aktarılacak iş bulunamadı.");

  try {
    if (!window.XLSX) throw new Error("Excel kütüphanesi yüklenemedi.");

    const rows = projects.map(p => ({
      "İş No": p.name,
      "Hektar": Number(p.area || 0),
      "Firma": p.company || "",
      "Durum": p.status || "",
      "İlerleme (%)": Number(p.progress || 0),
      "Sondaj Sayısı": p.boreholes?.features?.length || 0
    }));

    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet["!cols"] = [
      { wch: 20 }, { wch: 12 }, { wch: 28 },
      { wch: 24 }, { wch: 14 }, { wch: 14 }
    ];

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "İşler");

    const d = new Date();
    const stamp = [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0")
    ].join("-");

    XLSX.writeFile(book, `JEO_Isler_${stamp}.xlsx`);
    toast("İşler Excel dosyası olarak dışa aktarıldı.");
  } catch (err) {
    console.error(err);
    toast(err.message || "Excel dışa aktarımı yapılamadı.", 5000);
  }
}


function openModal() {
  if (currentRole !== "admin") return;
  editingProjectId = null;
  $("projectModalTitle").textContent = "Yeni İş Oluştur";
  $("projectModalSubtitle").textContent = "İşi kısa bir ad ve hektar bilgisiyle kaydedin.";
  $("projectSaveBtn").textContent = "İşi Kaydet";
  $("projectForm").reset();
  $("projectModal").classList.remove("hidden");
  $("projectName").focus();
}

function openEditModal(projectId) {
  if (currentRole !== "admin") return;
  const p = projects.find(x => x.id === projectId);
  if (!p) return toast("İş bulunamadı.");

  editingProjectId = p.id;
  $("projectModalTitle").textContent = "İşi Düzenle";
  $("projectModalSubtitle").textContent = "İş adı, hektar, firma ve durum bilgilerini güncelleyin.";
  $("projectSaveBtn").textContent = "Değişiklikleri Kaydet";
  $("projectName").value = p.name || "";
  $("projectArea").value = Number(p.area || 0);
  $("projectCompany").value = p.company === "Firma atanmadı" ? "" : (p.company || "");
  $("projectStatus").value = p.status || "Planlandı";
  $("projectModal").classList.remove("hidden");
  $("projectName").focus();
}

async function deleteProject(projectId) {
  if (currentRole !== "admin") return;
  const p = projects.find(x => x.id === projectId);
  if (!p) return;

  const ok = window.confirm(
    `"${p.name}" işi silinsin mi?\n\nBu işe bağlı çalışma alanı, sondaj ve saha kayıtları da silinecektir.`
  );
  if (!ok) return;

  try {
    const { error } = await sb.from("projects").delete().eq("id", projectId);
    if (error) throw error;

    if (activeProjectId === projectId) activeProjectId = null;
    await loadAppData();
    toast("İş silindi.");
  } catch (err) {
    console.error(err);
    toast(err.message || "İş silinemedi.", 5000);
  }
}

function closeModal() {
  $("projectModal").classList.add("hidden");
  $("projectForm").reset();
  editingProjectId = null;
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
  $("excelExportBtn").onclick = exportProjectsToExcel;
  $("dashboardExcelImportBtn").onclick = () => $("excelImportInput").click();
  $("dashboardExcelExportBtn").onclick = exportProjectsToExcel;
  $("backToJobsBtn").onclick = () => switchView("dashboard");
  $("editCurrentProjectBtn").onclick = () => {
    if (activeProjectId) openEditModal(activeProjectId);
  };
  $("detailImportBoundaryBtn").onclick = () => importLayer("boundary", "detailBoundaryFile");
  $("detailImportBoreholesBtn").onclick = () => importLayer("borehole", "detailBoreholeFile");
  $("detailDeleteBoundaryBtn").onclick = () => deleteProjectLayer("boundary");
  $("detailDeleteBoreholesBtn").onclick = () => deleteProjectLayer("boreholes");
  $("excelImportInput").addEventListener("change", async e => {
    const file = e.target.files?.[0];
    if (file) await importProjectsFromExcel(file);
  });
  $("closeModalBtn").onclick = closeModal;
  $("cancelModalBtn").onclick = closeModal;

  $("projectModal").addEventListener("click", e => {
    if (e.target.id === "projectModal") closeModal();
  });

  $("projectForm").addEventListener("submit", saveProject);

  $("mapProjectSelect").addEventListener("change", e => {
    activeProjectId = e.target.value || null;
    renderProjectSelect();
    renderBoreholeProjectSelect();
    renderBoreholes();
    renderMapProject();
    renderBoreholeMap();
  });

  document.querySelectorAll(".borehole-stat-card").forEach(card => {
    card.addEventListener("click", () => {
      boreholeFilter = card.dataset.bhFilter || "all";
      renderBoreholes();
      renderBoreholeMap();
    });
  });

  $("closeBoreholeModalBtn").onclick = closeBoreholeModal;
  $("cancelBoreholeModalBtn").onclick = closeBoreholeModal;
  $("boreholeModal").addEventListener("click", e => {
    if (e.target.id === "boreholeModal") closeBoreholeModal();
  });
  $("boreholeForm").addEventListener("submit", saveBorehole);
  $("fieldEntryForm").addEventListener("submit", addFieldEntry);
  $("uploadBoreholeFilesBtn").onclick = uploadBoreholeFiles;
  $("toggleMapSidebarBtn").onclick = toggleMapSidebar;
  $("toggleAppSidebarBtn").onclick = toggleAppSidebar;

  $("locateMeBtn").onclick = () => locateMe(false);
  $("addBoreholePointBtn").onclick = () => openPointModal("Sondaj");
  $("addGeotechnicalPointBtn").onclick = () => openPointModal("Jeoteknik");
  $("closePointModalBtn").onclick = closePointModal;
  $("cancelPointModalBtn").onclick = closePointModal;
  $("pointModal").addEventListener("click", e => {
    if (e.target.id === "pointModal") closePointModal();
  });
  $("useCurrentLocationBtn").onclick = () => locateMe(true);
  $("pickPointFromMapBtn").onclick = () => {
    pickingPointFromMap = true;
    toast("Haritada noktanın yerini tıklayın.");
  };
  $("pointForm").addEventListener("submit", saveNewPoint);
  $("deleteBoundaryLayerBtn").onclick = () => deleteProjectLayer("boundary");
  $("deleteBoreholeLayerBtn").onclick = () => deleteProjectLayer("boreholes");

  $("importBoundaryBtn").onclick = () => importLayer("boundary");
  $("importBoreholesBtn").onclick = () => importLayer("borehole");
}

document.addEventListener("DOMContentLoaded", () => {
  wireEvents();

  if (localStorage.getItem("je_sidebar_collapsed") === "1") {
    $("appShell").classList.add("sidebar-collapsed");
    $("toggleAppSidebarBtn").textContent = "›";
    $("toggleAppSidebarBtn").title = "Menüyü genişlet";
  }

  showAuth();
  initializeAuth();
});
