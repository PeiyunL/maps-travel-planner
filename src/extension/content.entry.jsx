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
const LONG_DISTANCE_AIR_KM = 350;
const ROUTE_FETCH_LIMIT = 4;
const ROUTE_FETCH_RETRY_LIMIT = 2;

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
  const [routeRenderMode] = useState("straight");
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
  const [routeDataByKey, setRouteDataByKey] = useState({});
  const routeFetchAttemptsRef = useRef(new Map());

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
        routeRenderMode: "straight",
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

  const orderedMarkers = useMemo(() => sortMarkers(markers), [markers]);

  const markerPins = useMemo(() => {
    if (!mapRect || !mapView) return [];

    return orderedMarkers.map((marker) => {
      const pixel = latLngToPixel({ lat: marker.lat, lng: marker.lng }, mapRect, mapView);
      return {
        ...marker,
        x: pixel.x,
        y: pixel.y
      };
    });
  }, [orderedMarkers, mapRect, mapView]);

  const markerDataById = useMemo(() => {
    const map = new Map();
    orderedMarkers.forEach((m) => map.set(m.id, m));
    return map;
  }, [orderedMarkers]);

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
      distanceKm,
      durationMinutes,
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
    (id, from, to, vehicleType, mode, routeKey) => {
      const routeData = routeDataByKey[routeKey];
      const metrics = routeData || getRouteMetrics(from, to, vehicleType);
      const routedPoints =
      routeRenderMode === "road" && routeData?.path?.length && mapRect && mapView
          ? routeData.path
              .map((point) => latLngToPixel(point, mapRect, mapView))
              .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
          : null;

      const points =
        routedPoints && routedPoints.length >= 2
          ? routedPoints
          : [
              { x: from.x, y: from.y },
              { x: to.x, y: to.y }
            ];
      const midpoint =
        computePolylineMidpoint(points) || {
          x: (from.x + to.x) / 2,
          y: (from.y + to.y) / 2
        };

      return {
        id,
        routeKey,
        mode,
        fromMarkerId: from.id,
        toMarkerId: to.id,
        vehicleType,
        icon: metrics.icon,
        distanceKm: Number(metrics.distanceKm) || 0,
        durationMinutes: Number(metrics.durationMinutes) || 0,
        distanceText: metrics.distanceText,
        durationText: metrics.durationText,
        midpoint,
        points
      };
    },
    [getRouteMetrics, routeDataByKey, mapRect, mapView, routeRenderMode]
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
      const autoKey = `${from.id}->${to.id}`;
      const vehicleType =
        autoVehiclesByKey[autoKey] ||
        (haversineKm(from, to) >= LONG_DISTANCE_AIR_KM ? "airplane" : "driving");
      const routeKey = `auto:${autoKey}:${vehicleType}`;
      list.push(buildEdgePayload(`a_${from.id}_${to.id}`, from, to, vehicleType, "auto", routeKey));
    }
    return list;
  }, [markerPins, autoVehiclesByKey, allowCrossDayConnections, buildEdgePayload]);

  const manualRenderedEdges = useMemo(() => {
    return manualEdges
      .map((edge) => {
        const from = markerById.get(edge.fromMarkerId);
        const to = markerById.get(edge.toMarkerId);
        if (!from || !to) return null;
        const vehicleType = edge.vehicleType || (haversineKm(from, to) >= LONG_DISTANCE_AIR_KM ? "airplane" : "driving");
        const routeKey = `manual:${edge.id}:${edge.fromMarkerId}->${edge.toMarkerId}:${vehicleType}`;
        return buildEdgePayload(edge.id, from, to, vehicleType, "manual", routeKey);
      })
      .filter(Boolean);
  }, [manualEdges, markerById, buildEdgePayload]);

  const routeCandidates = useMemo(() => {
    const candidates = [];

    if (routeRenderMode !== "road") return candidates;

    if (connectionMode === "manual") {
      manualEdges.forEach((edge) => {
        const from = markerDataById.get(edge.fromMarkerId);
        const to = markerDataById.get(edge.toMarkerId);
        if (!from || !to) return;

        const vehicleType = edge.vehicleType || (haversineKm(from, to) >= LONG_DISTANCE_AIR_KM ? "airplane" : "driving");
        if (!supportsExternalRouting(vehicleType)) return;
        candidates.push({
          key: `manual:${edge.id}:${edge.fromMarkerId}->${edge.toMarkerId}:${vehicleType}`,
          from,
          to,
          vehicleType
        });
      });
      return candidates;
    }

    if (orderedMarkers.length < 2) return candidates;
    for (let i = 0; i < orderedMarkers.length - 1; i += 1) {
      const from = orderedMarkers[i];
      const to = orderedMarkers[i + 1];
      if (!allowCrossDayConnections && Number(from.day) !== Number(to.day)) continue;

      const autoKey = `${from.id}->${to.id}`;
      const vehicleType =
        autoVehiclesByKey[autoKey] ||
        (haversineKm(from, to) >= LONG_DISTANCE_AIR_KM ? "airplane" : "driving");
      if (!supportsExternalRouting(vehicleType)) continue;
      candidates.push({
        key: `auto:${autoKey}:${vehicleType}`,
        from,
        to,
        vehicleType
      });
    }

    return candidates;
  }, [connectionMode, manualEdges, markerDataById, orderedMarkers, allowCrossDayConnections, autoVehiclesByKey, routeRenderMode]);

  useEffect(() => {
    if (!routeCandidates.length) return;

    const validKeys = new Set(routeCandidates.map((c) => c.key));
    routeFetchAttemptsRef.current.forEach((_value, key) => {
      if (!validKeys.has(key)) routeFetchAttemptsRef.current.delete(key);
    });
    setRouteDataByKey((prev) => {
      let changed = false;
      const next = {};
      Object.keys(prev).forEach((key) => {
        if (validKeys.has(key)) {
          next[key] = prev[key];
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [routeCandidates]);

  useEffect(() => {
    if (!routeCandidates.length) return;
    const pending = routeCandidates
      .filter((candidate) => {
        if (routeDataByKey[candidate.key]) return false;
        const attempts = routeFetchAttemptsRef.current.get(candidate.key) || 0;
        return attempts < ROUTE_FETCH_RETRY_LIMIT;
      })
      .slice(0, ROUTE_FETCH_LIMIT);
    if (!pending.length) return;

    let cancelled = false;

    (async () => {
      for (const candidate of pending) {
        if (cancelled) break;
        const attempts = routeFetchAttemptsRef.current.get(candidate.key) || 0;
        routeFetchAttemptsRef.current.set(candidate.key, attempts + 1);
        try {
          const route = await fetchRouteData(candidate.from, candidate.to, candidate.vehicleType);
          if (cancelled || !route) continue;
          setRouteDataByKey((prev) => (prev[candidate.key] ? prev : { ...prev, [candidate.key]: route }));
        } catch {
          // Keep straight-line fallback if routing request fails.
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [routeCandidates, routeDataByKey]);

  const edges = connectionMode === "manual" ? manualRenderedEdges : autoEdges;
  const dayTravelSummary = useMemo(() => {
    const targetDay = Number(activeDay) || 1;
    let totalMinutes = 0;
    let totalDistanceKm = 0;
    let segments = 0;

    edges.forEach((edge) => {
      const from = markerById.get(edge.fromMarkerId);
      const to = markerById.get(edge.toMarkerId);
      if (!from || !to) return;
      if (Number(from.day) !== targetDay || Number(to.day) !== targetDay) return;
      totalMinutes += Number(edge.durationMinutes) || 0;
      totalDistanceKm += Number(edge.distanceKm) || 0;
      segments += 1;
    });

    return {
      day: targetDay,
      segments,
      totalMinutes,
      totalDistanceKm,
      totalDurationText: formatDuration(totalMinutes),
      totalDistanceText: formatDistance(totalDistanceKm)
    };
  }, [edges, markerById, activeDay]);

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
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      setSelectedEdgeId(null);
      setSelectedMarkerId(null);
      setConnectSelection([]);
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);

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
      routeRenderMode: "straight",
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
          routeRenderMode: "straight",
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
      routeRenderMode: "straight",
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
      dayTravelSummary={dayTravelSummary}
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
    routeRenderMode: planner.routeRenderMode === "straight" ? "straight" : "road",
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
    transit: 30,
    airplane: 700
  };
  return byType[vehicleType] || byType.driving;
}

function getVehicleIcon(vehicleType) {
  const byType = {
    walking: "\uD83D\uDEB6",
    biking: "\uD83D\uDEB2",
    driving: "\uD83D\uDE97",
    transit: "\uD83D\uDE8C",
    airplane: "\u2708\uFE0F"
  };
  return byType[vehicleType] || byType.driving;
}

function roundCoord(value) {
  return Number(value || 0).toFixed(5);
}

function supportsExternalRouting(vehicleType) {
  return vehicleType === "driving" || vehicleType === "walking" || vehicleType === "biking" || vehicleType === "transit";
}

function mapVehicleToOsrmProfile(vehicleType) {
  if (vehicleType === "biking") return "cycling";
  if (vehicleType === "walking") return "walking";
  return "driving";
}

async function fetchRouteData(from, to, vehicleType) {
  if (vehicleType === "transit") {
    return fetchTransitRouteData(from, to);
  }

  const route = await fetchRoadRoute(from, to, vehicleType);
  if (!route || !route.path.length) return null;

  return {
    icon: getVehicleIcon(vehicleType),
    distanceKm: route.distanceKm,
    durationMinutes: route.durationMinutes,
    distanceText: formatDistance(route.distanceKm),
    durationText: formatDuration(route.durationMinutes),
    path: route.path
  };
}

function simplifyPath(points, maxPoints) {
  if (!Array.isArray(points)) return [];
  if (points.length <= maxPoints) return points;
  const step = Math.max(1, Math.ceil(points.length / maxPoints));
  const out = [];
  for (let i = 0; i < points.length; i += step) {
    out.push(points[i]);
  }
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function computePolylineMidpoint(points) {
  if (!Array.isArray(points) || points.length === 0) return null;
  if (points.length === 1) return points[0];
  if (points.length === 2) {
    return {
      x: (points[0].x + points[1].x) / 2,
      y: (points[0].y + points[1].y) / 2
    };
  }

  let total = 0;
  const segments = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    segments.push({ a, b, len });
    total += len;
  }

  if (!Number.isFinite(total) || total <= 0) {
    return {
      x: (points[0].x + points[points.length - 1].x) / 2,
      y: (points[0].y + points[points.length - 1].y) / 2
    };
  }

  const half = total / 2;
  let walked = 0;
  for (const seg of segments) {
    if (walked + seg.len >= half) {
      const t = seg.len > 0 ? (half - walked) / seg.len : 0;
      return {
        x: seg.a.x + (seg.b.x - seg.a.x) * t,
        y: seg.a.y + (seg.b.y - seg.a.y) * t
      };
    }
    walked += seg.len;
  }

  return points[points.length - 1];
}

async function fetchTransitRouteData(from, to) {
  // Transit approximation with first/last mile walking:
  // route path follows roads; total time includes transfer walking.
  const road = await fetchRoadRoute(from, to, "transit");
  if (!road || !road.path.length) return null;

  const walkToStartKm = road.snappedStart ? haversineKm(from, road.snappedStart) : 0;
  const walkFromEndKm = road.snappedEnd ? haversineKm(to, road.snappedEnd) : 0;
  const walkingKm = walkToStartKm + walkFromEndKm;
  const transitKm = road.distanceKm;

  const transitMinutes = (transitKm / getVehicleSpeed("transit")) * 60;
  const walkingMinutes = (walkingKm / getVehicleSpeed("walking")) * 60;
  const totalMinutes = transitMinutes + walkingMinutes;

  return {
    icon: getVehicleIcon("transit"),
    distanceKm: transitKm + walkingKm,
    durationMinutes: totalMinutes,
    distanceText: formatDistance(transitKm + walkingKm),
    durationText: `${formatDuration(totalMinutes)} incl walk`,
    path: road.path
  };
}

async function fetchRoadRoute(from, to, vehicleType) {
  const google = await requestGoogleRouteViaPage(from, to, vehicleType);
  if (google && google.path?.length >= 2) return google;

  const profile = mapVehicleToOsrmProfile(vehicleType);
  return fetchOsrmRoute(profile, from, to);
}

async function fetchOsrmRoute(profile, from, to) {
  const payload = await requestOsrmRoute(profile, from, to);
  if (!payload) return null;

  const route = payload?.routes?.[0];
  if (!route || !route.geometry?.coordinates?.length) return null;

  const rawPath = route.geometry.coordinates
    .map((coord) => ({ lat: Number(coord[1]), lng: Number(coord[0]) }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  const path = simplifyPath(rawPath, 64);
  if (path.length < 2) return null;

  const snappedStart = toLatLng(payload?.waypoints?.[0]?.location);
  const snappedEnd = toLatLng(payload?.waypoints?.[1]?.location);

  return {
    distanceKm: (Number(route.distance) || 0) / 1000,
    durationMinutes: (Number(route.duration) || 0) / 60,
    path,
    snappedStart,
    snappedEnd
  };
}

function toLatLng(location) {
  if (!Array.isArray(location) || location.length < 2) return null;
  const lng = Number(location[0]);
  const lat = Number(location[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function requestOsrmRoute(profile, from, to) {
  return new Promise((resolve) => {
    const fallbackFetch = () => {
      fetchOsrmDirect(profile, from, to)
        .then((data) => resolve(data))
        .catch(() => resolve(null));
    };

    if (!chrome?.runtime?.id) {
      fallbackFetch();
      return;
    }

    chrome.runtime.sendMessage(
      {
        type: "MTP_FETCH_OSRM_ROUTE",
        payload: { profile, from, to }
      },
      (response) => {
        if (chrome.runtime.lastError || !response?.ok) {
          fallbackFetch();
          return;
        }
        resolve(response.data || null);
      }
    );
  });
}

async function fetchOsrmDirect(profile, from, to) {
  const url = `https://router.project-osrm.org/route/v1/${profile}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function requestGoogleRouteViaPage(from, to, vehicleType) {
  return new Promise((resolve) => {
    try {
      ensureGoogleRouteBridge();
    } catch {
      resolve(null);
      return;
    }

    const requestId = `gr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const timeout = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve(null);
    }, 4500);

    const onMessage = (event) => {
      if (event.source !== window) return;
      const message = event.data;
      if (!message || message.type !== "MTP_GOOGLE_ROUTE_RESPONSE") return;
      if (!message.payload || message.payload.requestId !== requestId) return;

      clearTimeout(timeout);
      window.removeEventListener("message", onMessage);

      if (!message.payload.ok || !message.payload.data) {
        resolve(null);
        return;
      }

      const route = normalizeGoogleRoute(message.payload.data);
      resolve(route);
    };

    window.addEventListener("message", onMessage);
    window.postMessage(
      {
        type: "MTP_GOOGLE_ROUTE_REQUEST",
        payload: { requestId, from, to, vehicleType }
      },
      "*"
    );
  });
}

function normalizeGoogleRoute(data) {
  const rawPath = Array.isArray(data.path) ? data.path : [];
  const path = simplifyPath(
    rawPath
      .map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)),
    64
  );
  if (path.length < 2) return null;

  return {
    distanceKm: (Number(data.distanceMeters) || 0) / 1000,
    durationMinutes: (Number(data.durationSeconds) || 0) / 60,
    path,
    snappedStart: path[0],
    snappedEnd: path[path.length - 1]
  };
}

function ensureGoogleRouteBridge() {
  if (window.__mtp_google_route_bridge__) return;

  const script = document.createElement("script");
  script.dataset.mtpRouteBridge = "true";
  script.textContent = `
    (function () {
      if (window.__mtp_google_route_bridge__) return;
      window.__mtp_google_route_bridge__ = true;

      function toMode(vehicleType) {
        if (vehicleType === "walking") return "WALKING";
        if (vehicleType === "biking") return "BICYCLING";
        if (vehicleType === "transit") return "TRANSIT";
        return "DRIVING";
      }

      window.addEventListener("message", function (event) {
        if (event.source !== window) return;
        var msg = event.data;
        if (!msg || msg.type !== "MTP_GOOGLE_ROUTE_REQUEST") return;

        var payload = msg.payload || {};
        var requestId = payload.requestId;
        var from = payload.from;
        var to = payload.to;
        var vehicleType = payload.vehicleType;

        var respond = function (ok, data, error) {
          window.postMessage(
            {
              type: "MTP_GOOGLE_ROUTE_RESPONSE",
              payload: { requestId: requestId, ok: ok, data: data || null, error: error || null }
            },
            "*"
          );
        };

        try {
          if (!window.google || !window.google.maps || !window.google.maps.DirectionsService) {
            respond(false, null, "Directions unavailable");
            return;
          }

          var service = new window.google.maps.DirectionsService();
          var modeName = toMode(vehicleType);
          var travelMode = window.google.maps.TravelMode[modeName];

          service.route(
            {
              origin: { lat: Number(from.lat), lng: Number(from.lng) },
              destination: { lat: Number(to.lat), lng: Number(to.lng) },
              travelMode: travelMode,
              provideRouteAlternatives: false
            },
            function (result, status) {
              if (status !== "OK" || !result || !result.routes || !result.routes.length) {
                respond(false, null, String(status || "NO_ROUTE"));
                return;
              }

              var route = result.routes[0];
              var leg = route.legs && route.legs[0] ? route.legs[0] : null;
              var path = (route.overview_path || []).map(function (p) {
                return { lat: p.lat(), lng: p.lng() };
              });

              respond(true, {
                distanceMeters: leg && leg.distance ? leg.distance.value : 0,
                durationSeconds: leg && leg.duration ? leg.duration.value : 0,
                path: path
              });
            }
          );
        } catch (error) {
          respond(false, null, String((error && error.message) || error || "route_error"));
        }
      });
    })();
  `;

  (document.documentElement || document.head || document.body).appendChild(script);
  script.remove();
  window.__mtp_google_route_bridge__ = true;
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
