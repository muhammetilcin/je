const CONFIG = window.JEO_CONFIG || {};

const sb = window.supabase?.createClient(
  CONFIG.SUPABASE_URL,
  CONFIG.SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);


// ============================================================
// GENEL DURUM
// ============================================================

let currentUser = null;
let currentProfile = null;
let currentRole = null;

let projects = [];
let boreholeRecords = [];

let activeProjectId = null;
let activeBoreholeId = null;
let editingProjectId = null;

let boreholeFilter = "all";

let fieldPointSchemaAvailable = true;

let currentLocation = null;
let locationMarker = null;
let locationAccuracyCircle = null;

let pickingPointFromMap = false;

let mapsInitialized = false;


// ============================================================
// HARİTALAR
// ============================================================

let mainMap = null;
let dashboardMap = null;
let boreholeMap = null;

let mainBoundaryLayer = null;
let mainPointsLayer = null;

let boreholeBoundaryLayer = null;
let boreholePointsLayer = null;

let dashboardDataLayer = null;


// ============================================================
// YARDIMCI
// ============================================================

const $ = id => document.getElementById(id);


function escapeHtml(value = "") {
  return String(value).replace(
    /[&<>"']/g,
    c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[c]
  );
}


function toast(message, ms = 3200) {

  const el = $("toast");

  if (!el) return;

  el.textContent = message;

  el.classList.remove("hidden");

  setTimeout(() => {
    el.classList.add("hidden");
  }, ms);
}


function setLoginMessage(message, isError = false) {

  const el = $("loginMessage");

  if (!el) return;

  el.textContent = message || "";

  el.classList.toggle("error", isError);
}


function setText(id, value) {

  const el = $(id);

  if (el) {
    el.textContent = value;
  }
}


// ============================================================
// DURUM RENKLERİ
// ============================================================

function getStatusKey(status = "") {

  const s = String(status).toLocaleLowerCase("tr-TR");

  if (s.includes("tamam")) {
    return "done";
  }

  if (s.includes("saha")) {
    return "active";
  }

  if (s.includes("kontrol")) {
    return "review";
  }

  return "planned";
}


function getStatusColor(status = "") {

  const key = getStatusKey(status);

  const colors = {

    // PLANLANAN = GRİ
    planned: "#9aa3ad",

    // SAHADA = SARI
    active: "#e0b100",

    // KONTROL = MAVİ
    review: "#3b82f6",

    // TAMAMLANAN = YEŞİL
    done: "#22a06b"

  };

  return colors[key];
}


function getPointMarkerStyle(
  status = "",
  pointType = "Sondaj"
) {

  const color = getStatusColor(status);

  const isGeotechnical =
    pointType === "Jeoteknik";

  return {

    radius:
      isGeotechnical ? 9 : 7,

    color,

    fillColor: color,

    fillOpacity: 0.92,

    weight:
      isGeotechnical ? 3 : 2

  };
}


function boreholeStatusClass(status = "") {

  return getStatusKey(status);
}


// ============================================================
// GİRİŞ
// ============================================================

function showAuth() {

  $("authScreen")?.classList.remove("hidden");

  $("appShell")?.classList.add("app-hidden");
}


function showApp() {

  $("authScreen")?.classList.add("hidden");

  $("appShell")?.classList.remove("app-hidden");


  if (!mapsInitialized) {

    initMaps();

    mapsInitialized = true;

  }


  setTimeout(() => {

    mainMap?.invalidateSize();

    dashboardMap?.invalidateSize();

    boreholeMap?.invalidateSize();

  }, 150);
}


// ============================================================
// ALTLIK HARİTALAR
// ============================================================

function createBaseLayers() {

  return {

    "Sokak Haritası":

      L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          attribution:
            "&copy; OpenStreetMap katkıcıları",
          maxZoom: 20
        }
      ),


    "Uydu":

      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
          attribution:
            "Tiles &copy; Esri",
          maxZoom: 20
        }
      )

  };
}


function addStatusLegend(map) {

  if (!map) return;


  const legend =
    L.control({
      position: "bottomright"
    });


  legend.onAdd = () => {

    const div =
      L.DomUtil.create(
        "div",
        "map-status-legend"
      );


    div.innerHTML = `

      <strong>Durum</strong>

      <div>
        <span style="
          background:#9aa3ad;
          width:11px;
          height:11px;
          border-radius:50%;
          display:inline-block;
          margin-right:6px;">
        </span>
        Planlandı
      </div>

      <div>
        <span style="
          background:#e0b100;
          width:11px;
          height:11px;
          border-radius:50%;
          display:inline-block;
          margin-right:6px;">
        </span>
        Sahada
      </div>

      <div>
        <span style="
          background:#3b82f6;
          width:11px;
          height:11px;
          border-radius:50%;
          display:inline-block;
          margin-right:6px;">
        </span>
        Kontrol
      </div>

      <div>
        <span style="
          background:#22a06b;
          width:11px;
          height:11px;
          border-radius:50%;
          display:inline-block;
          margin-right:6px;">
        </span>
        Tamamlandı
      </div>

    `;

    return div;
  };


  legend.addTo(map);
}


// ============================================================
// HARİTALARI BAŞLAT
// ============================================================

function initMaps() {

  // ESKİ HARİTA EKRANI

  if ($("mainMap")) {

    mainMap =
      L.map("mainMap")
        .setView(
          [38.42, 27.14],
          10
        );


    const bases =
      createBaseLayers();


    bases["Sokak Haritası"]
      .addTo(mainMap);


    L.control.layers(
      bases,
      null,
      {
        position: "topright",
        collapsed: false
      }
    ).addTo(mainMap);


    addStatusLegend(mainMap);

  }


  // ANA MENÜ NOKTALAR HARİTASI

  if ($("dashboardMap")) {

    dashboardMap =
      L.map(
        "dashboardMap",
        {
          zoomControl: true
        }
      )
        .setView(
          [38.42, 27.14],
          9
        );


    const bases =
      createBaseLayers();


    bases["Sokak Haritası"]
      .addTo(dashboardMap);


    L.control.layers(
      bases,
      null,
      {
        position: "topright",
        collapsed: true
      }
    ).addTo(dashboardMap);


    addStatusLegend(dashboardMap);

  }


  // İŞ DETAY HARİTASI

  if ($("boreholeMap")) {

    boreholeMap =
      L.map("boreholeMap")
        .setView(
          [38.42, 27.14],
          10
        );


    const bases =
      createBaseLayers();


    bases["Sokak Haritası"]
      .addTo(boreholeMap);


    L.control.layers(
      bases,
      null,
      {
        position: "topright",
        collapsed: false
      }
    ).addTo(boreholeMap);


    addStatusLegend(boreholeMap);


    // HARİTADAN YENİ NOKTA SEÇME

    boreholeMap.on(
      "click",
      e => {

        if (!pickingPointFromMap) {
          return;
        }


        setText(
          "pointLocationAccuracy",
          "Konum: haritadan seçildi"
        );


        $("pointLat").value =
          e.latlng.lat.toFixed(7);


        $("pointLng").value =
          e.latlng.lng.toFixed(7);


        pickingPointFromMap = false;


        $("pointModal")
          ?.classList
          .remove("hidden");


        toast(
          "Nokta konumu haritadan seçildi."
        );

      }
    );

  }

}


// ============================================================
// ROL
// ============================================================

function applyRole() {

  document
    .querySelectorAll(".admin-only")
    .forEach(el => {

      el.classList.toggle(
        "company-hidden",
        currentRole !== "admin"
      );

    });


  const label =
    currentRole === "admin"
      ? "Yönetici"
      : "Firma";


  setText(
    "roleBadge",
    label
  );


  setText(
    "sidebarRoleBadge",
    label
  );
}


// ============================================================
// AUTH
// ============================================================

async function initializeAuth() {

  if (
    !sb ||
    !CONFIG.SUPABASE_URL ||
    !CONFIG.SUPABASE_PUBLISHABLE_KEY
  ) {

    setLoginMessage(
      "Supabase bağlantı ayarları bulunamadı.",
      true
    );

    return;
  }


  const {
    data,
    error
  } =
    await sb.auth.getSession();


  if (error) {

    setLoginMessage(
      error.message,
      true
    );

    return;
  }


  if (data.session?.user) {

    await enterSession(
      data.session.user
    );

  } else {

    showAuth();

  }
}


async function enterSession(user) {

  currentUser = user;


  const {
    data: profile,
    error
  } =
    await sb
      .from("profiles")
      .select(
        "id,full_name,role,company_id"
      )
      .eq(
        "id",
        user.id
      )
      .single();


  if (
    error ||
    !profile
  ) {

    await sb.auth.signOut();

    showAuth();

    setLoginMessage(
      "Bu kullanıcı için profil/yetki kaydı bulunamadı.",
      true
    );

    return;
  }


  currentProfile = profile;

  currentRole = profile.role;


  setText(
    "signedUserName",
    profile.full_name || "Kullanıcı"
  );


  setText(
    "signedUserEmail",
    user.email || ""
  );


  applyRole();

  showApp();


  try {

    await loadAppData();

  } catch (err) {

    console.error(err);

    toast(
      err.message ||
      "Veriler yüklenemedi.",
      5000
    );

  }
}


// ============================================================
// VERİLERİ YÜKLE
// ============================================================

async function loadAppData() {

  // İŞLER

  const {
    data: projectRows,
    error: projectError
  } =
    await sb
      .from("projects")
      .select(
        "id,short_name,area_ha,company_id,status,progress,created_at"
      )
      .order(
        "created_at",
        {
          ascending: false
        }
      );


  if (projectError) {
    throw projectError;
  }


  // FİRMALAR

  const companyIds =
    [
      ...new Set(
        (projectRows || [])
          .map(
            p => p.company_id
          )
          .filter(Boolean)
      )
    ];


  let companyMap = {};


  if (companyIds.length) {

    const {
      data: companyRows,
      error: companyError
    } =
      await sb
        .from("companies")
        .select("id,name")
        .in(
          "id",
          companyIds
        );


    if (companyError) {
      throw companyError;
    }


    companyMap =
      Object.fromEntries(
        (companyRows || [])
          .map(
            c => [
              c.id,
              c.name
            ]
          )
      );

  }


  // KML / KMZ

  const projectIds =
    (projectRows || [])
      .map(
        p => p.id
      );


  let layers = [];


  if (projectIds.length) {

    const {
      data: layerRows,
      error: layerError
    } =
      await sb
        .from("project_layers")
        .select(
          "id,project_id,layer_type,name,geojson"
        )
        .in(
          "project_id",
          projectIds
        )
        .order(
          "created_at",
          {
            ascending: true
          }
        );


    if (layerError) {
      throw layerError;
    }


    layers =
      layerRows || [];

  }


  // SAHA NOKTALARI

  let pointRows = [];


  if (projectIds.length) {

    let result =
      await sb
        .from("borehole_records")
        .select(
          "id,project_id,borehole_code,longitude,latitude,planned_depth_m,actual_depth_m,status,notes,started_at,completed_at,created_at,point_type,method,location_accuracy_m,location_captured_at"
        )
        .in(
          "project_id",
          projectIds
        )
        .order(
          "borehole_code",
          {
            ascending: true
          }
        );


    // ESKİ VERİTABANI İÇİN GERİ UYUMLULUK

    if (result.error) {

      fieldPointSchemaAvailable = false;


      result =
        await sb
          .from("borehole_records")
          .select(
            "id,project_id,borehole_code,longitude,latitude,planned_depth_m,actual_depth_m,status,notes,started_at,completed_at,created_at"
          )
          .in(
            "project_id",
            projectIds
          )
          .order(
            "borehole_code",
            {
              ascending: true
            }
          );

    } else {

      fieldPointSchemaAvailable = true;

    }


    if (result.error) {
      throw result.error;
    }


    pointRows =
      (result.data || [])
        .map(
          row => ({
            ...row,

            point_type:
              row.point_type ||
              "Sondaj",

            method:
              row.method ||
              null,

            location_accuracy_m:
              row.location_accuracy_m ??
              null,

            location_captured_at:
              row.location_captured_at ||
              null
          })
        );

  }


  boreholeRecords =
    pointRows;


  // PROJE NESNELERİ

  projects =
    (projectRows || [])
      .map(
        row => {

          const boundaryLayer =
            layers
              .filter(
                x =>
                  x.project_id === row.id &&
                  x.layer_type === "boundary"
              )
              .at(-1) ||
            null;


          const boreholesLayer =
            layers
              .filter(
                x =>
                  x.project_id === row.id &&
                  x.layer_type === "boreholes"
              )
              .at(-1) ||
            null;


          return {

            id:
              row.id,

            name:
              row.short_name,

            area:
              Number(
                row.area_ha ||
                0
              ),

            companyId:
              row.company_id,

            company:
              companyMap[
                row.company_id
              ] ||
              "Firma atanmadı",

            status:
              row.status,

            progress:
              Number(
                row.progress ||
                0
              ),

            boundary:
              boundaryLayer?.geojson ||
              null,

            boreholes:
              boreholesLayer?.geojson ||
              null,

            boundaryLayerId:
              boundaryLayer?.id ||
              null,

            boundaryLayerName:
              boundaryLayer?.name ||
              "",

            boreholesLayerId:
              boreholesLayer?.id ||
              null,

            boreholesLayerName:
              boreholesLayer?.name ||
              ""

          };

        }
      );


  if (
    !projects.some(
      p =>
        p.id === activeProjectId
    )
  ) {

    activeProjectId =
      projects[0]?.id ||
      null;

  }


  renderAll();
}


// ============================================================
// TÜM EKRANLARI YENİLE
// ============================================================

function renderAll() {

  renderStats();

  renderProjects();

  renderProjectSelect();

  renderBoreholes();

  renderProjectDetailSummary();

  renderMapProject();

  renderBoreholeMap();

  renderDashboardPointSummary();

  renderDashboardMap();

  renderTrackingChart();
}


// ============================================================
// İLERLEME
// ============================================================

function getProjectProgress(projectId) {

  const rows =
    boreholeRecords.filter(
      b =>
        b.project_id === projectId &&
        (
          b.point_type ||
          "Sondaj"
        ) === "Sondaj"
    );


  if (!rows.length) {

    const p =
      projects.find(
        x =>
          x.id === projectId
      );


    return {

      total: 0,

      done: 0,

      percent:
        Number(
          p?.progress ||
          0
        )

    };

  }


  const done =
    rows.filter(
      b =>
        getStatusKey(
          b.status
        ) === "done"
    ).length;


  return {

    total:
      rows.length,

    done,

    percent:
      Math.round(
        (
          done /
          rows.length
        ) *
        100
      )

  };
}


async function syncProjectProgress(
  projectId
) {

  let result =
    await sb
      .from("borehole_records")
      .select(
        "status,point_type"
      )
      .eq(
        "project_id",
        projectId
      );


  if (result.error) {

    result =
      await sb
        .from("borehole_records")
        .select("status")
        .eq(
          "project_id",
          projectId
        );

  }


  if (result.error) {
    throw result.error;
  }


  const sondajlar =
    (result.data || [])
      .filter(
        x =>
          (
            x.point_type ||
            "Sondaj"
          ) === "Sondaj"
      );


  const total =
    sondajlar.length;


  const done =
    sondajlar
      .filter(
        x =>
          getStatusKey(
            x.status
          ) === "done"
      )
      .length;


  const percent =
    total
      ? Math.round(
          (
            done /
            total
          ) *
          100
        )
      : 0;


  const {
    error
  } =
    await sb
      .from("projects")
      .update({
        progress:
          percent
      })
      .eq(
        "id",
        projectId
      );


  if (error) {
    throw error;
  }


  return percent;
}


// ============================================================
// ANA İSTATİSTİKLER
// ============================================================

function renderStats() {

  setText(
    "statProjects",
    projects.length
  );


  const sondajCount =
    boreholeRecords.filter(
      b =>
        (
          b.point_type ||
          "Sondaj"
        ) === "Sondaj"
    ).length;


  setText(
    "statBoreholes",
    sondajCount
  );


  const area =
    projects.reduce(
      (
        sum,
        p
      ) =>
        sum +
        Number(
          p.area ||
          0
        ),
      0
    );


  setText(
    "statArea",
    area.toLocaleString(
      "tr-TR"
    ) +
    " ha"
  );


  const review =
    boreholeRecords
      .filter(
        x =>
          getStatusKey(
            x.status
          ) === "review"
      )
      .length;


  setText(
    "statPending",
    review
  );
}


// ============================================================
// ANA MENÜ PROJE LİSTESİ
// ============================================================

function renderProjects() {

  const container =
    $("dashboardProjects");


  if (!container) {
    return;
  }


  if (!projects.length) {

    container.innerHTML =
      `
      <div class="empty-state">
        Henüz görüntülenebilir iş yok.
      </div>
      `;

    return;
  }


  container.innerHTML =
    projects
      .map(
        p => {

          const sondajCount =
            boreholeRecords
              .filter(
                b =>
                  b.project_id === p.id &&
                  (
                    b.point_type ||
                    "Sondaj"
                  ) === "Sondaj"
              )
              .length;


          const geoCount =
            boreholeRecords
              .filter(
                b =>
                  b.project_id === p.id &&
                  b.point_type === "Jeoteknik"
              )
              .length;


          const progress =
            getProjectProgress(
              p.id
            ).percent;


          return `

            <div
              class="project-row project-open-row"
              data-id="${p.id}"
              role="button"
              tabindex="0"
            >

              <div class="project-row-main">

                <strong>
                  ${escapeHtml(p.name)}
                </strong>

                <small>
                  ${Number(p.area).toLocaleString("tr-TR")} ha
                  ·
                  ${escapeHtml(p.company)}
                </small>

                <div class="project-row-meta">

                  <span class="status">
                    ${escapeHtml(p.status || "—")}
                  </span>

                  <span>
                    ${sondajCount} sondaj
                  </span>

                  ${
                    geoCount
                      ? `<span>${geoCount} jeoteknik</span>`
                      : ""
                  }

                  <span>
                    %${progress} ilerleme
                  </span>

                </div>

              </div>


              <button
                class="btn secondary open-project-btn"
                data-id="${p.id}"
                type="button"
              >
                İşi Aç
              </button>

            </div>

          `;

        }
      )
      .join("");


  document
    .querySelectorAll(
      ".open-project-btn"
    )
    .forEach(
      btn => {

        btn.onclick =
          e => {

            e.stopPropagation();

            openProjectDetail(
              btn.dataset.id
            );

          };

      }
    );


  document
    .querySelectorAll(
      ".project-open-row"
    )
    .forEach(
      row => {

        row.onclick =
          () =>
            openProjectDetail(
              row.dataset.id
            );


        row.onkeydown =
          e => {

            if (
              e.key === "Enter" ||
              e.key === " "
            ) {

              openProjectDetail(
                row.dataset.id
              );

            }

          };

      }
    );


  // ESKİ TABLO VARSA ONU DA DOLDUR

  const table =
    $("projectsTableBody");


  if (table) {

    table.innerHTML =
      projects
        .map(
          p => {

            const count =
              boreholeRecords
                .filter(
                  b =>
                    b.project_id === p.id &&
                    (
                      b.point_type ||
                      "Sondaj"
                    ) === "Sondaj"
                )
                .length;


            const progress =
              getProjectProgress(
                p.id
              ).percent;


            return `

              <tr>

                <td>
                  <strong>
                    ${escapeHtml(p.name)}
                  </strong>
                </td>

                <td>
                  ${Number(p.area).toLocaleString("tr-TR")} ha
                </td>

                <td>
                  ${escapeHtml(p.company)}
                </td>

                <td>
                  ${count}
                </td>

                <td>
                  <span class="status">
                    ${escapeHtml(p.status || "—")}
                  </span>
                </td>

                <td>

                  <div class="progress">
                    <span style="width:${progress}%"></span>
                  </div>

                  <small>
                    ${progress}%
                  </small>

                </td>

                <td>

                  <div class="row-actions">

                    <button
                      class="btn ghost open-project-btn"
                      data-id="${p.id}"
                    >
                      Aç
                    </button>

                    ${
                      currentRole === "admin"
                        ? `

                          <button
                            class="btn secondary edit-project-btn"
                            data-id="${p.id}"
                          >
                            Düzenle
                          </button>

                          <button
                            class="btn danger delete-project-btn"
                            data-id="${p.id}"
                          >
                            Sil
                          </button>

                        `
                        : ""
                    }

                  </div>

                </td>

              </tr>

            `;

          }
        )
        .join("");


    document
      .querySelectorAll(
        ".edit-project-btn"
      )
      .forEach(
        btn => {

          btn.onclick =
            () =>
              openEditModal(
                btn.dataset.id
              );

        }
      );


    document
      .querySelectorAll(
        ".delete-project-btn"
      )
      .forEach(
        btn => {

          btn.onclick =
            () =>
              deleteProject(
                btn.dataset.id
              );

        }
      );

  }
}


// ============================================================
// DASHBOARD - 3 ANA BUTON
// ============================================================

function switchDashboardPanel(panel) {

  document
    .querySelectorAll(
      ".dashboard-panel"
    )
    .forEach(
      el => {
        el.classList.add("hidden");
      }
    );


  document
    .querySelectorAll(
      ".dashboard-switch-btn"
    )
    .forEach(
      btn => {

        btn.classList.toggle(
          "active",
          btn.dataset.dashboardPanel === panel
        );

      }
    );


  if (panel === "overview") {

    $("dashboardOverviewPanel")
      ?.classList
      .remove("hidden");

  }


  if (panel === "points") {

    $("dashboardPointsPanel")
      ?.classList
      .remove("hidden");


    renderDashboardPointSummary();

    renderDashboardMap();


    setTimeout(
      () => {
        dashboardMap?.invalidateSize();
      },
      150
    );

  }


  if (panel === "tracking") {

    $("dashboardTrackingPanel")
      ?.classList
      .remove("hidden");


    renderTrackingChart();

  }
}


// ============================================================
// DASHBOARD NOKTA SAYILARI
// ============================================================

function renderDashboardPointSummary() {

  const planned =
    boreholeRecords
      .filter(
        x =>
          getStatusKey(
            x.status
          ) === "planned"
      )
      .length;


  const active =
    boreholeRecords
      .filter(
        x =>
          getStatusKey(
            x.status
          ) === "active"
      )
      .length;


  const review =
    boreholeRecords
      .filter(
        x =>
          getStatusKey(
            x.status
          ) === "review"
      )
      .length;


  const done =
    boreholeRecords
      .filter(
        x =>
          getStatusKey(
            x.status
          ) === "done"
      )
      .length;


  setText(
    "dashPointPlanned",
    planned
  );


  setText(
    "dashPointActive",
    active
  );


  setText(
    "dashPointReview",
    review
  );


  setText(
    "dashPointDone",
    done
  );
}


// ============================================================
// ANA NOKTALAR HARİTASI
// ============================================================

function renderDashboardMap() {

  if (
    !dashboardMap ||
    !mapsInitialized
  ) {
    return;
  }


  if (dashboardDataLayer) {

    dashboardMap.removeLayer(
      dashboardDataLayer
    );

  }


  dashboardDataLayer =
    L.layerGroup();


  const bounds = [];


  // TÜM İŞ SINIRLARI

  projects.forEach(
    p => {

      if (!p.boundary) return;


      const boundary =
        L.geoJSON(
          p.boundary,
          {
            style: {
              weight: 2,
              fillOpacity: 0.03
            }
          }
        );


      boundary.on(
        "click",
        () =>
          openProjectDetail(
            p.id
          )
      );


      boundary.addTo(
        dashboardDataLayer
      );


      try {

        const b =
          boundary.getBounds();

        if (b.isValid()) {
          bounds.push(b);
        }

      } catch {}

    }
  );


  // TÜM NOKTALAR

  boreholeRecords.forEach(
    point => {

      const lat =
        Number(
          point.latitude
        );


      const lng =
        Number(
          point.longitude
        );


      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
      ) {
        return;
      }


      const marker =
        L.circleMarker(
          [lat, lng],
          getPointMarkerStyle(
            point.status,
            point.point_type ||
            "Sondaj"
          )
        );


      const label =
        point.point_type === "Jeoteknik" &&
        point.method
          ? `${point.borehole_code} · ${point.method}`
          : point.borehole_code;


      marker.bindTooltip(
        escapeHtml(label),
        {
          direction: "top"
        }
      );


      marker.on(
        "click",
        () => {

          activeProjectId =
            point.project_id;


          openProjectDetail(
            point.project_id
          );


          setTimeout(
            () =>
              openBoreholeModal(
                point.id
              ),
            200
          );

        }
      );


      marker.addTo(
        dashboardDataLayer
      );


      bounds.push(
        L.latLngBounds(
          [[lat, lng]]
        )
      );

    }
  );


  dashboardDataLayer.addTo(
    dashboardMap
  );


  if (bounds.length) {

    let merged =
      bounds[0];


    bounds
      .slice(1)
      .forEach(
        b =>
          merged.extend(b)
      );


    dashboardMap.fitBounds(
      merged.pad(0.08),
      {
        maxZoom: 15
      }
    );

  }
}


// ============================================================
// İŞ TAKİP DİYAGRAMI
// ============================================================

function renderTrackingChart() {

  const el =
    $("trackingChart");


  if (!el) {
    return;
  }


  if (!projects.length) {

    el.innerHTML =
      `
      <div class="empty-state">
        Henüz iş bulunmuyor.
      </div>
      `;

    return;
  }


  el.innerHTML =
    projects
      .map(
        p => {

          const all =
            boreholeRecords
              .filter(
                b =>
                  b.project_id === p.id
              );


          const planned =
            all.filter(
              x =>
                getStatusKey(
                  x.status
                ) === "planned"
            ).length;


          const active =
            all.filter(
              x =>
                getStatusKey(
                  x.status
                ) === "active"
            ).length;


          const review =
            all.filter(
              x =>
                getStatusKey(
                  x.status
                ) === "review"
            ).length;


          const done =
            all.filter(
              x =>
                getStatusKey(
                  x.status
                ) === "done"
            ).length;


          const progress =
            getProjectProgress(
              p.id
            ).percent;


          return `

            <div
              class="track-row"
              data-project-id="${p.id}"
            >

              <div class="track-row-top">

                <strong>
                  ${escapeHtml(p.name)}
                </strong>

                <span>
                  %${progress}
                </span>

              </div>


              <div class="progress">

                <span
                  style="
                    width:${progress}%;
                    background:#22a06b;
                  "
                ></span>

              </div>


              <div
                style="
                  display:flex;
                  gap:12px;
                  flex-wrap:wrap;
                  margin-top:8px;
                  font-size:12px;
                "
              >

                <span style="color:#6c7a89">
                  ● ${planned} Planlandı
                </span>

                <span style="color:#b78d00">
                  ● ${active} Sahada
                </span>

                <span style="color:#3b82f6">
                  ● ${review} Kontrol
                </span>

                <span style="color:#22a06b">
                  ● ${done} Tamamlandı
                </span>

              </div>

            </div>

          `;

        }
      )
      .join("");


  document
    .querySelectorAll(
      ".track-row"
    )
    .forEach(
      row => {

        row.onclick =
          () =>
            openProjectDetail(
              row.dataset.projectId
            );

      }
    );
}


// ============================================================
// VIEW
// ============================================================

function switchView(view) {

  if (
    view === "users" &&
    currentRole !== "admin"
  ) {
    return;
  }


  document
    .querySelectorAll(".view")
    .forEach(
      v =>
        v.classList.remove(
          "active"
        )
    );


  $(view + "View")
    ?.classList
    .add("active");


  document
    .querySelectorAll(
      ".nav-item"
    )
    .forEach(
      v =>
        v.classList.remove(
          "active"
        )
    );


  if (view === "users") {

    document
      .querySelector(
        '.nav-item[data-view="users"]'
      )
      ?.classList
      .add("active");

  } else {

    document
      .querySelector(
        '.nav-item[data-view="dashboard"]'
      )
      ?.classList
      .add("active");

  }


  const titles = {

    dashboard: [
      "İşler",
      "Bir işi seçerek durum, harita ve saha noktalarına geçin."
    ],

    boreholes: [
      "İş Detayı",
      "İş durumu, harita ve saha işlemleri aynı ekranda."
    ],

    users: [
      "Yönetim",
      "Kullanıcı, firma ve yetki ayarlarını yönetin."
    ],

    projects: [
      "İşler",
      "İş listesini yönetin."
    ],

    map: [
      "Harita",
      "Çalışma alanlarını ve saha noktalarını yönetin."
    ]

  };


  setText(
    "pageTitle",
    titles[view]?.[0] ||
    ""
  );


  setText(
    "pageSubtitle",
    titles[view]?.[1] ||
    ""
  );


  $("newProjectBtn")
    ?.classList
    .toggle(
      "hidden",
      view === "boreholes" ||
      view === "users"
    );


  if (view === "dashboard") {

    setTimeout(
      () =>
        dashboardMap
          ?.invalidateSize(),
      150
    );

  }


  if (view === "boreholes") {

    renderProjectDetailSummary();

    setTimeout(
      () => {

        boreholeMap
          ?.invalidateSize();

        renderBoreholeMap();

      },
      150
    );

  }
}


// ============================================================
// PROJE DETAYINA GİR
// ============================================================

function openProjectDetail(
  projectId
) {

  const p =
    projects.find(
      x =>
        x.id === projectId
    );


  if (!p) {

    toast(
      "İş bulunamadı."
    );

    return;
  }


  activeProjectId =
    projectId;


  boreholeFilter =
    "all";


  renderProjectSelect();

  renderBoreholes();

  renderProjectDetailSummary();

  renderMapProject();

  renderBoreholeMap();


  switchView(
    "boreholes"
  );
}


// ============================================================
// PROJE DETAY ÖZETİ
// ============================================================

function renderProjectDetailSummary() {

  const p =
    projects.find(
      x =>
        x.id === activeProjectId
    );


  if (!p) return;


  const progress =
    getProjectProgress(
      p.id
    ).percent;


  const pointCount =
    boreholeRecords
      .filter(
        b =>
          b.project_id === p.id
      )
      .length;


  setText(
    "projectDetailTitle",
    p.name
  );


  setText(
    "projectDetailMeta",
    `${pointCount} saha noktası · ${p.company}`
  );


  setText(
    "projectDetailStatus",
    p.status ||
    "—"
  );


  setText(
    "projectDetailArea",
    `${Number(p.area).toLocaleString("tr-TR")} ha`
  );


  setText(
    "projectDetailCompany",
    p.company ||
    "—"
  );


  setText(
    "projectDetailProgress",
    `%${progress}`
  );


  setText(
    "detailBoundaryLayerInfo",
    p.boundaryLayerName
      ? `Yüklü: ${p.boundaryLayerName}`
      : "Yüklü çalışma alanı yok"
  );


  setText(
    "detailBoreholeLayerInfo",
    p.boreholesLayerName
      ? `Yüklü: ${p.boreholesLayerName}`
      : "Yüklü sondaj KML/KMZ yok"
  );


  if ($("detailDeleteBoundaryBtn")) {

    $("detailDeleteBoundaryBtn").disabled =
      !p.boundaryLayerId;

  }


  if ($("detailDeleteBoreholesBtn")) {

    $("detailDeleteBoreholesBtn").disabled =
      !p.boreholesLayerId;

  }
}


// ============================================================
// PROJE SELECT
// ============================================================

function renderProjectSelect() {

  const select =
    $("mapProjectSelect");


  if (!select) return;


  select.innerHTML =
    projects.length

      ? projects
          .map(
            p =>
              `
              <option value="${p.id}">
                ${escapeHtml(p.name)}
              </option>
              `
          )
          .join("")

      : `
        <option value="">
          İş yok
        </option>
        `;


  if (activeProjectId) {

    select.value =
      activeProjectId;

  }
}


// ============================================================
// İŞ DETAY NOKTA İSTATİSTİKLERİ
// ============================================================

function renderBoreholes() {

  const tbody =
    $("boreholesTableBody");


  if (!tbody) {
    return;
  }


  const allRows =
    boreholeRecords
      .filter(
        b =>
          b.project_id === activeProjectId
      );


  const planned =
    allRows
      .filter(
        b =>
          getStatusKey(
            b.status
          ) === "planned"
      )
      .length;


  const active =
    allRows
      .filter(
        b =>
          getStatusKey(
            b.status
          ) === "active"
      )
      .length;


  const review =
    allRows
      .filter(
        b =>
          getStatusKey(
            b.status
          ) === "review"
      )
      .length;


  const done =
    allRows
      .filter(
        b =>
          getStatusKey(
            b.status
          ) === "done"
      )
      .length;


  const sondajRows =
    allRows
      .filter(
        b =>
          (
            b.point_type ||
            "Sondaj"
          ) === "Sondaj"
      );


  const doneSondaj =
    sondajRows
      .filter(
        b =>
          getStatusKey(
            b.status
          ) === "done"
      )
      .length;


  const progress =
    sondajRows.length

      ? Math.round(
          (
            doneSondaj /
            sondajRows.length
          ) *
          100
        )

      : 0;


  setText(
    "bhStatTotal",
    allRows.length
  );


  setText(
    "bhStatPlanned",
    planned
  );


  setText(
    "bhStatActive",
    active
  );


  setText(
    "bhStatReview",
    review
  );


  setText(
    "bhStatDone",
    done
  );


  setText(
    "bhProgressText",
    `${doneSondaj} / ${sondajRows.length} sondaj tamamlandı · %${progress}`
  );


  if ($("bhProgressBar")) {

    $("bhProgressBar").style.width =
      `${progress}%`;

  }


  document
    .querySelectorAll(
      ".borehole-stat-card"
    )
    .forEach(
      card => {

        card.classList.toggle(
          "active",
          card.dataset.bhFilter === boreholeFilter
        );

      }
    );


  const rows =
    boreholeFilter === "all"

      ? allRows

      : allRows.filter(
          b =>
            (
              b.status ||
              "Planlandı"
            ) === boreholeFilter
        );


  if (!allRows.length) {

    tbody.innerHTML =
      `
      <tr>
        <td
          colspan="7"
          class="empty-state"
        >
          Bu iş için saha noktası bulunmuyor.
        </td>
      </tr>
      `;

    return;
  }


  if (!rows.length) {

    tbody.innerHTML =
      `
      <tr>
        <td
          colspan="7"
          class="empty-state"
        >
          Bu durumda saha noktası bulunmuyor.
        </td>
      </tr>
      `;

    return;
  }


  tbody.innerHTML =
    rows
      .map(
        b => {

          const lat =
            Number.isFinite(
              Number(
                b.latitude
              )
            )
              ? Number(
                  b.latitude
                ).toFixed(6)
              : "—";


          const lng =
            Number.isFinite(
              Number(
                b.longitude
              )
            )
              ? Number(
                  b.longitude
                ).toFixed(6)
              : "—";


          return `

            <tr>

              <td>
                <strong>
                  ${escapeHtml(b.borehole_code)}
                </strong>
              </td>


              <td>

                <span
                  class="
                    point-type-badge
                    ${
                      b.point_type === "Jeoteknik"
                        ? "geotech"
                        : "borehole"
                    }
                  "
                >
                  ${escapeHtml(b.point_type || "Sondaj")}

                  ${
                    b.method
                      ? " · " +
                        escapeHtml(b.method)
                      : ""
                  }

                </span>

              </td>


              <td>
                <small>
                  ${lat}, ${lng}
                </small>
              </td>


              <td>
                ${b.planned_depth_m ?? "—"} m
              </td>


              <td>
                ${b.actual_depth_m ?? "—"} m
              </td>


              <td>

                <span
                  class="
                    status
                    bh-status
                    ${getStatusKey(b.status)}
                  "
                >
                  ${escapeHtml(b.status || "Planlandı")}
                </span>

              </td>


              <td>

                <button
                  class="btn secondary borehole-detail-btn"
                  data-id="${b.id}"
                >
                  Detay / Saha Girişi
                </button>

              </td>

            </tr>

          `;

        }
      )
      .join("");


  document
    .querySelectorAll(
      ".borehole-detail-btn"
    )
    .forEach(
      btn => {

        btn.onclick =
          () =>
            openBoreholeModal(
              btn.dataset.id
            );

      }
    );
}


// ============================================================
// İŞ DETAY HARİTASI
// ============================================================

function renderBoreholeMap() {

  if (
    !boreholeMap ||
    !mapsInitialized
  ) {
    return;
  }


  if (boreholeBoundaryLayer) {

    boreholeMap.removeLayer(
      boreholeBoundaryLayer
    );

  }


  if (boreholePointsLayer) {

    boreholeMap.removeLayer(
      boreholePointsLayer
    );

  }


  boreholeBoundaryLayer = null;

  boreholePointsLayer = null;


  const p =
    projects.find(
      x =>
        x.id === activeProjectId
    );


  if (!p) return;


  const bounds = [];


  if (p.boundary) {

    boreholeBoundaryLayer =
      L.geoJSON(
        p.boundary,
        {
          style: {
            weight: 3,
            fillOpacity: 0.05
          }
        }
      )
        .addTo(
          boreholeMap
        );


    try {

      bounds.push(
        boreholeBoundaryLayer.getBounds()
      );

    } catch {}

  }


  const allRows =
    boreholeRecords
      .filter(
        b =>
          b.project_id === p.id
      );


  const rows =
    boreholeFilter === "all"

      ? allRows

      : allRows.filter(
          b =>
            (
              b.status ||
              "Planlandı"
            ) === boreholeFilter
        );


  if (rows.length) {

    boreholePointsLayer =
      L.layerGroup();


    rows.forEach(
      b => {

        const lat =
          Number(
            b.latitude
          );


        const lng =
          Number(
            b.longitude
          );


        if (
          !Number.isFinite(lat) ||
          !Number.isFinite(lng)
        ) {
          return;
        }


        const marker =
          L.circleMarker(
            [lat, lng],
            getPointMarkerStyle(
              b.status,
              b.point_type ||
              "Sondaj"
            )
          );


        const label =
          b.point_type === "Jeoteknik" &&
          b.method

            ? `${b.borehole_code} · ${b.method}`

            : b.borehole_code;


        marker.bindTooltip(
          escapeHtml(label),
          {
            permanent: true,
            direction: "right",
            offset: [8, 0],
            className: "borehole-label"
          }
        );


        marker.on(
          "click",
          () =>
            openBoreholeModal(
              b.id
            )
        );


        marker.addTo(
          boreholePointsLayer
        );

      }
    );


    boreholePointsLayer.addTo(
      boreholeMap
    );


    const coords =
      rows
        .filter(
          b =>
            Number.isFinite(
              Number(
                b.latitude
              )
            ) &&
            Number.isFinite(
              Number(
                b.longitude
              )
            )
        )
        .map(
          b => [
            Number(
              b.latitude
            ),
            Number(
              b.longitude
            )
          ]
        );


    if (coords.length) {

      const pointBounds =
        L.latLngBounds(
          coords
        );


      if (pointBounds.isValid()) {

        bounds.push(
          pointBounds
        );

      }

    }

  }


  const valid =
    bounds.filter(
      b =>
        b?.isValid?.()
    );


  if (valid.length) {

    const merged =
      valid[0];


    valid
      .slice(1)
      .forEach(
        b =>
          merged.extend(b)
      );


    boreholeMap.fitBounds(
      merged.pad(0.12),
      {
        maxZoom: 17
      }
    );

  }
}


// ============================================================
// ESKİ ANA HARİTA EKRANI
// ============================================================

function renderMapProject() {

  if (
    !mainMap ||
    !mapsInitialized
  ) {
    return;
  }


  if (mainBoundaryLayer) {

    mainMap.removeLayer(
      mainBoundaryLayer
    );

  }


  if (mainPointsLayer) {

    mainMap.removeLayer(
      mainPointsLayer
    );

  }


  mainBoundaryLayer = null;

  mainPointsLayer = null;


  const p =
    projects.find(
      x =>
        x.id === activeProjectId
    );


  if (!p) return;


  setText(
    "mapProjectName",
    p.name
  );


  setText(
    "mapProjectMeta",
    `${Number(p.area).toLocaleString("tr-TR")} ha · ${p.company}`
  );


  const points =
    boreholeRecords
      .filter(
        b =>
          b.project_id === p.id
      );


  const sondaj =
    points.filter(
      x =>
        (
          x.point_type ||
          "Sondaj"
        ) === "Sondaj"
    ).length;


  const geo =
    points.filter(
      x =>
        x.point_type === "Jeoteknik"
    ).length;


  setText(
    "mapBoreholeCount",
    geo
      ? `${sondaj} sondaj · ${geo} jeoteknik`
      : `${sondaj} sondaj`
  );


  setText(
    "boundaryLayerInfo",
    p.boundaryLayerName
      ? `Yüklü: ${p.boundaryLayerName}`
      : "Yüklü çalışma alanı yok"
  );


  setText(
    "boreholeLayerInfo",
    p.boreholesLayerName
      ? `Yüklü: ${p.boreholesLayerName}`
      : "Yüklü sondaj KML/KMZ yok"
  );


  const bounds = [];


  if (p.boundary) {

    mainBoundaryLayer =
      L.geoJSON(
        p.boundary,
        {
          style: {
            weight: 3,
            fillOpacity: 0.05
          }
        }
      )
        .addTo(
          mainMap
        );


    bounds.push(
      mainBoundaryLayer.getBounds()
    );

  }


  mainPointsLayer =
    L.layerGroup();


  points.forEach(
    point => {

      const lat =
        Number(
          point.latitude
        );


      const lng =
        Number(
          point.longitude
        );


      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
      ) {
        return;
      }


      const marker =
        L.circleMarker(
          [lat, lng],
          getPointMarkerStyle(
            point.status,
            point.point_type ||
            "Sondaj"
          )
        );


      marker.bindTooltip(
        escapeHtml(
          point.borehole_code
        ),
        {
          permanent: true,
          direction: "right",
          offset: [8, 0],
          className: "borehole-label"
        }
      );


      marker.on(
        "click",
        () =>
          openBoreholeModal(
            point.id
          )
      );


      marker.addTo(
        mainPointsLayer
      );

    }
  );


  mainPointsLayer.addTo(
    mainMap
  );


  const coords =
    points
      .filter(
        b =>
          Number.isFinite(
            Number(
              b.latitude
            )
          ) &&
          Number.isFinite(
            Number(
              b.longitude
            )
          )
      )
      .map(
        b => [
          Number(
            b.latitude
          ),
          Number(
            b.longitude
          )
        ]
      );


  if (coords.length) {

    bounds.push(
      L.latLngBounds(
        coords
      )
    );

  }


  const valid =
    bounds.filter(
      b =>
        b?.isValid?.()
    );


  if (valid.length) {

    const merged =
      valid[0];


    valid
      .slice(1)
      .forEach(
        b =>
          merged.extend(b)
      );


    mainMap.fitBounds(
      merged.pad(0.12),
      {
        maxZoom: 17
      }
    );

  }
}


// ============================================================
// YENİ SAHA NOKTASI
// ============================================================

function nextPointCode(type) {

  const prefix =
    type === "Jeoteknik"
      ? "JT-"
      : "SK-";


  const numbers =
    boreholeRecords

      .filter(
        b =>
          b.project_id === activeProjectId &&
          (
            b.point_type ||
            "Sondaj"
          ) === type
      )

      .map(
        b => {

          const match =
            String(
              b.borehole_code ||
              ""
            )
              .match(
                /(\d+)$/
              );


          return match
            ? Number(
                match[1]
              )
            : 0;

        }
      );


  return (
    prefix +
    String(
      Math.max(
        0,
        ...numbers
      ) +
      1
    )
      .padStart(
        2,
        "0"
      )
  );
}


function openPointModal(type) {

  if (!activeProjectId) {

    toast(
      "Önce bir iş seçin."
    );

    return;
  }


  if (!fieldPointSchemaAvailable) {

    toast(
      "Yeni saha noktası için Supabase saha noktaları SQL güncellemesi gerekiyor.",
      6000
    );

    return;
  }


  $("pointForm")?.reset();


  $("pointType").value =
    type;


  $("pointCode").value =
    nextPointCode(type);


  setText(
    "pointModalTitle",
    type === "Jeoteknik"
      ? "Yeni Jeoteknik Nokta"
      : "Yeni Sondaj Noktası"
  );


  $("pointMethodGroup")
    ?.classList
    .toggle(
      "hidden",
      type !== "Jeoteknik"
    );


  setText(
    "pointLocationAccuracy",
    "Konum doğruluğu: —"
  );


  $("pointModal")
    ?.classList
    .remove("hidden");


  pickingPointFromMap =
    false;


  $("pointCode")
    ?.focus();
}


function closePointModal() {

  $("pointModal")
    ?.classList
    .add("hidden");


  $("pointForm")
    ?.reset();


  pickingPointFromMap =
    false;
}


// ============================================================
// GPS
// ============================================================

function getDeviceLocation() {

  return new Promise(
    (
      resolve,
      reject
    ) => {

      if (!navigator.geolocation) {

        reject(
          new Error(
            "Bu cihaz konum bilgisini desteklemiyor."
          )
        );

        return;
      }


      navigator.geolocation
        .getCurrentPosition(

          position => {

            resolve({

              latitude:
                position.coords.latitude,

              longitude:
                position.coords.longitude,

              accuracy:
                position.coords.accuracy,

              capturedAt:
                new Date(
                  position.timestamp ||
                  Date.now()
                )
                  .toISOString()

            });

          },


          error => {

            reject(
              new Error(

                error.code === 1
                  ? "Konum izni verilmedi."

                  : error.code === 2
                    ? "Konum belirlenemedi."

                    : "Konum alınırken zaman aşımı oluştu."

              )
            );

          },


          {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 5000
          }

        );

    }
  );
}


function showLocationOnMap(location) {

  if (
    !boreholeMap ||
    !location
  ) {
    return;
  }


  if (locationMarker) {

    boreholeMap.removeLayer(
      locationMarker
    );

  }


  if (locationAccuracyCircle) {

    boreholeMap.removeLayer(
      locationAccuracyCircle
    );

  }


  locationMarker =
    L.circleMarker(
      [
        location.latitude,
        location.longitude
      ],
      {
        radius: 9,
        weight: 3,
        color: "#dc2626",
        fillColor: "#dc2626",
        fillOpacity: 0.9
      }
    )
      .addTo(
        boreholeMap
      )
      .bindTooltip(
        "Konumum",
        {
          permanent: true,
          direction: "top"
        }
      );


  if (
    Number.isFinite(
      Number(
        location.accuracy
      )
    )
  ) {

    locationAccuracyCircle =
      L.circle(
        [
          location.latitude,
          location.longitude
        ],
        {
          radius:
            Number(
              location.accuracy
            ),
          weight: 1,
          fillOpacity: 0.05
        }
      )
        .addTo(
          boreholeMap
        );

  }


  boreholeMap.setView(
    [
      location.latitude,
      location.longitude
    ],
    18
  );
}


async function locateMe(
  fillPointForm = false
) {

  try {

    setText(
      "currentLocationInfo",
      "Konum alınıyor..."
    );


    const location =
      await getDeviceLocation();


    currentLocation =
      location;


    const accuracy =
      Number.isFinite(
        Number(
          location.accuracy
        )
      )
        ? ` ±${Math.round(location.accuracy)} m`
        : "";


    setText(
      "currentLocationInfo",
      `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}${accuracy}`
    );


    showLocationOnMap(
      location
    );


    if (fillPointForm) {

      $("pointLat").value =
        location.latitude.toFixed(7);


      $("pointLng").value =
        location.longitude.toFixed(7);


      setText(
        "pointLocationAccuracy",
        `Konum doğruluğu: ${Math.round(location.accuracy || 0)} m`
      );

    }

  } catch (err) {

    setText(
      "currentLocationInfo",
      "Konum alınamadı"
    );


    toast(
      err.message ||
      "Konum alınamadı.",
      5000
    );

  }
}


function startPickPointFromMap() {

  if (!boreholeMap) {

    toast(
      "Harita hazır değil."
    );

    return;
  }


  pickingPointFromMap =
    true;


  // MODALI GEÇİCİ KAPAT
  // HARİTAYA TIKLANABİLSİN

  $("pointModal")
    ?.classList
    .add("hidden");


  toast(
    "Haritada yeni noktanın yerini tıklayın.",
    5000
  );
}


// ============================================================
// YENİ NOKTAYI KAYDET
// ============================================================

async function saveNewPoint(event) {

  event.preventDefault();


  if (!activeProjectId) {
    return;
  }


  const type =
    $("pointType").value ||
    "Sondaj";


  const lat =
    Number(
      $("pointLat").value
    );


  const lng =
    Number(
      $("pointLng").value
    );


  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {

    toast(
      "Geçerli koordinat girin."
    );

    return;
  }


  const sameAsGps =
    currentLocation &&

    Math.abs(
      currentLocation.latitude -
      lat
    ) <
    0.000001 &&

    Math.abs(
      currentLocation.longitude -
      lng
    ) <
    0.000001;


  const payload = {

    project_id:
      activeProjectId,

    borehole_code:
      $("pointCode")
        .value
        .trim(),

    point_type:
      type,

    method:
      type === "Jeoteknik"
        ? (
            $("pointMethod").value ||
            null
          )
        : null,

    latitude:
      lat,

    longitude:
      lng,

    status:
      "Planlandı",

    notes:
      $("pointNotes")
        .value
        .trim() ||
      null,

    location_accuracy_m:
      sameAsGps
        ? currentLocation.accuracy
        : null,

    location_captured_at:
      sameAsGps
        ? currentLocation.capturedAt
        : null,

    created_by:
      currentUser.id

  };


  try {

    const {
      error
    } =
      await sb
        .from("borehole_records")
        .insert(payload);


    if (error) {
      throw error;
    }


    if (type === "Sondaj") {

      await syncProjectProgress(
        activeProjectId
      );

    }


    closePointModal();


    await loadAppData();


    toast(
      type === "Jeoteknik"
        ? "Jeoteknik nokta eklendi."
        : "Sondaj noktası eklendi."
    );

  } catch (err) {

    console.error(err);


    toast(
      err.message ||
      "Saha noktası eklenemedi.",
      5000
    );

  }
}


// ============================================================
// NOKTA DETAY MODALI
// ============================================================

async function openBoreholeModal(id) {

  const b =
    boreholeRecords.find(
      x =>
        x.id === id
    );


  if (!b) {

    toast(
      "Saha noktası bulunamadı."
    );

    return;
  }


  activeBoreholeId =
    id;


  const p =
    projects.find(
      x =>
        x.id === b.project_id
    );


  setText(
    "boreholeModalTitle",
    b.borehole_code
  );


  setText(
    "boreholeModalSubtitle",
    p?.name ||
    "Saha Noktası"
  );


  $("bhCode").value =
    b.borehole_code ||
    "";


  $("bhPointType").value =
    b.point_type ||
    "Sondaj";


  $("bhMethod").value =
    b.method ||
    "—";


  $("bhLat").value =
    b.latitude ??
    "";


  $("bhLng").value =
    b.longitude ??
    "";


  $("bhPlannedDepth").value =
    b.planned_depth_m ??
    "";


  $("bhActualDepth").value =
    b.actual_depth_m ??
    "";


  $("bhStatus").value =
    b.status ||
    "Planlandı";


  $("bhNotes").value =
    b.notes ||
    "";


  $("boreholeModal")
    ?.classList
    .remove("hidden");


  await Promise.all([

    loadFieldEntries(id),

    loadBoreholeAttachments(id)

  ]);
}


function closeBoreholeModal() {

  $("boreholeModal")
    ?.classList
    .add("hidden");


  activeBoreholeId =
    null;


  $("boreholeForm")
    ?.reset();


  $("fieldEntryForm")
    ?.reset();


  if ($("boreholeFiles")) {

    $("boreholeFiles").value =
      "";

  }
}


// ============================================================
// NOKTAYI KAYDET
// ============================================================

async function saveBorehole(event) {

  event.preventDefault();


  if (!activeBoreholeId) {
    return;
  }


  const record =
    boreholeRecords.find(
      x =>
        x.id === activeBoreholeId
    );


  if (!record) {
    return;
  }


  const status =
    $("bhStatus").value;


  const payload = {

    planned_depth_m:
      $("bhPlannedDepth").value === ""
        ? null
        : Number(
            $("bhPlannedDepth").value
          ),

    actual_depth_m:
      $("bhActualDepth").value === ""
        ? null
        : Number(
            $("bhActualDepth").value
          ),

    status,

    notes:
      $("bhNotes")
        .value
        .trim() ||
      null,

    updated_at:
      new Date()
        .toISOString()

  };


  if (
    getStatusKey(status) === "active" &&
    !record.started_at
  ) {

    payload.started_at =
      new Date()
        .toISOString();

  }


  if (
    getStatusKey(status) === "done"
  ) {

    payload.completed_at =
      new Date()
        .toISOString();

  }


  try {

    const {
      error
    } =
      await sb
        .from("borehole_records")
        .update(payload)
        .eq(
          "id",
          activeBoreholeId
        );


    if (error) {
      throw error;
    }


    if (
      (
        record.point_type ||
        "Sondaj"
      ) === "Sondaj"
    ) {

      await syncProjectProgress(
        record.project_id
      );

    }


    toast(
      "Saha noktası kaydedildi."
    );


    await loadAppData();


    await openBoreholeModal(
      activeBoreholeId
    );

  } catch (err) {

    console.error(err);


    toast(
      err.message ||
      "Kayıt güncellenemedi.",
      5000
    );

  }
}


// ============================================================
// SAHA KAYITLARI
// ============================================================

async function loadFieldEntries(
  boreholeId
) {

  const {
    data,
    error
  } =
    await sb
      .from("field_entries")
      .select(
        "id,entry_type,depth_from_m,depth_to_m,value_text,notes,created_at"
      )
      .eq(
        "borehole_id",
        boreholeId
      )
      .order(
        "created_at",
        {
          ascending: false
        }
      );


  const list =
    $("fieldEntriesList");


  if (!list) {
    return;
  }


  if (error) {

    console.error(error);

    list.innerHTML =
      `
      <div class="empty-state">
        Saha kayıtları yüklenemedi.
      </div>
      `;

    return;
  }


  if (!data?.length) {

    list.innerHTML =
      `
      <div class="empty-state">
        Henüz saha kaydı yok.
      </div>
      `;

    return;
  }


  list.innerHTML =
    data
      .map(
        e => {

          const depth =
            e.depth_from_m != null ||
            e.depth_to_m != null

              ? `${e.depth_from_m ?? "?"} – ${e.depth_to_m ?? "?"} m`

              : "Derinlik yok";


          return `

            <article class="entry-card">

              <div>

                <strong>
                  ${escapeHtml(e.entry_type)}
                </strong>

                <span>
                  ${escapeHtml(depth)}
                </span>

              </div>


              <p>
                ${escapeHtml(e.value_text || e.notes || "—")}
              </p>


              <button
                class="entry-delete-btn"
                data-id="${e.id}"
                title="Kaydı sil"
              >
                ×
              </button>

            </article>

          `;

        }
      )
      .join("");


  document
    .querySelectorAll(
      ".entry-delete-btn"
    )
    .forEach(
      btn => {

        btn.onclick =
          () =>
            deleteFieldEntry(
              btn.dataset.id
            );

      }
    );
}


async function addFieldEntry(event) {

  event.preventDefault();


  if (!activeBoreholeId) {
    return;
  }


  try {

    const {
      error
    } =
      await sb
        .from("field_entries")
        .insert({

          borehole_id:
            activeBoreholeId,

          entry_type:
            $("entryType").value,

          depth_from_m:
            $("entryDepthFrom").value === ""
              ? null
              : Number(
                  $("entryDepthFrom").value
                ),

          depth_to_m:
            $("entryDepthTo").value === ""
              ? null
              : Number(
                  $("entryDepthTo").value
                ),

          value_text:
            $("entryValue")
              .value
              .trim() ||
            null,

          notes:
            $("entryNotes")
              .value
              .trim() ||
            null,

          created_by:
            currentUser.id

        });


    if (error) {
      throw error;
    }


    $("fieldEntryForm")
      .reset();


    toast(
      "Saha kaydı eklendi."
    );


    await loadFieldEntries(
      activeBoreholeId
    );

  } catch (err) {

    console.error(err);


    toast(
      err.message ||
      "Saha kaydı eklenemedi.",
      5000
    );

  }
}


async function deleteFieldEntry(id) {

  if (
    !window.confirm(
      "Bu saha kaydı silinsin mi?"
    )
  ) {
    return;
  }


  try {

    const {
      error
    } =
      await sb
        .from("field_entries")
        .delete()
        .eq(
          "id",
          id
        );


    if (error) {
      throw error;
    }


    await loadFieldEntries(
      activeBoreholeId
    );


    toast(
      "Saha kaydı silindi."
    );

  } catch (err) {

    toast(
      err.message ||
      "Kayıt silinemedi.",
      5000
    );

  }
}


// ============================================================
// DOSYALAR
// ============================================================

function safeFileName(
  name = "dosya"
) {

  return name

    .normalize("NFD")

    .replace(
      /[\u0300-\u036f]/g,
      ""
    )

    .replace(
      /[^a-zA-Z0-9._-]+/g,
      "_"
    );
}


async function uploadBoreholeFiles() {

  if (!activeBoreholeId) {
    return;
  }


  const files =
    [
      ...(
        $("boreholeFiles")
          ?.files ||
        []
      )
    ];


  if (!files.length) {

    toast(
      "Yüklenecek dosya seçilmedi."
    );

    return;
  }


  const record =
    boreholeRecords.find(
      x =>
        x.id === activeBoreholeId
    );


  if (!record) {
    return;
  }


  try {

    for (
      const file
      of files
    ) {

      const path =
        `${record.project_id}/${record.id}/${Date.now()}_${safeFileName(file.name)}`;


      const {
        error: uploadError
      } =
        await sb.storage
          .from("field-files")
          .upload(
            path,
            file,
            {
              upsert: false,
              contentType:
                file.type ||
                undefined
            }
          );


      if (uploadError) {
        throw uploadError;
      }


      const {
        error: dbError
      } =
        await sb
          .from("attachments")
          .insert({

            project_id:
              record.project_id,

            borehole_id:
              record.id,

            file_name:
              file.name,

            storage_path:
              path,

            mime_type:
              file.type ||
              null,

            size_bytes:
              file.size,

            uploaded_by:
              currentUser.id

          });


      if (dbError) {
        throw dbError;
      }

    }


    $("boreholeFiles").value =
      "";


    toast(
      `${files.length} dosya yüklendi.`
    );


    await loadBoreholeAttachments(
      activeBoreholeId
    );

  } catch (err) {

    console.error(err);


    toast(
      err.message ||
      "Dosya yüklenemedi.",
      5000
    );

  }
}


async function loadBoreholeAttachments(
  boreholeId
) {

  const {
    data,
    error
  } =
    await sb
      .from("attachments")
      .select(
        "id,file_name,storage_path,mime_type,size_bytes,created_at"
      )
      .eq(
        "borehole_id",
        boreholeId
      )
      .order(
        "created_at",
        {
          ascending: false
        }
      );


  const list =
    $("boreholeFilesList");


  if (!list) {
    return;
  }


  if (error) {

    list.innerHTML =
      `
      <div class="empty-state">
        Dosyalar yüklenemedi.
      </div>
      `;

    return;
  }


  if (!data?.length) {

    list.innerHTML =
      `
      <div class="empty-state">
        Henüz dosya yok.
      </div>
      `;

    return;
  }


  const html = [];


  for (
    const file
    of data
  ) {

    const {
      data: signed
    } =
      await sb.storage
        .from("field-files")
        .createSignedUrl(
          file.storage_path,
          3600
        );


    const url =
      signed?.signedUrl ||
      "#";


    const size =
      file.size_bytes

        ? (
            Number(
              file.size_bytes
            ) /
            1024 /
            1024
          ).toFixed(2) +
          " MB"

        : "";


    html.push(`

      <div class="attachment-card">

        <a
          class="attachment-main"
          href="${url}"
          target="_blank"
          rel="noopener"
        >

          <strong>
            ${escapeHtml(file.file_name)}
          </strong>

          <span>
            ${escapeHtml(size)}
          </span>

        </a>


        <div class="attachment-actions">

          <button
            class="btn ghost mini rename-attachment-btn"
            data-id="${file.id}"
            data-name="${encodeURIComponent(file.file_name)}"
            type="button"
          >
            Düzenle
          </button>


          <button
            class="btn danger mini delete-attachment-btn"
            data-id="${file.id}"
            data-path="${encodeURIComponent(file.storage_path)}"
            type="button"
          >
            Sil
          </button>

        </div>

      </div>

    `);

  }


  list.innerHTML =
    html.join("");


  document
    .querySelectorAll(
      ".rename-attachment-btn"
    )
    .forEach(
      btn => {

        btn.onclick =
          () =>
            renameAttachment(
              btn.dataset.id,
              decodeURIComponent(
                btn.dataset.name
              )
            );

      }
    );


  document
    .querySelectorAll(
      ".delete-attachment-btn"
    )
    .forEach(
      btn => {

        btn.onclick =
          () =>
            deleteAttachment(
              btn.dataset.id,
              decodeURIComponent(
                btn.dataset.path
              )
            );

      }
    );
}


async function renameAttachment(
  id,
  currentName
) {

  const next =
    window.prompt(
      "Dosya adını değiştir:",
      currentName
    );


  if (next === null) {
    return;
  }


  const clean =
    next.trim();


  if (!clean) {
    return;
  }


  const {
    error
  } =
    await sb
      .from("attachments")
      .update({
        file_name:
          clean
      })
      .eq(
        "id",
        id
      );


  if (error) {

    toast(
      error.message,
      5000
    );

    return;
  }


  await loadBoreholeAttachments(
    activeBoreholeId
  );


  toast(
    "Dosya adı güncellendi."
  );
}


async function deleteAttachment(
  id,
  storagePath
) {

  if (
    !window.confirm(
      "Bu fotoğraf/belge silinsin mi?"
    )
  ) {
    return;
  }


  const {
    error: storageError
  } =
    await sb.storage
      .from("field-files")
      .remove([
        storagePath
      ]);


  if (storageError) {

    toast(
      storageError.message,
      5000
    );

    return;
  }


  const {
    error
  } =
    await sb
      .from("attachments")
      .delete()
      .eq(
        "id",
        id
      );


  if (error) {

    toast(
      error.message,
      5000
    );

    return;
  }


  await loadBoreholeAttachments(
    activeBoreholeId
  );


  toast(
    "Dosya silindi."
  );
}


// ============================================================
// KML / KMZ
// ============================================================

async function fileToGeoJSON(file) {

  if (!file) {

    throw new Error(
      "Dosya seçilmedi."
    );

  }


  const lower =
    file.name.toLowerCase();


  let kmlText =
    "";


  if (
    lower.endsWith(
      ".kml"
    )
  ) {

    kmlText =
      await file.text();

  } else if (
    lower.endsWith(
      ".kmz"
    )
  ) {

    const zip =
      await JSZip.loadAsync(
        await file.arrayBuffer()
      );


    const kmlName =
      Object.keys(
        zip.files
      )
        .find(
          name =>
            name
              .toLowerCase()
              .endsWith(".kml")
        );


    if (!kmlName) {

      throw new Error(
        "KMZ içinde KML bulunamadı."
      );

    }


    kmlText =
      await zip.files[kmlName]
        .async("text");

  } else {

    throw new Error(
      "Yalnızca KML veya KMZ yükleyin."
    );

  }


  const xml =
    new DOMParser()
      .parseFromString(
        kmlText,
        "text/xml"
      );


  if (
    xml.querySelector(
      "parsererror"
    )
  ) {

    throw new Error(
      "KML okunamadı."
    );

  }


  const geojson =
    toGeoJSON.kml(xml);


  if (
    !geojson?.features?.length
  ) {

    throw new Error(
      "Dosyada harita verisi bulunamadı."
    );

  }


  return geojson;
}


async function replaceProjectLayer(
  projectId,
  layerType,
  fileName,
  geojson
) {

  const {
    error: deleteError
  } =
    await sb
      .from("project_layers")
      .delete()
      .eq(
        "project_id",
        projectId
      )
      .eq(
        "layer_type",
        layerType
      );


  if (deleteError) {
    throw deleteError;
  }


  const {
    error
  } =
    await sb
      .from("project_layers")
      .insert({

        project_id:
          projectId,

        layer_type:
          layerType,

        name:
          fileName,

        geojson,

        created_by:
          currentUser.id

      });


  if (error) {
    throw error;
  }
}


function boreholeCode(
  feature,
  index
) {

  const p =
    feature.properties ||
    {};


  return String(

    p.name ||
    p.Name ||
    p.NAME ||
    p.id ||
    p.ID ||
    `SK-${index + 1}`

  ).trim();
}


async function syncBoreholeRecords(
  projectId,
  geojson
) {

  const {
    data: existingRows,
    error
  } =
    await sb
      .from("borehole_records")
      .select(
        "id,borehole_code"
      )
      .eq(
        "project_id",
        projectId
      );


  if (error) {
    throw error;
  }


  const existing =
    new Map(
      (existingRows || [])
        .map(
          r => [
            String(
              r.borehole_code
            ),
            r
          ]
        )
    );


  const inserts = [];


  for (
    let i = 0;
    i < geojson.features.length;
    i++
  ) {

    const feature =
      geojson.features[i];


    if (
      feature.geometry?.type !== "Point"
    ) {
      continue;
    }


    const [
      longitude,
      latitude
    ] =
      feature.geometry.coordinates ||
      [];


    const code =
      boreholeCode(
        feature,
        i
      );


    const old =
      existing.get(
        code
      );


    if (old) {

      const {
        error
      } =
        await sb
          .from("borehole_records")
          .update({
            longitude,
            latitude
          })
          .eq(
            "id",
            old.id
          );


      if (error) {
        throw error;
      }

    } else {

      inserts.push({

        project_id:
          projectId,

        borehole_code:
          code,

        longitude,

        latitude,

        point_type:
          "Sondaj",

        status:
          "Planlandı",

        created_by:
          currentUser.id

      });

    }

  }


  if (inserts.length) {

    const {
      error
    } =
      await sb
        .from("borehole_records")
        .insert(
          inserts
        );


    if (error) {
      throw error;
    }

  }


  await syncProjectProgress(
    projectId
  );
}


async function importLayer(
  kind,
  inputId = null
) {

  if (
    currentRole !== "admin"
  ) {

    toast(
      "Bu işlem yalnızca Yönetici rolüne açık."
    );

    return;
  }


  const p =
    projects.find(
      x =>
        x.id === activeProjectId
    );


  if (!p) {

    toast(
      "Önce bir iş seçin."
    );

    return;
  }


  const input =
    inputId
      ? $(inputId)
      : (
          kind === "boundary"
            ? $("boundaryFile")
            : $("boreholeFile")
        );


  const file =
    input?.files?.[0];


  if (!file) {

    toast(
      "Önce KML/KMZ dosyası seçin."
    );

    return;
  }


  try {

    const raw =
      await fileToGeoJSON(
        file
      );


    if (
      kind === "boundary"
    ) {

      const features =
        raw.features
          .filter(
            f =>
              [
                "Polygon",
                "MultiPolygon"
              ]
                .includes(
                  f.geometry?.type
                )
          );


      if (!features.length) {

        throw new Error(
          "Çalışma alanı poligonu bulunamadı."
        );

      }


      await replaceProjectLayer(

        p.id,

        "boundary",

        file.name,

        {
          type:
            "FeatureCollection",
          features
        }

      );


      toast(
        "Çalışma alanı yüklendi."
      );

    } else {

      const features =
        raw.features
          .filter(
            f =>
              [
                "Point",
                "MultiPoint"
              ]
                .includes(
                  f.geometry?.type
                )
          );


      if (!features.length) {

        throw new Error(
          "Sondaj noktası bulunamadı."
        );

      }


      const geojson = {
        type:
          "FeatureCollection",
        features
      };


      await replaceProjectLayer(

        p.id,

        "boreholes",

        file.name,

        geojson

      );


      await syncBoreholeRecords(
        p.id,
        geojson
      );


      toast(
        `${features.length} sondaj noktası yüklendi.`
      );

    }


    input.value =
      "";


    await loadAppData();

  } catch (err) {

    console.error(err);


    toast(
      err.message ||
      "Dosya içe aktarılamadı.",
      5000
    );

  }
}


async function deleteProjectLayer(
  layerType
) {

  const p =
    projects.find(
      x =>
        x.id === activeProjectId
    );


  if (!p) return;


  const id =
    layerType === "boundary"
      ? p.boundaryLayerId
      : p.boreholesLayerId;


  if (!id) {

    toast(
      "Silinecek katman bulunamadı."
    );

    return;
  }


  const message =
    layerType === "boreholes"

      ? "Sondaj KML/KMZ katmanı silinsin mi?\n\nSaha kayıtları korunacaktır."

      : "Çalışma alanı KML/KMZ katmanı silinsin mi?";


  if (
    !window.confirm(
      message
    )
  ) {
    return;
  }


  const {
    error
  } =
    await sb
      .from("project_layers")
      .delete()
      .eq(
        "id",
        id
      );


  if (error) {

    toast(
      error.message,
      5000
    );

    return;
  }


  await loadAppData();


  toast(
    "Katman silindi."
  );
}


// ============================================================
// PROJE OLUŞTUR / DÜZENLE
// ============================================================

async function getOrCreateCompany(
  name
) {

  const clean =
    String(
      name ||
      "Firma Atanmamış"
    )
      .trim();


  const {
    data: existing,
    error
  } =
    await sb
      .from("companies")
      .select("id,name")
      .eq(
        "name",
        clean
      )
      .maybeSingle();


  if (error) {
    throw error;
  }


  if (existing) {
    return existing;
  }


  const {
    data,
    error: createError
  } =
    await sb
      .from("companies")
      .insert({
        name:
          clean
      })
      .select(
        "id,name"
      )
      .single();


  if (createError) {
    throw createError;
  }


  return data;
}


function openModal() {

  if (
    currentRole !== "admin"
  ) {
    return;
  }


  editingProjectId =
    null;


  setText(
    "projectModalTitle",
    "Yeni İş Oluştur"
  );


  setText(
    "projectModalSubtitle",
    "İş bilgilerini girin."
  );


  setText(
    "projectSaveBtn",
    "İşi Kaydet"
  );


  $("projectForm")
    ?.reset();


  $("projectModal")
    ?.classList
    .remove("hidden");


  $("projectName")
    ?.focus();
}


function openEditModal(id) {

  if (
    currentRole !== "admin"
  ) {
    return;
  }


  const p =
    projects.find(
      x =>
        x.id === id
    );


  if (!p) return;


  editingProjectId =
    p.id;


  setText(
    "projectModalTitle",
    "İşi Düzenle"
  );


  setText(
    "projectModalSubtitle",
    "İş bilgilerini güncelleyin."
  );


  setText(
    "projectSaveBtn",
    "Değişiklikleri Kaydet"
  );


  $("projectName").value =
    p.name ||
    "";


  $("projectArea").value =
    Number(
      p.area ||
      0
    );


  $("projectCompany").value =
    p.company === "Firma atanmadı"
      ? ""
      : p.company;


  $("projectStatus").value =
    p.status ||
    "Planlandı";


  $("projectModal")
    ?.classList
    .remove("hidden");
}


function closeModal() {

  $("projectModal")
    ?.classList
    .add("hidden");


  $("projectForm")
    ?.reset();


  editingProjectId =
    null;
}


async function saveProject(event) {

  event.preventDefault();


  if (
    currentRole !== "admin"
  ) {
    return;
  }


  try {

    const company =
      await getOrCreateCompany(
        $("projectCompany").value
      );


    const payload = {

      short_name:
        $("projectName")
          .value
          .trim(),

      area_ha:
        Number(
          $("projectArea").value
        ),

      company_id:
        company.id,

      status:
        $("projectStatus").value

    };


    if (editingProjectId) {

      const {
        error
      } =
        await sb
          .from("projects")
          .update(payload)
          .eq(
            "id",
            editingProjectId
          );


      if (error) {
        throw error;
      }


      activeProjectId =
        editingProjectId;


      toast(
        "İş güncellendi."
      );

    } else {

      const {
        data,
        error
      } =
        await sb
          .from("projects")
          .insert({
            ...payload,
            progress: 0,
            created_by:
              currentUser.id
          })
          .select("id")
          .single();


      if (error) {
        throw error;
      }


      activeProjectId =
        data.id;


      toast(
        "Yeni iş oluşturuldu."
      );

    }


    closeModal();


    await loadAppData();

  } catch (err) {

    toast(
      err.message ||
      "İş kaydedilemedi.",
      5000
    );

  }
}


async function deleteProject(id) {

  if (
    currentRole !== "admin"
  ) {
    return;
  }


  const p =
    projects.find(
      x =>
        x.id === id
    );


  if (!p) return;


  if (
    !window.confirm(
      `"${p.name}" işi silinsin mi?`
    )
  ) {
    return;
  }


  const {
    error
  } =
    await sb
      .from("projects")
      .delete()
      .eq(
        "id",
        id
      );


  if (error) {

    toast(
      error.message,
      5000
    );

    return;
  }


  activeProjectId =
    null;


  await loadAppData();


  switchView(
    "dashboard"
  );


  toast(
    "İş silindi."
  );
}


// ============================================================
// EXCEL
// ============================================================

function normalizeHeader(value = "") {

  return String(value)

    .trim()

    .toLocaleLowerCase(
      "tr-TR"
    )

    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")

    .replace(
      /[^a-z0-9]+/g,
      " "
    )

    .trim();
}


function firstValue(
  row,
  aliases
) {

  const entries =
    Object.entries(
      row ||
      {}
    );


  const normalizedAliases =
    aliases.map(
      normalizeHeader
    );


  for (
    const [
      key,
      value
    ]
    of entries
  ) {

    if (
      normalizedAliases
        .includes(
          normalizeHeader(key)
        ) &&

      value !== "" &&
      value != null
    ) {

      return value;

    }

  }


  return "";
}


function parseNumberTR(value) {

  if (
    typeof value === "number"
  ) {
    return value;
  }


  const text =
    String(
      value ??
      ""
    )
      .trim()
      .replace(
        /\s/g,
        ""
      );


  if (!text) {
    return 0;
  }


  if (
    text.includes(",") &&
    text.includes(".")
  ) {

    return (
      Number(
        text
          .replace(
            /\./g,
            ""
          )
          .replace(
            ",",
            "."
          )
      ) ||
      0
    );

  }


  if (text.includes(",")) {

    return (
      Number(
        text.replace(
          ",",
          "."
        )
      ) ||
      0
    );

  }


  return (
    Number(text) ||
    0
  );
}


function formatAreaLabel(area) {

  if (
    !Number.isFinite(area) ||
    area <= 0
  ) {

    return "? ha";

  }


  return (
    area.toLocaleString(
      "tr-TR",
      {
        maximumFractionDigits: 2
      }
    ) +
    " ha"
  );
}


function extractNeighborhoodFromTitle(
  title = ""
) {

  const text =
    String(title)
      .replace(
        /[’‘`]/g,
        "'"
      );


  let m =
    text.match(
      /İlçe(?:si|leri)\s*,?\s*(.+?)\s+Mahalle(?:si|leri|lerinde|sinde|si'nde|leri'nde)/i
    );


  if (m?.[1]) {

    return m[1]
      .replace(
        /^\s*,/,
        ""
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  }


  m =
    text.match(
      /(?:^|,)\s*([^,.;]+?)\s+Mahalle(?:si|leri|lerinde|sinde|si'nde|leri'nde)/i
    );


  return (
    m?.[1]
      ?.trim() ||
    ""
  );
}


function projectNameFromRow(
  row,
  index
) {

  const district =
    String(

      firstValue(
        row,
        [
          "İlçe",
          "Ilce",
          "İlçeler",
          "Ilceler"
        ]
      ) ||

      "İlçe belirtilmedi"

    ).trim();


  const area =
    parseNumberTR(

      firstValue(
        row,
        [
          "Hektar",
          "Ha",
          "Alan (ha)",
          "Alan Ha",
          "Alan"
        ]
      )

    );


  const title =
    firstValue(
      row,
      [
        "İş Adı / Konu",
        "İş Adı",
        "İşin Adı",
        "Konu",
        "Proje Adı"
      ]
    );


  const neighborhood =
    extractNeighborhoodFromTitle(
      title
    ) ||
    "Genel";


  return (
    `${district} - ${neighborhood} - ${formatAreaLabel(area)}`
  );
}


async function importProjectsFromExcel(file) {

  if (
    currentRole !== "admin"
  ) {
    return;
  }


  try {

    const buffer =
      await file.arrayBuffer();


    const workbook =
      XLSX.read(
        buffer,
        {
          type: "array",
          cellDates: true
        }
      );


    const sheet =
      workbook.Sheets[
        workbook.SheetNames[0]
      ];


    const matrix =
      XLSX.utils.sheet_to_json(
        sheet,
        {
          header: 1,
          defval: ""
        }
      );


    let headerRow =
      matrix.findIndex(
        row => {

          const normalized =
            row.map(
              normalizeHeader
            );


          return (
            normalized.includes(
              "is no"
            ) &&
            (
              normalized.includes(
                "hektar"
              ) ||
              normalized.includes(
                "durum"
              )
            )
          );

        }
      );


    if (headerRow < 0) {
      headerRow = 0;
    }


    const rows =
      XLSX.utils.sheet_to_json(
        sheet,
        {
          range:
            headerRow,
          defval:
            ""
        }
      );


    let added = 0;

    let updated = 0;


    for (
      let i = 0;
      i < rows.length;
      i++
    ) {

      const row =
        rows[i];


      const sourceNo =
        String(
          firstValue(
            row,
            [
              "İş No",
              "İş Numarası",
              "Evrak Kodu"
            ]
          ) ||
          ""
        )
          .trim();


      const name =
        projectNameFromRow(
          row,
          i
        );


      const area =
        parseNumberTR(
          firstValue(
            row,
            [
              "Hektar",
              "Ha",
              "Alan (ha)",
              "Alan"
            ]
          )
        );


      const companyName =
        String(
          firstValue(
            row,
            [
              "Firma",
              "Firma Adı",
              "Yüklenici",
              "Yüklenici Firma"
            ]
          ) ||
          "Firma Atanmamış"
        )
          .trim();


      const status =
        String(
          firstValue(
            row,
            [
              "Durum",
              "Aşama",
              "İş Durumu",
              "Süreç"
            ]
          ) ||
          "Planlandı"
        )
          .trim();


      const company =
        await getOrCreateCompany(
          companyName
        );


      const existing =
        projects.find(
          p => {

            const current =
              normalizeHeader(
                p.name
              );


            return (
              current ===
              normalizeHeader(
                name
              ) ||

              (
                sourceNo &&
                current ===
                normalizeHeader(
                  sourceNo
                )
              )
            );

          }
        );


      if (existing) {

        await sb
          .from("projects")
          .update({

            short_name:
              name,

            area_ha:
              area,

            company_id:
              company.id,

            status

          })
          .eq(
            "id",
            existing.id
          );


        updated++;

      } else {

        await sb
          .from("projects")
          .insert({

            short_name:
              name,

            area_ha:
              area,

            company_id:
              company.id,

            status,

            progress:
              0,

            created_by:
              currentUser.id

          });


        added++;

      }

    }


    await loadAppData();


    toast(
      `Excel aktarımı tamamlandı: ${added} yeni, ${updated} güncellendi.`,
      6000
    );

  } catch (err) {

    console.error(err);


    toast(
      err.message ||
      "Excel aktarılamadı.",
      6000
    );

  } finally {

    if ($("excelImportInput")) {

      $("excelImportInput").value =
        "";

    }

  }
}


function exportProjectsToExcel() {

  if (
    currentRole !== "admin"
  ) {
    return;
  }


  const rows =
    projects.map(
      p => ({

        "İş":
          p.name,

        "Hektar":
          p.area,

        "Firma":
          p.company,

        "Durum":
          p.status,

        "İlerleme (%)":
          getProjectProgress(
            p.id
          ).percent,

        "Sondaj":
          boreholeRecords.filter(
            b =>
              b.project_id === p.id &&
              (
                b.point_type ||
                "Sondaj"
              ) === "Sondaj"
          ).length,

        "Jeoteknik":
          boreholeRecords.filter(
            b =>
              b.project_id === p.id &&
              b.point_type === "Jeoteknik"
          ).length

      })
    );


  const sheet =
    XLSX.utils.json_to_sheet(
      rows
    );


  const book =
    XLSX.utils.book_new();


  XLSX.utils.book_append_sheet(
    book,
    sheet,
    "İşler"
  );


  const date =
    new Date()
      .toISOString()
      .slice(
        0,
        10
      );


  XLSX.writeFile(
    book,
    `JEO_Isler_${date}.xlsx`
  );
}


// ============================================================
// YAN PANEL
// ============================================================

function toggleAppSidebar() {

  const shell =
    $("appShell");


  if (!shell) return;


  const collapsed =
    shell.classList.toggle(
      "sidebar-collapsed"
    );


  setText(
    "toggleAppSidebarBtn",
    collapsed
      ? "›"
      : "‹"
  );


  localStorage.setItem(
    "je_sidebar_collapsed",
    collapsed
      ? "1"
      : "0"
  );


  setTimeout(
    () => {

      mainMap?.invalidateSize();

      dashboardMap?.invalidateSize();

      boreholeMap?.invalidateSize();

    },
    250
  );
}


function toggleMapSidebar() {

  const layout =
    document.querySelector(
      "#mapView .map-layout"
    );


  if (!layout) return;


  const collapsed =
    layout.classList.toggle(
      "map-sidebar-collapsed"
    );


  setText(
    "toggleMapSidebarBtn",
    collapsed
      ? "›"
      : "‹"
  );


  setTimeout(
    () =>
      mainMap?.invalidateSize(),
    250
  );
}


// ============================================================
// EVENTS
// ============================================================

function wireEvents() {

  // SOL MENÜ

  document
    .querySelectorAll(
      ".nav-item"
    )
    .forEach(
      btn => {

        btn.addEventListener(
          "click",
          () =>
            switchView(
              btn.dataset.view
            )
        );

      }
    );


  // DASHBOARD 3 BUTON

  document
    .querySelectorAll(
      ".dashboard-switch-btn"
    )
    .forEach(
      btn => {

        btn.addEventListener(
          "click",
          () =>
            switchDashboardPanel(
              btn.dataset.dashboardPanel
            )
        );

      }
    );


  // LOGIN

  $("loginForm")
    ?.addEventListener(
      "submit",
      async e => {

        e.preventDefault();


        setLoginMessage("");


        const {
          data,
          error
        } =
          await sb.auth
            .signInWithPassword({

              email:
                $("loginEmail")
                  .value
                  .trim(),

              password:
                $("loginPassword")
                  .value

            });


        if (error) {

          setLoginMessage(
            error.message,
            true
          );

          return;
        }


        $("loginForm")
          .reset();


        await enterSession(
          data.user
        );

      }
    );


  // LOGOUT

  $("logoutBtn")
    ?.addEventListener(
      "click",
      async () => {

        await sb.auth.signOut();

        currentUser =
          null;

        currentProfile =
          null;

        currentRole =
          null;

        projects =
          [];

        boreholeRecords =
          [];

        showAuth();

      }
    );


  // YENİ İŞ

  if ($("newProjectBtn")) {
    $("newProjectBtn").onclick =
      openModal;
  }


  if ($("newProjectBtn2")) {
    $("newProjectBtn2").onclick =
      openModal;
  }


  // EXCEL

  if ($("dashboardExcelImportBtn")) {

    $("dashboardExcelImportBtn").onclick =
      () =>
        $("excelImportInput")
          ?.click();

  }


  if ($("dashboardExcelExportBtn")) {

    $("dashboardExcelExportBtn").onclick =
      exportProjectsToExcel;

  }


  if ($("excelImportBtn")) {

    $("excelImportBtn").onclick =
      () =>
        $("excelImportInput")
          ?.click();

  }


  if ($("excelExportBtn")) {

    $("excelExportBtn").onclick =
      exportProjectsToExcel;

  }


  $("excelImportInput")
    ?.addEventListener(
      "change",
      async e => {

        const file =
          e.target.files?.[0];


        if (file) {

          await importProjectsFromExcel(
            file
          );

        }

      }
    );


  // PROJE MODALI

  if ($("closeModalBtn")) {

    $("closeModalBtn").onclick =
      closeModal;

  }


  if ($("cancelModalBtn")) {

    $("cancelModalBtn").onclick =
      closeModal;

  }


  $("projectModal")
    ?.addEventListener(
      "click",
      e => {

        if (
          e.target.id === "projectModal"
        ) {

          closeModal();

        }

      }
    );


  $("projectForm")
    ?.addEventListener(
      "submit",
      saveProject
    );


  // İŞ DETAY

  if ($("backToJobsBtn")) {

    $("backToJobsBtn").onclick =
      () =>
        switchView(
          "dashboard"
        );

  }


  if ($("editCurrentProjectBtn")) {

    $("editCurrentProjectBtn").onclick =
      () => {

        if (activeProjectId) {

          openEditModal(
            activeProjectId
          );

        }

      };

  }


  // NOKTA FİLTRELERİ

  document
    .querySelectorAll(
      ".borehole-stat-card"
    )
    .forEach(
      card => {

        card.addEventListener(
          "click",
          () => {

            boreholeFilter =
              card.dataset.bhFilter ||
              "all";


            renderBoreholes();

            renderBoreholeMap();

          }
        );

      }
    );


  // GPS

  if ($("locateMeBtn")) {

    $("locateMeBtn").onclick =
      () =>
        locateMe(false);

  }


  // YENİ NOKTA

  if ($("addBoreholePointBtn")) {

    $("addBoreholePointBtn").onclick =
      () =>
        openPointModal(
          "Sondaj"
        );

  }


  if ($("addGeotechnicalPointBtn")) {

    $("addGeotechnicalPointBtn").onclick =
      () =>
        openPointModal(
          "Jeoteknik"
        );

  }


  if ($("closePointModalBtn")) {

    $("closePointModalBtn").onclick =
      closePointModal;

  }


  if ($("cancelPointModalBtn")) {

    $("cancelPointModalBtn").onclick =
      closePointModal;

  }


  if ($("useCurrentLocationBtn")) {

    $("useCurrentLocationBtn").onclick =
      () =>
        locateMe(true);

  }


  if ($("pickPointFromMapBtn")) {

    $("pickPointFromMapBtn").onclick =
      startPickPointFromMap;

  }


  $("pointForm")
    ?.addEventListener(
      "submit",
      saveNewPoint
    );


  // NOKTA DETAY

  if ($("closeBoreholeModalBtn")) {

    $("closeBoreholeModalBtn").onclick =
      closeBoreholeModal;

  }


  if ($("cancelBoreholeModalBtn")) {

    $("cancelBoreholeModalBtn").onclick =
      closeBoreholeModal;

  }


  $("boreholeForm")
    ?.addEventListener(
      "submit",
      saveBorehole
    );


  $("fieldEntryForm")
    ?.addEventListener(
      "submit",
      addFieldEntry
    );


  if ($("uploadBoreholeFilesBtn")) {

    $("uploadBoreholeFilesBtn").onclick =
      uploadBoreholeFiles;

  }


  // KML DETAY EKRANI

  if ($("detailImportBoundaryBtn")) {

    $("detailImportBoundaryBtn").onclick =
      () =>
        importLayer(
          "boundary",
          "detailBoundaryFile"
        );

  }


  if ($("detailImportBoreholesBtn")) {

    $("detailImportBoreholesBtn").onclick =
      () =>
        importLayer(
          "borehole",
          "detailBoreholeFile"
        );

  }


  if ($("detailDeleteBoundaryBtn")) {

    $("detailDeleteBoundaryBtn").onclick =
      () =>
        deleteProjectLayer(
          "boundary"
        );

  }


  if ($("detailDeleteBoreholesBtn")) {

    $("detailDeleteBoreholesBtn").onclick =
      () =>
        deleteProjectLayer(
          "boreholes"
        );

  }


  // ESKİ HARİTA EKRANI

  if ($("importBoundaryBtn")) {

    $("importBoundaryBtn").onclick =
      () =>
        importLayer(
          "boundary"
        );

  }


  if ($("importBoreholesBtn")) {

    $("importBoreholesBtn").onclick =
      () =>
        importLayer(
          "borehole"
        );

  }


  if ($("deleteBoundaryLayerBtn")) {

    $("deleteBoundaryLayerBtn").onclick =
      () =>
        deleteProjectLayer(
          "boundary"
        );

  }


  if ($("deleteBoreholeLayerBtn")) {

    $("deleteBoreholeLayerBtn").onclick =
      () =>
        deleteProjectLayer(
          "boreholes"
        );

  }


  if ($("toggleMapSidebarBtn")) {

    $("toggleMapSidebarBtn").onclick =
      toggleMapSidebar;

  }


  if ($("toggleAppSidebarBtn")) {

    $("toggleAppSidebarBtn").onclick =
      toggleAppSidebar;

  }


  // ESKİ MAP SELECT

  $("mapProjectSelect")
    ?.addEventListener(
      "change",
      e => {

        activeProjectId =
          e.target.value ||
          null;


        renderMapProject();

        renderBoreholes();

        renderBoreholeMap();

      }
    );

}


// ============================================================
// BAŞLAT
// ============================================================

document.addEventListener(
  "DOMContentLoaded",
  () => {

    wireEvents();


    if (
      localStorage.getItem(
        "je_sidebar_collapsed"
      ) === "1"
    ) {

      $("appShell")
        ?.classList
        .add(
          "sidebar-collapsed"
        );


      setText(
        "toggleAppSidebarBtn",
        "›"
      );

    }


    showAuth();

    initializeAuth();

  }
);
