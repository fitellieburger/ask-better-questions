// components/Tooltip.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  text: string;
  children: React.ReactNode;
};

export function HelpTip({ text, children }: Props) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // ensure document exists (Next/SSR safe)
  const canPortal = typeof document !== "undefined";

  function updatePosition() {
    const el = anchorRef.current;
    if (!el) return;

    const r = el.getBoundingClientRect();
    const padding = 10;

    // default: centered above
    let left = r.left + r.width / 2;
    const top = r.top - 10;

    // clamp horizontally so it stays on screen
    const vw = window.innerWidth;
    left = Math.max(padding, Math.min(vw - padding, left));

    setPos({ left, top });
  }

  useEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  return (
    <>
      <span
        ref={anchorRef}
        className="tipAnchor"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        tabIndex={0}
        aria-label={text}
      >
        {children}
      </span>

      {canPortal && open && pos
        ? createPortal(
            <div className="tooltipBubble" style={{ left: pos.left, top: pos.top }}>
              {text}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
