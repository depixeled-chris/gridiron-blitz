import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// No StrictMode: it double-invokes effects in dev, which would init Pixi twice.
createRoot(document.getElementById("root")!).render(<App />);
