// iOS-safe viewport sizing.
//
// `100vh`/`position:fixed; inset:0` size to the *layout* viewport on iOS Safari,
// which is taller than the visible area (the URL/tool bars overlay it). That
// pushes content off-screen. The reliable source of the actually-visible size is
// `window.visualViewport`. We publish it as CSS vars (--vvw/--vvh) and notify
// listeners so the canvas can resize to match.

const callbacks = new Set<() => void>();
let inited = false;

function apply() {
  const vv = window.visualViewport;
  const w = Math.round(vv?.width ?? window.innerWidth);
  const h = Math.round(vv?.height ?? window.innerHeight);
  // offset of the visible area within the layout viewport — this is the space
  // taken by the browser's top bar that position:fixed otherwise ignores.
  const top = Math.round(vv?.offsetTop ?? 0);
  const left = Math.round(vv?.offsetLeft ?? 0);
  const s = document.documentElement.style;
  s.setProperty("--vvw", `${w}px`);
  s.setProperty("--vvh", `${h}px`);
  s.setProperty("--vvt", `${top}px`);
  s.setProperty("--vvl", `${left}px`);
  callbacks.forEach((cb) => cb());
}

export function initViewport() {
  if (inited) return;
  inited = true;
  apply();
  const vv = window.visualViewport;
  vv?.addEventListener("resize", apply);
  vv?.addEventListener("scroll", apply);
  window.addEventListener("resize", apply);
  // iOS reports stale sizes right after an orientation flip — re-measure a few times
  window.addEventListener("orientationchange", () => {
    apply();
    setTimeout(apply, 250);
    setTimeout(apply, 600);
  });
  // keep the page pinned so the bars don't toggle the layout under us
  window.addEventListener("scroll", () => window.scrollTo(0, 0), { passive: true });

  // Bulletproof iOS scroll lock: cancel touch-scroll everywhere except inside
  // scrollable menu overlays (which may need to scroll on short screens).
  document.addEventListener(
    "touchmove",
    (e) => {
      const t = e.target;
      if (t instanceof Element && t.closest(".overlay")) return;
      e.preventDefault();
    },
    { passive: false }
  );
}

/** subscribe to viewport changes; returns an unsubscribe fn */
export function onViewportChange(cb: () => void) {
  callbacks.add(cb);
  return () => callbacks.delete(cb);
}
