const STORAGE_KEY = "mtp_planner_workspace_v1";
const LEGACY_PLANNER_KEY = "mtp_planner_state_v1";
const LEGACY_MARKERS_KEY = "mtp_markers_step3_v1";
const UI_PREFS_KEY = "mtp_ui_prefs_v1";

export function createDefaultPlannerState() {
  return {
    markers: [],
    manualEdges: [],
    autoVehiclesByKey: {},
    connectionMode: "auto",
    routeRenderMode: "straight",
    activeDay: 1,
    allowCrossDayConnections: false,
    visibleDays: {}
  };
}

export function createDefaultTrip(name = "My Trip") {
  const now = new Date().toISOString();
  return {
    id: `trip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    description: "",
    createdAt: now,
    updatedAt: now,
    ...createDefaultPlannerState()
  };
}

export function loadPlannerWorkspace() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY, LEGACY_PLANNER_KEY, LEGACY_MARKERS_KEY], (result) => {
      const savedWorkspace = result[STORAGE_KEY];
      if (isObject(savedWorkspace) && isObject(savedWorkspace.tripsById)) {
        const normalized = normalizeWorkspace(savedWorkspace);
        resolve(normalized);
        return;
      }

      // Migration path from previous single-trip saves.
      const legacyPlanner = isObject(result[LEGACY_PLANNER_KEY])
        ? {
            ...createDefaultPlannerState(),
            ...result[LEGACY_PLANNER_KEY]
          }
        : null;

      const legacyMarkers = Array.isArray(result[LEGACY_MARKERS_KEY]) ? result[LEGACY_MARKERS_KEY] : [];
      const baseTrip = createDefaultTrip("My Trip");

      const migratedTrip = {
        ...baseTrip,
        ...(legacyPlanner || {}),
      markers: legacyPlanner ? legacyPlanner.markers || [] : legacyMarkers,
      manualEdges: legacyPlanner ? legacyPlanner.manualEdges || [] : [],
      autoVehiclesByKey: legacyPlanner ? legacyPlanner.autoVehiclesByKey || {} : {},
      routeRenderMode: "straight",
      visibleDays: legacyPlanner ? legacyPlanner.visibleDays || {} : {}
    };

      resolve({
        currentTripId: migratedTrip.id,
        tripOrder: [migratedTrip.id],
        tripsById: { [migratedTrip.id]: migratedTrip }
      });
    });
  });
}

export function savePlannerWorkspace(workspace) {
  const payload = normalizeWorkspace(workspace);

  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STORAGE_KEY]: payload }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve();
    });
  });
}

export function loadUiPrefs() {
  return new Promise((resolve) => {
    chrome.storage.local.get([UI_PREFS_KEY], (result) => {
      const raw = result[UI_PREFS_KEY];
      if (!isObject(raw)) {
        resolve({ onboardingSeen: false });
        return;
      }
      resolve({
        onboardingSeen: Boolean(raw.onboardingSeen)
      });
    });
  });
}

export function saveUiPrefs(prefs) {
  const payload = {
    onboardingSeen: Boolean(prefs?.onboardingSeen)
  };

  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [UI_PREFS_KEY]: payload }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve();
    });
  });
}

function normalizeWorkspace(workspace) {
  const inputTrips = isObject(workspace?.tripsById) ? workspace.tripsById : {};
  const tripIds = Object.keys(inputTrips);

  if (tripIds.length === 0) {
    const fallback = createDefaultTrip("My Trip");
    return {
      currentTripId: fallback.id,
      tripOrder: [fallback.id],
      tripsById: { [fallback.id]: fallback }
    };
  }

  const tripsById = {};
  tripIds.forEach((id) => {
    const raw = inputTrips[id] || {};
    tripsById[id] = {
      ...createDefaultTrip(raw.name || "Trip"),
      ...raw,
      id,
      markers: Array.isArray(raw.markers) ? raw.markers : [],
      manualEdges: Array.isArray(raw.manualEdges) ? raw.manualEdges : [],
      autoVehiclesByKey: isObject(raw.autoVehiclesByKey) ? raw.autoVehiclesByKey : {},
      visibleDays: isObject(raw.visibleDays) ? raw.visibleDays : {},
      connectionMode: raw.connectionMode === "manual" ? "manual" : "auto",
      routeRenderMode: "straight",
      activeDay: Math.max(1, Number(raw.activeDay) || 1),
      allowCrossDayConnections: Boolean(raw.allowCrossDayConnections)
    };
  });

  const rawOrder = Array.isArray(workspace?.tripOrder) ? workspace.tripOrder : [];
  const ordered = rawOrder.filter((id) => id in tripsById);
  const remaining = tripIds.filter((id) => !ordered.includes(id));
  const tripOrder = [...ordered, ...remaining];

  const currentTripId = tripOrder.includes(workspace?.currentTripId)
    ? workspace.currentTripId
    : tripOrder[0];

  return {
    currentTripId,
    tripOrder,
    tripsById
  };
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
