const WORLD_GEOJSON_URL =
  "https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson";

const mapElement = document.querySelector("#map");
const loadingElement = document.querySelector("#loading");
const clearButton = document.querySelector("#clear-overlays");
const selectedNameElement = document.querySelector("#selected-name");
const selectedMetaElement = document.querySelector("#selected-meta");
const comparisonTitleElement = document.querySelector("#comparison-title");
const comparisonCopyElement = document.querySelector("#comparison-copy");

const state = {
  features: [],
  selectedId: null,
  hoverTargetId: null,
  overlays: [],
  rotation: [-12, -8, 0],
  targetRotation: [-12, -8, 0],
  animationFrameId: null,
  dragRotationStart: null,
  dragPointerStart: null,
};

const width = 1280;
const height = 760;
const viewCenter = [width / 2, height / 2];

const svg = d3.select(mapElement).attr("viewBox", `0 0 ${width} ${height}`);
const projection = d3
  .geoOrthographic()
  .translate(viewCenter)
  .scale(Math.min(width, height) * 0.45)
  .clipAngle(90)
  .precision(0.5)
  .rotate(state.rotation);
const path = d3.geoPath(projection);
const graticule = d3.geoGraticule10();

const defs = svg.append("defs");
const globeGradient = defs
  .append("radialGradient")
  .attr("id", "globeGradient")
  .attr("cx", "38%")
  .attr("cy", "32%");

globeGradient
  .append("stop")
  .attr("offset", "0%")
  .attr("stop-color", "#fdfbf3");

globeGradient
  .append("stop")
  .attr("offset", "58%")
  .attr("stop-color", "#eee7d8");

globeGradient
  .append("stop")
  .attr("offset", "100%")
  .attr("stop-color", "#d8cfbe");

const globeShadow = svg.append("path").attr("class", "globe-shadow");
const sphere = svg.append("path").attr("class", "sphere");
const graticulePath = svg.append("path").attr("class", "graticule");
const baseLayer = svg.append("g");
const overlayLayer = svg.append("g");
const labelLayer = svg.append("g").attr("pointer-events", "none");

sphere.call(
  d3
    .drag()
    .on("start", handleGlobeRotateStart)
    .on("drag", handleGlobeRotateDrag)
    .on("end", handleGlobeRotateEnd),
);

graticulePath.call(
  d3
    .drag()
    .on("start", handleGlobeRotateStart)
    .on("drag", handleGlobeRotateDrag)
    .on("end", handleGlobeRotateEnd),
);

clearButton.addEventListener("click", () => {
  state.overlays = [];
  state.hoverTargetId = null;
  renderScene();
  resetComparisonCard();
});

svg.on("dblclick", () => {
  state.overlays = [];
  state.hoverTargetId = null;
  renderScene();
  resetComparisonCard();
});

loadMap();

async function loadMap() {
  try {
    const world = await d3.json(WORLD_GEOJSON_URL);
    const normalizedFeatures = normalizeFeatures(world.features);
    const features = normalizedFeatures
      .filter((feature) => feature.properties.name !== "Antarctica")
      .map((feature, index) => {
        const areaSteradians = d3.geoArea(feature);
        const landShare = (areaSteradians / (4 * Math.PI)) * 100;

        return {
          ...feature,
          uid: `${feature.properties.name}-${index}`,
          areaSteradians,
          landShare,
          geoCentroid: d3.geoCentroid(feature),
          screenCentroid: [NaN, NaN],
          isVisible: false,
        };
      })
      .sort((a, b) => b.areaSteradians - a.areaSteradians);

    features.forEach((feature, index) => {
      feature.rank = index + 1;
      feature.displayArea = steradiansToSquareKm(feature.areaSteradians);
    });

    state.features = features;
    state.selectedId = features[0]?.uid ?? null;

    loadingElement.textContent = "拖动任意国家或地区开始比较";
    window.setTimeout(() => loadingElement.classList.add("hidden"), 900);
    renderScene();
    updateSelectedCard(getFeature(state.selectedId));
  } catch (error) {
    loadingElement.textContent = "地图数据加载失败，请检查网络后刷新页面";
    console.error(error);
  }
}

function renderScene() {
  projection.rotate(state.rotation);
  refreshFeatureProjectionState();
  renderGlobe();
  renderCountries();
  renderLabels();
  renderOverlays();
}

function refreshFeatureProjectionState() {
  for (const feature of state.features) {
    const projectedGeoCentroid = projection(feature.geoCentroid);
    const screenCentroid = path.centroid(feature);
    feature.screenCentroid = screenCentroid;
    feature.isVisible =
      projectedGeoCentroid !== null &&
      Number.isFinite(screenCentroid[0]) &&
      Number.isFinite(screenCentroid[1]);
  }
}

function renderGlobe() {
  const sphereDatum = { type: "Sphere" };
  globeShadow
    .datum(sphereDatum)
    .attr("d", path)
    .attr("transform", "translate(14 18)");
  sphere.datum(sphereDatum).attr("d", path);
  graticulePath.datum(graticule).attr("d", path);
}

function renderCountries() {
  const countrySelection = baseLayer
    .selectAll(".country")
    .data(state.features, (feature) => feature.uid);

  countrySelection
    .join("path")
    .attr("class", (feature) => {
      const classNames = ["country"];

      if (feature.uid === state.selectedId) {
        classNames.push("selected");
      }

      if (feature.uid === state.hoverTargetId) {
        classNames.push("target");
      }

      return classNames.join(" ");
    })
    .attr("d", (feature) => (feature.isVisible ? path(feature) : null))
    .attr("data-id", (feature) => feature.uid)
    .style("pointer-events", (feature) => (feature.isVisible ? "auto" : "none"))
    .on("click", (_, feature) => {
      state.selectedId = feature.uid;
      updateSelectedCard(feature);
      renderCountries();
    })
    .call(
      d3
        .drag()
        .on("start", handleCountryDragStart)
        .on("drag", handleCountryDrag)
        .on("end", handleCountryDragEnd),
    );
}

function renderLabels() {
  const labelCandidates = state.features.filter((feature) => {
    const [x, y] = feature.screenCentroid;
    return (
      feature.isVisible &&
      feature.areaSteradians > 0.006 &&
      x > 46 &&
      x < width - 46 &&
      y > 40 &&
      y < height - 40
    );
  });

  labelLayer
    .selectAll(".name-label")
    .data(labelCandidates, (feature) => feature.uid)
    .join("text")
    .attr("class", "name-label")
    .attr("x", (feature) => feature.screenCentroid[0])
    .attr("y", (feature) => feature.screenCentroid[1])
    .attr("text-anchor", "middle")
    .text((feature) => feature.properties.name);
}

function renderOverlays() {
  overlayLayer
    .selectAll(".overlay-country")
    .data(state.overlays, (overlay) => overlay.id)
    .join("path")
    .attr("class", (overlay) =>
      overlay.isDragging ? "overlay-country dragging" : "overlay-country",
    )
    .attr("d", (overlay) => getOverlayPath(overlay))
    .attr("transform", (overlay) => getOverlayTransform(overlay))
    .style("pointer-events", "none");
}

function handleCountryDragStart(event, feature) {
  state.selectedId = feature.uid;
  updateSelectedCard(feature);

  const [pointerX, pointerY] = d3.pointer(event, svg.node());
  const [centroidX, centroidY] = feature.screenCentroid;
  const overlay = {
    id: `${feature.uid}-${Date.now()}`,
    featureId: feature.uid,
    dx: pointerX - centroidX,
    dy: pointerY - centroidY,
    isDragging: true,
    anchorGeo: null,
  };

  state.overlays.push(overlay);
  event.subject.overlayId = overlay.id;
  state.targetRotation = [...state.rotation];
  renderScene();
}

function handleCountryDrag(event) {
  const overlay = state.overlays.find(
    (item) => item.id === event.subject.overlayId,
  );

  if (!overlay) {
    return;
  }

  const sourceFeature = getFeature(overlay.featureId);

  if (!sourceFeature?.isVisible) {
    return;
  }

  const rawDx = event.x - sourceFeature.screenCentroid[0];
  const rawDy = event.y - sourceFeature.screenCentroid[1];
  overlay.dx = rawDx;
  overlay.dy = rawDy;
  overlay.anchorGeo = null;

  const target = findHoveredCountry(event.x, event.y, overlay.featureId);
  state.hoverTargetId = target?.uid ?? null;

  updateGlobeRotationTarget(event.x, event.y);
  ensureRotationAnimation();
  updateComparisonCard(overlay, target);
  renderScene();
}

function handleCountryDragEnd(event) {
  const overlay = state.overlays.find(
    (item) => item.id === event.subject.overlayId,
  );

  if (!overlay) {
    return;
  }

  overlay.isDragging = false;
  state.targetRotation = [...state.rotation];
  overlay.anchorGeo = projection.invert([event.x, event.y]);

  const target = findHoveredCountry(event.x, event.y, overlay.featureId);
  state.hoverTargetId = null;

  if (!target) {
    updateComparisonCard(overlay, null);
  } else {
    updateComparisonCard(overlay, target, true);
  }

  renderScene();
}

function handleGlobeRotateStart(event) {
  if (event.sourceEvent?.target?.closest?.(".country")) {
    return;
  }

  if (state.animationFrameId !== null) {
    window.cancelAnimationFrame(state.animationFrameId);
    state.animationFrameId = null;
  }

  state.dragRotationStart = [...state.rotation];
  state.dragPointerStart = [event.x, event.y];
}

function handleGlobeRotateDrag(event) {
  if (!state.dragRotationStart || !state.dragPointerStart) {
    return;
  }

  const deltaX = event.x - state.dragPointerStart[0];
  const deltaY = event.y - state.dragPointerStart[1];
  const rotationSensitivity = 0.22;
  const nextLon = state.dragRotationStart[0] + deltaX * rotationSensitivity;
  const nextLat = state.dragRotationStart[1] - deltaY * rotationSensitivity;

  state.rotation = [wrapLongitude(nextLon), clampLatitude(nextLat), 0];
  state.targetRotation = [...state.rotation];
  state.hoverTargetId = null;
  renderScene();
}

function handleGlobeRotateEnd() {
  state.dragRotationStart = null;
  state.dragPointerStart = null;
}

function updateSelectedCard(feature) {
  if (!feature) {
    selectedNameElement.textContent = "点击地图中的国家或地区";
    selectedMetaElement.textContent =
      "这里会显示面积、全球排名与占地球陆地比例。";
    return;
  }

  selectedNameElement.textContent = feature.properties.name;
  selectedMetaElement.textContent =
    `${formatNumber(feature.displayArea)} 平方公里，按真实球面面积估算排名第 ${feature.rank}，约占地球表面积的 ${feature.landShare.toFixed(
      2,
    )}% 。`;
}

function updateComparisonCard(overlay, target, isDropped = false) {
  const sourceFeature = getFeature(overlay.featureId);

  if (!sourceFeature) {
    resetComparisonCard();
    return;
  }

  if (!target) {
    comparisonTitleElement.textContent = `${sourceFeature.properties.name} 正在移动中`;
    comparisonCopyElement.textContent =
      "把它拖到另一个国家或地区上方，系统会自动显示面积倍数关系。";
    return;
  }

  const sourceArea = sourceFeature.displayArea;
  const targetArea = target.displayArea;
  const ratio = sourceArea / targetArea;
  const largerFeature = ratio >= 1 ? sourceFeature : target;
  const smallerFeature = ratio >= 1 ? target : sourceFeature;
  const largerRatio = ratio >= 1 ? ratio : 1 / ratio;

  comparisonTitleElement.textContent = isDropped
    ? `${sourceFeature.properties.name} 已覆盖到 ${target.properties.name}`
    : `${sourceFeature.properties.name} 正在对比 ${target.properties.name}`;

  comparisonCopyElement.textContent =
    `${largerFeature.properties.name} 约为 ${smallerFeature.properties.name} 的 ${largerRatio.toFixed(
      2,
    )} 倍。` +
    ` ${sourceFeature.properties.name}：${formatNumber(sourceArea)} 平方公里；` +
    ` ${target.properties.name}：${formatNumber(targetArea)} 平方公里。`;
}

function resetComparisonCard() {
  comparisonTitleElement.textContent = "把一个国家或地区拖到另一个国家或地区上方";
  comparisonCopyElement.textContent =
    "拖拽时会自动识别目标国家或地区，并显示两者面积倍数关系。";
}

function updateGlobeRotationTarget(pointerX, pointerY) {
  const offsetX = pointerX - viewCenter[0];
  const offsetY = pointerY - viewCenter[1];
  const distance = Math.hypot(offsetX, offsetY);
  const deadZone = 84;
  const maxRadius = Math.min(width, height) * 0.42;

  if (distance <= deadZone) {
    state.targetRotation = [...state.rotation];
    return;
  }

  const intensity = Math.min(1, (distance - deadZone) / (maxRadius - deadZone));
  const easedIntensity = 1 - Math.pow(1 - intensity, 3);
  const lonAdjustment = offsetX * 0.032 * easedIntensity;
  const latAdjustment = offsetY * 0.024 * easedIntensity;

  state.targetRotation = [
    wrapLongitude(state.rotation[0] - lonAdjustment),
    clampLatitude(state.rotation[1] + latAdjustment),
    0,
  ];
}

function ensureRotationAnimation() {
  if (state.animationFrameId !== null) {
    return;
  }

  state.animationFrameId = window.requestAnimationFrame(stepRotationAnimation);
}

function stepRotationAnimation() {
  state.animationFrameId = null;

  const nextLon =
    state.rotation[0] + shortestLongitudeDelta(state.rotation[0], state.targetRotation[0]) * 0.16;
  const nextLat =
    state.rotation[1] + (state.targetRotation[1] - state.rotation[1]) * 0.14;

  state.rotation = [wrapLongitude(nextLon), clampLatitude(nextLat), 0];
  renderScene();

  const lonDelta = Math.abs(
    shortestLongitudeDelta(state.rotation[0], state.targetRotation[0]),
  );
  const latDelta = Math.abs(state.targetRotation[1] - state.rotation[1]);

  if (lonDelta > 0.08 || latDelta > 0.08) {
    state.animationFrameId = window.requestAnimationFrame(stepRotationAnimation);
  }
}

function findHoveredCountry(x, y, excludedId) {
  const invertedPoint = projection.invert([x, y]);

  if (!invertedPoint) {
    return null;
  }

  for (const feature of state.features) {
    if (feature.uid === excludedId || !feature.isVisible) {
      continue;
    }

    if (d3.geoContains(feature, invertedPoint)) {
      return feature;
    }
  }

  return null;
}

function normalizeFeatures(features) {
  const chinaFeature = features.find(
    (feature) => feature.properties?.name === "China",
  );
  const taiwanFeature = features.find(
    (feature) => feature.properties?.name === "Taiwan",
  );

  if (!chinaFeature || !taiwanFeature) {
    return features;
  }

  const mergedChina = {
    ...chinaFeature,
    geometry: {
      type: "GeometryCollection",
      geometries: [chinaFeature.geometry, taiwanFeature.geometry],
    },
  };

  return features
    .filter((feature) => feature !== chinaFeature && feature !== taiwanFeature)
    .concat(mergedChina);
}

function getFeature(id) {
  return state.features.find((feature) => feature.uid === id) ?? null;
}

function getOverlayPath(overlay) {
  const feature = overlay.isDragging
    ? getFeature(overlay.featureId)
    : getOverlayFeature(overlay);

  if (!feature) {
    return null;
  }

  if (overlay.isDragging) {
    return feature.isVisible ? path(feature) : null;
  }

  return path(feature);
}

function getOverlayTransform(overlay) {
  if (overlay.isDragging || !overlay.anchorGeo) {
    return `translate(${overlay.dx}, ${overlay.dy})`;
  }

  return null;
}

function getOverlayFeature(overlay) {
  const feature = getFeature(overlay.featureId);

  if (!feature || !overlay.anchorGeo) {
    return feature;
  }

  const rotation = d3.geoRotation([
    overlay.anchorGeo[0] - feature.geoCentroid[0],
    overlay.anchorGeo[1] - feature.geoCentroid[1],
  ]);

  return {
    ...feature,
    geometry: rotateGeometry(feature.geometry, rotation),
  };
}

function rotateGeometry(geometry, rotation) {
  switch (geometry.type) {
    case "Point":
      return {
        ...geometry,
        coordinates: rotation(geometry.coordinates),
      };
    case "MultiPoint":
    case "LineString":
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((point) => rotation(point)),
      };
    case "MultiLineString":
    case "Polygon":
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((ring) =>
          ring.map((point) => rotation(point)),
        ),
      };
    case "MultiPolygon":
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((polygon) =>
          polygon.map((ring) => ring.map((point) => rotation(point))),
        ),
      };
    case "GeometryCollection":
      return {
        ...geometry,
        geometries: geometry.geometries.map((child) =>
          rotateGeometry(child, rotation),
        ),
      };
    default:
      return geometry;
  }
}

function wrapLongitude(value) {
  let nextValue = value;

  while (nextValue > 180) {
    nextValue -= 360;
  }

  while (nextValue < -180) {
    nextValue += 360;
  }

  return nextValue;
}

function shortestLongitudeDelta(from, to) {
  return wrapLongitude(to - from);
}

function clampLatitude(value) {
  return Math.max(-55, Math.min(55, value));
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(Math.round(value));
}

function steradiansToSquareKm(steradians) {
  const earthRadiusKm = 6371.0088;
  return steradians * earthRadiusKm * earthRadiusKm;
}
