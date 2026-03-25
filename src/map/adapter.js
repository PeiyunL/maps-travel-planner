export function findMapContainer() {
  const byId = document.querySelector("#scene");
  if (isValidMapSurface(byId)) return byId;

  const widgetScene = document.querySelector(".widget-scene");
  if (isValidMapSurface(widgetScene)) return widgetScene;

  const candidates = Array.from(document.querySelectorAll("div[aria-label], div[role='main'], div"));
  const surfaces = candidates.filter(isValidMapSurface);
  if (!surfaces.length) return null;

  // Prefer containers that include map canvas/vector layers when available.
  const scored = surfaces.map((el) => {
    const hasCanvas = !!el.querySelector("canvas");
    const hasMapTiles = !!el.querySelector("img[src*='googleusercontent.com'], img[src*='maps']");
    const area = el.clientWidth * el.clientHeight;
    const score = area + (hasCanvas ? 1_000_000 : 0) + (hasMapTiles ? 500_000 : 0);
    return { el, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.el || null;
}

export function waitForMapReady({ timeoutMs = 12000 } = {}) {
  return new Promise((resolve) => {
    const start = Date.now();

    const probe = () => {
      const container = findMapContainer();
      if (container) {
        resolve(container);
        return true;
      }

      if (Date.now() - start > timeoutMs) {
        resolve(null);
        return true;
      }

      return false;
    };

    if (probe()) return;

    const observer = new MutationObserver(() => {
      if (!probe()) return;
      observer.disconnect();
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });

    const timer = setInterval(() => {
      if (!probe()) return;
      clearInterval(timer);
      observer.disconnect();
    }, 250);
  });
}

export function observeMapsNavigation(onNavigate) {
  const notify = () => {
    if (!location.pathname.startsWith("/maps")) return;
    onNavigate();
  };

  const originalPush = history.pushState.bind(history);
  const originalReplace = history.replaceState.bind(history);

  history.pushState = function patchedPushState(...args) {
    const res = originalPush(...args);
    queueMicrotask(notify);
    return res;
  };

  history.replaceState = function patchedReplaceState(...args) {
    const res = originalReplace(...args);
    queueMicrotask(notify);
    return res;
  };

  const onPop = () => notify();
  const onHash = () => notify();
  const onPageShow = () => notify();

  window.addEventListener("popstate", onPop);
  window.addEventListener("hashchange", onHash);
  window.addEventListener("pageshow", onPageShow);

  return () => {
    history.pushState = originalPush;
    history.replaceState = originalReplace;
    window.removeEventListener("popstate", onPop);
    window.removeEventListener("hashchange", onHash);
    window.removeEventListener("pageshow", onPageShow);
  };
}

export function getMapViewSnapshot(url = location.href) {
  const match = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)z/);
  if (match) {
    return {
      lat: Number(match[1]),
      lng: Number(match[2]),
      zoom: Number(match[3])
    };
  }

  const alt = url.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (alt) {
    return {
      lat: Number(alt[1]),
      lng: Number(alt[2]),
      zoom: 14
    };
  }

  return null;
}

function isValidMapSurface(node) {
  return (
    node instanceof HTMLElement &&
    node.isConnected &&
    node.clientWidth > 300 &&
    node.clientHeight > 300 &&
    getComputedStyle(node).display !== "none"
  );
}