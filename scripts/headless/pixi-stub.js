// No-op Pixi stub for headless (Node) simulation. The headless sim never renders
// (Game.setHeadless(true) skips makeSprite/render/camera), so these classes only
// need to be constructable; every method is a no-op. Bundled in via esbuild alias.
class Node {
  constructor() {
    this.scale = { set() {} };
    this.position = { set() {} };
    this.x = 0; this.y = 0; this.visible = true; this.alpha = 1; this.tint = 0xffffff;
    this.children = []; this.text = ""; this.style = {};
  }
  addChild() { return this; }
  removeChild() { return this; }
  removeChildren() { return this; }
  destroy() {}
  clear() { return this; }
  rect() { return this; } roundRect() { return this; } circle() { return this; }
  ellipse() { return this; } poly() { return this; }
  moveTo() { return this; } lineTo() { return this; } quadraticCurveTo() { return this; }
  fill() { return this; } stroke() { return this; }
  beginFill() { return this; } endFill() { return this; } drawRect() { return this; }
  lineStyle() { return this; } setStrokeStyle() { return this; }
  set() { return this; }
}
export class Application {
  constructor() {
    this.stage = new Node();
    this.ticker = { add() {}, remove() {} };
    this.screen = { width: 960, height: 540 };
  }
  async init() {}
  get canvas() { return {}; }
  get renderer() { return { resize() {} }; }
}
export class Container extends Node {}
export class Graphics extends Node {}
export class Text extends Node {}
