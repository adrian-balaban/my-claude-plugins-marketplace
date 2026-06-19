// ─── LRU Cache ───────────────────────────────────────────────────────────────

export class LRUCache<K, V> {
  private map = new Map<K, { value: V; expiry: number }>();
  private hits = 0;
  private misses = 0;
  constructor(private maxSize: number, private ttlMs: number) {}

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry || Date.now() > entry.expiry) {
      this.misses++;
      this.map.delete(key);
      return undefined;
    }
    this.hits++;
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V) {
    if (this.map.size >= this.maxSize) {
      this.map.delete(this.map.keys().next().value!);
    }
    this.map.set(key, { value, expiry: Date.now() + this.ttlMs });
  }

  delete(key: K) { this.map.delete(key); }
  stats() { return { hits: this.hits, misses: this.misses, size: this.map.size }; }
}

export const contentCache = new LRUCache<string, string>(100, 30 * 60 * 1000);