/* 
Workshop_3: B00km4rk5_P3rsona1_Atla5
*/

// Variable used to store the bookmarks JSON data
let data;

// Camera object used to manage panning and zooming of the atlas
let cam = {

  x: 0,   // horizontal offset of the camera
  y: 0,   // vertical offset of the camera

  z: 1,   // current zoom value
  tz: 1,  // target zoom used for smooth zoom transitions

  dragging: false,  // true while the user is dragging the canvas

  lastMx: 0, // last mouse x position
  lastMy: 0, // last mouse y position


  // Variables used to keep the zoom centered on the cursor
  focusWorld: null,   // world coordinate under the cursor
  focusScreen: null   // screen position of the cursor
};

// Object that stores the main atlas state
let atlas = {

  center: null, // center of the atlas

  R: 320,       // radius of the main atlas area
  ringPad: 30,  // small padding to keep nodes inside the ring

  nodes: [],    // array containing all bookmark nodes

  hoveredIndex: -1, // index of the node currently hovered

  // list of categories used in the visualization
  categories: ["Art", "YT tutorials", "Tools", "Docs", "Coding", "Miscellany"],

  anchors: {},  // stores the spatial anchor for each category

  dateMin: null, // earliest bookmark date
  dateMax: null  // latest bookmark date
};

// Color associated with each category
const CAT_COLORS = {

  "Art": [46, 98, 159],
  "YT tutorials": [181, 120, 38],
  "Tools": [57, 140, 105],
  "Docs": [132, 96, 165],
  "Coding": [170, 62, 62],
  "Miscellany": [70, 70, 70]
};

// Parameters used to tune the layout and motion of the nodes
const TUNE = {

  ringRadiusFactor: 0.40,

  // category cluster behaviour
  anchorRadiusFactor: 0.60,
  attract: 0.0020,

  // spacing between nodes
  repelRadius: 180,
  repelStrength: 0.00085,

  damping: 0.95,
  maxSpeed: 1.25,

  // small movement to keep nodes visually alive
  driftAmp: 0.25,
  driftFreq: 0.0012,

  // zoom limits
  zoomMin: 0.60,
  zoomMax: 4.20
};

// Load the JSON file before the sketch starts
function preload() {

  data = loadJSON("bookmarks.json");

}

// Setup runs once when the sketch starts
function setup() {

  const c = createCanvas(windowWidth, windowHeight);

  // Fix pixel density for consistent rendering
  pixelDensity(1);

  // Font used in the interface
  textFont("Nunito");

  textSize(13);

  colorMode(RGB, 255, 255, 255, 255);


  // Prevent page scrolling so mouse wheel only zooms the atlas
  c.elt.addEventListener("wheel", (e) => e.preventDefault(), { passive: false });


  // Initialize atlas layout
  resizeAtlas();

  // Convert JSON bookmarks into nodes
  buildDataset();

  // Center camera on the atlas
  centerCamera();
}

// Handle window resizing
function windowResized() {

  resizeCanvas(windowWidth, windowHeight);

  resizeAtlas();

  clampCameraToAtlas();
}

// ATLAS GEOMETRY:

// Recalculate atlas size and position based on the canvas
function resizeAtlas() {

  // The center of the atlas is always the center of the canvas
  atlas.center = createVector(width / 2, height / 2);

  // Radius is scaled relative to the screen size
  atlas.R = min(width, height) * TUNE.ringRadiusFactor;

  // Rebuild category anchors whenever the atlas size changes
  buildAnchors();
}

// Compute the anchor position for each category cluster
function buildAnchors() {

  // Reset anchors
  atlas.anchors = {};

  // Number of categories
  const n = atlas.categories.length;

  // Start placing anchors from the top of the circle
  const startAngle = -HALF_PI;

  for (let i = 0; i < n; i++) {

    const cat = atlas.categories[i];

    // Evenly distribute anchors around the circle
    const a = startAngle + (TWO_PI * i) / n;

    // Distance from center where the anchor is placed
    const r = atlas.R * TUNE.anchorRadiusFactor;

    // Store anchor coordinates for this category
    atlas.anchors[cat] = createVector(
      atlas.center.x + cos(a) * r,
      atlas.center.y + sin(a) * r
    );
  }
}


// DATASET PROCESSING

// Convert the JSON bookmark data into visual node objects
function buildDataset() {

  // Get bookmark list from the JSON file
  const bms = (data && data.bookmarks) ? data.bookmarks : [];

  // Reset nodes array
  atlas.nodes = [];

  let minT = Infinity;
  let maxT = -Infinity;

  // Find the earliest and latest bookmark dates
  for (const b of bms) {

    const t = parseDateToTime(b.add_date);

    if (!isNaN(t)) {

      minT = min(minT, t);
      maxT = max(maxT, t);
    }
  }

  // If dates are missing, use fallback values
  if (minT === Infinity || maxT === -Infinity) {

    minT = parseDateToTime("2020-01-01");
    maxT = parseDateToTime("2026-02-28");
  }

  atlas.dateMin = minT;
  atlas.dateMax = maxT;

  // Create node objects from bookmarks
  for (const b of bms) {

    // Normalize category name
    const cat = normalizeCategory(b.category);

    // Get category anchor position
    const anchor = atlas.anchors[cat] || atlas.center.copy();

    // Clamp reference level between 0.1 and 1
    const ref = clamp(Number(b.ref_level), 0.1, 1.0);

    // Node size based on reference level
    const size = lerp(10, 46, (ref - 0.1) / 0.9);

    // Convert date to time value
    const t = parseDateToTime(b.add_date);

    // Normalize date between 0 and 1
    const dateNorm = isNaN(t)
      ? 0.5
      : clamp((t - atlas.dateMin) / (atlas.dateMax - atlas.dateMin || 1), 0, 1);

    // Small random offset so nodes don't overlap exactly
    const jitter = p5.Vector.random2D().mult(random(16, 140));

    // Push new node object into the atlas
    atlas.nodes.push({

      title: (b.title || "").trim(),
      url: (b.url || "").trim(),
      domain: (b.domain || "").trim(),

      category: cat,
      key_word: (b.key_word || "").trim(),

      ref_level: ref,
      add_date: (b.add_date || "").trim(),

      // Position starts near the category anchor
      pos: p5.Vector.add(anchor, jitter),

      // Initial random velocity
      vel: p5.Vector.random2D().mult(random(0.15, 0.55)),

      size,

      dateNorm,

      hoverAmt: 0, // hover animation amount

      phase: random(1000) // used for small noise motion
    });
  }
}


// MAIN DRAW LOOP

function draw() {

  // Clear background every frame
  background(255);


  // Smooth zoom transition toward the target zoom value
  cam.z = lerp(cam.z, cam.tz, 0.18);


  // When zooming, keep the same world point under the cursor
  if (cam.focusWorld && cam.focusScreen) {

    cam.x = cam.focusScreen.x - cam.focusWorld.x * cam.z;
    cam.y = cam.focusScreen.y - cam.focusWorld.y * cam.z;

    clampCameraToAtlas();
  }


  // Detect which node is currently under the mouse
  atlas.hoveredIndex = pickHoveredNodeIndex();


  // Apply camera transformation
  push();

  applyCamera();

  // Draw atlas elements
  drawAliveRing();

  drawCategoryZones();

  // Update node physics
  stepNodes();

  // Draw bookmark nodes
  drawNodes();

  pop();


  // Draw UI elements on top
  drawTitle();

  drawInteractionHint();

  drawHoverUI();
}

// CAMERA FUNCTIONS

// Apply camera translation and zoom
function applyCamera() {

  translate(cam.x, cam.y);

  scale(cam.z);
}



// Convert screen coordinates into world coordinates
function screenToWorld(mx, my) {

  return createVector(
    (mx - cam.x) / cam.z,
    (my - cam.y) / cam.z
  );
}



// Convert world coordinates back into screen space
function worldToScreen(v) {

  return createVector(
    v.x * cam.z + cam.x,
    v.y * cam.z + cam.y
  );
}



// Center the camera on the atlas
function centerCamera() {

  cam.x = width / 2 - atlas.center.x * cam.z;

  cam.y = height / 2 - atlas.center.y * cam.z;

  clampCameraToAtlas();
}

// Prevent camera from moving too far away from the atlas
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


// NODE PHYSICS SIMULATION

// Update node positions and simulate simple physics behaviour
function stepNodes() {

  const center = atlas.center;

  // Radius limit for nodes inside the atlas
  const R = atlas.R - atlas.ringPad;

  const kAttract = TUNE.attract;
  const kRepel = TUNE.repelStrength;

  const repelRadius = TUNE.repelRadius;

  const damp = TUNE.damping;
  const maxSpeed = TUNE.maxSpeed;


  // Update hover animation values
  for (let i = 0; i < atlas.nodes.length; i++) {

    const n = atlas.nodes[i];

    const target = (i === atlas.hoveredIndex) ? 1 : 0;

    // Smooth transition for hover effect
    n.hoverAmt = lerp(n.hoverAmt, target, 0.18);
  }


  // Apply forces to each node
  for (let i = 0; i < atlas.nodes.length; i++) {

    const a = atlas.nodes[i];

    // Get anchor position of the category
    const anchor = atlas.anchors[a.category] || center;

    // Attraction force toward the category anchor
    const toAnchor = p5.Vector.sub(anchor, a.pos);

    a.vel.add(toAnchor.mult(kAttract * (0.7 + a.ref_level * 0.6)));


    // Small drifting motion using noise
    const t = frameCount * TUNE.driftFreq;

    const dx = map(noise(a.phase + t), 0, 1, -TUNE.driftAmp, TUNE.driftAmp);
    const dy = map(noise(a.phase + 100 + t), 0, 1, -TUNE.driftAmp, TUNE.driftAmp);

    a.vel.add(dx, dy);


    // Repulsion between nodes
    for (let j = i + 1; j < atlas.nodes.length; j++) {

      const b = atlas.nodes[j];

      const d = p5.Vector.sub(a.pos, b.pos);

      const distSq = d.magSq();

      if (distSq === 0) continue;


      // Minimum separation based on node sizes
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


  // Apply velocity and keep nodes inside the atlas boundary
  for (const n of atlas.nodes) {

    // Apply damping to slow movement
    n.vel.mult(damp);

    // Limit max speed
    n.vel.limit(maxSpeed);

    // Update position
    n.pos.add(n.vel);


    // Check if node is outside the atlas
    const v = p5.Vector.sub(n.pos, center);

    const d = v.mag();


    if (d > R) {

      v.normalize();

      const overshoot = d - R;

      // Push node back inside
      n.pos.sub(p5.Vector.mult(v, overshoot * 0.85));


      // Reflect velocity away from boundary
      const vn = p5.Vector.dot(n.vel, v);

      if (vn > 0) n.vel.sub(p5.Vector.mult(v, vn * 1.25));
    }
  }
}

// DRAWING:

// Draw the animated ring around the central atlas area
function drawAliveRing() {
  const c = atlas.center; // center position of the atlas
  const baseR = atlas.R;  // base radius of the atlas ring

  noFill();               // ring is just an outline, no fill
  stroke(30, 30, 30, 120); // dark semi-transparent stroke
  strokeWeight(2 / cam.z); // stroke scales with zoom for consistent thickness

  beginShape();
  const steps = 240;      // number of vertices to make a smooth circle
  const t = frameCount * 0.009; // time offset for Perlin noise animation

  for (let i = 0; i <= steps; i++) {
    const a = (TWO_PI * i) / steps; // angle for this step
    const nx = cos(a) * 0.9 + 1.2;  // x input for noise
    const ny = sin(a) * 0.9 + 1.2;  // y input for noise
    const n = noise(nx + t, ny + t); // generate smooth noise value
    const wobble = map(n, 0, 1, -16, 16); // map noise to radius offset
    const r = baseR + wobble;            // final radius including wobble
    vertex(c.x + cos(a) * r, c.y + sin(a) * r); // place vertex
  }

  endShape(); // complete the ring shape
}

// Draw the lightly shaded zones around each category cluster
function drawCategoryZones() {
  noFill();                  // zones are outlines only
  stroke(0, 0, 0, 35);       // very light black stroke
  strokeWeight(1 / cam.z);   // scale stroke with zoom

  const t = frameCount * 0.006; // time for small noise offset
  for (const cat of atlas.categories) {
    const a = atlas.anchors[cat]; // anchor point for this category
    if (!a) continue;             // skip if anchor not defined

    beginShape();
    const steps = 70;              // fewer steps than ring, rougher shape
    const r0 = atlas.R * 0.22;     // base radius for category zone

    for (let i = 0; i <= steps; i++) {
      const ang = (TWO_PI * i) / steps; // current angle
      const nn = noise(a.x * 0.004 + cos(ang) + t, a.y * 0.004 + sin(ang) + t); // smooth randomness
      const rr = r0 + map(nn, 0, 1, -12, 12); // adjust radius with noise
      vertex(a.x + cos(ang) * rr, a.y + sin(ang) * rr); // vertex around anchor
    }

    endShape(); // finish drawing category zone
  }

  // Draw category labels outside the ring
  push(); // save current transformation
  fill(0); 
  noStroke();
  textAlign(CENTER, CENTER);
  textSize(16 / cam.z); // scale text with zoom

  const n = atlas.categories.length;
  const startAngle = -HALF_PI; // start at top
  const rLabel = atlas.R * 1.12; // label radius beyond ring

  for (let i = 0; i < n; i++) {
    const cat = atlas.categories[i];
    const ang = startAngle + (TWO_PI * i) / n;

    const x = atlas.center.x + cos(ang) * rLabel; // label x position
    const y = atlas.center.y + sin(ang) * rLabel; // label y position

    push();           // isolate transformations
    translate(x, y);

    let rot = ang + HALF_PI; // rotate text along circle
    const rotNorm = ((rot % TWO_PI) + TWO_PI) % TWO_PI; // normalize rotation
    const upsideDown = rotNorm > HALF_PI && rotNorm < (3 * HALF_PI); // check if upside down
    if (upsideDown) rot += PI; // flip if necessary

    rotate(rot); // apply rotation
    text(cat.toUpperCase(), 0, 0); // draw category label
    pop();
  }

  pop(); // restore original transformation
}

// Draw all bookmark nodes
function drawNodes() {
  const h = atlas.hoveredIndex;           // index of hovered node
  const someoneHovered = (h >= 0);       // flag if any node is hovered

  // Draw non-hovered nodes first (background)
  for (let i = 0; i < atlas.nodes.length; i++) {
    if (i === h) continue;                // skip hovered node

    const n = atlas.nodes[i];
    const size = n.size * (1 + 0.08 * n.hoverAmt); // subtle pulsing effect

    const base = CAT_COLORS[n.category] || [80, 80, 80]; // category color
    const gray = [80, 80, 80];                             // base gray for blending
    const mixAmt = lerp(0.20, 1.00, n.dateNorm);         // blend factor by date
    const col = mixRGB(gray, base, mixAmt);              // final color

    const alpha = someoneHovered ? 70 : 220;             // dim if something hovered

    noStroke();
    fill(col[0], col[1], col[2], alpha);
    drawShapeForCategory(n.category, n.pos.x, n.pos.y, size); // draw node shape
  }

  // Draw hovered node on top
  if (h >= 0) {
    const n = atlas.nodes[h];
    const size = n.size * (1 + 0.22 * n.hoverAmt); // stronger pulsing for hover

    const base = CAT_COLORS[n.category] || [80, 80, 80];
    const gray = [80, 80, 80];
    const mixAmt = lerp(0.20, 1.00, n.dateNorm);
    const col = mixRGB(gray, base, mixAmt);

    // Halo effect around hovered node
    noFill();
    stroke(col[0], col[1], col[2], 150);
    strokeWeight((3.2 + 4.0 * n.hoverAmt) / cam.z);
    ellipse(n.pos.x, n.pos.y, size * 1.65, size * 1.65);

    // Node fill
    noStroke();
    fill(col[0], col[1], col[2], 255);
    drawShapeForCategory(n.category, n.pos.x, n.pos.y, size);

    // Outline for better separation
    noFill();
    stroke(20, 20, 20, 200);
    strokeWeight(2.2 / cam.z);
    drawShapeOutlineForCategory(n.category, n.pos.x, n.pos.y, size);
  }
}

// Draw a node’s basic shape according to category
function drawShapeForCategory(cat, x, y, s) {
  switch (cat) {
    case "Tools":
      ellipse(x, y, s, s);
      break;
    case "Docs":
      ellipse(x, y, s * 1.25, s * 0.6); // oval shape
      break;
    case "YT tutorials":
      rectMode(CENTER);
      rect(x, y, s, s, s * 0.12); // slightly rounded rectangle
      break;
    case "Coding":
      rectMode(CENTER);
      rect(x, y, s * 1.35, s * 0.4, s * 0.12); // stretched rectangle
      break;
    case "Art":
      triangle(
        x, y - s * 0.62,
        x - s * 0.58, y + s * 0.44,
        x + s * 0.58, y + s * 0.44
      ); // triangle shape
      break;
    case "Miscellany":
    default:
      push();
      stroke(30, 30, 30, 220);
      strokeWeight(3.2 / cam.z);
      line(x - s * 0.45, y - s * 0.45, x + s * 0.45, y + s * 0.45);
      line(x + s * 0.45, y - s * 0.45, x - s * 0.45, y + s * 0.45); // X shape
      pop();
      break;
  }
}

// Draw just the outline of a node for hover or layering purposes
function drawShapeOutlineForCategory(cat, x, y, s) {
  switch (cat) {
    case "Tools":
      ellipse(x, y, s, s);
      break;
    case "Docs":
      ellipse(x, y, s * 1.25, s * 0.8); // slightly taller oval
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
      line(x - s * 0.45, y - s * 0.45, x + s * 0.45, y + s * 0.45);
      line(x + s * 0.45, y - s * 0.45, x - s * 0.45, y + s * 0.45);
      break;
  }
}

// UI elements like title, notes, and author
function drawTitle() {
  const title = data?.meta?.title || "Bookmarks Atlas"; // fallback title
  const note = data?.meta?.note || "";                   // optional note
  const autor = data?.meta?.autor || "";                // optional author

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

// Draw simple interaction hint for users
function drawInteractionHint() {
  fill(80);
  noStroke();
  textAlign(LEFT, TOP);
  textSize(14);
  text(`Drag to pan • Scroll to zoom\nZoom: ${nf(cam.z, 1, 2)}x`, 16, 110);
}

// Draw hover UI around selected node
function drawHoverUI() {
  const idx = atlas.hoveredIndex;
  if (idx < 0) return; // no node hovered

  const n = atlas.nodes[idx];
  const p = worldToScreen(n.pos); // convert node position to screen coordinates

  fill(20);
  noStroke();
  textSize(13);

  const title = truncate(n.title || n.domain || "Untitled", 28); // limit text length
  const r = (n.size * cam.z) * 0.55; // scaled radius for UI placement

  const topY = p.y - r - 18;
  const botY = p.y + r + 18;
  const leftX = p.x - r - 16;
  const rightX = p.x + r + 16;

  textAlign(CENTER, CENTER);
  text(title, p.x, topY);
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

// INPUT HANDLERS:

function mousePressed() {
  // Open node URL if clicked
  if (atlas.hoveredIndex >= 0) {
    const url = atlas.nodes[atlas.hoveredIndex].url;
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
  }

  // Start panning
  cam.focusWorld = null; // cancel zoom focus
  cam.focusScreen = null;

  cam.dragging = true;
  cam.lastMx = mouseX;
  cam.lastMy = mouseY;
}

function mouseDragged() {
  if (!cam.dragging) return; // ignore if not dragging

  const dx = mouseX - cam.lastMx;
  const dy = mouseY - cam.lastMy;
  cam.lastMx = mouseX;
  cam.lastMy = mouseY;

  cam.x += dx; // move camera
  cam.y += dy;

  clampCameraToAtlas(); // prevent moving too far
}

function mouseReleased() {
  cam.dragging = false; // stop panning
}

function mouseWheel(e) {
  // Maintain cursor world point while zooming
  cam.focusWorld = screenToWorld(mouseX, mouseY);
  cam.focusScreen = { x: mouseX, y: mouseY };

  const zoomFactor = 1.0016;
  cam.tz = clamp(cam.tz * pow(zoomFactor, -e.delta), TUNE.zoomMin, TUNE.zoomMax);

  clampCameraToAtlas(); // keep camera within bounds
  return false; // prevent default scroll behavior
}

// HOVER DETECTION:

function pickHoveredNodeIndex() {
  const m = screenToWorld(mouseX, mouseY); // convert cursor to world coordinates

  let best = -1;
  let bestD = Infinity;

  for (let i = 0; i < atlas.nodes.length; i++) {
    const n = atlas.nodes[i];
    const r = max(10, n.size * 0.55); // hover radius
    const d = dist(m.x, m.y, n.pos.x, n.pos.y); // distance to cursor

    if (d < r && d < bestD) { // pick closest node under cursor
      bestD = d;
      best = i;
    }
  }
  return best; // return index of hovered node
}

// UTILITIES:

function normalizeCategory(c) {
  if (!c) return "Miscellany";
  const s = String(c).trim();
  return atlas.categories.includes(s) ? s : "Miscellany"; // fallback to Miscellany
}

function parseDateToTime(s) {
  if (!s) return NaN;
  const t = Date.parse(s); // convert date string to timestamp
  return isNaN(t) ? NaN : t;
}

function truncate(str, maxLen) {
  const s = String(str || "");
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1).trimEnd() + "…"; // add ellipsis
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v)); // constrain value between a and b
}

function mixRGB(a, b, t) {
  // linear interpolation for each RGB channel
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t))
  ];
}