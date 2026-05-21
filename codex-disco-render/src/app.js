import * as THREE from "../lib/three.module.min.js";

const canvas = document.querySelector("#scene");
const toggleButton = document.querySelector("#toggle-motion");
const speedInput = document.querySelector("#speed");

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  canvas,
  powerPreference: "high-performance",
});

renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.setClearColor(0x02020a, 1);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02020a);
scene.fog = new THREE.FogExp2(0x030314, 0.045);

const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 80);
camera.position.set(0, 0.14, 5.35);

const pointer = new THREE.Vector2();
let firstFrameTime = getNow();
let lastFrameTime = firstFrameTime;
const qaState = {
  angularVelocity: [0, 0, 0],
  frameCount: 0,
  isDragging: false,
  renderReady: false,
  rotationX: -0.08,
  rotationY: 0,
  rotationZ: 0.02,
  tileCount: 0,
  animatedTileColor: [0, 0, 0],
};

window.__discoQA = qaState;

// 96 radial samples extracted from /Applications/Codex.app/Contents/Resources/icon.icns.
// They capture the inner blue Codex icon silhouette, not the macOS white app tile.
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
const GLYPH_SEGMENTS = [
  [new THREE.Vector2(-0.55, 0.43), new THREE.Vector2(-0.2, 0.02)],
  [new THREE.Vector2(-0.55, -0.39), new THREE.Vector2(-0.2, 0.02)],
  [new THREE.Vector2(0.08, -0.28), new THREE.Vector2(0.64, -0.28)],
];
const DEPTH_SCALE = 0.46;
const GLYPH_RECESS_RADIUS = 0.086;
const DEFAULT_SPIN_RATE = 0.52;
const HINGE_ROTATION_X = -0.08;
const HINGE_ROTATION_Z = 0.02;
const DRAG_ROTATION_PER_PIXEL = 0.0049;
const MAX_INTERACTION_VELOCITY = 5.4;

const environmentTexture = createEnvironmentTexture();
scene.environment = environmentTexture;

scene.add(new THREE.AmbientLight(0x2a35a5, 0.72));

const ballGroup = new THREE.Group();
ballGroup.rotation.set(HINGE_ROTATION_X, -0.4, HINGE_ROTATION_Z);
scene.add(ballGroup);

const core = createCoreSurface();
const tileSystem = createCodexDiscoTiles();
const glyph = createPromptGlyph();
const glints = createSurfaceGlints();
const auraShell = createAuraShell();

ballGroup.add(core);
ballGroup.add(tileSystem.mesh);
ballGroup.add(glyph);
ballGroup.add(auraShell);
glints.forEach((glint) => ballGroup.add(glint.sprite));

qaState.tileCount = tileSystem.tiles.length;

const lightRig = createDiscoLights();
const caustics = createCausticShards();
const grid = createFloorGrid();
const dust = createStarfield();
scene.add(caustics.group);
scene.add(grid);
scene.add(dust);

let paused = false;
let speed = Number.parseFloat(speedInput.value);
const angularVelocity = new THREE.Vector3(0, DEFAULT_SPIN_RATE * speed, 0);
const dragState = {
  isDragging: false,
  lastTime: 0,
  lastX: 0,
  pointerId: null,
};

toggleButton.addEventListener("click", () => {
  paused = !paused;
  toggleButton.classList.toggle("is-paused", paused);
  toggleButton.setAttribute("aria-label", paused ? "Resume rotation" : "Pause rotation");
  toggleButton.setAttribute("title", paused ? "Resume rotation" : "Pause rotation");
});

speedInput.addEventListener("input", () => {
  speed = Number.parseFloat(speedInput.value);
});

canvas.addEventListener("pointerdown", handlePointerDown);
canvas.addEventListener("pointermove", handlePointerMove);
canvas.addEventListener("pointerup", handlePointerUp);
canvas.addEventListener("pointercancel", handlePointerUp);

window.addEventListener("pointermove", (event) => {
  pointer.x = (event.clientX / window.innerWidth - 0.5) * 2;
  if (!dragState.isDragging) {
    pointer.y = (event.clientY / window.innerHeight - 0.5) * 2;
  }
});

window.addEventListener("resize", resize);
resize();
animate();

function animate() {
  requestAnimationFrame(animate);

  const now = getNow();
  const delta = Math.min((now - lastFrameTime) / 1000, 0.033);
  const elapsed = (now - firstFrameTime) / 1000;
  lastFrameTime = now;

  if (!dragState.isDragging) {
    const defaultSpin = paused ? 0 : DEFAULT_SPIN_RATE * speed;
    const settle = 1 - Math.exp(-delta * 1.55);
    angularVelocity.x = 0;
    angularVelocity.y = THREE.MathUtils.lerp(angularVelocity.y, defaultSpin, settle);
    angularVelocity.z = 0;
    applyAngularVelocity(delta);
  }

  camera.position.x += (pointer.x * 0.34 - camera.position.x) * 0.038;
  camera.position.y += (0.16 - pointer.y * 0.18 - camera.position.y) * 0.038;
  camera.lookAt(0, 0, 0);

  animateLights(elapsed);
  ballGroup.updateMatrixWorld(true);
  updateTileReflections(elapsed);
  updateGlints(elapsed);
  updateAura(elapsed);
  updateCausticShards(elapsed);

  dust.rotation.y = elapsed * 0.012;
  grid.material.opacity = 0.18 + Math.sin(elapsed * 0.7) * 0.025;

  renderer.render(scene, camera);

  qaState.frameCount += 1;
  qaState.angularVelocity = [
    Number(angularVelocity.x.toFixed(4)),
    Number(angularVelocity.y.toFixed(4)),
    Number(angularVelocity.z.toFixed(4)),
  ];
  qaState.isDragging = dragState.isDragging;
  qaState.renderReady = true;
  qaState.rotationX = ballGroup.rotation.x;
  qaState.rotationY = ballGroup.rotation.y;
  qaState.rotationZ = ballGroup.rotation.z;
  canvas.dataset.angularVelocity = qaState.angularVelocity.join(",");
  canvas.dataset.frameCount = String(qaState.frameCount);
  canvas.dataset.isDragging = String(qaState.isDragging);
  canvas.dataset.renderReady = String(qaState.renderReady);
  canvas.dataset.rotationX = qaState.rotationX.toFixed(5);
  canvas.dataset.rotationY = qaState.rotationY.toFixed(5);
  canvas.dataset.rotationZ = qaState.rotationZ.toFixed(5);
  canvas.dataset.tileCount = String(qaState.tileCount);
  canvas.dataset.animatedTileColor = qaState.animatedTileColor.join(",");
}

function applyAngularVelocity(delta) {
  ballGroup.rotation.x = HINGE_ROTATION_X;
  ballGroup.rotation.y += angularVelocity.y * delta;
  ballGroup.rotation.z = HINGE_ROTATION_Z;
}

function handlePointerDown(event) {
  if (event.button !== undefined && event.button !== 0) {
    return;
  }

  dragState.isDragging = true;
  dragState.lastTime = getNow();
  dragState.lastX = event.clientX;
  dragState.pointerId = event.pointerId;
  angularVelocity.x = 0;
  angularVelocity.z = 0;
  ballGroup.rotation.x = HINGE_ROTATION_X;
  ballGroup.rotation.z = HINGE_ROTATION_Z;
  canvas.setPointerCapture(event.pointerId);
  document.body.classList.add("is-dragging-scene");
  event.preventDefault();
}

function handlePointerMove(event) {
  const normalized = pointerToNdc(event);

  pointer.x = normalized.x;

  if (!dragState.isDragging || event.pointerId !== dragState.pointerId) {
    pointer.y = normalized.y;
    return;
  }

  const now = getNow();
  const dt = Math.max((now - dragState.lastTime) / 1000, 0.008);
  const dx = event.clientX - dragState.lastX;
  const nextVelocityY = THREE.MathUtils.clamp(
    dx * DRAG_ROTATION_PER_PIXEL / dt,
    -MAX_INTERACTION_VELOCITY,
    MAX_INTERACTION_VELOCITY,
  );

  ballGroup.rotation.x = HINGE_ROTATION_X;
  ballGroup.rotation.y += dx * DRAG_ROTATION_PER_PIXEL;
  ballGroup.rotation.z = HINGE_ROTATION_Z;

  angularVelocity.x = 0;
  angularVelocity.y = THREE.MathUtils.lerp(angularVelocity.y, nextVelocityY, 0.62);
  angularVelocity.z = 0;

  dragState.lastTime = now;
  dragState.lastX = event.clientX;
  event.preventDefault();
}

function handlePointerUp(event) {
  if (!dragState.isDragging || event.pointerId !== dragState.pointerId) {
    return;
  }

  dragState.isDragging = false;
  dragState.pointerId = null;
  document.body.classList.remove("is-dragging-scene");

  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
}

function pointerToNdc(event) {
  const rect = canvas.getBoundingClientRect();

  return {
    x: ((event.clientX - rect.left) / rect.width - 0.5) * 2,
    y: ((event.clientY - rect.top) / rect.height - 0.5) * 2,
  };
}

function getNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const aspect = width / height;
  const responsivePullback = THREE.MathUtils.clamp(1.06 / aspect, 1, 2.28);

  camera.aspect = aspect;
  camera.position.z = 5.35 * responsivePullback;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function createCodexDiscoTiles() {
  const latBands = 40;
  const lonBands = 82;
  const positions = [];
  const normals = [];
  const colors = [];
  const tiles = [];
  const color = new THREE.Color();
  const vertexOrder = [0, 1, 2, 0, 2, 3];

  for (let lat = 1; lat < latBands - 1; lat += 1) {
    const theta0 = (lat / latBands) * Math.PI;
    const theta1 = ((lat + 1) / latBands) * Math.PI;

    for (let lon = 0; lon < lonBands; lon += 1) {
      const phi0 = (lon / lonBands) * Math.PI * 2;
      const phi1 = ((lon + 1) / lonBands) * Math.PI * 2;

      const corners = [
        surfacePoint(theta0, phi0, 0.012),
        surfacePoint(theta0, phi1, 0.012),
        surfacePoint(theta1, phi1, 0.012),
        surfacePoint(theta1, phi0, 0.012),
      ];

      const center = corners
        .reduce((sum, point) => sum.add(point), new THREE.Vector3())
        .multiplyScalar(0.25);
      const normal = new THREE.Vector3()
        .crossVectors(
          new THREE.Vector3().subVectors(corners[1], corners[0]),
          new THREE.Vector3().subVectors(corners[3], corners[0]),
        )
        .normalize();

      if (normal.dot(center) < 0) {
        normal.negate();
      }

      if (
        Math.abs(center.z) > 0.16
        && isPointInsideGlyphRecess(center.x, center.y, GLYPH_RECESS_RADIUS, Math.sign(center.z))
      ) {
        continue;
      }

      const hue = 0.62 + seededNoise(lat * 17.1 + lon * 3.7) * 0.12;
      const saturation = 0.54 + seededNoise(lat * 9.8 - lon * 2.3) * 0.32;
      const lightness = 0.33 + seededNoise(lat * 1.9 + lon * 11.2) * 0.24;
      const baseColor = new THREE.Color().setHSL(hue, saturation, lightness);
      const colorOffset = colors.length;

      vertexOrder.forEach((cornerIndex) => {
        const point = corners[cornerIndex];
        positions.push(point.x, point.y, point.z);
        normals.push(normal.x, normal.y, normal.z);
        colors.push(baseColor.r, baseColor.g, baseColor.b);
      });

      tiles.push({
        baseColor,
        center,
        colorOffset,
        normal,
        phase: seededNoise(lat * 15.7 + lon * 6.4) * Math.PI * 2,
      });
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();

  const material = new THREE.MeshPhysicalMaterial({
    clearcoat: 1,
    clearcoatRoughness: 0.14,
    envMap: environmentTexture,
    envMapIntensity: 3.2,
    metalness: 1,
    reflectivity: 1,
    roughness: 0.16,
    side: THREE.DoubleSide,
    vertexColors: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  return {
    colorAttribute: geometry.getAttribute("color"),
    mesh,
    tiles,
  };
}

function updateTileReflections(elapsed) {
  const worldNormal = new THREE.Vector3();
  const worldCenter = new THREE.Vector3();
  const viewDirection = new THREE.Vector3();
  const lightDirection = new THREE.Vector3();
  const halfVector = new THREE.Vector3();
  const finalColor = new THREE.Color();
  const matrixWorld = ballGroup.matrixWorld;
  const colorArray = tileSystem.colorAttribute.array;

  tileSystem.tiles.forEach((tile, tileIndex) => {
    worldNormal.copy(tile.normal).transformDirection(matrixWorld);
    worldCenter.copy(tile.center).applyMatrix4(matrixWorld);
    viewDirection.copy(camera.position).sub(worldCenter).normalize();

    const rim = Math.pow(Math.max(0, 1 - worldNormal.dot(viewDirection)), 2.4) * 0.24;
    const pulse = Math.sin(elapsed * 3.1 + tile.phase) * 0.035;

    finalColor
      .copy(tile.baseColor)
      .multiplyScalar(0.46 + rim + pulse);

    lightRig.forEach((rig) => {
      lightDirection.copy(rig.light.position).sub(worldCenter).normalize();
      halfVector.copy(lightDirection).add(viewDirection).normalize();

      const diffuse = Math.max(0, worldNormal.dot(lightDirection));
      const sparkle = Math.pow(Math.max(0, worldNormal.dot(halfVector)), rig.shininess);
      const passingBeam = Math.pow(
        Math.max(0, Math.sin(elapsed * rig.flicker + tile.phase + tileIndex * 0.017)),
        8,
      );
      const contribution = sparkle * rig.specular + diffuse * 0.13 + passingBeam * 0.04;

      finalColor.r += rig.color.r * contribution;
      finalColor.g += rig.color.g * contribution;
      finalColor.b += rig.color.b * contribution;
    });

    finalColor.r = Math.min(finalColor.r, 1.8);
    finalColor.g = Math.min(finalColor.g, 1.8);
    finalColor.b = Math.min(finalColor.b, 1.8);

    for (let vertex = 0; vertex < 6; vertex += 1) {
      const offset = tile.colorOffset + vertex * 3;
      colorArray[offset] = finalColor.r;
      colorArray[offset + 1] = finalColor.g;
      colorArray[offset + 2] = finalColor.b;
    }

    if (tileIndex === 780) {
      qaState.animatedTileColor = [
        Number(finalColor.r.toFixed(4)),
        Number(finalColor.g.toFixed(4)),
        Number(finalColor.b.toFixed(4)),
      ];
    }
  });

  tileSystem.colorAttribute.needsUpdate = true;
}

function createCoreSurface() {
  const latBands = 72;
  const lonBands = 96;
  const positions = [];
  const indices = [];

  for (let lat = 0; lat <= latBands; lat += 1) {
    const theta = (lat / latBands) * Math.PI;

    for (let lon = 0; lon <= lonBands; lon += 1) {
      const phi = (lon / lonBands) * Math.PI * 2;
      const point = surfacePoint(theta, phi, -0.03);
      positions.push(point.x, point.y, point.z);
    }
  }

  for (let lat = 0; lat < latBands; lat += 1) {
    for (let lon = 0; lon < lonBands; lon += 1) {
      const a = lat * (lonBands + 1) + lon;
      const b = a + lonBands + 1;
      const c = b + 1;
      const d = a + 1;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();

  return new THREE.Mesh(
    geometry,
    new THREE.MeshPhysicalMaterial({
      clearcoat: 0.85,
      clearcoatRoughness: 0.2,
      color: 0x05074a,
      envMap: environmentTexture,
      envMapIntensity: 1.25,
      metalness: 0.64,
      roughness: 0.34,
    }),
  );
}

function createAuraShell() {
  const latBands = 72;
  const lonBands = 96;
  const positions = [];
  const indices = [];

  for (let lat = 0; lat <= latBands; lat += 1) {
    const theta = (lat / latBands) * Math.PI;

    for (let lon = 0; lon <= lonBands; lon += 1) {
      const phi = (lon / lonBands) * Math.PI * 2;
      const point = surfacePoint(theta, phi, 0.095);
      positions.push(point.x, point.y, point.z);
    }
  }

  for (let lat = 0; lat < latBands; lat += 1) {
    for (let lon = 0; lon < lonBands; lon += 1) {
      const a = lat * (lonBands + 1) + lon;
      const b = a + lonBands + 1;
      const c = b + 1;
      const d = a + 1;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0xd8e6ff,
      depthWrite: false,
      opacity: 0.11,
      side: THREE.BackSide,
      transparent: true,
    }),
  );

  mesh.renderOrder = -1;

  return mesh;
}

function updateAura(elapsed) {
  const pulse = 0.5 + Math.sin(elapsed * 1.15) * 0.5;
  const slowBreath = 1 + Math.sin(elapsed * 0.43) * 0.006;

  auraShell.material.opacity = 0.018 + pulse * 0.028;
  auraShell.scale.setScalar(slowBreath * 1.012);
}

function surfacePoint(theta, phi, offset = 0) {
  const sinTheta = Math.sin(theta);
  const direction = new THREE.Vector3(
    sinTheta * Math.cos(phi),
    Math.cos(theta),
    sinTheta * Math.sin(phi),
  );

  return surfacePointFromDirection(direction, offset);
}

function surfacePointFromDirection(direction, offset = 0) {
  const radius = iconRadius(direction) + offset;

  return new THREE.Vector3(
    direction.x * radius,
    direction.y * radius,
    direction.z * radius * DEPTH_SCALE,
  );
}

function iconRadius(direction) {
  const planarAmount = Math.hypot(direction.x, direction.y);
  const iconOutline = sampleIconOutline(Math.atan2(direction.y, direction.x));
  const contourStrength = Math.pow(THREE.MathUtils.clamp(planarAmount, 0, 1), 0.34);
  const capRoundness = 0.945 + Math.pow(planarAmount, 1.8) * 0.055;
  const lensCrown = Math.pow(Math.abs(direction.z), 4) * 0.014;

  return 1.08 * THREE.MathUtils.lerp(0.965, iconOutline, contourStrength) * capRoundness + lensCrown;
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

function createPromptGlyph() {
  const group = new THREE.Group();
  const recessMaterial = new THREE.MeshPhysicalMaterial({
    clearcoat: 0.65,
    clearcoatRoughness: 0.18,
    color: 0x11185d,
    emissive: 0x0a0f46,
    emissiveIntensity: 0.7,
    envMap: environmentTexture,
    envMapIntensity: 1.8,
    metalness: 0.55,
    roughness: 0.28,
    side: THREE.DoubleSide,
  });
  const glowMaterial = new THREE.MeshBasicMaterial({
    blending: THREE.AdditiveBlending,
    color: 0x9fb7ff,
    depthWrite: false,
    opacity: 0.18,
    side: THREE.DoubleSide,
    transparent: true,
  });
  const faceSheenMaterial = new THREE.MeshBasicMaterial({
    blending: THREE.AdditiveBlending,
    color: 0xeaf3ff,
    depthWrite: false,
    opacity: 0.28,
    side: THREE.DoubleSide,
    transparent: true,
  });
  const faceMaterial = new THREE.MeshPhysicalMaterial({
    clearcoat: 1,
    clearcoatRoughness: 0.015,
    color: 0xf7fbff,
    emissive: 0xbfdcff,
    emissiveIntensity: 3.15,
    envMap: environmentTexture,
    envMapIntensity: 6.2,
    ior: 1.62,
    iridescence: 0.42,
    iridescenceIOR: 1.35,
    metalness: 0,
    reflectivity: 1,
    roughness: 0.035,
    specularColor: 0xffffff,
    specularIntensity: 1,
    side: THREE.DoubleSide,
    thickness: 0.34,
    transmission: 0,
  });

  [-1, 1].forEach((side) => {
    GLYPH_SEGMENTS.forEach(([start, end]) => {
      const sideStart = mapGlyphPointToSide(start, side);
      const sideEnd = mapGlyphPointToSide(end, side);

      group.add(createSurfaceCapsuleSegment(sideStart, sideEnd, 0.094, 0.024, 0.019, glowMaterial, {
        baseRadius: 0.102,
        side,
      }));
      group.add(createSurfaceCapsuleSegment(sideStart, sideEnd, 0.084, 0.004, -0.018, recessMaterial, {
        baseRadius: 0.092,
        side,
      }));
      group.add(createSurfaceCapsuleSegment(sideStart, sideEnd, 0.052, 0.064, 0.012, faceMaterial, {
        baseRadius: 0.071,
        side,
        widthSegments: 10,
      }));
      group.add(createSurfaceCapsuleSegment(sideStart, sideEnd, 0.033, 0.067, 0.066, faceSheenMaterial, {
        baseRadius: 0.034,
        side,
        widthSegments: 8,
      }));
    });
  });

  return group;
}

function mapGlyphPointToSide(point, side) {
  return new THREE.Vector2(side < 0 ? -point.x : point.x, point.y);
}

function isPointInsideGlyphRecess(x, y, radius, side = 1) {
  const point = new THREE.Vector2(side < 0 ? -x : x, y);

  return GLYPH_SEGMENTS.some(([start, end]) => distanceToSegment(point, start, end) <= radius);
}

function distanceToSegment(point, start, end) {
  const segment = new THREE.Vector2().subVectors(end, start);
  const lengthSquared = segment.lengthSq();
  const t = lengthSquared === 0
    ? 0
    : THREE.MathUtils.clamp(new THREE.Vector2().subVectors(point, start).dot(segment) / lengthSquared, 0, 1);
  const closest = new THREE.Vector2().copy(start).addScaledVector(segment, t);

  return point.distanceTo(closest);
}

function createSurfaceCapsuleSegment(start, end, radius, topOffset, baseOffset, material, options = {}) {
  const lengthSegments = 36;
  const widthSegments = options.widthSegments ?? 8;
  const boundarySegments = 22;
  const baseRadius = options.baseRadius ?? radius;
  const edgeCrown = options.edgeCrown ?? 0;
  const side = options.side ?? 1;
  const length = start.distanceTo(end);
  const direction = new THREE.Vector2().subVectors(end, start).normalize();
  const perpendicular = new THREE.Vector2(-direction.y, direction.x);
  const positions = [];
  const indices = [];
  const rowSize = widthSegments + 1;

  for (let row = 0; row <= lengthSegments; row += 1) {
    const h = -radius + (row / lengthSegments) * (length + radius * 2);
    const capInset = h < 0 ? -h : h > length ? h - length : 0;
    const halfWidth = Math.sqrt(Math.max(0, radius * radius - capInset * capInset));
    const center = new THREE.Vector2().copy(start).addScaledVector(direction, h);

    for (let column = 0; column <= widthSegments; column += 1) {
      const t = column / widthSegments;
      const edgeSoftness = Math.sin(t * Math.PI) * edgeCrown;
      const point = new THREE.Vector2()
        .copy(center)
        .addScaledVector(perpendicular, THREE.MathUtils.lerp(-halfWidth, halfWidth, t));
      const surfacePoint = surfacePointFromXY(point.x, point.y, topOffset + edgeSoftness, side);

      positions.push(surfacePoint.x, surfacePoint.y, surfacePoint.z);
    }
  }

  for (let row = 0; row < lengthSegments; row += 1) {
    for (let column = 0; column < widthSegments; column += 1) {
      const a = row * rowSize + column;
      const b = a + 1;
      const c = a + rowSize;
      const d = c + 1;
      if (side > 0) {
        indices.push(a, c, b, b, c, d);
      } else {
        indices.push(a, b, c, b, d, c);
      }
    }
  }

  const sideStart = positions.length / 3;
  const topBoundary = createCapsuleBoundary(start, end, radius, boundarySegments);
  const baseBoundary = createCapsuleBoundary(start, end, baseRadius, boundarySegments);

  topBoundary.forEach((topPoint, index) => {
    const basePoint = baseBoundary[index];
    const top = surfacePointFromXY(topPoint.x, topPoint.y, topOffset, side);
    const base = surfacePointFromXY(basePoint.x, basePoint.y, baseOffset, side);

    positions.push(top.x, top.y, top.z, base.x, base.y, base.z);
  });

  for (let index = 0; index < topBoundary.length; index += 1) {
    const next = (index + 1) % topBoundary.length;
    const topA = sideStart + index * 2;
    const baseA = topA + 1;
    const topB = sideStart + next * 2;
    const baseB = topB + 1;

    if (side > 0) {
      indices.push(topA, baseA, topB, topB, baseA, baseB);
    } else {
      indices.push(topA, topB, baseA, topB, baseB, baseA);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = material.transparent ? 2 : 1;

  return mesh;
}

function createCapsuleBoundary(start, end, radius, segments) {
  const length = start.distanceTo(end);
  const direction = new THREE.Vector2().subVectors(end, start).normalize();
  const perpendicular = new THREE.Vector2(-direction.y, direction.x);
  const points = [];

  for (let index = 0; index <= segments; index += 1) {
    const angle = Math.PI / 2 - (index / segments) * Math.PI;
    points.push(
      new THREE.Vector2()
        .copy(start)
        .addScaledVector(direction, length + Math.cos(angle) * radius)
        .addScaledVector(perpendicular, Math.sin(angle) * radius),
    );
  }

  for (let index = 0; index <= segments; index += 1) {
    const angle = -Math.PI / 2 - (index / segments) * Math.PI;
    points.push(
      new THREE.Vector2()
        .copy(start)
        .addScaledVector(direction, Math.cos(angle) * radius)
        .addScaledVector(perpendicular, Math.sin(angle) * radius),
    );
  }

  return points;
}

function surfacePointFromXY(x, y, offset = 0, side = 1) {
  const planarRadius = Math.hypot(x, y);
  let unscaledZ = Math.sqrt(Math.max(0, 1.18 * 1.18 - planarRadius * planarRadius));
  const direction = new THREE.Vector3();

  for (let iteration = 0; iteration < 8; iteration += 1) {
    direction.set(x, y, side * unscaledZ).normalize();

    const radius = iconRadius(direction) + offset;
    unscaledZ = Math.sqrt(Math.max(0, radius * radius - planarRadius * planarRadius));
  }

  return new THREE.Vector3(x, y, side * unscaledZ * DEPTH_SCALE);
}

function createSurfaceGlints() {
  const texture = createStarTexture();
  const presets = [
    { direction: new THREE.Vector3(0.72, 0.4, 1), scale: 0.42, phase: 0.1 },
    { direction: new THREE.Vector3(-0.94, -0.32, 0.9), scale: 0.34, phase: 1.9 },
    { direction: new THREE.Vector3(0.18, 0.88, 0.82), scale: 0.28, phase: 3.1 },
    { direction: new THREE.Vector3(-0.2, -0.96, 0.58), scale: 0.2, phase: 4.1 },
    { direction: new THREE.Vector3(0.92, -0.06, -0.52), scale: 0.22, phase: 5.2 },
  ];

  return presets.map((preset) => {
    const normal = preset.direction.normalize();
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        blending: THREE.AdditiveBlending,
        color: 0xf3f6ff,
        depthWrite: false,
        map: texture,
        opacity: 0.6,
        transparent: true,
      }),
    );

    sprite.position.copy(surfacePointFromDirection(normal, 0.035));
    sprite.scale.setScalar(preset.scale);

    return {
      normal,
      phase: preset.phase,
      scale: preset.scale,
      sprite,
    };
  });
}

function updateGlints(elapsed) {
  const normalWorld = new THREE.Vector3();
  const centerWorld = new THREE.Vector3();
  const viewDirection = new THREE.Vector3();

  glints.forEach((glint) => {
    normalWorld.copy(glint.normal).transformDirection(ballGroup.matrixWorld);
    centerWorld.copy(glint.sprite.position).applyMatrix4(ballGroup.matrixWorld);
    viewDirection.copy(camera.position).sub(centerWorld).normalize();

    const facing = Math.max(0, normalWorld.dot(viewDirection));
    const pulse = 0.5 + Math.sin(elapsed * 3.6 + glint.phase) * 0.5;
    const scale = glint.scale * (0.78 + pulse * 0.5);

    glint.sprite.material.opacity = Math.min(0.82, facing * (0.24 + pulse * 0.56));
    glint.sprite.scale.set(scale, scale, 1);
  });
}

function createCausticShards() {
  const group = new THREE.Group();
  const texture = createCausticTexture();
  const colors = [0x87a0ff, 0x2fe4ff, 0xff68d7, 0xf8f4ff, 0x6c60ff];
  const shards = [];

  for (let index = 0; index < 42; index += 1) {
    const material = new THREE.SpriteMaterial({
      blending: THREE.AdditiveBlending,
      color: colors[index % colors.length],
      depthWrite: false,
      map: texture,
      opacity: 0,
      rotation: seededNoise(index * 4.9) * Math.PI,
      transparent: true,
    });
    const sprite = new THREE.Sprite(material);
    const side = index % 2 === 0 ? -1 : 1;
    const basePosition = new THREE.Vector3(
      side * (1.45 + seededNoise(index * 2.7) * 3.5),
      -1.95 + seededNoise(index * 7.3) * 4.25,
      -2.25 + seededNoise(index * 5.1) * 2.35,
    );
    const baseScale = new THREE.Vector2(
      0.34 + seededNoise(index * 8.2) * 1.05,
      0.018 + seededNoise(index * 3.4) * 0.038,
    );

    sprite.position.copy(basePosition);
    sprite.scale.set(baseScale.x, baseScale.y, 1);
    group.add(sprite);
    shards.push({
      baseOpacity: 0.18 + seededNoise(index * 6.6) * 0.36,
      basePosition,
      baseScale,
      driftX: (seededNoise(index * 13.3) - 0.5) * 0.55,
      driftY: (seededNoise(index * 17.7) - 0.5) * 0.36,
      phase: seededNoise(index * 11.9) * Math.PI * 2,
      rotation: material.rotation,
      speed: 0.75 + seededNoise(index * 19.1) * 1.4,
      sprite,
    });
  }

  return { group, shards };
}

function updateCausticShards(elapsed) {
  const viewportFade = camera.aspect < 0.75 ? 0.55 : 1;

  caustics.shards.forEach((shard) => {
    const pulse = Math.pow(Math.max(0, Math.sin(elapsed * shard.speed + shard.phase)), 2.8);
    const shimmer = 0.35 + Math.sin(elapsed * (shard.speed * 2.3) + shard.phase) * 0.12;
    const opacity = (0.035 + pulse * shard.baseOpacity + shimmer * 0.04) * viewportFade;
    const scalePulse = 1 + pulse * 0.38;

    shard.sprite.position.set(
      shard.basePosition.x + Math.sin(elapsed * 0.18 + shard.phase) * shard.driftX,
      shard.basePosition.y + Math.cos(elapsed * 0.14 + shard.phase) * shard.driftY,
      shard.basePosition.z,
    );
    shard.sprite.material.opacity = Math.min(opacity, 0.56);
    shard.sprite.material.rotation = shard.rotation + Math.sin(elapsed * 0.5 + shard.phase) * 0.11;
    shard.sprite.scale.set(shard.baseScale.x * scalePulse, shard.baseScale.y * (0.82 + pulse * 0.46), 1);
  });

  caustics.group.rotation.y = Math.sin(elapsed * 0.08) * 0.035;
}

function createDiscoLights() {
  const specs = [
    { color: 0x7c58ff, flicker: 2.8, phase: 0.2, radius: 3.8, shininess: 68, specular: 1.08, speed: 0.68, y: 1.9 },
    { color: 0x22d7ff, flicker: 3.4, phase: 2.3, radius: 4.3, shininess: 74, specular: 1.0, speed: -0.52, y: -0.7 },
    { color: 0xff4cc8, flicker: 3.1, phase: 4.1, radius: 3.4, shininess: 62, specular: 0.95, speed: 0.76, y: 0.78 },
    { color: 0xf6f5ff, flicker: 4.2, phase: 5.8, radius: 4.7, shininess: 90, specular: 0.72, speed: -0.35, y: 1.18 },
  ];
  const starTexture = createStarTexture();

  return specs.map((spec) => {
    const color = new THREE.Color(spec.color);
    const light = new THREE.PointLight(color, 16, 8.5, 1.7);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        blending: THREE.AdditiveBlending,
        color,
        depthWrite: false,
        map: starTexture,
        opacity: 0.58,
        transparent: true,
      }),
    );
    const beam = new THREE.Line(
      new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3),
      ),
      new THREE.LineBasicMaterial({
        blending: THREE.AdditiveBlending,
        color,
        opacity: 0.2,
        transparent: true,
      }),
    );

    sprite.scale.set(0.34, 0.34, 1);
    scene.add(light);
    scene.add(sprite);
    scene.add(beam);

    return {
      ...spec,
      beam,
      color,
      intensity: light.intensity,
      light,
      sprite,
    };
  });
}

function animateLights(elapsed) {
  const narrowViewport = camera.aspect < 0.75;

  lightRig.forEach((rig, index) => {
    const angle = elapsed * rig.speed + rig.phase;
    const wobble = Math.sin(elapsed * 0.61 + index) * 0.42;
    const zOffset = Math.cos(angle * 0.72 + index) * 0.85;

    rig.light.position.set(
      Math.cos(angle) * rig.radius,
      rig.y + wobble,
      Math.sin(angle) * rig.radius + zOffset,
    );
    rig.light.intensity = rig.intensity * (0.82 + Math.max(0, Math.sin(elapsed * 0.82 + rig.phase)) * 0.34);
    rig.sprite.position.copy(rig.light.position);
    rig.sprite.visible = !narrowViewport;
    rig.sprite.material.opacity = 0.36 + Math.sin(elapsed * rig.flicker + rig.phase) * 0.12;
    rig.sprite.scale.setScalar(0.31 + Math.sin(elapsed * 1.7 + rig.phase) * 0.055);

    const positions = rig.beam.geometry.getAttribute("position");
    positions.setXYZ(0, rig.light.position.x, rig.light.position.y, rig.light.position.z);
    positions.setXYZ(1, 0, 0, 0);
    positions.needsUpdate = true;
    rig.beam.material.opacity = 0.12 + Math.max(0, Math.sin(elapsed * 1.4 + rig.phase)) * 0.12;
  });
}

function createFloorGrid() {
  const gridHelper = new THREE.GridHelper(18, 42, 0x7b6dff, 0x151b56);
  gridHelper.position.y = -2.18;
  gridHelper.material.transparent = true;
  gridHelper.material.opacity = 0.18;
  gridHelper.material.depthWrite = false;

  return gridHelper;
}

function createStarfield() {
  const count = 850;
  const positions = [];
  const colors = [];

  for (let index = 0; index < count; index += 1) {
    const radius = 8 + seededNoise(index * 2.1) * 20;
    const theta = seededNoise(index * 5.3) * Math.PI * 2;
    const y = -4 + seededNoise(index * 3.7) * 9;
    const z = -14 + seededNoise(index * 11.4) * 8;
    const color = new THREE.Color().setHSL(
      0.58 + seededNoise(index * 17.8) * 0.26,
      0.55,
      0.46 + seededNoise(index * 4.4) * 0.38,
    );

    positions.push(Math.cos(theta) * radius, y, z + Math.sin(theta) * radius * 0.12);
    colors.push(color.r, color.g, color.b);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.7,
      size: 0.035,
      sizeAttenuation: true,
      transparent: true,
      vertexColors: true,
    }),
  );
}

function createEnvironmentTexture() {
  const canvasElement = document.createElement("canvas");
  canvasElement.width = 1024;
  canvasElement.height = 512;
  const context = canvasElement.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, 0, canvasElement.height);

  gradient.addColorStop(0, "#06071d");
  gradient.addColorStop(0.45, "#141089");
  gradient.addColorStop(1, "#02020b");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvasElement.width, canvasElement.height);

  const spots = [
    [190, 120, 230, "rgba(129, 92, 255, 0.92)"],
    [760, 150, 250, "rgba(31, 214, 255, 0.82)"],
    [520, 88, 170, "rgba(255, 80, 209, 0.74)"],
    [910, 300, 220, "rgba(255, 255, 255, 0.62)"],
    [90, 342, 180, "rgba(54, 88, 255, 0.72)"],
  ];

  spots.forEach(([x, y, radius, color]) => {
    const spot = context.createRadialGradient(x, y, 0, x, y, radius);
    spot.addColorStop(0, color);
    spot.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = spot;
    context.fillRect(0, 0, canvasElement.width, canvasElement.height);
  });

  for (let index = 0; index < 72; index += 1) {
    const x = seededNoise(index * 12.1) * canvasElement.width;
    const y = seededNoise(index * 4.6) * canvasElement.height;
    const alpha = 0.06 + seededNoise(index * 8.2) * 0.22;

    context.strokeStyle = `rgba(230, 236, 255, ${alpha})`;
    context.lineWidth = 1 + seededNoise(index * 9.1) * 2;
    context.beginPath();
    context.moveTo(x - 18, y);
    context.lineTo(x + 18, y);
    context.moveTo(x, y - 18);
    context.lineTo(x, y + 18);
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvasElement);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.needsUpdate = true;

  return texture;
}

function createStarTexture() {
  const canvasElement = document.createElement("canvas");
  canvasElement.width = 256;
  canvasElement.height = 256;
  const context = canvasElement.getContext("2d");
  const center = 128;
  const glow = context.createRadialGradient(center, center, 0, center, center, 122);

  glow.addColorStop(0, "rgba(255, 255, 255, 1)");
  glow.addColorStop(0.16, "rgba(224, 232, 255, 0.76)");
  glow.addColorStop(0.38, "rgba(130, 124, 255, 0.22)");
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, 256, 256);
  context.strokeStyle = "rgba(255, 255, 255, 0.9)";
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(16, center);
  context.lineTo(240, center);
  context.moveTo(center, 16);
  context.lineTo(center, 240);
  context.moveTo(42, 42);
  context.lineTo(214, 214);
  context.moveTo(214, 42);
  context.lineTo(42, 214);
  context.stroke();

  const texture = new THREE.CanvasTexture(canvasElement);
  texture.colorSpace = THREE.SRGBColorSpace;

  return texture;
}

function createCausticTexture() {
  const canvasElement = document.createElement("canvas");
  canvasElement.width = 256;
  canvasElement.height = 64;
  const context = canvasElement.getContext("2d");
  const horizontal = context.createLinearGradient(0, 0, canvasElement.width, 0);
  const vertical = context.createLinearGradient(0, 0, 0, canvasElement.height);

  horizontal.addColorStop(0, "rgba(255, 255, 255, 0)");
  horizontal.addColorStop(0.18, "rgba(205, 226, 255, 0.08)");
  horizontal.addColorStop(0.5, "rgba(255, 255, 255, 0.95)");
  horizontal.addColorStop(0.82, "rgba(205, 226, 255, 0.08)");
  horizontal.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = horizontal;
  context.fillRect(0, 0, canvasElement.width, canvasElement.height);

  context.globalCompositeOperation = "destination-in";
  vertical.addColorStop(0, "rgba(255, 255, 255, 0)");
  vertical.addColorStop(0.38, "rgba(255, 255, 255, 0.85)");
  vertical.addColorStop(0.5, "rgba(255, 255, 255, 1)");
  vertical.addColorStop(0.62, "rgba(255, 255, 255, 0.85)");
  vertical.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = vertical;
  context.fillRect(0, 0, canvasElement.width, canvasElement.height);

  context.globalCompositeOperation = "source-over";
  context.strokeStyle = "rgba(255, 255, 255, 0.7)";
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(26, canvasElement.height / 2);
  context.lineTo(230, canvasElement.height / 2);
  context.stroke();

  const texture = new THREE.CanvasTexture(canvasElement);
  texture.colorSpace = THREE.SRGBColorSpace;

  return texture;
}

function createSoftDiscTexture() {
  const canvasElement = document.createElement("canvas");
  canvasElement.width = 256;
  canvasElement.height = 256;
  const context = canvasElement.getContext("2d");
  const glow = context.createRadialGradient(128, 128, 0, 128, 128, 128);

  glow.addColorStop(0, "rgba(255, 255, 255, 0.82)");
  glow.addColorStop(0.38, "rgba(145, 167, 255, 0.25)");
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, 256, 256);

  const texture = new THREE.CanvasTexture(canvasElement);
  texture.colorSpace = THREE.SRGBColorSpace;

  return texture;
}

function seededNoise(value) {
  return fract(Math.sin(value * 127.1 + 311.7) * 43758.5453123);
}

function fract(value) {
  return value - Math.floor(value);
}
