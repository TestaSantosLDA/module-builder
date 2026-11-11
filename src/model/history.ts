/**
 * Undo history of whole-plan snapshots. `commit` is called after every change;
 * callers skip it while a drag is in progress so a drag counts as one step.
 */
export class History {
  private past: string[] = [];
  private current: string | null = null;
  constructor(private readonly max = 5) {}

  /** Records `state` as current; the previous state becomes undoable if it differs. */
  commit(state: string): void {
    if (this.current !== null && state !== this.current) {
      this.past.push(this.current);
      if (this.past.length > this.max) this.past.shift();
    }
    this.current = state;
  }

  /** Returns the previous state, or null when there is nothing to undo. */
  undo(): string | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.current = prev;
    return prev;
  }

  get size(): number { return this.past.length; }
}
