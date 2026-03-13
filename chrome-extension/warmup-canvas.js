// warmup-canvas.js — Interactive particle field for the warmup overlay.
// Gold capsule particles repel from the cursor and lerp back to home positions.

(function () {
  const canvas  = document.getElementById("wu-canvas");
  if (!canvas) return;
  const ctx     = canvas.getContext("2d");

  // ── Config ──────────────────────────────────────────────────────────────
  const COUNT         = 220;   // particle count
  const PARTICLE_W    = 6;     // capsule half-length (px)
  const PARTICLE_H    = 1.5;   // capsule half-width (px)
  const COLOR         = "#FFD700";
  const REPEL_RADIUS  = 60;    // px — cursor influence radius
  const FIELD_STR     = 120;   // repulsion impulse strength
  const LERP          = 0.06;  // how fast particles return home (0–1)
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
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    particles.forEach(p => {
      p.hx = Math.random() * W;
      p.hy = Math.random() * H;
      p.x  = p.hx;
      p.y  = p.hy;
    });
  }

  // ── Particles ────────────────────────────────────────────────────────────
  const particles = Array.from({ length: COUNT }, () => ({
    x: 0, y: 0,
    hx: 0, hy: 0,
    vx: 0, vy: 0,
    angle: Math.random() * Math.PI,
  }));

  // ── Mouse tracking ───────────────────────────────────────────────────────
  let mx = -9999, my = -9999;

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
  function drawCapsule(x, y, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
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
      const dx = p.x - mx;
      const dy = p.y - my;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < REPEL_RADIUS && dist > 0) {
        const force = (1 - dist / REPEL_RADIUS) * FIELD_STR;
        p.vx += (dx / dist) * force * 0.016;
        p.vy += (dy / dist) * force * 0.016;
      }

      p.vx += (p.hx - p.x) * LERP;
      p.vy += (p.hy - p.y) * LERP;

      p.vx *= FRICTION;
      p.vy *= FRICTION;
      p.x  += p.vx;
      p.y  += p.vy;

      drawCapsule(p.x, p.y, p.angle);
    }

    requestAnimationFrame(tick);
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  requestAnimationFrame(() => {
    resize();
    window.addEventListener("resize", resize);
    tick();
  });
})();
