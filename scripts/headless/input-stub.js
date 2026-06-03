// no-op input for headless sim (the harness drives plays via test hooks, not keys)
export class Input {
  axis() { return { x: 0, y: 0 }; }
  pressed() { return false; }
  turbo() { return false; }
  attach() {} detach() {} flush() {}
  setStick() {} setTurbo() {} virtualPress() {}
}
