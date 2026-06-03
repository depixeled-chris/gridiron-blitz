// no-op audio for headless sim
export class Sfx {
  constructor() { this.muted = false; }
  resume() {} select() {} snap() {} throw() {} catchBall() {} tackle() {}
  whistle() {} firstDown() {} turnover() {} touchdown() {} kick() {}
}
