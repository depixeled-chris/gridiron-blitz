import { useEffect, useState } from "react";

interface BipEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function detectPlatform(): "ios" | "android" | "desktop" {
  const ua = navigator.userAgent;
  const iOS =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS reports as Mac but is touch-capable
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (iOS) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

/** A dismissible "install to home screen" banner shown on open (until installed). */
export function InstallBanner() {
  const [deferred, setDeferred] = useState<BipEvent | null>(null);
  const [standalone, setStandalone] = useState(isStandalone);
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem("gb-install-dismissed") === "1"
  );
  const platform = detectPlatform();

  useEffect(() => {
    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BipEvent);
    };
    const onInstalled = () => {
      setStandalone(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // Don't show if already installed/running standalone, dismissed, or on a
  // desktop browser that can't install (no prompt captured).
  if (standalone || dismissed) return null;
  if (platform === "desktop" && !deferred) return null;

  const dismiss = () => {
    setDismissed(true);
    localStorage.setItem("gb-install-dismissed", "1");
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  };

  return (
    <div className="install-banner">
      <span className="ib-icon">🏈</span>
      <div className="ib-text">
        <b>Install Gridiron Blitz</b>
        {deferred ? (
          <span>Add it to your home screen for full-screen play.</span>
        ) : platform === "ios" ? (
          <span>
            Tap <b>Share</b> <span className="ib-share">⬆️</span> then{" "}
            <b>Add to Home Screen</b>, and launch it for full-screen play.
          </span>
        ) : (
          <span>
            Open your browser menu <b>⋮</b> and tap <b>Install app</b> /{" "}
            <b>Add to Home screen</b>.
          </span>
        )}
      </div>
      {deferred && (
        <button className="ib-btn" onClick={install}>
          INSTALL
        </button>
      )}
      <button className="ib-close" onClick={dismiss} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
