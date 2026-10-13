/**
 * Mulberry32: a small deterministic generator, so a seed always rebuilds the
 * same demo world. Never use it for tokens or anything else that must be secret.
 */
export class SeededRandom {
  private current: number;

  constructor(seed: number) {
    this.current = seed >>> 0;
  }

  /** Save this to continue the same sequence later with `new SeededRandom(state)`. */
  get state(): number {
    return this.current;
  }

  /** A number in [0, 1). An arrow function, so it can be handed out as a plain callback. */
  readonly next = (): number => {
    this.current = (this.current + 0x6d2b79f5) >>> 0;
    let t = this.current;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
