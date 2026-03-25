import React, { useEffect, useMemo, useRef, useState } from "react";

const MIN_MARGIN = 8;
const DAY_COLORS = ["#ef4444", "#2563eb", "#16a34a", "#d97706", "#7c3aed", "#0f766e"];

const CATEGORY_META = {
  food: { icon: "\uD83C\uDF7D\uFE0F" },
  hotel: { icon: "\uD83C\uDFE8" },
  attraction: { icon: "\uD83D\uDCCD" },
  shopping: { icon: "\uD83D\uDED2" },
  other: { icon: "\uD83D\uDDFA\uFE0F" }
};

export function PlannerShell({
  trips,
  currentTripId,
  isLoading,
  showOnboarding,
  toasts,
  markers,
  allMarkers,
  dayNumbers,
  visibleDays,
  edges,
  selectedMarker,
  selectedEdge,
  paused,
  connectionMode,
  activeDay,
  dayTravelSummary,
  allowCrossDayConnections,
  connectSelection,
  onTogglePause,
  onCloseOnboarding,
  onDismissToast,
  onTripChange,
  onCreateTrip,
  onRenameTrip,
  onDuplicateTrip,
  onDeleteTrip,
  onActiveDayChange,
  onToggleDayVisible,
  onToggleCrossDayConnections,
  onConnectionModeChange,
  onMarkerListClick,
  onMarkerMapClick,
  onCloseMarkerModal,
  onUpdateMarker,
  onDeleteMarker,
  onDeleteMarkers,
  onReorderMarkers,
  onEdgeClick,
  onEdgeVehicleChange,
  onDeleteSelectedEdge
}) {
  const [position, setPosition] = useState({ top: 84, left: 18 });
  const [isDragging, setIsDragging] = useState(false);
  const [draggedMarkerId, setDraggedMarkerId] = useState(null);
  const [dragOverMarkerId, setDragOverMarkerId] = useState(null);
  const [selectedForDelete, setSelectedForDelete] = useState([]);
  const panelRef = useRef(null);
  const dragRef = useRef(null);

  const panelStyle = useMemo(
    () => ({ top: `${position.top}px`, left: `${position.left}px` }),
    [position.left, position.top]
  );

  const visibleMarkers = useMemo(
    () => allMarkers.filter((m) => (Number(m.day) || 1) === (Number(activeDay) || 1)),
    [allMarkers, activeDay]
  );

  useEffect(() => {
    const markerIds = new Set(allMarkers.map((m) => m.id));
    setSelectedForDelete((prev) => prev.filter((id) => markerIds.has(id)));
  }, [allMarkers]);

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    if (!panelRef.current) return;

    const target = event.target;
    if (target instanceof Element && target.closest("button,input,textarea,select,a,label")) return;

    const rect = panelRef.current.getBoundingClientRect();
    dragRef.current = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      pointerId: event.pointerId
    };

    panelRef.current.setPointerCapture(event.pointerId);
    setIsDragging(true);
    event.preventDefault();
  };

  const onPointerMove = (event) => {
    if (!dragRef.current || !panelRef.current) return;

    const nextLeft = clamp(
      event.clientX - dragRef.current.offsetX,
      MIN_MARGIN,
      window.innerWidth - rectWidth(panelRef.current) - MIN_MARGIN
    );
    const nextTop = clamp(
      event.clientY - dragRef.current.offsetY,
      MIN_MARGIN,
      window.innerHeight - rectHeight(panelRef.current) - MIN_MARGIN
    );

    setPosition({ top: nextTop, left: nextLeft });
  };

  const onPointerEnd = (event) => {
    if (!dragRef.current || !panelRef.current) return;

    const { pointerId } = dragRef.current;
    dragRef.current = null;
    setIsDragging(false);

    if (panelRef.current.hasPointerCapture(pointerId)) {
      panelRef.current.releasePointerCapture(pointerId);
    }

    event.preventDefault();
  };

  useEffect(() => {
    if (!isDragging) return undefined;

    const handleMove = (event) => onPointerMove(event);
    const handleEnd = (event) => onPointerEnd(event);

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleEnd);
    window.addEventListener("pointercancel", handleEnd);

    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);
    };
  }, [isDragging]);

  const handleToggleSelect = (markerId, checked) => {
    setSelectedForDelete((prev) => {
      if (checked) return [...new Set([...prev, markerId])];
      return prev.filter((id) => id !== markerId);
    });
  };

  const handleDeleteSelected = () => {
    if (!selectedForDelete.length) return;
    onDeleteMarkers(selectedForDelete);
    setSelectedForDelete([]);
  };

  const handleSelectAllVisible = () => {
    if (!visibleMarkers.length) return;
    setSelectedForDelete((prev) => {
      const next = new Set(prev);
      visibleMarkers.forEach((marker) => next.add(marker.id));
      return [...next];
    });
  };

  const handleClearSelected = () => {
    setSelectedForDelete([]);
  };

  return (
    <>
      <aside
        className={`mtp-panel${isDragging ? " mtp-panel--dragging" : ""}${paused ? " mtp-panel--paused" : ""}`}
        ref={panelRef}
        style={panelStyle}
        aria-label="Travel Planner"
      >
        <header className="mtp-panel__header" onPointerDown={onPointerDown}>
          <h1>Travel Planner Pro</h1>
          <div className="mtp-toolbar">
            <button type="button" className="mtp-btn" onClick={onTogglePause}>
              {paused ? "Resume" : "Pause"}
            </button>
            <button
              type="button"
              className={`mtp-btn ${connectionMode === "manual" ? "mtp-btn--primary" : ""}`}
              onClick={() => onConnectionModeChange(connectionMode === "manual" ? "auto" : "manual")}
              disabled={paused}
              title="Toggle between auto route and manual connect mode"
            >
              {connectionMode === "manual" ? "Manual" : "Auto"}
            </button>
          </div>
        </header>

        <section className="mtp-panel__body">
          {isLoading ? (
            <div className="mtp-loading">Loading planner...</div>
          ) : null}

          {!isLoading && trips.length === 0 ? (
            <div className="mtp-empty-card">
              <p>No trips yet.</p>
              <button type="button" className="mtp-btn mtp-btn--primary" onClick={onCreateTrip}>Create Trip</button>
            </div>
          ) : null}

          <div className="mtp-trip-controls">
            <label>
              Trip
              <select
                value={currentTripId || ""}
                onChange={(e) => onTripChange(e.target.value)}
                disabled={paused}
                title="Switch active trip"
              >
                {trips.map((trip) => (
                  <option key={trip.id} value={trip.id}>
                    {trip.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="mtp-trip-actions">
              <button type="button" className="mtp-btn" onClick={onCreateTrip} disabled={paused} title="Create a new trip">New</button>
              <button type="button" className="mtp-btn" onClick={onDuplicateTrip} disabled={paused} title="Duplicate current trip">Duplicate</button>
              <button type="button" className="mtp-btn" onClick={onRenameTrip} disabled={paused} title="Rename current trip">Rename</button>
              <button
                type="button"
                className="mtp-btn mtp-btn--danger"
                onClick={onDeleteTrip}
                disabled={paused || trips.length <= 1}
                title="Delete current trip"
              >
                Delete
              </button>
            </div>
          </div>

          <p className="mtp-placeholder">
            {paused
              ? "Paused: Google Maps interactions are normal."
              : connectionMode === "manual"
                ? "Manual connect: click two markers on the map to create a connection."
                : "Auto connect: markers connect in order by day."}
          </p>

          <div className="mtp-day-tabs">
            {dayNumbers.map((day) => (
              <button
                key={`tab_${day}`}
                type="button"
                className={`mtp-day-tab${day === Number(activeDay) ? " mtp-day-tab--active" : ""}`}
                onClick={() => onActiveDayChange(day)}
                disabled={paused}
                title={`Show Day ${day} in sidebar`}
              >
                Day {day}
              </button>
            ))}
          </div>

          <div className="mtp-day-visibility">
            <span>Show On Map</span>
            <div className="mtp-day-visibility-list">
              {dayNumbers.map((day) => (
                <label key={`visible_${day}`} className="mtp-check">
                  <input
                    type="checkbox"
                    checked={visibleDays[day] !== false}
                    onChange={() => onToggleDayVisible(day)}
                    disabled={paused}
                    title={`Show/hide Day ${day} markers on map`}
                  />
                  Day {day}
                </label>
              ))}
            </div>
          </div>

          <div className="mtp-day-controls">
            <label>
              Add To Day
              <input
                type="number"
                min={1}
                value={activeDay}
                onChange={(e) => onActiveDayChange(Math.max(1, Number(e.target.value) || 1))}
                disabled={paused}
              />
            </label>
            <label className="mtp-check">
              <input
                type="checkbox"
                checked={allowCrossDayConnections}
                onChange={onToggleCrossDayConnections}
                disabled={paused}
              />
              Cross-day auto links
            </label>
          </div>

          <div className="mtp-day-summary">
            <h3>Day {dayTravelSummary?.day || activeDay} Travel</h3>
            <p><strong>{dayTravelSummary?.totalDurationText || "0 min"}</strong> total travel time</p>
            <p><strong>{dayTravelSummary?.totalDistanceText || "0 m"}</strong> total distance</p>
            <p>{dayTravelSummary?.segments || 0} route segment(s)</p>
          </div>

          <div className="mtp-bulk-actions">
            <div className="mtp-bulk-actions-row">
              <button
                type="button"
                className="mtp-btn"
                onClick={handleSelectAllVisible}
                disabled={paused || visibleMarkers.length === 0}
              >
                Select All Day {activeDay}
              </button>
              <button
                type="button"
                className="mtp-btn"
                onClick={handleClearSelected}
                disabled={paused || selectedForDelete.length === 0}
              >
                Clear
              </button>
            </div>
            <button
              type="button"
              className="mtp-btn mtp-btn--danger"
              onClick={handleDeleteSelected}
              disabled={paused || selectedForDelete.length === 0}
            >
              Delete Selected ({selectedForDelete.length})
            </button>
          </div>

          {connectionMode === "manual" && !paused ? (
            <p className="mtp-connect-status">
              {connectSelection.length === 0
                ? "Connection start: none"
                : `Connection start: ${connectSelection[0]}`}
            </p>
          ) : null}

          {selectedEdge ? (
            <div className="mtp-edge-editor">
              <h3>Selected Connection</h3>
              <p>{selectedEdge.icon} {selectedEdge.durationText} - {selectedEdge.distanceText}</p>
              <label>
                Vehicle
                <select
                  value={selectedEdge.vehicleType}
                  onChange={(e) => onEdgeVehicleChange(e.target.value)}
                  disabled={paused}
                >
                  <option value="driving">Driving</option>
                  <option value="walking">Walking</option>
                  <option value="biking">Biking</option>
                  <option value="transit">Transit</option>
                  <option value="airplane">Airplane</option>
                </select>
              </label>
              <button
                type="button"
                className="mtp-btn mtp-btn--danger"
                onClick={onDeleteSelectedEdge}
                disabled={paused || selectedEdge.mode !== "manual"}
                title={selectedEdge.mode !== "manual" ? "Auto edges cannot be deleted in auto mode" : "Delete edge"}
              >
                Delete Connection
              </button>
            </div>
          ) : null}

          <div className="mtp-marker-list">
            {visibleMarkers.length === 0 ? (
              <p className="mtp-empty">No markers for Day {activeDay}.</p>
            ) : (
              <section className="mtp-day-group">
                <h3>Day {activeDay}</h3>
                {visibleMarkers.map((marker) => {
                  const meta = CATEGORY_META[marker.category] || CATEGORY_META.other;
                  const isConnectSelected = connectSelection.includes(marker.id);
                  const isBulkSelected = selectedForDelete.includes(marker.id);
                  const dayColor = getDayColor(marker.day);

                  return (
                    <div
                      key={marker.id}
                      className={`mtp-marker-row${
                        dragOverMarkerId === marker.id && draggedMarkerId !== marker.id ? " mtp-marker-row--drop-target" : ""
                      }${draggedMarkerId === marker.id ? " mtp-marker-row--dragging" : ""}${
                        isConnectSelected ? " mtp-marker-row--connect-selected" : ""
                      }${isBulkSelected ? " mtp-marker-row--bulk-selected" : ""}`}
                      draggable={!paused}
                      onDragStart={(event) => {
                        if (paused) return;
                        event.dataTransfer.setData("text/plain", marker.id);
                        event.dataTransfer.effectAllowed = "move";
                        setDraggedMarkerId(marker.id);
                      }}
                      onDragOver={(event) => {
                        if (paused || !draggedMarkerId) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        setDragOverMarkerId(marker.id);
                      }}
                      onDragLeave={() => {
                        if (dragOverMarkerId === marker.id) setDragOverMarkerId(null);
                      }}
                      onDrop={(event) => {
                        if (paused) return;
                        event.preventDefault();
                        const fromId = event.dataTransfer.getData("text/plain") || draggedMarkerId;
                        onReorderMarkers(fromId, marker.id);
                        setDraggedMarkerId(null);
                        setDragOverMarkerId(null);
                      }}
                      onDragEnd={() => {
                        setDraggedMarkerId(null);
                        setDragOverMarkerId(null);
                      }}
                    >
                      <label className="mtp-row-check" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isBulkSelected}
                          onChange={(e) => handleToggleSelect(marker.id, e.target.checked)}
                          disabled={paused}
                        />
                      </label>

                      <button
                        type="button"
                        className="mtp-marker-row-mainbtn"
                        onClick={() => {
                          if (paused) return;
                          onMarkerListClick(marker.id);
                        }}
                      >
                        <span className="mtp-dot" style={{ backgroundColor: dayColor }}>{marker.order}</span>
                        <span className="mtp-row-main">
                          <strong>{marker.title || "Untitled"}</strong>
                          <small>{meta.icon} {marker.category}</small>
                        </span>
                      </button>
                    </div>
                  );
                })}
              </section>
            )}
          </div>
        </section>
      </aside>

      <div className="mtp-marker-layer">
        <svg className="mtp-edge-layer" aria-hidden="true">
          {edges.map((edge) => {
            const d = edge.points.map((p, idx) => `${idx === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
            const isSelected = selectedEdge?.id === edge.id;
            const hasActiveSelection = Boolean(selectedEdge);
            return (
              <g key={edge.id}>
                {isSelected ? <path d={d} className="mtp-edge-focus" /> : null}
                <path
                  d={d}
                  className={`mtp-edge mtp-edge--${edge.vehicleType}${isSelected ? " mtp-edge--selected" : ""}${
                    hasActiveSelection && !isSelected ? " mtp-edge--dimmed" : ""
                  }`}
                  onClick={(event) => {
                    if (paused) return;
                    event.preventDefault();
                    event.stopPropagation();
                    onEdgeClick(edge.id);
                  }}
                />
              </g>
            );
          })}
        </svg>

        <div className="mtp-edge-label-layer" aria-hidden="true">
          {edges.map((edge) => (
            <button
              key={`label_${edge.id}`}
              type="button"
              className={`mtp-edge-label${selectedEdge?.id === edge.id ? " mtp-edge-label--selected" : ""}${
                selectedEdge && selectedEdge.id !== edge.id ? " mtp-edge-label--dimmed" : ""
              }`}
              style={{ left: `${edge.midpoint.x}px`, top: `${edge.midpoint.y}px` }}
              onClick={(event) => {
                if (paused) return;
                event.preventDefault();
                event.stopPropagation();
                onEdgeClick(edge.id);
              }}
            >
              <span>{edge.icon}</span>
              <span>{edge.durationText}</span>
              <span>{edge.distanceText}</span>
            </button>
          ))}
        </div>

        {selectedEdge ? (
          <div className="mtp-edge-endpoints" aria-hidden="true">
            <span
              className="mtp-edge-endpoint mtp-edge-endpoint--start"
              style={{
                left: `${selectedEdge.points[0]?.x || 0}px`,
                top: `${selectedEdge.points[0]?.y || 0}px`
              }}
            >
              Start
            </span>
            <span
              className="mtp-edge-endpoint mtp-edge-endpoint--end"
              style={{
                left: `${selectedEdge.points[selectedEdge.points.length - 1]?.x || 0}px`,
                top: `${selectedEdge.points[selectedEdge.points.length - 1]?.y || 0}px`
              }}
            >
              End
            </span>
          </div>
        ) : null}

        {markers.map((marker) => {
          const dayColor = getDayColor(marker.day);
          const isConnectSelected = connectSelection.includes(marker.id);
          return (
            <button
              key={marker.id}
              type="button"
              className={`mtp-marker${isConnectSelected ? " mtp-marker--connect-selected" : ""}`}
              style={{ left: `${marker.x}px`, top: `${marker.y}px`, backgroundColor: dayColor }}
              onClick={(event) => {
                if (paused) return;
                event.preventDefault();
                event.stopPropagation();
                onMarkerMapClick(marker.id);
              }}
              title={`${marker.title} (Day ${marker.day})`}
            >
              <span>{marker.order}</span>
            </button>
          );
        })}
      </div>

      {showOnboarding ? (
        <div className="mtp-onboarding">
          <div className="mtp-onboarding-card">
            <h3>Welcome to Travel Planner Pro</h3>
            <ul>
              <li>Click map to add markers to the selected day.</li>
              <li>Use Pause to browse Google Maps normally.</li>
              <li>Click route lines to edit vehicle and route details.</li>
            </ul>
            <button type="button" className="mtp-btn mtp-btn--primary" onClick={onCloseOnboarding}>
              Got it
            </button>
          </div>
        </div>
      ) : null}

      {selectedMarker ? (
        <MarkerModal
          marker={selectedMarker}
          onClose={onCloseMarkerModal}
          onSave={(patch) => onUpdateMarker(selectedMarker.id, patch)}
          onDelete={() => onDeleteMarker(selectedMarker.id)}
        />
      ) : null}

      <div className="mtp-toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`mtp-toast mtp-toast--${toast.kind || "info"}`}>
            <span>{toast.message}</span>
            <button type="button" className="mtp-toast-close" onClick={() => onDismissToast(toast.id)}>x</button>
          </div>
        ))}
      </div>
    </>
  );
}

function MarkerModal({ marker, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(() => toForm(marker));

  useEffect(() => {
    setForm(toForm(marker));
  }, [marker]);

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = () => {
    onSave({
      title: form.title.trim() || "Untitled",
      notes: form.notes.trim(),
      category: form.category,
      imageUrl: form.imageUrl.trim(),
      linkUrl: form.linkUrl.trim(),
      visitDurationMinutes: Math.max(0, Number(form.visitDurationMinutes) || 0),
      day: Math.max(1, Number(form.day) || 1),
      order: Math.max(1, Number(form.order) || 1)
    });
    onClose();
  };

  return (
    <>
      <div className="mtp-modal-backdrop" onClick={onClose} />
      <div className="mtp-modal" role="dialog" aria-label="Edit marker">
        <h3>Edit Marker</h3>

        <label>
          Title
          <input value={form.title} onChange={(e) => setField("title", e.target.value)} />
        </label>

        <label>
          Notes
          <textarea rows={3} value={form.notes} onChange={(e) => setField("notes", e.target.value)} />
        </label>

        <label>
          Category
          <select value={form.category} onChange={(e) => setField("category", e.target.value)}>
            <option value="food">food</option>
            <option value="hotel">hotel</option>
            <option value="attraction">attraction</option>
            <option value="shopping">shopping</option>
            <option value="other">other</option>
          </select>
        </label>

        <label>
          Image URL
          <input value={form.imageUrl} onChange={(e) => setField("imageUrl", e.target.value)} />
        </label>

        <label>
          Link URL
          <input value={form.linkUrl} onChange={(e) => setField("linkUrl", e.target.value)} />
        </label>

        <div className="mtp-grid-2">
          <label>
            Visit (min)
            <input
              type="number"
              min={0}
              value={form.visitDurationMinutes}
              onChange={(e) => setField("visitDurationMinutes", e.target.value)}
            />
          </label>

          <label>
            Day
            <input type="number" min={1} value={form.day} onChange={(e) => setField("day", e.target.value)} />
          </label>
        </div>

        <label>
          Order
          <input type="number" min={1} value={form.order} onChange={(e) => setField("order", e.target.value)} />
        </label>

        <div className="mtp-modal-actions">
          <button type="button" className="mtp-btn mtp-btn--danger" onClick={onDelete}>Delete</button>
          <button type="button" className="mtp-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="mtp-btn mtp-btn--primary" onClick={handleSave}>Save</button>
        </div>
      </div>
    </>
  );
}

function toForm(marker) {
  return {
    title: marker.title || "",
    notes: marker.notes || "",
    category: marker.category || "attraction",
    imageUrl: marker.imageUrl || "",
    linkUrl: marker.linkUrl || "",
    visitDurationMinutes: String(marker.visitDurationMinutes ?? 60),
    day: String(marker.day ?? 1),
    order: String(marker.order ?? 1)
  };
}

function getDayColor(day) {
  const index = (Math.max(1, Number(day) || 1) - 1) % DAY_COLORS.length;
  return DAY_COLORS[index];
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function rectWidth(element) {
  return Math.max(1, Math.round(element.getBoundingClientRect().width));
}

function rectHeight(element) {
  return Math.max(1, Math.round(element.getBoundingClientRect().height));
}
