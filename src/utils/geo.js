export function parseMapCenterZoomFromUrl(url) {
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

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

function toDegrees(rad) {
  return (rad * 180) / Math.PI;
}

function projectLatLng(lat, lng) {
  const siny = Math.min(Math.max(Math.sin(toRadians(lat)), -0.9999), 0.9999);
  return {
    x: 256 * (0.5 + lng / 360),
    y: 256 * (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI))
  };
}

function unprojectPoint(x, y) {
  const lng = (x / 256 - 0.5) * 360;
  const n = Math.PI - (2 * Math.PI * y) / 256;
  const lat = toDegrees(Math.atan(Math.sinh(n)));
  return { lat, lng };
}

export function latLngToPixel(latLng, rect, view) {
  const scale = Math.pow(2, view.zoom);
  const centerWorld = projectLatLng(view.lat, view.lng);
  const pointWorld = projectLatLng(latLng.lat, latLng.lng);

  return {
    x: (pointWorld.x - centerWorld.x) * scale + rect.width / 2,
    y: (pointWorld.y - centerWorld.y) * scale + rect.height / 2
  };
}

export function pixelToLatLng(pixel, rect, view) {
  const scale = Math.pow(2, view.zoom);
  const centerWorld = projectLatLng(view.lat, view.lng);
  const worldX = centerWorld.x + (pixel.x - rect.width / 2) / scale;
  const worldY = centerWorld.y + (pixel.y - rect.height / 2) / scale;
  return unprojectPoint(worldX, worldY);
}