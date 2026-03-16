# Warmup Canvas Particle Field Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a gold capsule-particle field to the extension side panel warmup screen that repels away from the cursor, giving users something to interact with while waiting for the API cold start.

**Architecture:** A vanilla JS canvas animation is inserted into `side_panel.html` between the ticker and loading bar. All particle logic lives in a `warmup-canvas.js` file loaded by the side panel. No build step needed — plain `<script>` tag. The canvas is purely decorative: transparent background, soft edge fade via CSS mask, hidden on short viewports.

**Tech Stack:** Vanilla JS, HTML5 Canvas API, CSS `mask-image`, Chrome extension (MV3) — no React, no npm.

---

### Task 1: Add the canvas element to the HTML

**Files:**
- Modify: `chrome-extension/side_panel.html`

**Step 1: Add canvas element and CSS**

Inside `side_panel.html`, locate the `.wu-shell` div which currently has this structure:

```html
<div class="wu-shell">
  <div class="wu-ticker">...</div>
  <div class="wu-bar-row">...</div>
  <p id="wu-status" ...></p>
</div>
```

Insert a `<canvas>` between `.wu-ticker` and `.wu-bar-row`:

```html
<div class="wu-shell">
  <div class="wu-ticker">...</div>
  <canvas id="wu-canvas" class="wu-canvas" aria-hidden="true"></canvas>
  <div class="wu-bar-row">...</div>
  <p id="wu-status" ...></p>
</div>
```

**Step 2: Add CSS in the `<style>` block**

Add inside the existing `<style>` tag in `side_panel.html`:

```css
/* ── Warmup particle canvas ── */
.wu-canvas {
  display: block;
  width: 100%;
  height: clamp(100px, 20vh, 140px);
  opacity: 0.75;
  pointer-events: none;
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0px,
    black 20px,
    black calc(100% - 20px),
    transparent 100%
  );
  mask-image: linear-gradient(
    to bottom,
    transparent 0px,
    black 20px,
    black calc(100% - 20px),
    transparent 100%
  );
}

@media (max-height: 520px) {
  .wu-canvas { display: none; }
}
```

**Step 3: Add the script tag**

At the bottom of `<body>`, before the closing `</body>`, add after `config.js` and before `side_panel.js`:

```html
<script src="warmup-canvas.js"></script>
```

**Step 4: Verify visually**

Load the extension in Chrome (`chrome://extensions` → Load unpacked → `chrome-extension/`). Open the side panel. Confirm there is an empty gap between the ticker and loading bar (~120px tall). No particles yet — that comes in Task 2.

**Step 5: Commit**

```bash
git add chrome-extension/side_panel.html
git commit -m "feat: add warmup canvas placeholder between ticker and bar"
```

---

### Task 2: Implement the particle field in warmup-canvas.js

**Files:**
- Create: `chrome-extension/warmup-canvas.js`

This file initialises the canvas, spawns particles, runs the animation loop, and handles mouse repulsion. No tests — this is pure canvas rendering code, not unit-testable in Vitest.

**Step 1: Create the file with particle initialisation**

Create `chrome-extension/warmup-canvas.js`:

```js
// warmup-canvas.js — Interactive particle field for the warmup overlay.
// Gold capsule particles repel from the cursor and lerp back to home positions.

(function () {
  const canvas  = document.getElementById("wu-canvas");
  if (!canvas) return;
  const ctx     = canvas.getContext("2d");

  // ── Config ──────────────────────────────────────────────────────────────
  const COUNT         = 220;   // particle count — fewer than 300 suits the narrow panel
  const PARTICLE_W    = 6;     // capsule half-length (px)
  const PARTICLE_H    = 1.5;   // capsule half-width (px)
  const COLOR         = "#FFD700";
  const REPEL_RADIUS  = 60;    // px — cursor influence radius
  const FIELD_STR     = 120;   // repulsion impulse strength
  const LERP          = 0.06;  // how fast particles return home (0–1, lower = slower)
  const FRICTION      = 0.82;  // velocity damping per frame

  // ── Sizing ───────────────────────────────────────────────────────────────
  let W = 0, H = 0;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    W = rect.width;
    H = rect.height;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    // Re-seed home positions when canvas resizes
    particles.forEach(p => {
      p.hx = Math.random() * W;
      p.hy = Math.random() * H;
      p.x  = p.hx;
      p.y  = p.hy;
    });
  }

  // ── Particles ────────────────────────────────────────────────────────────
  const particles = Array.from({ length: COUNT }, () => ({
    x: 0, y: 0,       // current position
    hx: 0, hy: 0,     // home (resting) position
    vx: 0, vy: 0,     // velocity
    angle: Math.random() * Math.PI, // capsule rotation
  }));

  // ── Mouse tracking ───────────────────────────────────────────────────────
  let mx = -9999, my = -9999; // off-canvas default

  // pointer-events is "none" on the canvas itself, so track on the warmup overlay
  const warmup = document.getElementById("warmup");
  if (warmup) {
    warmup.addEventListener("mousemove", (e) => {
      const rect = canvas.getBoundingClientRect();
      mx = e.clientX - rect.left;
      my = e.clientY - rect.top;
    });
    warmup.addEventListener("mouseleave", () => { mx = -9999; my = -9999; });
  }

  // ── Draw helpers ─────────────────────────────────────────────────────────

  /** Draws a single capsule (pill shape) centred at (x, y) rotated by angle. */
  function drawCapsule(x, y, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    // Rounded rect acting as a capsule
    const r = PARTICLE_H;
    const hw = PARTICLE_W - r;
    ctx.moveTo(-hw, -r);
    ctx.lineTo( hw, -r);
    ctx.arc(hw, 0, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(-hw,  r);
    ctx.arc(-hw, 0, r, Math.PI / 2, 3 * Math.PI / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ── Animation loop ───────────────────────────────────────────────────────
  function tick() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = COLOR;

    for (const p of particles) {
      // Repulsion from cursor
      const dx = p.x - mx;
      const dy = p.y - my;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < REPEL_RADIUS && dist > 0) {
        const force = (1 - dist / REPEL_RADIUS) * FIELD_STR;
        p.vx += (dx / dist) * force * 0.016; // scale by ~1 frame (60fps)
        p.vy += (dy / dist) * force * 0.016;
      }

      // Lerp back toward home
      p.vx += (p.hx - p.x) * LERP;
      p.vy += (p.hy - p.y) * LERP;

      // Apply friction and integrate
      p.vx *= FRICTION;
      p.vy *= FRICTION;
      p.x  += p.vx;
      p.y  += p.vy;

      drawCapsule(p.x, p.y, p.angle);
    }

    requestAnimationFrame(tick);
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  // Wait for layout to settle so getBoundingClientRect() returns real dimensions
  requestAnimationFrame(() => {
    resize();
    window.addEventListener("resize", resize);
    tick();
  });
})();
```

**Step 2: Verify in Chrome**

Reload the extension. Open the side panel on any article page. You should see:
- ~220 small gold capsule-shaped lines scattered across the canvas zone
- Moving the cursor into the warmup overlay area causes particles to scatter away
- Particles drift back smoothly when cursor leaves
- No visual border around the canvas; particles fade out at top/bottom edges
- Loading bar and ticker are unaffected

**Step 3: Spot-check short viewport**

Shrink the browser window to under 520px height. Confirm the canvas disappears and the ticker/bar/status still display normally.

**Step 4: Commit**

```bash
git add chrome-extension/warmup-canvas.js
git commit -m "feat: vanilla canvas particle field in warmup overlay"
```

---

### Task 3: Pause and decide

**No code in this task.**

Load the extension, try it on a real article page, and decide:

- Does it feel right, or is it too busy / too subtle?
- If too busy: reduce `COUNT` (try 120) or `FIELD_STR` (try 80) in `warmup-canvas.js`
- If too subtle: increase `opacity` in the CSS (try 0.9) or increase `COUNT`
- If you want to roll back entirely: `git checkout pre-warmup-canvas`

Only proceed to Task 4 if you're happy with the result.

---

### Task 4: Cleanup and zip

**Files:**
- Modify: `chrome-extension/manifest.json` (version bump if desired)
- Run: repackage the extension zip

**Step 1: Confirm manifest lists no new permissions**

The canvas feature requires no new Chrome permissions. Double-check `manifest.json` — `web_accessible_resources` does not need updating since `warmup-canvas.js` is loaded directly by `side_panel.html`, not injected into pages.

**Step 2: Repackage**

```bash
cd chrome-extension
zip -r ABQ.zip . --exclude "*.DS_Store" --exclude "__MACOSX/*"
cd ..
```

**Step 3: Commit**

```bash
git add chrome-extension/ABQ.zip
git commit -m "chore: repackage extension with warmup canvas"
```
