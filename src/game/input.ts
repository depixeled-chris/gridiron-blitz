export class Input {
  private down = new Set<string>();
  private justPressed = new Set<string>();

  private onDown = (e: KeyboardEvent) => {
    const c = e.code;
    if (PREVENT.has(c)) e.preventDefault();
    if (!this.down.has(c)) this.justPressed.add(c);
    this.down.add(c);
  };
  private onUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };

  attach() {
    window.addEventListener("keydown", this.onDown);
    window.addEventListener("keyup", this.onUp);
  }
  detach() {
    window.removeEventListener("keydown", this.onDown);
    window.removeEventListener("keyup", this.onUp);
    this.down.clear();
    this.justPressed.clear();
  }

  held(code: string) {
    return this.down.has(code);
  }
  pressed(code: string) {
    return this.justPressed.has(code);
  }
  /** -1..1 movement axis from arrows or WASD */
  axis(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.held("ArrowLeft") || this.held("KeyA")) x -= 1;
    if (this.held("ArrowRight") || this.held("KeyD")) x += 1;
    if (this.held("ArrowUp") || this.held("KeyW")) y -= 1;
    if (this.held("ArrowDown") || this.held("KeyS")) y += 1;
    return { x, y };
  }
  turbo() {
    return this.held("ShiftLeft") || this.held("ShiftRight");
  }
  /** call at end of each frame */
  flush() {
    this.justPressed.clear();
  }
}

const PREVENT = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Space",
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
]);
