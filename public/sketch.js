/* 
Workshop_3: B00km4rk5_P3rsona1_Atla5
By: Andres Serna
Last update: 1 March 2026

Blurp: A personal dataset dynamic mapping about some of the web references I have archived over a few years.

*/

let data; // Stores bookmarks data from JSON file

let cam = { // Camera values to control zoom/pan
  x: 0,
  y: 0,
  z: 1,
  tz: 1,
  dragging: false,
  lastMx: 0,
  lastMy: 0,

  // Zoom focus
  // If set, we maintain: focusScreen = focusWorld * zoom + pan
  focusWorld: null,   // p5.Vector in world coords under cursor when wheel happened
  focusScreen: null   // {x,y} cursor position in screen pixels at wheel time
};

// ATLAS STATE
let atlas = {
  center: null,
  R: 320,
  ringPad: 30,
  nodes: [],
  hoveredIndex: -1,
  categories: ["Art", "YT tutorials", "Tools", "Docs", "Coding", "Miscellany"],
  anchors: {},
  dateMin: null,
  dateMax: null
};

// CATEGORIES COLOR
const CAT_COLORS = {
  "Art": [46, 98, 159],
  "YT tutorials": [181, 120, 38],
  "Tools": [57, 140, 105],
  "Docs": [132, 96, 165],
  "Coding": [170, 62, 62],
  "Miscellany": [70, 70, 70]
};

// LAYOUT TUNING

const TUNE = {
  ringRadiusFactor: 0.40,

  // Cluster layout: keep category clusters closer
  anchorRadiusFactor: 0.60,
  attract: 0.0020,

  // Internal spacing: more distance inside clusters
  repelRadius: 180,
  repelStrength: 0.00085,

  damping: 0.95,
  maxSpeed: 1.25,

  driftAmp: 0.25,
  driftFreq: 0.0012,

  zoomMin: 0.60,
  zoomMax: 4.20
};

function preload() {
  data = loadJSON("bookmarks.json");
}

function setup() {
  const c = createCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  textFont("Nunito");
  textSize(13);

  colorMode(RGB, 255, 255, 255, 255);

  // Prevent page scrolling on wheel (so zoom is reliable)
  c.elt.addEventListener("wheel", (e) => e.preventDefault(), { passive: false });

  resizeAtlas();
  buildDataset();
  centerCamera();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  resizeAtlas();
  clampCameraToAtlas();
}

// ATLAS GEOMETRY (ring radius + category anchors)

function resizeAtlas() {
  atlas.center = createVector(width / 2, height / 2);
  atlas.R = min(width, height) * TUNE.ringRadiusFactor;
  buildAnchors();
}

function buildAnchors() {
  atlas.anchors = {};
  const n = atlas.categories.length;
  const startAngle = -HALF_PI;

  for (let i = 0; i < n; i++) {
    const cat = atlas.categories[i];
    const a = startAngle + (TWO_PI * i) / n;
    const r = atlas.R * TUNE.anchorRadiusFactor;

    atlas.anchors[cat] = createVector(
      atlas.center.x + cos(a) * r,
      atlas.center.y + sin(a) * r
    );
  }
}

// 2) DATA -> NODE OBJECTS

function buildDataset() {
  const bms = (data && data.bookmarks) ? data.bookmarks : [];
  atlas.nodes = [];

  let minT = Infinity;
  let maxT = -Infinity;

  for (const b of bms) {
    const t = parseDateToTime(b.add_date);
    if (!isNaN(t)) {
      minT = min(minT, t);
      maxT = max(maxT, t);
    }
  }

  if (minT === Infinity || maxT === -Infinity) {
    minT = parseDateToTime("2020-01-01");
    maxT = parseDateToTime("2026-02-28");
  }

  atlas.dateMin = minT;
  atlas.dateMax = maxT;

  for (const b of bms) {
    const cat = normalizeCategory(b.category);
    const anchor = atlas.anchors[cat] || atlas.center.copy();

    const ref = clamp(Number(b.ref_level), 0.1, 1.0);
    const size = lerp(10, 46, (ref - 0.1) / 0.9);

    const t = parseDateToTime(b.add_date);
    const dateNorm = isNaN(t)
      ? 0.5
      : clamp((t - atlas.dateMin) / (atlas.dateMax - atlas.dateMin || 1), 0, 1);

    const jitter = p5.Vector.random2D().mult(random(16, 140));

    atlas.nodes.push({
      title: (b.title || "").trim(),
      url: (b.url || "").trim(),
      domain: (b.domain || "").trim(),
      category: cat,
      key_word: (b.key_word || "").trim(),
      ref_level: ref,
      add_date: (b.add_date || "").trim(),

      pos: p5.Vector.add(anchor, jitter),
      vel: p5.Vector.random2D().mult(random(0.15, 0.55)),
      size,
      dateNorm,
      hoverAmt: 0,
      phase: random(1000)
    });
  }
}

// 3) DRAW LOOP

function draw() {
  background(255);

  // Smooth zoom toward target zoom
  // NOTE: pan is updated below (if zoom focus exists) so the map doesn't jump
  cam.z = lerp(cam.z, cam.tz, 0.18);

  // If we're zooming (or recently zoomed), keep the same world point under the cursor
  // This is the key fix that prevents the atlas from disappearing.
  if (cam.focusWorld && cam.focusScreen) {
    cam.x = cam.focusScreen.x - cam.focusWorld.x * cam.z;
    cam.y = cam.focusScreen.y - cam.focusWorld.y * cam.z;
    clampCameraToAtlas();
  }

  atlas.hoveredIndex = pickHoveredNodeIndex();

  push();
  applyCamera();
  drawAliveRing();
  drawCategoryZones();
  stepNodes();
  drawNodes();
  pop();

  drawTitle();
  drawInteractionHint();
  drawHoverUI();
}

// CAMERA TRANSFORMS (world <-> screen)

function applyCamera() {
  translate(cam.x, cam.y);
  scale(cam.z);
}

function screenToWorld(mx, my) {
  return createVector((mx - cam.x) / cam.z, (my - cam.y) / cam.z);
}

function worldToScreen(v) {
  return createVector(v.x * cam.z + cam.x, v.y * cam.z + cam.y);
}

function centerCamera() {
  cam.x = width / 2 - atlas.center.x * cam.z;
  cam.y = height / 2 - atlas.center.y * cam.z;
  clampCameraToAtlas();
}

function clampCameraToAtlas() {
  const r = atlas.R * cam.z;
  const c = worldToScreen(atlas.center);
  const margin = 40;

  const minCx = -r + margin;
  const maxCx = width + r - margin;
  const minCy = -r + margin;
  const maxCy = height + r - margin;

  const clampedCx = clamp(c.x, minCx, maxCx);
  const clampedCy = clamp(c.y, minCy, maxCy);

  cam.x += (clampedCx - c.x);
  cam.y += (clampedCy - c.y);
}

// PHYSICS (clustering + spacing + boundary)

function stepNodes() {
  const center = atlas.center;
  const R = atlas.R - atlas.ringPad;

  const kAttract = TUNE.attract;
  const kRepel = TUNE.repelStrength;
  const repelRadius = TUNE.repelRadius;
  const damp = TUNE.damping;
  const maxSpeed = TUNE.maxSpeed;

  for (let i = 0; i < atlas.nodes.length; i++) {
    const n = atlas.nodes[i];
    const target = (i === atlas.hoveredIndex) ? 1 : 0;
    n.hoverAmt = lerp(n.hoverAmt, target, 0.18);
  }

  for (let i = 0; i < atlas.nodes.length; i++) {
    const a = atlas.nodes[i];

    const anchor = atlas.anchors[a.category] || center;
    const toAnchor = p5.Vector.sub(anchor, a.pos);
    a.vel.add(toAnchor.mult(kAttract * (0.7 + a.ref_level * 0.6)));

    const t = frameCount * TUNE.driftFreq;
    const dx = map(noise(a.phase + t), 0, 1, -TUNE.driftAmp, TUNE.driftAmp);
    const dy = map(noise(a.phase + 100 + t), 0, 1, -TUNE.driftAmp, TUNE.driftAmp);
    a.vel.add(dx, dy);

    for (let j = i + 1; j < atlas.nodes.length; j++) {
      const b = atlas.nodes[j];

      const d = p5.Vector.sub(a.pos, b.pos);
      const distSq = d.magSq();
      if (distSq === 0) continue;

      // Bigger minSep => more breathing room inside clusters
      const minSep = (a.size + b.size) * 0.80 + 18;
      const soft = max(minSep, repelRadius);

      if (distSq < soft * soft) {
        const distV = sqrt(distSq);
        d.mult(1 / (distV || 1));
        const push = (1 - distV / soft);
        const f = push * kRepel;

        a.vel.add(p5.Vector.mult(d, f));
        b.vel.sub(p5.Vector.mult(d, f));
      }
    }
  }

  for (const n of atlas.nodes) {
    n.vel.mult(damp);
    n.vel.limit(maxSpeed);
    n.pos.add(n.vel);

    const v = p5.Vector.sub(n.pos, center);
    const d = v.mag();

    if (d > R) {
      v.normalize();
      const overshoot = d - R;
      n.pos.sub(p5.Vector.mult(v, overshoot * 0.85));

      const vn = p5.Vector.dot(n.vel, v);
      if (vn > 0) n.vel.sub(p5.Vector.mult(v, vn * 1.25));
    }
  }
}

// DRAWING (ring, zones, nodes)

function drawAliveRing() {
  const c = atlas.center;
  const baseR = atlas.R;

  noFill();
  stroke(30, 30, 30, 120);
  strokeWeight(2 / cam.z);

  beginShape();
  const steps = 240;
  const t = frameCount * 0.009;
  for (let i = 0; i <= steps; i++) {
    const a = (TWO_PI * i) / steps;
    const nx = cos(a) * 0.9 + 1.2;
    const ny = sin(a) * 0.9 + 1.2;
    const n = noise(nx + t, ny + t);
    const wobble = map(n, 0, 1, -16, 16);
    const r = baseR + wobble;
    vertex(c.x + cos(a) * r, c.y + sin(a) * r);
  }
  endShape();
}

function drawCategoryZones() {
  noFill();
  stroke(0, 0, 0, 35);
  strokeWeight(1 / cam.z);

  const t = frameCount * 0.006;
  for (const cat of atlas.categories) {
    const a = atlas.anchors[cat];
    if (!a) continue;

    beginShape();
    const steps = 70;
    const r0 = atlas.R * 0.22;
    for (let i = 0; i <= steps; i++) {
      const ang = (TWO_PI * i) / steps;
      const nn = noise(a.x * 0.004 + cos(ang) + t, a.y * 0.004 + sin(ang) + t);
      const rr = r0 + map(nn, 0, 1, -12, 12);
      vertex(a.x + cos(ang) * rr, a.y + sin(ang) * rr);
    }
    endShape();
  }

  // Category labels outside ring, tangent-rotated, flipped to be readable
  push();
  fill(0);
  noStroke();
  textAlign(CENTER, CENTER);
  textSize(16 / cam.z);

  const n = atlas.categories.length;
  const startAngle = -HALF_PI;
  const rLabel = atlas.R * 1.12;

  for (let i = 0; i < n; i++) {
    const cat = atlas.categories[i];
    const ang = startAngle + (TWO_PI * i) / n;

    const x = atlas.center.x + cos(ang) * rLabel;
    const y = atlas.center.y + sin(ang) * rLabel;

    push();
    translate(x, y);

    let rot = ang + HALF_PI;
    const rotNorm = ((rot % TWO_PI) + TWO_PI) % TWO_PI;
    const upsideDown = rotNorm > HALF_PI && rotNorm < (3 * HALF_PI);
    if (upsideDown) rot += PI;

    rotate(rot);
    text(cat.toUpperCase(), 0, 0);
    pop();
  }

  pop();
}

function drawNodes() {
  const h = atlas.hoveredIndex;
  const someoneHovered = (h >= 0);

  // Draw all NON-hovered nodes first (so hovered can sit on top)
  for (let i = 0; i < atlas.nodes.length; i++) {
    if (i === h) continue;

    const n = atlas.nodes[i];

    // Keep a small pulse on non-hovered nodes too (optional)
    const size = n.size * (1 + 0.08 * n.hoverAmt);

    const base = CAT_COLORS[n.category] || [80, 80, 80];
    const gray = [80, 80, 80];
    const mixAmt = lerp(0.20, 1.00, n.dateNorm);
    const col = mixRGB(gray, base, mixAmt);

    // Dim background nodes when hovering something
    const alpha = someoneHovered ? 70 : 220;

    noStroke();
    fill(col[0], col[1], col[2], alpha);
    drawShapeForCategory(n.category, n.pos.x, n.pos.y, size);
  }

  // Draw hovered node last (top layer) with halo + outline
  if (h >= 0) {
    const n = atlas.nodes[h];

    const size = n.size * (1 + 0.22 * n.hoverAmt);

    const base = CAT_COLORS[n.category] || [80, 80, 80];
    const gray = [80, 80, 80];
    const mixAmt = lerp(0.20, 1.00, n.dateNorm);
    const col = mixRGB(gray, base, mixAmt);

    // Halo
    noFill();
    stroke(col[0], col[1], col[2], 150);
    strokeWeight((3.2 + 4.0 * n.hoverAmt) / cam.z);
    ellipse(n.pos.x, n.pos.y, size * 1.65, size * 1.65);

    // Node fill
    noStroke();
    fill(col[0], col[1], col[2], 255);
    drawShapeForCategory(n.category, n.pos.x, n.pos.y, size);

    // Outline (on top) — helps contrast
    noFill();
    stroke(20, 20, 20, 200);
    strokeWeight(2.2 / cam.z);
    drawShapeOutlineForCategory(n.category, n.pos.x, n.pos.y, size);
  }
}

function drawShapeForCategory(cat, x, y, s) {
  switch (cat) {
    case "Tools":
      ellipse(x, y, s, s);
      break;
    case "Docs":
      ellipse(x, y, s * 1.25, s * 0.6);
      break;
    case "YT tutorials":
      rectMode(CENTER);
      rect(x, y, s, s, s * 0.12);
      break;
    case "Coding":
      rectMode(CENTER);
      rect(x, y, s * 1.35, s * 0.4, s * 0.12);
      break;
    case "Art":
      triangle(
        x, y - s * 0.62,
        x - s * 0.58, y + s * 0.44,
        x + s * 0.58, y + s * 0.44
      );
      break;
    case "Miscellany":
    default:
      push();
      stroke(30, 30, 30, 220);
      strokeWeight(3.2 / cam.z);
      line(x - s * 0.45, y - s * 0.45, x + s * 0.45, y + s * 0.45);
      line(x + s * 0.45, y - s * 0.45, x - s * 0.45, y + s * 0.45);
      pop();
      break;
  }
}

function drawShapeOutlineForCategory(cat, x, y, s) {
  // Same geometry as drawShapeForCategory, but stroke-only for an outline.
  switch (cat) {
    case "Tools":
      ellipse(x, y, s, s);
      break;

    case "Docs":
      ellipse(x, y, s * 1.25, s * 0.8);
      break;

    case "YT tutorials":
      rectMode(CENTER);
      rect(x, y, s, s, s * 0.12);
      break;

    case "Coding":
      rectMode(CENTER);
      rect(x, y, s * 1.35, s * 0.7, s * 0.12);
      break;

    case "Art":
      triangle(
        x, y - s * 0.62,
        x - s * 0.58, y + s * 0.44,
        x + s * 0.58, y + s * 0.44
      );
      break;

    case "Miscellany":
    default:
      // For X, the outline *is* the stroke in your main draw function,
      // so we can just re-draw the same X here.
      line(x - s * 0.45, y - s * 0.45, x + s * 0.45, y + s * 0.45);
      line(x + s * 0.45, y - s * 0.45, x - s * 0.45, y + s * 0.45);
      break;
  }
}

// UI

function drawTitle() {
  const title = data?.meta?.title || "Bookmarks Atlas";
  const note = data?.meta?.note || "";
  const autor = data?.meta?.autor || "";

  fill(0);
  noStroke();
  textAlign(LEFT, TOP);
  textSize(25);
  text(note ? `${title} :` : title, 16, 14);
  text(note ? `${note}` : title, 16, 45);
  fill(80);
  textSize(18);
  text(note ? `${autor}` : title, 16, 80);
}

function drawInteractionHint() {
  fill(80);
  noStroke();
  textAlign(LEFT, TOP);
  textSize(14);
  text(`Drag to pan • Scroll to zoom\nZoom: ${nf(cam.z, 1, 2)}x`, 16, 110);
}

function drawHoverUI() {
  const idx = atlas.hoveredIndex;
  if (idx < 0) return;

  const n = atlas.nodes[idx];
  const p = worldToScreen(n.pos);

  fill(20);
  noStroke();
  textSize(13);

  const title = truncate(n.title || n.domain || "Untitled", 28);
  const r = (n.size * cam.z) * 0.55;

  const topY = p.y - r - 18;
  const botY = p.y + r + 18;
  const leftX = p.x - r - 16;
  const rightX = p.x + r + 16;

  textAlign(CENTER, CENTER);
  text(title, p.x, topY);

  textAlign(CENTER, CENTER);
  text(n.add_date || "", p.x, botY);

  textAlign(RIGHT, CENTER);
  text(n.key_word || "", leftX, p.y);

  textAlign(LEFT, CENTER);
  text(n.ref_level != null ? nf(n.ref_level, 1, 2) : "", rightX, p.y);

  fill(90);
  textAlign(CENTER, CENTER);
  textSize(11);
  text("click to open", p.x, botY + 16);
}

// INPUT (click open + pan + zoom)


function mousePressed() {
  // If clicking a node, open immediately (popup rules)
  if (atlas.hoveredIndex >= 0) {
    const url = atlas.nodes[atlas.hoveredIndex].url;
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
  }

  // Starting a pan should cancel "zoom focus lock"
  cam.focusWorld = null;
  cam.focusScreen = null;

  cam.dragging = true;
  cam.lastMx = mouseX;
  cam.lastMy = mouseY;
}

function mouseDragged() {
  if (!cam.dragging) return;

  const dx = mouseX - cam.lastMx;
  const dy = mouseY - cam.lastMy;
  cam.lastMx = mouseX;
  cam.lastMy = mouseY;

  cam.x += dx;
  cam.y += dy;

  clampCameraToAtlas();
}

function mouseReleased() {
  cam.dragging = false;
}

function mouseWheel(e) {
  // Save cursor world point for stable zoom during smoothing
  cam.focusWorld = screenToWorld(mouseX, mouseY);
  cam.focusScreen = { x: mouseX, y: mouseY };

  const zoomFactor = 1.0016;
  cam.tz = clamp(cam.tz * pow(zoomFactor, -e.delta), TUNE.zoomMin, TUNE.zoomMax);

  // Immediately clamp using current cam.z; draw() will update pan each frame
  clampCameraToAtlas();
  return false;
}

// HOVER PICKING

function pickHoveredNodeIndex() {
  const m = screenToWorld(mouseX, mouseY);

  let best = -1;
  let bestD = Infinity;

  for (let i = 0; i < atlas.nodes.length; i++) {
    const n = atlas.nodes[i];
    const r = max(10, n.size * 0.55);
    const d = dist(m.x, m.y, n.pos.x, n.pos.y);

    if (d < r && d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// UTILITIES AND FIXERS

function normalizeCategory(c) {
  if (!c) return "Miscellany";
  const s = String(c).trim();
  return atlas.categories.includes(s) ? s : "Miscellany";
}

function parseDateToTime(s) {
  if (!s) return NaN;
  const t = Date.parse(s);
  return isNaN(t) ? NaN : t;
}

function truncate(str, maxLen) {
  const s = String(str || "");
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1).trimEnd() + "…";
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function mixRGB(a, b, t) {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t))
  ];
}