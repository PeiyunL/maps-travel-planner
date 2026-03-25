import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { PlannerShell } from "../ui/PlannerShell.jsx";
import { latLngToPixel, pixelToLatLng } from "../utils/geo.js";
import { findMapContainer, getMapViewSnapshot, observeMapsNavigation, waitForMapReady } from "../map/adapter.js";
import {
  createDefaultPlannerState,
  createDefaultTrip,
  loadPlannerWorkspace,
  loadUiPrefs,
  savePlannerWorkspace,
  saveUiPrefs
} from "../state/storage.js";

const ROOT_ID = "mtp-root";

function App() {
  const [markers, setMarkers] = useState(createDefaultPlannerState().markers);
  const [selectedMarkerId, setSelectedMarkerId] = useState(null);
  const [paused, setPaused] = useState(false);
  const [connectionMode, setConnectionMode] = useState(createDefaultPlannerState().connectionMode);
  const [activeDay, setActiveDay] = useState(createDefaultPlannerState().activeDay);
  const [allowCrossDayConnections, setAllowCrossDayConnections] = useState(
    createDefaultPlannerState().allowCrossDayConnections
  );
  const [visibleDays, setVisibleDays] = useState(createDefaultPlannerState().visibleDays);
  const [manualEdges, setManualEdges] = useState(createDefaultPlannerState().manualEdges);
  const [autoVehiclesByKey, setAutoVehiclesByKey] = useState(createDefaultPlannerState().autoVehiclesByKey);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [connectSelection, setConnectSelection] = useState([]);
  const [mapRect, setMapRect] = useState(null);
  const [mapView, setMapView] = useState(null);
  const pointerDownRef = useRef(null);
  const lastSaveToastRef = useRef(0);
  const routeMetricsCacheRef = useRef(new Map());
  const [tripsById, setTripsById] = useState({});
  const [tripOrder, setTripOrder] = useState([]);
  const [currentTripId, setCurrentTripId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [toasts, setToasts] = useState([]);

  const pushToast = (kind, message) => {
    const id = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2800);
  };

  useEffect(() => {
    let active = true;

    Promise.all([loadPlannerWorkspace(), loadUiPrefs()])
      .then(([workspace, prefs]) => {
        if (!active) return;
        const safeOrder = Array.isArray(workspace.tripOrder) ? workspace.tripOrder : Object.keys(workspace.tripsById || {});
        const safeCurrent = workspace.currentTripId || safeOrder[0] || null;
        const currentTrip = (workspace.tripsById || {})[safeCurrent] || createDefaultTrip("My Trip");

        setTripsById(workspace.tripsById || { [currentTrip.id]: currentTrip });
        setTripOrder(safeOrder.length ? safeOrder : [currentTrip.id]);
        setCurrentTripId(safeCurrent || currentTrip.id);
        applyTripState(currentTrip, {
          setMarkers,
          setManualEdges,
          setAutoVehiclesByKey,
          setConnectionMode,
          setActiveDay,
          setAllowCrossDayConnections,
          setVisibleDays
        });
        setShowOnboarding(!prefs.onboardingSeen);
        setIsLoading(false);
      })
      .catch(() => {
        if (!active) return;
        const fallback = createDefaultTrip("My Trip");
        setTripsById({ [fallback.id]: fallback });
        setTripOrder([fallback.id]);
        setCurrentTripId(fallback.id);
        applyTripState(fallback, {
          setMarkers,
          setManualEdges,
          setAutoVehiclesByKey,
          setConnectionMode,
          setActiveDay,
          setAllowCrossDayConnections,
          setVisibleDays
        });
        setShowOnboarding(true);
        setIsLoading(false);
        pushToast("error", "Failed to load planner data");
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!currentTripId) return;
    const handle = setTimeout(() => {
      const existing = tripsById[currentTripId] || createDefaultTrip("Trip");
      const nextTrip = {
        ...existing,
        markers,
        manualEdges,
        autoVehiclesByKey,
        connectionMode,
        activeDay,
        allowCrossDayConnections,
        visibleDays,
        updatedAt: new Date().toISOString()
      };

      const nextTripsById = {
        ...tripsById,
        [currentTripId]: nextTrip
      };

      savePlannerWorkspace({
        currentTripId,
        tripOrder,
        tripsById: nextTripsById
      })
        .then(() => {
          const now = Date.now();
          if (now - lastSaveToastRef.current > 12000) {
            lastSaveToastRef.current = now;
            pushToast("success", "Trip saved");
          }
        })
        .catch(() => {
          pushToast("error", "Failed to save trip");
      });
    }, 220);

    return () => clearTimeout(handle);
  }, [
    markers,
    manualEdges,
    autoVehiclesByKey,
    connectionMode,
    activeDay,
    allowCrossDayConnections,
    visibleDays,
    currentTripId,
    tripsById,
    tripOrder
  ]);

  useEffect(() => {
    let frame = 0;
    let lastSignature = "";

    const tick = () => {
      const container = findMapContainer();
      if (!container) {
        frame = requestAnimationFrame(tick);
        return;
      }

      const rect = container.getBoundingClientRect();
      const view = getMapViewSnapshot(location.href);
      const signature = `${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.width)}:${Math.round(
        rect.height
      )}:${view ? `${view.lat.toFixed(6)}:${view.lng.toFixed(6)}:${view.zoom.toFixed(2)}` : "none"}`;

      if (signature !== lastSignature) {
        lastSignature = signature;
        setMapRect(rect);
        setMapView(view);
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let suppressClickUntil = 0;
    const isPlannerUiTarget = (target) => {
      if (!(target instanceof Element)) return true;
      if (target.closest(".mtp-panel")) return true;
      if (target.closest(".mtp-modal")) return true;
      if (target.closest(".mtp-modal-backdrop")) return true;
      if (target.closest(".mtp-marker")) return true;
      if (target.closest(".mtp-edge")) return true;
      if (target.closest(".mtp-edge-label")) return true;
      return false;
    };

    const onPointerDown = (event) => {
      if (paused) return;
      if (!(event.target instanceof Element)) return;
      if (event.button !== 0) return;
      if (isPlannerUiTarget(event.target)) return;

      const container = findMapContainer();
      if (!container || !container.contains(event.target)) return;

      pointerDownRef.current = {
        x: event.clientX,
        y: event.clientY,
        moved: false
      };
    };

    const onPointerMove = (event) => {
      const down = pointerDownRef.current;
      if (!down) return;

      const distance = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      if (distance > 6) down.moved = true;
    };

    const onPointerUp = (event) => {
      if (!(event.target instanceof Element)) return;
      if (event.button !== 0) return;
      if (paused) return;
      if (!mapRect || !mapView) return;
      if (isPlannerUiTarget(event.target)) return;

      const down = pointerDownRef.current;
      pointerDownRef.current = null;
      if (!down || down.moved) return;

      const container = findMapContainer();
      if (!container || !container.contains(event.target)) return;

      const pixel = {
        x: event.clientX - mapRect.left,
        y: event.clientY - mapRect.top
      };

      const latLng = pixelToLatLng(pixel, mapRect, mapView);
      const order = nextOrderForDay(markers, activeDay);
      const marker = createMarker(latLng.lat, latLng.lng, order, activeDay);

      setMarkers((prev) => normalizeMarkerOrdersByDay(sortMarkers([...prev, marker])));
      setSelectedMarkerId(marker.id);
      pushToast("success", "Marker added");

      event.preventDefault();
      event.stopImmediatePropagation();
      suppressClickUntil = Date.now() + 450;
      closeGooglePlacePanelSoon();
    };

    const onClick = (event) => {
      if (paused) return;
      if (Date.now() > suppressClickUntil) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("click", onClick, true);
    };
  }, [mapRect, mapView, markers, paused, activeDay]);

  const markerPins = useMemo(() => {
    if (!mapRect || !mapView) return [];

    return markers.map((marker) => {
      const pixel = latLngToPixel({ lat: marker.lat, lng: marker.lng }, mapRect, mapView);
      return {
        ...marker,
        x: pixel.x,
        y: pixel.y
      };
    });
  }, [markers, mapRect, mapView]);

  const markerById = useMemo(() => {
    const map = new Map();
    markerPins.forEach((m) => map.set(m.id, m));
    return map;
  }, [markerPins]);

  const getRouteMetrics = useCallback((from, to, vehicleType) => {
    const key = `${vehicleType}:${roundCoord(from.lat)},${roundCoord(from.lng)}->${roundCoord(to.lat)},${roundCoord(to.lng)}`;
    const cached = routeMetricsCacheRef.current.get(key);
    if (cached) return cached;

    const distanceKm = haversineKm(from, to);
    const speedKmh = getVehicleSpeed(vehicleType);
    const durationMinutes = speedKmh > 0 ? (distanceKm / speedKmh) * 60 : 0;

    const metrics = {
      icon: getVehicleIcon(vehicleType),
      distanceText: formatDistance(distanceKm),
      durationText: formatDuration(durationMinutes)
    };
    routeMetricsCacheRef.current.set(key, metrics);
    if (routeMetricsCacheRef.current.size > 5000) {
      routeMetricsCacheRef.current.clear();
    }
    return metrics;
  }, []);

  const buildEdgePayload = useCallback(
    (id, from, to, vehicleType, mode) => {
      const metrics = getRouteMetrics(from, to, vehicleType);
      return {
        id,
        mode,
        fromMarkerId: from.id,
        toMarkerId: to.id,
        vehicleType,
        icon: metrics.icon,
        distanceText: metrics.distanceText,
        durationText: metrics.durationText,
        midpoint: {
          x: (from.x + to.x) / 2,
          y: (from.y + to.y) / 2
        },
        points: [
          { x: from.x, y: from.y },
          { x: to.x, y: to.y }
        ]
      };
    },
    [getRouteMetrics]
  );

  const dayNumbers = useMemo(() => {
    const set = new Set(markers.map((m) => Number(m.day) || 1));
    set.add(Number(activeDay) || 1);
    return [...set].sort((a, b) => a - b);
  }, [markers, activeDay]);

  useEffect(() => {
    setVisibleDays((prev) => {
      const next = { ...prev };
      let changed = false;

      dayNumbers.forEach((day) => {
        if (!(day in next)) {
          next[day] = true;
          changed = true;
        }
      });

      Object.keys(next).forEach((key) => {
        const day = Number(key);
        if (!dayNumbers.includes(day)) {
          delete next[key];
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [dayNumbers]);

  const autoEdges = useMemo(() => {
    if (markerPins.length < 2) return [];

    const list = [];
    for (let i = 0; i < markerPins.length - 1; i += 1) {
      const from = markerPins[i];
      const to = markerPins[i + 1];
      if (!allowCrossDayConnections && Number(from.day) !== Number(to.day)) continue;
      const vehicleType = autoVehiclesByKey[`${from.id}->${to.id}`] || "driving";
      list.push(buildEdgePayload(`a_${from.id}_${to.id}`, from, to, vehicleType, "auto"));
    }
    return list;
  }, [markerPins, autoVehiclesByKey, allowCrossDayConnections, buildEdgePayload]);

  const manualRenderedEdges = useMemo(() => {
    return manualEdges
      .map((edge) => {
        const from = markerById.get(edge.fromMarkerId);
        const to = markerById.get(edge.toMarkerId);
        if (!from || !to) return null;
        return buildEdgePayload(edge.id, from, to, edge.vehicleType || "driving", "manual");
      })
      .filter(Boolean);
  }, [manualEdges, markerById, buildEdgePayload]);

  const edges = connectionMode === "manual" ? manualRenderedEdges : autoEdges;
  const visibleMarkerPins = useMemo(
    () => markerPins.filter((marker) => visibleDays[Number(marker.day)] !== false),
    [markerPins, visibleDays]
  );
  const visibleEdges = useMemo(
    () =>
      edges.filter((edge) => {
        const from = markerById.get(edge.fromMarkerId);
        const to = markerById.get(edge.toMarkerId);
        if (!from || !to) return false;
        return visibleDays[Number(from.day)] !== false && visibleDays[Number(to.day)] !== false;
      }),
    [edges, markerById, visibleDays]
  );
  const selectedMarker = useMemo(
    () => markers.find((m) => m.id === selectedMarkerId) || null,
    [markers, selectedMarkerId]
  );
  const selectedEdge = useMemo(
    () => visibleEdges.find((e) => e.id === selectedEdgeId) || null,
    [visibleEdges, selectedEdgeId]
  );

  useEffect(() => {
    if (!paused) return;
    setSelectedMarkerId(null);
    setSelectedEdgeId(null);
    setConnectSelection([]);
  }, [paused]);

  useEffect(() => {
    if (!selectedEdgeId) return;
    if (visibleEdges.some((e) => e.id === selectedEdgeId)) return;
    setSelectedEdgeId(null);
  }, [visibleEdges, selectedEdgeId]);

  const onUpdateMarker = (id, patch) => {
    setMarkers((prev) =>
      normalizeMarkerOrdersByDay(
        sortMarkers(
          prev.map((marker) =>
            marker.id === id
              ? {
                  ...marker,
                  ...patch,
                  updatedAt: new Date().toISOString()
                }
              : marker
          )
        )
      )
    );
  };

  const onDeleteMarker = (id) => {
    setMarkers((prev) => normalizeMarkerOrdersByDay(sortMarkers(prev.filter((m) => m.id !== id))));
    setManualEdges((prev) => prev.filter((e) => e.fromMarkerId !== id && e.toMarkerId !== id));
    setSelectedMarkerId((prev) => (prev === id ? null : prev));
    setConnectSelection((prev) => prev.filter((markerId) => markerId !== id));
  };

  const onDeleteMarkers = (ids) => {
    const idSet = new Set(ids || []);
    if (!idSet.size) return;

    setMarkers((prev) => normalizeMarkerOrdersByDay(sortMarkers(prev.filter((m) => !idSet.has(m.id)))));
    setManualEdges((prev) =>
      prev.filter((e) => !idSet.has(e.fromMarkerId) && !idSet.has(e.toMarkerId))
    );
    setSelectedMarkerId((prev) => (prev && idSet.has(prev) ? null : prev));
    setConnectSelection((prev) => prev.filter((markerId) => !idSet.has(markerId)));
  };

  const onReorderMarkers = (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;

    setMarkers((prev) => {
      const ordered = sortMarkers(prev);
      const fromIndex = ordered.findIndex((m) => m.id === fromId);
      const toIndex = ordered.findIndex((m) => m.id === toId);
      if (fromIndex < 0 || toIndex < 0) return ordered;

      const next = [...ordered];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);

      const now = new Date().toISOString();
      const targetDay = Number(next[toIndex]?.day) || Number(moved.day) || 1;
      const withDayMove = next.map((marker) =>
        marker.id === moved.id
          ? {
              ...marker,
              day: targetDay,
              updatedAt: now
            }
          : marker
      );

      return normalizeMarkerOrdersByDay(sortMarkers(withDayMove));
    });
  };

  const onMarkerMapClick = (markerId) => {
    if (paused) return;

    if (connectionMode !== "manual") {
      setSelectedMarkerId(markerId);
      return;
    }

    setSelectedMarkerId(null);
    setSelectedEdgeId(null);

    setConnectSelection((prev) => {
      if (prev.length === 0) return [markerId];
      if (prev[0] === markerId) return [];

      const fromMarkerId = prev[0];
      const toMarkerId = markerId;
      const existing = manualEdges.find(
        (edge) =>
          (edge.fromMarkerId === fromMarkerId && edge.toMarkerId === toMarkerId) ||
          (edge.fromMarkerId === toMarkerId && edge.toMarkerId === fromMarkerId)
      );

      if (existing) {
        setSelectedEdgeId(existing.id);
      } else {
        const created = {
          id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
          fromMarkerId,
          toMarkerId,
          vehicleType: "driving"
        };
        setManualEdges((edgesPrev) => [...edgesPrev, created]);
        setSelectedEdgeId(created.id);
      }

      return [];
    });
  };

  const onEdgeVehicleChange = (vehicleType) => {
    if (!selectedEdge) return;

    if (selectedEdge.mode === "manual") {
      setManualEdges((prev) =>
        prev.map((edge) => (edge.id === selectedEdge.id ? { ...edge, vehicleType } : edge))
      );
      return;
    }

    const key = `${selectedEdge.fromMarkerId}->${selectedEdge.toMarkerId}`;
    setAutoVehiclesByKey((prev) => ({
      ...prev,
      [key]: vehicleType
    }));
  };

  const onDeleteSelectedEdge = () => {
    if (!selectedEdge) return;
    if (selectedEdge.mode !== "manual") return;

    setManualEdges((prev) => prev.filter((edge) => edge.id !== selectedEdge.id));
    setSelectedEdgeId(null);
  };

  const dismissToast = (toastId) => {
    setToasts((prev) => prev.filter((t) => t.id !== toastId));
  };

  const closeOnboarding = () => {
    setShowOnboarding(false);
    saveUiPrefs({ onboardingSeen: true }).catch(() => {
      pushToast("error", "Failed to save preferences");
    });
  };

  const trips = tripOrder
    .map((id) => tripsById[id])
    .filter(Boolean)
    .map((trip) => ({ id: trip.id, name: trip.name }));

  const switchToTrip = (targetTripId) => {
    if (!targetTripId || targetTripId === currentTripId) return;

    const currentSnapshot = buildTripSnapshot(tripsById[currentTripId], {
      markers,
      manualEdges,
      autoVehiclesByKey,
      connectionMode,
      activeDay,
      allowCrossDayConnections,
      visibleDays
    });

    const nextTripsById = {
      ...tripsById,
      [currentTripId]: currentSnapshot
    };

    const targetTrip = nextTripsById[targetTripId];
    if (!targetTrip) return;

    setTripsById(nextTripsById);
    setCurrentTripId(targetTripId);
    applyTripState(targetTrip, {
      setMarkers,
      setManualEdges,
      setAutoVehiclesByKey,
      setConnectionMode,
      setActiveDay,
      setAllowCrossDayConnections,
      setVisibleDays
    });
    setSelectedMarkerId(null);
    setSelectedEdgeId(null);
    setConnectSelection([]);
    pushToast("success", "Switched trip");
  };

  const onCreateTrip = () => {
    const name = `Trip ${tripOrder.length + 1}`;
    const created = createDefaultTrip(name);

    const currentSnapshot = currentTripId
      ? buildTripSnapshot(tripsById[currentTripId], {
          markers,
          manualEdges,
          autoVehiclesByKey,
          connectionMode,
          activeDay,
          allowCrossDayConnections,
          visibleDays
        })
      : null;

    const nextTripsById = {
      ...tripsById,
      ...(currentSnapshot ? { [currentTripId]: currentSnapshot } : {}),
      [created.id]: created
    };
    const nextOrder = [...tripOrder, created.id];

    setTripsById(nextTripsById);
    setTripOrder(nextOrder);
    setCurrentTripId(created.id);
    applyTripState(created, {
      setMarkers,
      setManualEdges,
      setAutoVehiclesByKey,
      setConnectionMode,
      setActiveDay,
      setAllowCrossDayConnections,
      setVisibleDays
    });
    setSelectedMarkerId(null);
    setSelectedEdgeId(null);
    setConnectSelection([]);
    pushToast("success", "Trip created");
  };

  const onRenameTrip = () => {
    if (!currentTripId) return;
    const current = tripsById[currentTripId];
    const nextName = prompt("Rename trip:", current?.name || "My Trip");
    if (!nextName) return;

    setTripsById((prev) => ({
      ...prev,
      [currentTripId]: {
        ...prev[currentTripId],
        name: nextName.trim() || "Untitled Trip",
        updatedAt: new Date().toISOString()
      }
    }));
    pushToast("success", "Trip renamed");
  };

  const onDuplicateTrip = () => {
    if (!currentTripId) return;
    const source = buildTripSnapshot(tripsById[currentTripId], {
      markers,
      manualEdges,
      autoVehiclesByKey,
      connectionMode,
      activeDay,
      allowCrossDayConnections,
      visibleDays
    });

    const duplicate = {
      ...source,
      id: `trip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      name: `${source.name || "Trip"} Copy`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    setTripsById((prev) => ({
      ...prev,
      [currentTripId]: source,
      [duplicate.id]: duplicate
    }));
    setTripOrder((prev) => [...prev, duplicate.id]);
    setCurrentTripId(duplicate.id);
    applyTripState(duplicate, {
      setMarkers,
      setManualEdges,
      setAutoVehiclesByKey,
      setConnectionMode,
      setActiveDay,
      setAllowCrossDayConnections,
      setVisibleDays
    });
    setSelectedMarkerId(null);
    setSelectedEdgeId(null);
    setConnectSelection([]);
    pushToast("success", "Trip duplicated");
  };

  const onDeleteTrip = () => {
    if (!currentTripId || tripOrder.length <= 1) return;
    if (!confirm("Delete current trip?")) return;

    const remainingOrder = tripOrder.filter((id) => id !== currentTripId);
    const fallbackTripId = remainingOrder[0];

    setTripsById((prev) => {
      const next = { ...prev };
      delete next[currentTripId];
      return next;
    });
    setTripOrder(remainingOrder);
    setCurrentTripId(fallbackTripId);

    const fallbackTrip = tripsById[fallbackTripId];
    if (fallbackTrip) {
      applyTripState(fallbackTrip, {
        setMarkers,
        setManualEdges,
        setAutoVehiclesByKey,
        setConnectionMode,
        setActiveDay,
        setAllowCrossDayConnections,
        setVisibleDays
      });
    }
    setSelectedMarkerId(null);
    setSelectedEdgeId(null);
    setConnectSelection([]);
    pushToast("success", "Trip deleted");
  };

  return (
    <PlannerShell
      trips={trips}
      currentTripId={currentTripId}
      isLoading={isLoading}
      showOnboarding={showOnboarding}
      toasts={toasts}
      markers={visibleMarkerPins}
      allMarkers={markers}
      dayNumbers={dayNumbers}
      visibleDays={visibleDays}
      edges={visibleEdges}
      selectedMarker={selectedMarker}
      selectedEdge={selectedEdge}
      paused={paused}
      connectionMode={connectionMode}
      activeDay={activeDay}
      allowCrossDayConnections={allowCrossDayConnections}
      connectSelection={connectSelection}
      onTogglePause={() => setPaused((prev) => !prev)}
      onCloseOnboarding={closeOnboarding}
      onDismissToast={dismissToast}
      onTripChange={switchToTrip}
      onCreateTrip={onCreateTrip}
      onRenameTrip={onRenameTrip}
      onDuplicateTrip={onDuplicateTrip}
      onDeleteTrip={onDeleteTrip}
      onActiveDayChange={setActiveDay}
      onToggleDayVisible={(day) =>
        setVisibleDays((prev) => ({
          ...prev,
          [day]: !(prev[day] !== false)
        }))
      }
      onToggleCrossDayConnections={() => setAllowCrossDayConnections((prev) => !prev)}
      onConnectionModeChange={(nextMode) => {
        setConnectionMode(nextMode);
        setConnectSelection([]);
        setSelectedEdgeId(null);
      }}
      onMarkerListClick={setSelectedMarkerId}
      onMarkerMapClick={onMarkerMapClick}
      onCloseMarkerModal={() => setSelectedMarkerId(null)}
      onUpdateMarker={onUpdateMarker}
      onDeleteMarker={onDeleteMarker}
      onDeleteMarkers={onDeleteMarkers}
      onReorderMarkers={onReorderMarkers}
      onEdgeClick={setSelectedEdgeId}
      onEdgeVehicleChange={onEdgeVehicleChange}
      onDeleteSelectedEdge={onDeleteSelectedEdge}
    />
  );
}

const BOOT_KEY = "__mtp_bootstrap_v1";

async function mount() {
  if (!location.pathname.startsWith("/maps")) return;
  await waitForMapReady({ timeoutMs: 12000 });

  const boot = getBootState();
  let host = document.getElementById(ROOT_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = ROOT_ID;
    host.className = "mtp-root";
    document.body.appendChild(host);
  }

  if (boot.host === host && boot.root) return;

  if (boot.root && boot.host && boot.host !== host) {
    try {
      boot.root.unmount();
    } catch {
      // Ignore stale unmount failures from detached hosts.
    }
  }

  const root = createRoot(host);
  root.render(React.createElement(App));
  boot.root = root;
  boot.host = host;
}

function bootstrap() {
  const boot = getBootState();
  if (boot.initialized) return;
  boot.initialized = true;

  mount();

  const observer = new MutationObserver(() => {
    const host = document.getElementById(ROOT_ID);
    if (!host) mount();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  boot.observer = observer;

  boot.stopNavObserver = observeMapsNavigation(() => {
    mount();
  });
}

function getBootState() {
  const win = window;
  if (!win[BOOT_KEY]) {
    win[BOOT_KEY] = {
      initialized: false,
      root: null,
      host: null,
      observer: null,
      stopNavObserver: null
    };
  }
  return win[BOOT_KEY];
}

function createMarker(lat, lng, order, day) {
  const now = new Date().toISOString();

  return {
    id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    lat,
    lng,
    title: "New Place",
    notes: "",
    category: "attraction",
    imageUrl: "",
    linkUrl: "",
    visitDurationMinutes: 60,
    day,
    order,
    createdAt: now,
    updatedAt: now
  };
}

function nextOrderForDay(markers, day) {
  const sameDay = markers.filter((m) => Number(m.day) === Number(day));
  if (!sameDay.length) return 1;
  return Math.max(...sameDay.map((m) => Number(m.order) || 0)) + 1;
}

function sortMarkers(markers) {
  return [...markers].sort((a, b) => {
    const dayDiff = (Number(a.day) || 1) - (Number(b.day) || 1);
    if (dayDiff !== 0) return dayDiff;
    return (Number(a.order) || 0) - (Number(b.order) || 0);
  });
}

function normalizeMarkerOrdersByDay(markers) {
  const byDay = new Map();
  markers.forEach((marker) => {
    const day = Number(marker.day) || 1;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(marker);
  });

  const days = [...byDay.keys()].sort((a, b) => a - b);
  const result = [];

  days.forEach((day) => {
    const group = byDay.get(day).sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    group.forEach((marker, index) => {
      result.push({
        ...marker,
        day,
        order: index + 1
      });
    });
  });

  return result;
}

function buildTripSnapshot(baseTrip, planner) {
  const base = baseTrip || createDefaultTrip("My Trip");
  return {
    ...base,
    markers: planner.markers || [],
    manualEdges: planner.manualEdges || [],
    autoVehiclesByKey: planner.autoVehiclesByKey || {},
    connectionMode: planner.connectionMode || "auto",
    activeDay: Math.max(1, Number(planner.activeDay) || 1),
    allowCrossDayConnections: Boolean(planner.allowCrossDayConnections),
    visibleDays: planner.visibleDays || {},
    updatedAt: new Date().toISOString()
  };
}

function applyTripState(trip, setters) {
  setters.setMarkers(normalizeMarkerOrdersByDay(sortMarkers(trip.markers || [])));
  setters.setManualEdges(Array.isArray(trip.manualEdges) ? trip.manualEdges : []);
  setters.setAutoVehiclesByKey(trip.autoVehiclesByKey || {});
  setters.setConnectionMode(trip.connectionMode === "manual" ? "manual" : "auto");
  setters.setActiveDay(Math.max(1, Number(trip.activeDay) || 1));
  setters.setAllowCrossDayConnections(Boolean(trip.allowCrossDayConnections));
  setters.setVisibleDays(trip.visibleDays || {});
}

function haversineKm(a, b) {
  const R = 6371;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return 2 * R * Math.asin(Math.sqrt(h));
}

function formatDistance(distanceKm) {
  if (!Number.isFinite(distanceKm)) return "-";
  if (distanceKm < 1) return `${Math.round(distanceKm * 1000)} m`;
  return `${distanceKm.toFixed(1)} km`;
}

function formatDuration(minutes) {
  if (!Number.isFinite(minutes)) return "-";
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

function getVehicleSpeed(vehicleType) {
  const byType = {
    walking: 5,
    biking: 15,
    driving: 40,
    transit: 30
  };
  return byType[vehicleType] || byType.driving;
}

function getVehicleIcon(vehicleType) {
  const byType = {
    walking: "\uD83D\uDEB6",
    biking: "\uD83D\uDEB2",
    driving: "\uD83D\uDE97",
    transit: "\uD83D\uDE8C"
  };
  return byType[vehicleType] || byType.driving;
}

function roundCoord(value) {
  return Number(value || 0).toFixed(5);
}

function closeGooglePlacePanelSoon() {
  const run = () => {
    const closeButton = findMapsCloseButton();
    if (closeButton) closeButton.click();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", bubbles: true }));
  };

  run();
  setTimeout(run, 20);
  setTimeout(run, 80);
}

function findMapsCloseButton() {
  const selectors = [
    "button[aria-label*='Close']",
    "button[aria-label*='close']",
    "button[jsaction*='pane.placeActions.close']",
    "button[jsaction*='close']"
  ];

  for (const selector of selectors) {
    const node = document.querySelector(selector);
    if (node instanceof HTMLButtonElement) return node;
  }
  return null;
}

bootstrap();
