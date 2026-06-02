import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initViewport } from "./viewport";
import "./styles.css";

// Publish the real visible viewport size before first paint (iOS Safari).
initViewport();

// No StrictMode: it double-invokes effects in dev, which would init Pixi twice.
createRoot(document.getElementById("root")!).render(<App />);
