export type SaveState = { pending: boolean; error: string | null };

/** Serializes whole-document saves and retains the newest unsaved draft on failure. */
export class SaveQueue<T> {
  private latest: { value: T } | null = null;
  private running = false;
  private failed = false;

  constructor(
    private readonly write: (value: T) => Promise<void>,
    private readonly changed: (state: SaveState) => void,
  ) {}

  enqueue(value: T) {
    this.latest = { value };
    if (!this.failed) void this.flush();
  }

  retry() {
    this.failed = false;
    void this.flush();
  }

  hasUnsavedChanges() {
    return this.running || this.latest !== null;
  }

  private async flush() {
    if (this.running || !this.latest) return;
    this.running = true;
    this.changed({ pending: true, error: null });
    while (this.latest) {
      const next = this.latest;
      this.latest = null;
      try {
        await this.write(next.value);
      } catch (error) {
        this.latest ??= next;
        this.failed = true;
        this.running = false;
        this.changed({ pending: false, error: error instanceof Error ? error.message : 'Save failed' });
        return;
      }
    }
    this.running = false;
    this.changed({ pending: false, error: null });
  }
}
