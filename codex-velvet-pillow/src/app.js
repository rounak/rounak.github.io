import * as THREE from "../../codex-disco-render/lib/three.module.min.js";

const canvas = document.querySelector("#scene");
const toggleButton = document.querySelector("#toggle-motion");
const resetButton = document.querySelector("#reset-nap");
const brushSizeInput = document.querySelector("#brush-size");

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  canvas,
  powerPreference: "high-performance",
});

renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.setClearColor(0x030711, 1);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030711);
scene.fog = new THREE.FogExp2(0x071124, 0.034);

const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 80);
camera.position.set(0, 0.16, 5.55);

const pointer = new THREE.Vector2();
const pointerNdc = new THREE.Vector2(10, 10);
const raycaster = new THREE.Raycaster();
const startTime = performance.now();
const qaState = {
  brushStrokes: 0,
  frameCount: 0,
  lastBrushUv: [0, 0],
  napTexture: "",
  pillowVertices: 0,
  renderReady: false,
  rotationY: 0,
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
const PILLOW_OUTLINE_SCALE = 1.12;
const PILLOW_UV_EXTENT = 1.28;
const EDGE_Z = 0.18;
const BULGE_Z = 0.52;

const napTexture = createNapTexture();
const noiseTexture = createNoiseTexture();
const velvetMaterial = createVelvetMaterial(napTexture, noiseTexture);
const cordMaterial = createCordMaterial(napTexture, noiseTexture);
const shadowTexture = createShadowTexture();

const pillowGroup = new THREE.Group();
pillowGroup.rotation.set(-0.08, -0.38, 0.035);
pillowGroup.position.y = 0.1;
scene.add(pillowGroup);

const pillow = createPillow();
const couch = createCouch();
const ambientDust = createAmbientDust();
const glowShards = createGlowShards();
const lightRig = createLightRig();

pillowGroup.add(pillow.group);
scene.add(couch);
scene.add(ambientDust);
scene.add(glowShards.group);

const brushTargets = pillow.brushTargets;
qaState.pillowVertices = pillow.vertexCount;

let paused = false;
let brushSize = Number.parseFloat(brushSizeInput.value);
let firstFrame = true;
let lastFrameTime = performance.now();
let lastBrushPoint = null;
let activePointerId = null;
let hoverFade = 0;

toggleButton.addEventListener("click", () => {
  paused = !paused;
  toggleButton.classList.toggle("is-paused", paused);
  toggleButton.setAttribute("aria-label", paused ? "Resume motion" : "Pause motion");
  toggleButton.setAttribute("title", paused ? "Resume motion" : "Pause motion");
});

resetButton.addEventListener("click", () => {
  resetNapTexture();
  lastBrushPoint = null;
});

brushSizeInput.addEventListener("input", () => {
  brushSize = Number.parseFloat(brushSizeInput.value);
});

canvas.addEventListener("pointerdown", (event) => {
  activePointerId = event.pointerId;
  canvas.setPointerCapture(event.pointerId);
  updatePointer(event);
  paintFromPointer(event, true);
  event.preventDefault();
});

canvas.addEventListener("pointermove", (event) => {
  updatePointer(event);
  paintFromPointer(event, false);
});

canvas.addEventListener("pointerup", (event) => {
  if (activePointerId === event.pointerId) {
    activePointerId = null;
  }

  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }

  lastBrushPoint = null;
});

canvas.addEventListener("pointercancel", () => {
  activePointerId = null;
  lastBrushPoint = null;
});

canvas.addEventListener("pointerleave", () => {
  lastBrushPoint = null;
  pointerNdc.set(10, 10);
});

window.addEventListener("resize", resize);
resize();
animate();

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const delta = Math.min((now - lastFrameTime) / 1000, 0.033);
  const elapsed = (now - startTime) / 1000;
  lastFrameTime = now;

  const motion = paused ? 0 : 1;
  const targetY = -0.38 + pointer.x * 0.12;
  pillowGroup.rotation.x += (-0.08 - pointer.y * 0.035 - pillowGroup.rotation.x) * 0.035;
  pillowGroup.rotation.y += ((targetY + Math.sin(elapsed * 0.23) * 0.055) - pillowGroup.rotation.y) * 0.018;
  pillowGroup.rotation.z += ((0.035 + pointer.x * 0.018) - pillowGroup.rotation.z) * 0.026;

  if (motion) {
    pillow.group.rotation.y = Math.sin(elapsed * 0.38) * 0.035;
    pillow.group.position.y = Math.sin(elapsed * 0.72) * 0.026;
  }

  velvetMaterial.uniforms.time.value = elapsed;
  cordMaterial.uniforms.time.value = elapsed;
  velvetMaterial.uniforms.hover.value += (hoverFade - velvetMaterial.uniforms.hover.value) * 0.09;
  updateLights(elapsed);
  updateGlowShards(elapsed);
  ambientDust.rotation.y = elapsed * 0.012;

  renderer.render(scene, camera);

  if (firstFrame) {
    firstFrame = false;
    canvas.dataset.pillowVertices = String(qaState.pillowVertices);
    canvas.dataset.napTexture = qaState.napTexture;
  }

  qaState.frameCount += 1;
  qaState.renderReady = true;
  qaState.rotationY = pillowGroup.rotation.y;
  canvas.dataset.brushStrokes = String(qaState.brushStrokes);
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

function paintFromPointer(event, forceDot) {
  if (activePointerId !== null && event.pointerId !== activePointerId) {
    return;
  }

  raycaster.setFromCamera(pointerNdc, camera);

  const intersections = raycaster.intersectObjects(brushTargets, false);

  if (intersections.length === 0 || !intersections[0].uv) {
    hoverFade = 0;
    lastBrushPoint = null;
    return;
  }

  hoverFade = 1;

  const uv = intersections[0].uv.clone();
  const x = uv.x * napTexture.image.width;
  const y = (1 - uv.y) * napTexture.image.height;
  const current = new THREE.Vector2(x, y);
  const previous = forceDot ? null : lastBrushPoint;

  brushVelvet(current, previous);
  lastBrushPoint = current;
  qaState.brushStrokes += 1;
  qaState.lastBrushUv = [Number(uv.x.toFixed(4)), Number(uv.y.toFixed(4))];
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const aspect = width / height;
  const responsivePullback = THREE.MathUtils.clamp(1.08 / aspect, 1, 2.18);

  camera.aspect = aspect;
  camera.position.z = 5.55 * responsivePullback;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function createPillow() {
  const group = new THREE.Group();
  const frontGeometry = createPillowFaceGeometry(1);
  const backGeometry = createPillowFaceGeometry(-1);
  const sideGeometry = createPillowSideGeometry();
  const front = new THREE.Mesh(frontGeometry, velvetMaterial);
  const back = new THREE.Mesh(backGeometry, velvetMaterial);
  const side = new THREE.Mesh(sideGeometry, velvetMaterial);
  const frontPipe = createPiping(1, 1.012, 0.042, cordMaterial);
  const backPipe = createPiping(-1, 1.012, 0.038, cordMaterial);

  front.frustumCulled = false;
  back.frustumCulled = false;
  side.frustumCulled = false;
  frontPipe.frustumCulled = false;
  backPipe.frustumCulled = false;

  group.add(back, side, front, frontPipe, backPipe);

  return {
    brushTargets: [front, back],
    group,
    vertexCount:
      frontGeometry.getAttribute("position").count
      + backGeometry.getAttribute("position").count
      + sideGeometry.getAttribute("position").count,
  };
}

function createPillowFaceGeometry(side) {
  const segments = 104;
  const rowSize = segments + 1;
  const positions = [];
  const uvs = [];
  const edgePressures = [];
  const indices = [];

  for (let row = 0; row <= segments; row += 1) {
    const v = row / segments * 2 - 1;

    for (let column = 0; column <= segments; column += 1) {
      const u = column / segments * 2 - 1;
      const polar = squarePointToPolar(u, v);
      const point = pillowFacePoint(polar.angle, polar.radial, side);
      const edgePressure = smoothstep(0.72, 1, polar.radial);

      positions.push(point.x, point.y, point.z);
      uvs.push(
        side > 0
          ? 0.5 + point.x / (PILLOW_UV_EXTENT * 2)
          : 0.5 - point.x / (PILLOW_UV_EXTENT * 2),
        0.5 + point.y / (PILLOW_UV_EXTENT * 2),
      );
      edgePressures.push(edgePressure);
    }
  }

  for (let row = 0; row < segments; row += 1) {
    for (let column = 0; column < segments; column += 1) {
      const a = row * rowSize + column;
      const b = a + 1;
      const c = a + rowSize;
      const d = c + 1;

      if (side > 0) {
        indices.push(a, b, c, b, d, c);
      } else {
        indices.push(a, c, b, b, c, d);
      }
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

function createPillowSideGeometry() {
  const perimeter = createBoundarySamples(1, 1, 192);
  const backPerimeter = createBoundarySamples(-1, 1, 192);
  const sideSegments = 18;
  const positions = [];
  const uvs = [];
  const edgePressures = [];
  const indices = [];
  const count = perimeter.length;

  for (let index = 0; index < count; index += 1) {
    const front = perimeter[index];
    const back = backPerimeter[index];
    const outward = new THREE.Vector2(front.x, front.y).normalize();

    for (let row = 0; row <= sideSegments; row += 1) {
      const t = row / sideSegments;
      const sideBulge = Math.sin(t * Math.PI) * 0.13;
      const cordPinch = 1 - Math.pow(Math.sin(t * Math.PI), 8) * 0.04;
      const weltRipple = Math.sin(index * 0.42) * 0.008 * Math.sin(t * Math.PI);
      const point = new THREE.Vector3().lerpVectors(front, back, t);

      point.x = point.x * cordPinch + outward.x * (sideBulge + weltRipple);
      point.y = point.y * cordPinch + outward.y * (sideBulge + weltRipple);
      positions.push(point.x, point.y, point.z);
      uvs.push(index / (count - 1), t);
      edgePressures.push(1);
    }
  }

  const rowSize = sideSegments + 1;

  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;

    for (let row = 0; row < sideSegments; row += 1) {
      const a = index * rowSize + row;
      const b = next * rowSize + row;
      const c = a + 1;
      const d = b + 1;
      indices.push(a, b, c, b, d, c);
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

function pillowFacePoint(angle, radial, side) {
  const outline = sampleIconOutline(angle) * PILLOW_OUTLINE_SCALE;
  const easedRadial = Math.pow(radial, 0.94);
  const edgePressure = smoothstep(0.72, 1, radial);
  const coreBulge = Math.pow(Math.max(0, 1 - Math.pow(radial, 2.38)), 0.78);
  const seamPinch = 1 - edgePressure * 0.035;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const x = cos * outline * easedRadial * seamPinch;
  const y = sin * outline * easedRadial * seamPinch;
  const wrinkleFade = smoothstep(0.28, 0.82, radial);
  const wrinkle = wrinkleFade * (
    Math.sin((cos * 4.8 + sin * 1.2) * Math.PI + radial * 1.1) * 0.0045
    + Math.sin((sin * 4.6 - cos * 0.7) * Math.PI - radial * 0.8) * 0.0035
  );
  const crown = EDGE_Z + BULGE_Z * coreBulge;
  const z = side * (crown + wrinkle * (0.25 + coreBulge * 0.75));

  return new THREE.Vector3(x, y, z);
}

function squarePointToPolar(u, v) {
  const distance = Math.hypot(u, v);

  if (distance < 0.0001) {
    return { angle: 0, radial: 0 };
  }

  const angle = Math.atan2(v, u);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const radial = Math.min(1, distance * Math.max(Math.abs(cos), Math.abs(sin)));

  return { angle, radial };
}

function createBoundarySamples(side, inset = 1, samples = 144) {
  const points = [];

  for (let index = 0; index < samples; index += 1) {
    const angle = index / samples * Math.PI * 2;
    points.push(pillowFacePoint(angle, inset, side));
  }

  return points;
}

function createPiping(side, inset, radius, material) {
  const points = createBoundarySamples(side, inset, 192).map((point) => {
    const normalOffset = new THREE.Vector3(point.x, point.y, 0).normalize().multiplyScalar(0.018);
    return new THREE.Vector3(point.x + normalOffset.x, point.y + normalOffset.y, point.z + side * 0.024);
  });
  const curve = new THREE.CatmullRomCurve3(points, true, "catmullrom", 0.5);
  const geometry = new THREE.TubeGeometry(curve, 192, radius, 16, true);
  const edgePressures = new Float32Array(geometry.getAttribute("position").count).fill(1);

  geometry.setAttribute("edgePressure", new THREE.BufferAttribute(edgePressures, 1));
  geometry.computeVertexNormals();

  return new THREE.Mesh(geometry, material);
}

function createVelvetMaterial(brushMap, noiseMap) {
  return new THREE.ShaderMaterial({
    uniforms: {
      baseColor: { value: new THREE.Color(0x1968c9) },
      brushMap: { value: brushMap },
      cyanColor: { value: new THREE.Color(0x84eaff) },
      deepColor: { value: new THREE.Color(0x061b45) },
      hover: { value: 0 },
      lightA: { value: new THREE.Vector3(-3.4, 2.7, 3.8) },
      lightB: { value: new THREE.Vector3(3.3, 1.1, 2.4) },
      lightC: { value: new THREE.Vector3(0.4, -2.3, 3.2) },
      noiseMap: { value: noiseMap },
      sheenColor: { value: new THREE.Color(0xeaf8ff) },
      time: { value: 0 },
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
      uniform sampler2D brushMap;
      uniform vec3 cyanColor;
      uniform vec3 deepColor;
      uniform float hover;
      uniform vec3 lightA;
      uniform vec3 lightB;
      uniform vec3 lightC;
      uniform sampler2D noiseMap;
      uniform vec3 sheenColor;
      uniform float time;

      varying float vEdgePressure;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      float clamp01(float value) {
        return clamp(value, 0.0, 1.0);
      }

      float softLight(float base, float blend) {
        return blend < 0.5
          ? 2.0 * base * blend + base * base * (1.0 - 2.0 * blend)
          : sqrt(base) * (2.0 * blend - 1.0) + 2.0 * base * (1.0 - blend);
      }

      float wrapLight(vec3 normal, vec3 lightDirection) {
        return pow(clamp01(dot(normal, lightDirection) * 0.5 + 0.5), 1.65);
      }

      void main() {
        vec3 normal = normalize(vNormal);
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        vec3 lightDirectionA = normalize(lightA - vWorldPosition);
        vec3 lightDirectionB = normalize(lightB - vWorldPosition);
        vec3 lightDirectionC = normalize(lightC - vWorldPosition);

        float nap = texture2D(brushMap, vUv).r;
        float fineNoise = texture2D(noiseMap, vUv * vec2(38.0, 96.0)).r;
        float fiberLines =
          sin((vUv.y * 250.0 + fineNoise * 1.8) + sin(vUv.x * 31.0) * 1.2) * 0.013
          + sin(vUv.x * 126.0 + vUv.y * 38.0) * 0.004;
        float brushed = (nap - 0.5) * 2.0;
        float fiber = fiberLines;
        float velvetTone = clamp01(0.4 + nap * 0.5 + fiber - vEdgePressure * 0.11);
        vec3 color = mix(deepColor, baseColor, velvetTone);
        color = mix(color, cyanColor, clamp01((nap - 0.63) * 0.58 + hover * 0.035));

        float diffuseA = wrapLight(normal, lightDirectionA);
        float diffuseB = wrapLight(normal, lightDirectionB);
        float diffuseC = wrapLight(normal, lightDirectionC);
        float fresnel = pow(1.0 - clamp01(dot(normal, viewDirection)), 1.72);
        float sheenA = pow(clamp01(dot(normalize(lightDirectionA + viewDirection), normal)), 28.0);
        float sheenB = pow(clamp01(dot(normalize(lightDirectionB + viewDirection), normal)), 38.0);
        float napSheen = softLight(clamp01(nap + fiber), 0.72);
        float edgeShadow = 1.0 - vEdgePressure * 0.18;
        float light = 0.42 + diffuseA * 0.48 + diffuseB * 0.25 + diffuseC * 0.18;

        color *= light * edgeShadow;
        color += sheenColor * (sheenA * 0.18 + sheenB * 0.12) * (0.25 + napSheen);
        color += cyanColor * fresnel * (0.33 + brushed * 0.12);
        color += vec3(0.008, 0.028, 0.065) * (1.0 - nap) * 0.62;
        color = pow(color, vec3(0.94));

        gl_FragColor = vec4(color, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });
}

function createCordMaterial(brushMap, noiseMap) {
  const material = createVelvetMaterial(brushMap, noiseMap);

  material.uniforms.baseColor.value.set(0x145bb2);
  material.uniforms.deepColor.value.set(0x061635);
  material.uniforms.cyanColor.value.set(0x7deaff);

  return material;
}

function createNapTexture() {
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = 1024;
  textureCanvas.height = 1024;
  const texture = new THREE.CanvasTexture(textureCanvas);

  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  qaState.napTexture = `${textureCanvas.width}x${textureCanvas.height}`;
  resetNapTexture(textureCanvas, texture);

  return texture;
}

function resetNapTexture(textureCanvas = napTexture?.image, texture = napTexture) {
  if (!textureCanvas || !texture) {
    return;
  }

  const context = textureCanvas.getContext("2d");
  const width = textureCanvas.width;
  const height = textureCanvas.height;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "rgb(130, 130, 130)";
  context.fillRect(0, 0, width, height);
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";

  for (let y = 0; y < height; y += 3) {
    const value = Math.round(128 + Math.sin(y * 0.035) * 2.5);
    context.globalAlpha = 0.08;
    context.fillStyle = `rgb(${value}, ${value}, ${value})`;
    context.fillRect(0, y, width, 1);
  }

  for (let index = 0; index < 880; index += 1) {
    const x = seededNoise(index * 4.7) * width;
    const y = seededNoise(index * 8.9) * height;
    const length = 48 + seededNoise(index * 3.3) * 140;
    const drift = (seededNoise(index * 9.1) - 0.5) * 38;
    const value = Math.round(122 + seededNoise(index * 11.4) * 18);

    context.globalAlpha = 0.03 + seededNoise(index * 2.2) * 0.035;
    context.strokeStyle = `rgb(${value}, ${value}, ${value})`;
    context.lineWidth = 0.7 + seededNoise(index * 5.8) * 1.6;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + drift, y + length);
    context.stroke();
  }

  context.restore();
  texture.needsUpdate = true;
  qaState.brushStrokes = 0;
}

function brushVelvet(current, previous) {
  const context = napTexture.image.getContext("2d");
  const dx = previous ? current.x - previous.x : 0;
  const dy = previous ? current.y - previous.y : 0;
  const distance = previous ? current.distanceTo(previous) : 0;
  const shade = Math.round(THREE.MathUtils.clamp(132 + dx * 0.68 - dy * 0.3, 48, 224));
  const alpha = THREE.MathUtils.clamp(0.28 + distance / 230, 0.34, 0.7);
  const radius = brushSize;
  const start = previous && distance < 260 ? previous : current;

  context.save();
  context.globalCompositeOperation = "source-over";
  context.lineCap = "round";
  context.lineJoin = "round";
  context.shadowColor = `rgba(${shade}, ${shade}, ${shade}, ${alpha * 0.8})`;
  context.shadowBlur = radius * 0.42;

  for (let pass = 0; pass < 7; pass += 1) {
    const offset = (pass - 3) * radius * 0.055;
    const passShade = THREE.MathUtils.clamp(shade + (seededNoise(pass * 19.7 + current.x) - 0.5) * 42, 28, 236);

    context.globalAlpha = alpha * (pass === 3 ? 0.44 : 0.22);
    context.strokeStyle = `rgb(${passShade}, ${passShade}, ${passShade})`;
    context.lineWidth = radius * (pass === 3 ? 0.5 : 0.16);
    context.beginPath();
    context.moveTo(start.x + offset, start.y - offset * 0.35);
    context.lineTo(current.x + offset, current.y - offset * 0.35);
    context.stroke();
  }

  const gradient = context.createRadialGradient(current.x, current.y, 0, current.x, current.y, radius * 0.96);
  gradient.addColorStop(0, `rgba(${shade}, ${shade}, ${shade}, ${alpha * 0.52})`);
  gradient.addColorStop(0.72, `rgba(${shade}, ${shade}, ${shade}, ${alpha * 0.08})`);
  gradient.addColorStop(1, `rgba(${shade}, ${shade}, ${shade}, 0)`);
  context.globalAlpha = 1;
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(current.x, current.y, radius * 0.96, 0, Math.PI * 2);
  context.fill();
  context.restore();

  napTexture.needsUpdate = true;
}

function createNoiseTexture() {
  const size = 512;
  const noiseCanvas = document.createElement("canvas");
  const context = noiseCanvas.getContext("2d");
  const image = context.createImageData(size, size);

  noiseCanvas.width = size;
  noiseCanvas.height = size;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const fiber = Math.sin(y * 0.42 + Math.sin(x * 0.018) * 2.5) * 28;
      const value = 118 + fiber + seededNoise(x * 4.2 + y * 91.7) * 62;

      image.data[offset] = value;
      image.data[offset + 1] = value;
      image.data[offset + 2] = value;
      image.data[offset + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(noiseCanvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = true;

  return texture;
}

function createCouch() {
  const group = new THREE.Group();
  const couchMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x071a35,
    roughness: 0.78,
    sheen: 1,
    sheenColor: 0x5ac9ff,
    sheenRoughness: 0.58,
  });
  const backMaterial = couchMaterial.clone();
  const seat = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.34, 2.2, 18, 4, 8), couchMaterial);
  const back = new THREE.Mesh(new THREE.BoxGeometry(6.5, 1.72, 0.34, 18, 12, 4), backMaterial);
  const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.48, 1.05, 2.1, 4, 8, 8), couchMaterial.clone());
  const rightArm = leftArm.clone();
  const shadow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      color: 0x000000,
      depthWrite: false,
      map: shadowTexture,
      opacity: 0.36,
      transparent: true,
    }),
  );

  seat.position.set(0, -1.34, -0.72);
  seat.rotation.x = -0.03;
  back.position.set(0, -0.66, -1.72);
  back.rotation.x = 0.08;
  leftArm.position.set(-3.08, -0.92, -0.7);
  rightArm.position.set(3.08, -0.92, -0.7);
  shadow.position.set(0, -1.05, 0.16);
  shadow.scale.set(2.85, 0.72, 1);

  group.add(back, seat, leftArm, rightArm, shadow);

  return group;
}

function createLightRig() {
  const specs = [
    { color: 0x87d9ff, intensity: 5.2, position: [-3.4, 2.65, 3.8], speed: 0.16 },
    { color: 0x2e72ff, intensity: 3.8, position: [3.3, 1.1, 2.4], speed: -0.21 },
    { color: 0x8bfff2, intensity: 2.8, position: [0.4, -2.3, 3.2], speed: 0.12 },
  ];

  scene.add(new THREE.AmbientLight(0x243f7c, 0.64));
  scene.add(new THREE.HemisphereLight(0x9fdfff, 0x030918, 0.7));

  return specs.map((spec) => {
    const light = new THREE.PointLight(spec.color, spec.intensity, 9, 1.8);
    light.position.fromArray(spec.position);
    scene.add(light);

    return { ...spec, light, origin: new THREE.Vector3(...spec.position) };
  });
}

function updateLights(elapsed) {
  lightRig.forEach((rig, index) => {
    rig.light.position.set(
      rig.origin.x + Math.sin(elapsed * rig.speed + index) * 0.36,
      rig.origin.y + Math.cos(elapsed * rig.speed * 1.4 + index) * 0.22,
      rig.origin.z + Math.sin(elapsed * rig.speed * 0.8 + index * 2.1) * 0.42,
    );
  });

  velvetMaterial.uniforms.lightA.value.copy(lightRig[0].light.position);
  velvetMaterial.uniforms.lightB.value.copy(lightRig[1].light.position);
  velvetMaterial.uniforms.lightC.value.copy(lightRig[2].light.position);
  cordMaterial.uniforms.lightA.value.copy(lightRig[0].light.position);
  cordMaterial.uniforms.lightB.value.copy(lightRig[1].light.position);
  cordMaterial.uniforms.lightC.value.copy(lightRig[2].light.position);
}

function createAmbientDust() {
  const count = 760;
  const positions = [];
  const colors = [];

  for (let index = 0; index < count; index += 1) {
    const radius = 7 + seededNoise(index * 2.1) * 18;
    const theta = seededNoise(index * 5.3) * Math.PI * 2;
    const y = -3.5 + seededNoise(index * 3.7) * 7.5;
    const z = -13 + seededNoise(index * 11.4) * 8;
    const color = new THREE.Color().setHSL(
      0.52 + seededNoise(index * 17.8) * 0.12,
      0.52,
      0.38 + seededNoise(index * 4.4) * 0.3,
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
      opacity: 0.62,
      size: 0.032,
      sizeAttenuation: true,
      transparent: true,
      vertexColors: true,
    }),
  );
}

function createGlowShards() {
  const group = new THREE.Group();
  const texture = createShardTexture();
  const colors = [0x74cfff, 0x42f0ff, 0x315fff, 0xebfbff];
  const shards = [];

  for (let index = 0; index < 34; index += 1) {
    const material = new THREE.SpriteMaterial({
      blending: THREE.AdditiveBlending,
      color: colors[index % colors.length],
      depthWrite: false,
      map: texture,
      opacity: 0,
      rotation: seededNoise(index * 7.4) * Math.PI,
      transparent: true,
    });
    const sprite = new THREE.Sprite(material);
    const side = index % 2 === 0 ? -1 : 1;
    const basePosition = new THREE.Vector3(
      side * (1.65 + seededNoise(index * 2.7) * 3.25),
      -1.7 + seededNoise(index * 7.3) * 3.8,
      -2.65 + seededNoise(index * 5.1) * 2.1,
    );
    const baseScale = new THREE.Vector2(
      0.42 + seededNoise(index * 8.2) * 0.95,
      0.012 + seededNoise(index * 3.4) * 0.032,
    );

    sprite.position.copy(basePosition);
    sprite.scale.set(baseScale.x, baseScale.y, 1);
    group.add(sprite);
    shards.push({
      baseOpacity: 0.1 + seededNoise(index * 6.6) * 0.22,
      basePosition,
      baseScale,
      phase: seededNoise(index * 11.9) * Math.PI * 2,
      rotation: material.rotation,
      speed: 0.45 + seededNoise(index * 19.1) * 0.9,
      sprite,
    });
  }

  return { group, shards };
}

function updateGlowShards(elapsed) {
  const viewportFade = camera.aspect < 0.75 ? 0.48 : 1;

  glowShards.shards.forEach((shard) => {
    const pulse = Math.pow(Math.max(0, Math.sin(elapsed * shard.speed + shard.phase)), 2.5);

    shard.sprite.position.set(
      shard.basePosition.x + Math.sin(elapsed * 0.12 + shard.phase) * 0.24,
      shard.basePosition.y + Math.cos(elapsed * 0.1 + shard.phase) * 0.16,
      shard.basePosition.z,
    );
    shard.sprite.material.opacity = (0.02 + pulse * shard.baseOpacity) * viewportFade;
    shard.sprite.material.rotation = shard.rotation + Math.sin(elapsed * 0.4 + shard.phase) * 0.08;
    shard.sprite.scale.set(
      shard.baseScale.x * (0.86 + pulse * 0.28),
      shard.baseScale.y * (0.8 + pulse * 0.52),
      1,
    );
  });
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

function createShardTexture() {
  const textureCanvas = document.createElement("canvas");
  const width = 512;
  const height = 64;
  const context = textureCanvas.getContext("2d");

  textureCanvas.width = width;
  textureCanvas.height = height;

  const gradient = context.createLinearGradient(0, height / 2, width, height / 2);
  gradient.addColorStop(0, "rgba(255, 255, 255, 0)");
  gradient.addColorStop(0.45, "rgba(255, 255, 255, 0.7)");
  gradient.addColorStop(0.55, "rgba(255, 255, 255, 0.7)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  const vertical = context.createLinearGradient(0, 0, 0, height);
  vertical.addColorStop(0, "rgba(255, 255, 255, 0)");
  vertical.addColorStop(0.5, "rgba(255, 255, 255, 1)");
  vertical.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.globalCompositeOperation = "destination-in";
  context.fillStyle = vertical;
  context.fillRect(0, 0, width, height);

  return new THREE.CanvasTexture(textureCanvas);
}

function smoothstep(edge0, edge1, value) {
  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);

  return t * t * (3 - 2 * t);
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

function seededNoise(seed) {
  const value = Math.sin(seed * 12.9898) * 43758.5453123;

  return value - Math.floor(value);
}
