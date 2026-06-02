import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initViewport } from "./viewport";
import "./styles.css";

// Publish the real visible viewport size before first paint (iOS Safari).
initViewport();

// Auto-reload once when a freshly-deployed service worker takes control, so a
// new deploy shows up without the user having to manually clear the PWA cache.
// (The SW uses skipWaiting + clientsClaim, which fires `controllerchange`.)
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloaded) return; // skip on first-ever install
    reloaded = true;
    window.location.reload();
  });
}

// No StrictMode: it double-invokes effects in dev, which would init Pixi twice.
createRoot(document.getElementById("root")!).render(<App />);
