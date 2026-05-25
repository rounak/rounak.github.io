import * as THREE from "../../codex-disco-render/lib/three.module.min.js";

const canvas = document.querySelector("#scene");
const resetButton = document.querySelector("#reset-nap");
const brushSizeInput = document.querySelector("#brush-size");

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  canvas,
  powerPreference: "high-performance",
});

renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.46;
renderer.setClearColor(0xf6f2e9, 1);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf6f2e9);
scene.fog = new THREE.FogExp2(0xf1ede4, 0.014);

const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 80);
camera.position.set(0, 0.1, 5.35);

const pointer = new THREE.Vector2();
const pointerNdc = new THREE.Vector2(10, 10);
const raycaster = new THREE.Raycaster();
const qaState = {
  brushStrokes: 0,
  flippedSequins: 0,
  frameCount: 0,
  lastBrushUv: [0, 0],
  pillowVertices: 0,
  renderReady: false,
  rotationY: 0,
  sequinCount: 0,
};

window.__pillowQA = qaState;

// Same 96-sample Codex outline used by the disco render.
const ICON_OUTLINE_SAMPLES = [
  1.0110, 0.9909, 0.9674, 0.9405, 0.9103, 0.9371, 0.9674, 0.9909, 1.0144,
  1.0278, 1.0413, 1.0446, 1.0480, 1.0446, 1.0413, 1.0245, 1.0110, 0.9909,
  0.9640, 0.9371, 0.9069, 0.9405, 0.9674, 0.9909, 1.0110, 1.0278, 1.0379,
  1.0413, 1.0480, 1.0446, 1.0379, 1.0245, 1.0110, 0.9909, 0.9674, 0.9405,
  0.9069, 0.9405, 0.9674, 0.9909, 1.0144, 1.0278, 1.0379, 1.0446, 1.0480,
  1.0446, 1.0379, 1.0278, 1.0144, 0.9909, 0.9674, 0.9405, 0.9103, 0.9405,
  0.9674, 0.9942, 1.0110, 1.0278, 1.0413, 1.0480, 1.0480, 1.0446, 1.0413,
  1.0245, 1.0110, 0.9909, 0.9640, 0.9371, 0.9069, 0.9405, 0.9674, 0.9909,
  1.0077, 1.0245, 1.0379, 1.0413, 1.0480, 1.0446, 1.0379, 1.0278, 1.0110,
  0.9909, 0.9707, 0.9405, 0.9103, 0.9371, 0.9674, 0.9909, 1.0110, 1.0278,
  1.0379, 1.0446, 1.0480, 1.0446, 1.0379, 1.0278,
];
const PILLOW_SCALE = 1.12;
const PILLOW_DEPTH_SCALE = 0.44;
const PILLOW_UV_EXTENT = 1.36;
const MIN_BRUSH_RADIUS = 0.1;
const MAX_BRUSH_RADIUS = 0.28;
const MIN_BRUSH_TRAVEL = 0.018;
const FRONT_SIDE = 1;

const fabricMaterial = createFabricMaterial();
const seamMaterial = createSeamMaterial();
const sequinMaterial = createSequinMaterial();
const glyphMaterial = createGlyphMaterial();
const glyphShadowMaterial = createGlyphShadowMaterial();
const shadowTexture = createShadowTexture();

const pillowGroup = new THREE.Group();
pillowGroup.rotation.set(-0.07, -0.12, 0.018);
pillowGroup.position.set(0, -0.08, -0.18);
scene.add(pillowGroup);

const pillow = createPillow();
const contactShadow = createContactShadow(shadowTexture);
const lightRig = createLightRig();

pillowGroup.add(pillow.group);
scene.add(contactShadow);
updateLights(0);

const brushTargets = pillow.brushTargets;
qaState.pillowVertices = pillow.vertexCount;
qaState.sequinCount = pillow.sequins.count;

let brushSize = Number.parseFloat(brushSizeInput.value);
let firstFrame = true;
let activePointerId = null;
let lastBrushLocalPoint = null;
let hoverFade = 0;

resetButton.addEventListener("click", () => {
  pillow.sequins.reset();
  qaState.brushStrokes = 0;
  qaState.flippedSequins = 0;
});

brushSizeInput.addEventListener("input", () => {
  brushSize = Number.parseFloat(brushSizeInput.value);
});

canvas.addEventListener("pointerdown", (event) => {
  activePointerId = event.pointerId;
  lastBrushLocalPoint = null;
  try {
    canvas.setPointerCapture(event.pointerId);
  } catch {
    // Synthetic QA events do not register an active browser pointer for capture.
  }
  updatePointer(event);
  reverseSequinsFromPointer(event);
  event.preventDefault();
});

canvas.addEventListener("pointermove", (event) => {
  updatePointer(event);

  if (activePointerId === event.pointerId) {
    reverseSequinsFromPointer(event);
    event.preventDefault();
  }
});

canvas.addEventListener("pointerup", (event) => {
  if (activePointerId === event.pointerId) {
    activePointerId = null;
    lastBrushLocalPoint = null;
  }

  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
});

canvas.addEventListener("pointercancel", () => {
  activePointerId = null;
  lastBrushLocalPoint = null;
});

canvas.addEventListener("pointerleave", () => {
  pointerNdc.set(10, 10);
  hoverFade = 0;
  lastBrushLocalPoint = null;
});

window.addEventListener("resize", resize);
resize();
animate();

function animate() {
  requestAnimationFrame(animate);

  fabricMaterial.uniforms.hover.value += (hoverFade - fabricMaterial.uniforms.hover.value) * 0.08;

  renderer.render(scene, camera);

  if (firstFrame) {
    firstFrame = false;
    canvas.dataset.pillowVertices = String(qaState.pillowVertices);
    canvas.dataset.sequinCount = String(qaState.sequinCount);
  }

  qaState.frameCount += 1;
  qaState.renderReady = true;
  qaState.rotationY = pillowGroup.rotation.y;
  canvas.dataset.brushStrokes = String(qaState.brushStrokes);
  canvas.dataset.flippedSequins = String(qaState.flippedSequins);
  canvas.dataset.frameCount = String(qaState.frameCount);
  canvas.dataset.lastBrushUv = qaState.lastBrushUv.join(",");
  canvas.dataset.renderReady = String(qaState.renderReady);
  canvas.dataset.rotationY = qaState.rotationY.toFixed(5);
}

function updatePointer(event) {
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;

  pointer.set((x - 0.5) * 2, (y - 0.5) * 2);
  pointerNdc.set(pointer.x, -pointer.y);
}

function reverseSequinsFromPointer(event) {
  if (activePointerId !== null && event.pointerId !== activePointerId) {
    return;
  }

  raycaster.setFromCamera(pointerNdc, camera);

  const intersections = raycaster.intersectObjects(brushTargets, false);

  if (intersections.length === 0) {
    hoverFade = 0;
    return;
  }

  const localPoint = pillow.group.worldToLocal(intersections[0].point.clone());

  const brushRadius = THREE.MathUtils.mapLinear(
    brushSize,
    Number.parseFloat(brushSizeInput.min),
    Number.parseFloat(brushSizeInput.max),
    MIN_BRUSH_RADIUS,
    MAX_BRUSH_RADIUS,
  );
  const brushDirection = new THREE.Vector2();

  hoverFade = 1;
  qaState.lastBrushUv = [
    Number(THREE.MathUtils.clamp(0.5 + localPoint.x / (PILLOW_UV_EXTENT * 2), 0, 1).toFixed(4)),
    Number(THREE.MathUtils.clamp(0.5 + localPoint.y / (PILLOW_UV_EXTENT * 2), 0, 1).toFixed(4)),
  ];

  if (!lastBrushLocalPoint) {
    lastBrushLocalPoint = localPoint.clone();
    return;
  }

  brushDirection.set(
    localPoint.x - lastBrushLocalPoint.x,
    localPoint.y - lastBrushLocalPoint.y,
  );

  if (brushDirection.lengthSq() < MIN_BRUSH_TRAVEL * MIN_BRUSH_TRAVEL) {
    return;
  }

  brushDirection.normalize();
  const touched = pillow.sequins.brushAt(localPoint, brushRadius, brushDirection);
  lastBrushLocalPoint.copy(localPoint);

  if (touched > 0) {
    qaState.brushStrokes += 1;
    qaState.flippedSequins = pillow.sequins.flippedCount;
  }
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const aspect = width / height;
  const responsivePullback = THREE.MathUtils.clamp(1.08 / aspect, 1, 2.18);

  camera.aspect = aspect;
  camera.position.z = 5.35 * responsivePullback;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function createPillow() {
  const group = new THREE.Group();
  const bodyGeometry = createCushionGeometry();
  const body = new THREE.Mesh(bodyGeometry, fabricMaterial);
  const frontSeam = createSeamCord(FRONT_SIDE, 0.944, 0.006);
  const backSeam = createSeamCord(-FRONT_SIDE, 0.944, 0.0055);
  const frontSequins = createSequinSystem(FRONT_SIDE, 0);
  const backSequins = createSequinSystem(-FRONT_SIDE, 14000);
  const sideSequins = createSideSequinSystem(28000);
  const sequins = createSequinCollection(frontSequins, backSequins, sideSequins);
  const promptGlyph = createPromptGlyph();

  body.frustumCulled = false;
  frontSeam.frustumCulled = false;
  backSeam.frustumCulled = false;
  frontSequins.mesh.frustumCulled = false;
  backSequins.mesh.frustumCulled = false;
  sideSequins.mesh.frustumCulled = false;
  promptGlyph.traverse((child) => {
    child.frustumCulled = false;
  });

  group.add(body, sideSequins.mesh, backSequins.mesh, frontSequins.mesh, frontSeam, backSeam, promptGlyph);

  return {
    brushTargets: [body],
    group,
    hitMesh: body,
    sequins,
    vertexCount: bodyGeometry.getAttribute("position").count,
  };
}

function createCushionGeometry() {
  const latBands = 72;
  const lonBands = 144;
  const positions = [];
  const uvs = [];
  const edgePressures = [];
  const indices = [];

  for (let lat = 0; lat <= latBands; lat += 1) {
    const theta = lat / latBands * Math.PI;
    const sinTheta = Math.sin(theta);

    for (let lon = 0; lon <= lonBands; lon += 1) {
      const phi = lon / lonBands * Math.PI * 2;
      const direction = new THREE.Vector3(
        sinTheta * Math.cos(phi),
        Math.cos(theta),
        sinTheta * Math.sin(phi),
      );
      const point = cushionPointFromDirection(direction);
      const edgePressure = smoothstep(0.78, 1, Math.hypot(direction.x, direction.y));

      positions.push(point.x, point.y, point.z);
      uvs.push(
        THREE.MathUtils.clamp(0.5 + point.x / (PILLOW_UV_EXTENT * 2), 0, 1),
        THREE.MathUtils.clamp(0.5 + point.y / (PILLOW_UV_EXTENT * 2), 0, 1),
      );
      edgePressures.push(edgePressure);
    }
  }

  const rowSize = lonBands + 1;

  for (let lat = 0; lat < latBands; lat += 1) {
    for (let lon = 0; lon < lonBands; lon += 1) {
      const a = lat * rowSize + lon;
      const b = a + 1;
      const c = a + rowSize;
      const d = c + 1;

      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("edgePressure", new THREE.Float32BufferAttribute(edgePressures, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  return geometry;
}

function cushionPointFromDirection(direction, offset = 0) {
  const radius = cushionRadius(direction) + offset;

  return new THREE.Vector3(
    direction.x * radius,
    direction.y * radius,
    direction.z * radius * PILLOW_DEPTH_SCALE,
  );
}

function cushionRadius(direction) {
  const planarAmount = Math.hypot(direction.x, direction.y);
  const outline = sampleCushionOutline(Math.atan2(direction.y, direction.x));
  const contourStrength = smoothstep(0.52, 0.98, planarAmount);
  const capRoundness = 0.952 + Math.pow(planarAmount, 1.8) * 0.048;
  const seamCompression = smoothstep(0.82, 1, planarAmount) * 0.034;
  const clothIrregularity = Math.sin(Math.atan2(direction.y, direction.x) * 5.0 + direction.z * 0.9) * 0.006
    * smoothstep(0.35, 0.92, planarAmount);

  return PILLOW_SCALE
    * THREE.MathUtils.lerp(0.982, outline, contourStrength)
    * capRoundness
    - seamCompression
    + clothIrregularity;
}

function cushionSurfacePointFromXY(x, y, side = FRONT_SIDE, offset = 0) {
  const planarRadius = Math.hypot(x, y);
  let unscaledZ = Math.sqrt(Math.max(0, Math.pow(PILLOW_SCALE * 1.08, 2) - planarRadius * planarRadius));
  const direction = new THREE.Vector3();

  for (let iteration = 0; iteration < 8; iteration += 1) {
    direction.set(x, y, side * unscaledZ).normalize();

    const radius = cushionRadius(direction) + offset;
    unscaledZ = Math.sqrt(Math.max(0, radius * radius - planarRadius * planarRadius));
  }

  return new THREE.Vector3(x, y, side * unscaledZ * PILLOW_DEPTH_SCALE);
}

function cushionNormalFromXY(x, y, side = FRONT_SIDE) {
  const epsilon = 0.006;
  const center = cushionSurfacePointFromXY(x, y, side);
  const dx = new THREE.Vector3()
    .subVectors(cushionSurfacePointFromXY(x + epsilon, y, side), cushionSurfacePointFromXY(x - epsilon, y, side));
  const dy = new THREE.Vector3()
    .subVectors(cushionSurfacePointFromXY(x, y + epsilon, side), cushionSurfacePointFromXY(x, y - epsilon, side));
  const normal = new THREE.Vector3().crossVectors(dx, dy).normalize();

  if (side < 0) {
    normal.negate();
  }

  if (normal.lengthSq() < 0.5) {
    normal.set(0, 0, side);
  }

  return { normal, point: center };
}

function createBoundarySamples(side, inset = 0.965, samples = 192) {
  const points = [];

  for (let index = 0; index < samples; index += 1) {
    const angle = index / samples * Math.PI * 2;
    const outline = sampleCushionOutline(angle) * PILLOW_SCALE * inset;
    const x = Math.cos(angle) * outline;
    const y = Math.sin(angle) * outline;

    points.push(cushionSurfacePointFromXY(x, y, side, 0.008));
  }

  return points;
}

function createSeamCord(side, inset, radius) {
  const points = createBoundarySamples(side, inset, 216);
  const curve = new THREE.CatmullRomCurve3(points, true, "catmullrom", 0.5);
  const geometry = new THREE.TubeGeometry(curve, 216, radius, 12, true);
  const mesh = new THREE.Mesh(geometry, seamMaterial);

  mesh.renderOrder = 2;

  return mesh;
}

function createSequinSystem(side = FRONT_SIDE, seedOffset = 0) {
  const records = [];
  const spacing = 0.052;
  const rowStep = spacing * 0.76;
  let row = 0;

  for (let y = -1.05; y <= 1.05; y += rowStep) {
    const xOffset = row % 2 === 0 ? 0 : spacing * 0.48;

    for (let x = -1.18 + xOffset; x <= 1.18; x += spacing) {
      const angle = Math.atan2(y, x);
      const distance = Math.hypot(x, y);
      const outline = sampleCushionOutline(angle) * PILLOW_SCALE;
      const radial = distance / outline;

      if (radial < 0.03 || distance + spacing * 0.66 > outline * 0.935) {
        continue;
      }

      const seed = seedOffset + records.length;
      const jitterX = (seededNoise(seed * 9.7) - 0.5) * spacing * 0.18;
      const jitterY = (seededNoise(seed * 13.1) - 0.5) * spacing * 0.18;
      const px = x + jitterX;
      const py = y + jitterY;
      const surface = cushionNormalFromXY(px, py, side);
      const tangent = new THREE.Vector3(1, 0, 0).projectOnVector(surface.normal).lengthSq() > 0.96
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(1, 0, 0);

      tangent.projectOnPlane(surface.normal).normalize();

      const bitangent = new THREE.Vector3().crossVectors(surface.normal, tangent).normalize();
      const baseHue = 0.595 + seededNoise(seed * 4.2) * 0.045;
      const frontColor = new THREE.Color().setHSL(
        baseHue,
        0.86,
        0.34 + seededNoise(seed * 6.3) * 0.16,
      );
      const reverseColor = new THREE.Color().setHSL(
        0.535 + seededNoise(seed * 8.6) * 0.045,
        0.44 + seededNoise(seed * 5.9) * 0.14,
        0.48 + seededNoise(seed * 7.1) * 0.12,
      );

      records.push({
        bitangent,
        flipped: false,
        frontColor,
        hinge: seededNoise(seed * 3.8) > 0.5 ? 1 : -1,
        normal: surface.normal,
        phase: seededNoise(seed * 11.7) * Math.PI * 2,
        position: surface.point.addScaledVector(surface.normal, 0.052 + seededNoise(seed * 15.2) * 0.004),
        radius: spacing * (0.58 + seededNoise(seed * 2.9) * 0.07),
        reverseColor,
        scaleX: 0.95 + seededNoise(seed * 18.8) * 0.12,
        scaleY: 0.9 + seededNoise(seed * 21.6) * 0.16,
        spin: seededNoise(seed * 5.4) * Math.PI * 2,
        tangent,
        x: px,
        y: py,
      });
    }

    row += 1;
  }

  const geometry = createSequinGeometry();
  const mesh = new THREE.InstancedMesh(geometry, sequinMaterial, records.length);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const qBase = new THREE.Quaternion();
  const qSpin = new THREE.Quaternion();
  const qTilt = new THREE.Quaternion();
  const tiltAxis = new THREE.Vector3(1, 0, 0);

  function updateInstance(index) {
    const record = records[index];
    const tilt = record.flipped
      ? record.hinge * (0.35 + seededNoise((seedOffset + index) * 12.5) * 0.12)
      : record.hinge * (-0.05 + seededNoise((seedOffset + index) * 10.4) * 0.08);

    qBase.setFromUnitVectors(zAxis, record.normal);
    qSpin.setFromAxisAngle(zAxis, record.spin);
    qTilt.setFromAxisAngle(tiltAxis, tilt);

    dummy.position.copy(record.position);
    dummy.position.addScaledVector(record.normal, record.flipped ? 0.012 : 0);
    dummy.quaternion.copy(qBase).multiply(qSpin).multiply(qTilt);
    dummy.scale.set(record.radius * record.scaleX, record.radius * record.scaleY, record.radius);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);

    color.copy(record.flipped ? record.reverseColor : record.frontColor);
    mesh.setColorAt(index, color);
  }

  records.forEach((_, index) => updateInstance(index));
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  mesh.renderOrder = 4;

  return {
    count: records.length,
    flippedCount: 0,
    mesh,
    records,
    reset() {
      this.flippedCount = 0;

      records.forEach((record, index) => {
        record.flipped = false;
        updateInstance(index);
      });

      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    },
    brushAt(localPoint, radius, direction) {
      let touched = 0;
      const strokeAngle = Math.atan2(direction.y, direction.x) + Math.PI * 0.5;
      const targetFlipped = direction.x + direction.y * 0.16 >= 0;
      const hinge = targetFlipped ? 1 : -1;
      const alongScale = 1.55;
      const crossScale = 0.68;

      records.forEach((record, index) => {
        const deltaX = record.x - localPoint.x;
        const deltaY = record.y - localPoint.y;
        const along = deltaX * direction.x + deltaY * direction.y;
        const cross = deltaX * -direction.y + deltaY * direction.x;
        const effectiveDistance = Math.hypot(along / alongScale, cross / crossScale);

        if (effectiveDistance <= radius) {
          const edgeFade = 1 - smoothstep(radius * 0.58, radius, effectiveDistance);

          if (record.flipped !== targetFlipped) {
            this.flippedCount += targetFlipped ? 1 : -1;
          }

          record.flipped = targetFlipped;
          record.hinge = hinge;
          record.spin = strokeAngle + (seededNoise((seedOffset + index) * 23.9) - 0.5) * 0.18;

          if (targetFlipped) {
            const seed = seedOffset + index;
            const sweep = along / radius;
            const lane = 1 - THREE.MathUtils.clamp(Math.abs(cross) / (radius * crossScale), 0, 1);
            const napLight = THREE.MathUtils.clamp(
              0.47 + sweep * 0.045 + lane * edgeFade * 0.065 + (seededNoise(seed * 31.4) - 0.5) * 0.045,
              0.42,
              0.59,
            );

            record.reverseColor.setHSL(
              0.535 + seededNoise(seed * 8.6) * 0.045,
              0.43 + seededNoise(seed * 5.9) * 0.13,
              napLight,
            );
          }

          updateInstance(index);
          touched += 1;
        }
      });

      if (touched > 0) {
        this.flippedCount = Math.max(0, Math.min(records.length, this.flippedCount));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
      }

      return touched;
    },
  };
}

function createSideSequinSystem(seedOffset = 0) {
  const records = [];
  const depthRowCount = 23;
  const angleCount = 240;
  const spacing = 0.052;

  for (let row = 0; row < depthRowCount; row += 1) {
    const depth = -1 + (row / (depthRowCount - 1)) * 2;

    for (let index = 0; index < angleCount; index += 1) {
      const seed = seedOffset + records.length;
      const angle = ((index + (row % 2) * 0.5) / angleCount) * Math.PI * 2;
      const jitterAngle = (seededNoise(seed * 12.4) - 0.5) * 0.018;
      const jitterDepth = (seededNoise(seed * 7.8) - 0.5) * 0.028;
      const sideAngle = angle + jitterAngle;
      const sideDepth = depth + jitterDepth;
      const direction = new THREE.Vector3(
        Math.cos(sideAngle),
        Math.sin(sideAngle),
        sideDepth,
      ).normalize();
      const surfacePoint = cushionPointFromDirection(direction);
      const normal = new THREE.Vector3(
        direction.x,
        direction.y,
        direction.z / PILLOW_DEPTH_SCALE,
      ).normalize();
      const tangent = new THREE.Vector3(-Math.sin(sideAngle), Math.cos(sideAngle), 0)
        .projectOnPlane(normal)
        .normalize();
      const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
      const baseHue = 0.595 + seededNoise(seed * 4.2) * 0.045;
      const frontColor = new THREE.Color().setHSL(
        baseHue,
        0.84,
        0.33 + seededNoise(seed * 6.3) * 0.15,
      );
      const reverseColor = new THREE.Color().setHSL(
        0.535 + seededNoise(seed * 8.6) * 0.045,
        0.43 + seededNoise(seed * 5.9) * 0.13,
        0.48 + seededNoise(seed * 7.1) * 0.11,
      );

      records.push({
        bitangent,
        flipped: false,
        frontColor,
        hinge: seededNoise(seed * 3.8) > 0.5 ? 1 : -1,
        normal,
        phase: seededNoise(seed * 11.7) * Math.PI * 2,
        position: surfacePoint.clone().addScaledVector(normal, 0.061 + seededNoise(seed * 15.2) * 0.004),
        radius: spacing * (0.76 + seededNoise(seed * 2.9) * 0.08),
        reverseColor,
        scaleX: 1.02 + seededNoise(seed * 18.8) * 0.12,
        scaleY: 0.98 + seededNoise(seed * 21.6) * 0.14,
        spin: seededNoise(seed * 5.4) * Math.PI * 2,
        surfacePoint,
        tangent,
        x: surfacePoint.x,
        y: surfacePoint.y,
      });
    }
  }

  const geometry = createSequinGeometry();
  const mesh = new THREE.InstancedMesh(geometry, sequinMaterial, records.length);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const qBase = new THREE.Quaternion();
  const qSpin = new THREE.Quaternion();
  const qTilt = new THREE.Quaternion();
  const tiltAxis = new THREE.Vector3(1, 0, 0);

  function updateInstance(index) {
    const record = records[index];
    const tilt = record.flipped
      ? record.hinge * (0.35 + seededNoise((seedOffset + index) * 12.5) * 0.12)
      : record.hinge * (-0.05 + seededNoise((seedOffset + index) * 10.4) * 0.08);

    qBase.setFromUnitVectors(zAxis, record.normal);
    qSpin.setFromAxisAngle(zAxis, record.spin);
    qTilt.setFromAxisAngle(tiltAxis, tilt);

    dummy.position.copy(record.position);
    dummy.position.addScaledVector(record.normal, record.flipped ? 0.012 : 0);
    dummy.quaternion.copy(qBase).multiply(qSpin).multiply(qTilt);
    dummy.scale.set(record.radius * record.scaleX, record.radius * record.scaleY, record.radius);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);

    color.copy(record.flipped ? record.reverseColor : record.frontColor);
    mesh.setColorAt(index, color);
  }

  records.forEach((_, index) => updateInstance(index));
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  mesh.renderOrder = 4;

  return {
    count: records.length,
    flippedCount: 0,
    mesh,
    records,
    reset() {
      this.flippedCount = 0;

      records.forEach((record, index) => {
        record.flipped = false;
        updateInstance(index);
      });

      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    },
    brushAt(localPoint, radius, direction) {
      let touched = 0;
      const strokeAngle = Math.atan2(direction.y, direction.x) + Math.PI * 0.5;
      const targetFlipped = direction.x + direction.y * 0.16 >= 0;
      const hinge = targetFlipped ? 1 : -1;
      const sideRadius = radius * 0.86;

      records.forEach((record, index) => {
        const distance = record.surfacePoint.distanceTo(localPoint);

        if (distance <= sideRadius) {
          const seed = seedOffset + index;
          const edgeFade = 1 - smoothstep(sideRadius * 0.55, sideRadius, distance);

          if (record.flipped !== targetFlipped) {
            this.flippedCount += targetFlipped ? 1 : -1;
          }

          record.flipped = targetFlipped;
          record.hinge = hinge;
          record.spin = strokeAngle + (seededNoise(seed * 23.9) - 0.5) * 0.18;

          if (targetFlipped) {
            record.reverseColor.setHSL(
              0.535 + seededNoise(seed * 8.6) * 0.045,
              0.43 + seededNoise(seed * 5.9) * 0.13,
              THREE.MathUtils.clamp(
                0.45 + edgeFade * 0.085 + (seededNoise(seed * 31.4) - 0.5) * 0.04,
                0.41,
                0.57,
              ),
            );
          }

          updateInstance(index);
          touched += 1;
        }
      });

      if (touched > 0) {
        this.flippedCount = Math.max(0, Math.min(records.length, this.flippedCount));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
      }

      return touched;
    },
  };
}

function createSequinCollection(front, back, side) {
  return {
    back,
    count: front.count + back.count + side.count,
    front,
    side,
    get flippedCount() {
      return front.flippedCount + back.flippedCount + side.flippedCount;
    },
    reset() {
      front.reset();
      back.reset();
      side.reset();
    },
    brushAt(localPoint, radius, direction) {
      return (isSideBrushPoint(localPoint) ? side : localPoint.z >= 0 ? front : back)
        .brushAt(localPoint, radius, direction);
    },
  };
}

function isSideBrushPoint(localPoint) {
  const angle = Math.atan2(localPoint.y, localPoint.x);
  const outline = sampleCushionOutline(angle) * PILLOW_SCALE;
  const radial = Math.hypot(localPoint.x, localPoint.y) / outline;

  return Math.abs(localPoint.z) < 0.18 || radial > 0.86;
}

function createPromptGlyph() {
  const group = new THREE.Group();
  const paths = [
    {
      points: createChevronGlyphPath(),
      radius: 0.064,
    },
    {
      points: [new THREE.Vector2(0.02, -0.285), new THREE.Vector2(0.52, -0.285)],
      radius: 0.056,
    },
  ];

  addPromptGlyphSide(group, paths, FRONT_SIDE, false);
  addPromptGlyphSide(group, paths, -FRONT_SIDE, true);

  return group;
}

function createChevronGlyphPath() {
  const top = new THREE.Vector2(-0.5, 0.31);
  const corner = new THREE.Vector2(-0.075, 0.015);
  const bottom = new THREE.Vector2(-0.5, -0.28);
  const topDirection = new THREE.Vector2().subVectors(top, corner).normalize();
  const bottomDirection = new THREE.Vector2().subVectors(bottom, corner).normalize();
  const topInner = new THREE.Vector2().copy(corner).addScaledVector(topDirection, 0.116);
  const bottomInner = new THREE.Vector2().copy(corner).addScaledVector(bottomDirection, 0.116);
  const points = [];

  appendLinePoints(points, top, topInner, 12);
  appendQuadraticPoints(points, topInner, new THREE.Vector2(-0.012, 0.015), bottomInner, 14);
  appendLinePoints(points, bottomInner, bottom, 12);

  return points;
}

function appendLinePoints(points, start, end, steps) {
  const initialStep = points.length === 0 ? 0 : 1;

  for (let index = initialStep; index <= steps; index += 1) {
    const t = index / steps;

    points.push(new THREE.Vector2(
      THREE.MathUtils.lerp(start.x, end.x, t),
      THREE.MathUtils.lerp(start.y, end.y, t),
    ));
  }
}

function appendQuadraticPoints(points, start, control, end, steps) {
  for (let index = 1; index <= steps; index += 1) {
    const t = index / steps;
    const invT = 1 - t;

    points.push(new THREE.Vector2(
      invT * invT * start.x + 2 * invT * t * control.x + t * t * end.x,
      invT * invT * start.y + 2 * invT * t * control.y + t * t * end.y,
    ));
  }
}

function addPromptGlyphSide(group, paths, side, mirrorX) {
  paths.forEach((path) => {
    const points = path.points.map((point) => (
      mirrorX ? new THREE.Vector2(-point.x, point.y) : point
    ));
    const foregroundRadius = path.radius;

    group.add(createRaisedGlyphPath(points, foregroundRadius + 0.007, 0.078, glyphShadowMaterial, 4.5, side));
    group.add(createRaisedGlyphPath(points, foregroundRadius, 0.11, glyphMaterial, 6, side));
  });
}

function createRaisedGlyphPath(path, radius, offset, material, renderOrder, side = FRONT_SIDE) {
  const points = [];
  const group = new THREE.Group();

  path.forEach((point) => {
    points.push(cushionSurfacePointFromXY(point.x, point.y, side, offset));
  });

  const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.08);
  const geometry = new THREE.TubeGeometry(curve, Math.max(34, points.length * 2), radius, 18, false);
  const mesh = new THREE.Mesh(geometry, material);

  mesh.renderOrder = renderOrder;
  group.add(mesh);
  group.add(createGlyphEndCap(points[0], radius, material, renderOrder));
  group.add(createGlyphEndCap(points[points.length - 1], radius, material, renderOrder));

  return group;
}

function createGlyphEndCap(position, radius, material, renderOrder) {
  const geometry = new THREE.SphereGeometry(radius * 1.01, 18, 12);
  const mesh = new THREE.Mesh(geometry, material);

  mesh.position.copy(position);
  mesh.renderOrder = renderOrder;

  return mesh;
}

function createSequinGeometry() {
  const segments = 22;
  const rings = [
    { radius: 0, z: -0.026 },
    { radius: 0.34, z: -0.014 },
    { radius: 0.72, z: 0.01 },
    { radius: 1, z: -0.006 },
  ];
  const positions = [];
  const normals = [];
  const indices = [];

  rings.forEach((ring) => {
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = segment / segments * Math.PI * 2;
      const ripple = 1
        + Math.sin(angle * 3.0) * 0.012
        + Math.cos(angle * 5.0) * 0.008;
      const x = Math.cos(angle) * ring.radius * ripple;
      const y = Math.sin(angle) * ring.radius * ripple;

      positions.push(x, y, ring.z);
      normals.push(0, -ring.z * 8 + 0.05, 1);
    }
  });

  for (let ring = 0; ring < rings.length - 1; ring += 1) {
    const current = ring * segments;
    const next = (ring + 1) * segments;

    for (let segment = 0; segment < segments; segment += 1) {
      const a = current + segment;
      const b = current + (segment + 1) % segments;
      const c = next + segment;
      const d = next + (segment + 1) % segments;

      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();

  geometry.setIndex(indices);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  return geometry;
}

function createFabricMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      baseColor: { value: new THREE.Color(0x122d62) },
      deepColor: { value: new THREE.Color(0x091a3a) },
      hover: { value: 0 },
      lightA: { value: new THREE.Vector3(-3.2, 2.4, 3.7) },
      lightB: { value: new THREE.Vector3(2.7, 1.2, 2.7) },
      time: { value: 0 },
      warmColor: { value: new THREE.Color(0x7b6b56) },
    },
    vertexShader: `
      attribute float edgePressure;

      varying float vEdgePressure;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      void main() {
        vUv = uv;
        vEdgePressure = edgePressure;
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 baseColor;
      uniform vec3 deepColor;
      uniform float hover;
      uniform vec3 lightA;
      uniform vec3 lightB;
      uniform float time;
      uniform vec3 warmColor;

      varying float vEdgePressure;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      float clamp01(float value) {
        return clamp(value, 0.0, 1.0);
      }

      void main() {
        vec3 normal = normalize(vNormal);
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        vec3 lightDirectionA = normalize(lightA - vWorldPosition);
        vec3 lightDirectionB = normalize(lightB - vWorldPosition);
        float woven = sin(vUv.y * 260.0 + sin(vUv.x * 28.0) * 1.2) * 0.018
          + sin(vUv.x * 210.0) * 0.008;
        float diffuse = clamp01(dot(normal, lightDirectionA) * 0.45 + 0.55);
        float fill = clamp01(dot(normal, lightDirectionB) * 0.5 + 0.5);
        float rim = pow(1.0 - clamp01(dot(normal, viewDirection)), 2.4);
        vec3 color = mix(deepColor, baseColor, 0.54 + diffuse * 0.34 + fill * 0.2 + woven);

        color = mix(color, warmColor, 0.05 + rim * 0.08);
        color *= 1.0 - vEdgePressure * 0.24;
        color += vec3(0.06, 0.12, 0.19) * rim * (0.16 + hover * 0.06);

        gl_FragColor = vec4(color, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });
}

function createSeamMaterial() {
  return new THREE.MeshPhysicalMaterial({
    clearcoat: 0.08,
    color: 0x1a4d7d,
    metalness: 0,
    opacity: 0.48,
    roughness: 0.84,
    sheen: 1,
    sheenColor: 0x4d8ed2,
    sheenRoughness: 0.92,
    transparent: true,
  });
}

function createSequinMaterial() {
  return new THREE.ShaderMaterial({
    fragmentShader: `
      uniform vec3 lightA;
      uniform vec3 lightB;
      uniform float time;

      varying vec3 vColor;
      varying vec2 vDiskUv;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;

      float sat(float value) {
        return clamp(value, 0.0, 1.0);
      }

      void main() {
        vec3 normal = normalize(vWorldNormal);
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        vec3 lightDirectionA = normalize(lightA - vWorldPosition);
        vec3 lightDirectionB = normalize(lightB - vWorldPosition);
        vec3 halfA = normalize(lightDirectionA + viewDirection);
        vec3 halfB = normalize(lightDirectionB + viewDirection);
        float facing = sat(dot(normal, viewDirection));
        float radius = length(vDiskUv);
        float bevel = smoothstep(0.72, 0.99, radius);
        float pin = 1.0 - smoothstep(0.05, 0.16, radius);
        float hingeShadow = smoothstep(0.48, 0.9, vDiskUv.y) * smoothstep(1.02, 0.72, radius);
        float lowerLip = smoothstep(-0.82, -0.54, vDiskUv.y) * smoothstep(0.96, 0.64, radius);
        float diffuseA = sat(dot(normal, lightDirectionA));
        float diffuseB = sat(dot(normal, lightDirectionB));
        float specA = pow(sat(dot(normal, halfA)), 34.0);
        float specB = pow(sat(dot(normal, halfB)), 54.0);
        float crescent = smoothstep(0.1, 0.0, abs(vDiskUv.y - 0.26))
          * smoothstep(0.82, 0.2, abs(vDiskUv.x + 0.14));
        float crossSheen = sin((vDiskUv.x * 12.0 + vDiskUv.y * 7.0) + vWorldPosition.x * 4.0) * 0.035;
        float rim = pow(1.0 - facing, 1.9);
        vec3 color = vColor * (0.48 + diffuseA * 0.62 + diffuseB * 0.22 + facing * 0.12 + crossSheen);

        color += vec3(0.75, 0.95, 1.0) * (specA * 0.8 + specB * 0.42 + crescent * 0.18);
        color += vec3(0.16, 0.43, 0.9) * rim * 0.18;
        color *= 1.0 - bevel * 0.16 - pin * 0.32 - hingeShadow * 0.16 - lowerLip * 0.1;
        color += vec3(0.02, 0.045, 0.09) * pin;

        gl_FragColor = vec4(color, 1.0);
      }
    `,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
    uniforms: {
      lightA: { value: new THREE.Vector3(-3.2, 2.4, 3.7) },
      lightB: { value: new THREE.Vector3(2.7, 1.2, 2.7) },
      time: { value: 0 },
    },
    vertexShader: `
      varying vec3 vColor;
      varying vec2 vDiskUv;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;

      void main() {
        vColor = instanceColor;
        vDiskUv = position.xy;

        vec4 instancedPosition = instanceMatrix * vec4(position, 1.0);
        vec4 worldPosition = modelMatrix * instancedPosition;
        vWorldPosition = worldPosition.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
  });
}

function createGlyphMaterial() {
  return new THREE.MeshPhysicalMaterial({
    clearcoat: 0.62,
    clearcoatRoughness: 0.18,
    color: 0xf8fdff,
    emissive: 0xbcefff,
    emissiveIntensity: 0.14,
    metalness: 0.02,
    reflectivity: 0.48,
    roughness: 0.28,
  });
}

function createGlyphShadowMaterial() {
  return new THREE.MeshPhysicalMaterial({
    clearcoat: 0.12,
    clearcoatRoughness: 0.58,
    color: 0x8fd6ee,
    emissive: 0x1f6d9b,
    emissiveIntensity: 0.08,
    metalness: 0,
    opacity: 0.46,
    roughness: 0.72,
    transparent: true,
  });
}

function createContactShadow(texture) {
  const shadow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      color: 0x5e6672,
      depthWrite: false,
      map: texture,
      opacity: 0.2,
      transparent: true,
    }),
  );

  shadow.position.set(0, -1.07, 0.16);
  shadow.scale.set(2.58, 0.54, 1);
  shadow.renderOrder = -2;

  return shadow;
}

function createLightRig() {
  const specs = [
    { color: 0xffe7c8, intensity: 5.4, position: [-3.2, 2.4, 3.7], speed: 0.11 },
    { color: 0x8ed2ff, intensity: 4.5, position: [2.7, 1.2, 2.7], speed: -0.16 },
    { color: 0xffffff, intensity: 2.9, position: [0.2, -1.8, 3.2], speed: 0.1 },
  ];

  scene.add(new THREE.AmbientLight(0xffffff, 0.76));
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcac4b7, 0.82));

  return specs.map((spec) => {
    const light = new THREE.PointLight(spec.color, spec.intensity, 9, 1.85);
    light.position.fromArray(spec.position);
    scene.add(light);

    return { ...spec, light, origin: new THREE.Vector3(...spec.position) };
  });
}

function updateLights(elapsed) {
  lightRig.forEach((rig, index) => {
    rig.light.position.set(
      rig.origin.x + Math.sin(elapsed * rig.speed + index) * 0.34,
      rig.origin.y + Math.cos(elapsed * rig.speed * 1.35 + index) * 0.18,
      rig.origin.z + Math.sin(elapsed * rig.speed * 0.75 + index * 2.1) * 0.34,
    );
  });

  fabricMaterial.uniforms.lightA.value.copy(lightRig[0].light.position);
  fabricMaterial.uniforms.lightB.value.copy(lightRig[1].light.position);
  sequinMaterial.uniforms.lightA.value.copy(lightRig[0].light.position);
  sequinMaterial.uniforms.lightB.value.copy(lightRig[1].light.position);
}

function createShadowTexture() {
  const textureCanvas = document.createElement("canvas");
  const size = 512;
  const context = textureCanvas.getContext("2d");

  textureCanvas.width = size;
  textureCanvas.height = size;

  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(0, 0, 0, 0.82)");
  gradient.addColorStop(0.52, "rgba(0, 0, 0, 0.34)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  return new THREE.CanvasTexture(textureCanvas);
}

function sampleIconOutline(angle) {
  const normalizedAngle = (angle + Math.PI * 2) % (Math.PI * 2);
  const samplePosition = (normalizedAngle / (Math.PI * 2)) * ICON_OUTLINE_SAMPLES.length;
  const sampleIndex = Math.floor(samplePosition);
  const nextIndex = (sampleIndex + 1) % ICON_OUTLINE_SAMPLES.length;
  const t = samplePosition - sampleIndex;

  return THREE.MathUtils.lerp(
    ICON_OUTLINE_SAMPLES[sampleIndex],
    ICON_OUTLINE_SAMPLES[nextIndex],
    t,
  );
}

function sampleCushionOutline(angle) {
  const rawOutline = sampleIconOutline(angle);
  const outlineDelta = rawOutline - 1;

  return 1 + outlineDelta * (outlineDelta < 0 ? 1.32 : 1.18);
}

function smoothstep(edge0, edge1, value) {
  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);

  return t * t * (3 - 2 * t);
}

function seededNoise(seed) {
  const value = Math.sin(seed * 12.9898) * 43758.5453123;

  return value - Math.floor(value);
}
