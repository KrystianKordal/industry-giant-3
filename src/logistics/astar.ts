/**
 * Generic A* over integer node ids with reusable typed-array buffers.
 * No per-search allocation except the resulting path array.
 *
 * Nodes are ints in [0, capacity). Callers encode tiles (or tile×dir) as nodes.
 */

export interface SearchSpec {
  /** Start nodes (cost 0). */
  sources: readonly number[];
  isGoal(node: number): boolean;
  /** Emit neighbours with step cost (> 0). Call push(node, cost) for each. */
  neighbors(node: number, push: (next: number, cost: number) => void): void;
  /** Admissible-ish estimate of remaining cost. */
  heuristic(node: number): number;
  /** Stop after expanding this many nodes (returns null). */
  maxNodes?: number;
}

export class AStar {
  private g: Float32Array;
  private parent: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private gen = 1;
  // binary heap
  private heapNodes: Int32Array;
  private heapKeys: Float64Array;
  private heapSize = 0;
  /** Nodes expanded by the last search (stats/tests). */
  lastExpanded = 0;

  constructor(public capacity: number) {
    this.g = new Float32Array(capacity);
    this.parent = new Int32Array(capacity);
    this.stamp = new Uint32Array(capacity);
    this.closed = new Uint32Array(capacity);
    this.heapNodes = new Int32Array(1024);
    this.heapKeys = new Float64Array(1024);
  }

  ensure(capacity: number): void {
    if (capacity <= this.capacity) return;
    this.capacity = capacity;
    this.g = new Float32Array(capacity);
    this.parent = new Int32Array(capacity);
    this.stamp = new Uint32Array(capacity);
    this.closed = new Uint32Array(capacity);
    this.gen = 1;
  }

  /** Returns node list from a source to the reached goal (inclusive) or null. */
  search(spec: SearchSpec): number[] | null {
    this.gen++;
    if (this.gen >= 0xfffffff0) {
      this.stamp.fill(0);
      this.closed.fill(0);
      this.gen = 1;
    }
    const gen = this.gen;
    const { g, parent, stamp, closed } = this;
    this.heapSize = 0;
    for (const s of spec.sources) {
      if (s < 0 || s >= this.capacity) continue;
      if (stamp[s] === gen) continue;
      stamp[s] = gen;
      g[s] = 0;
      parent[s] = -1;
      this.push(s, spec.heuristic(s));
    }
    const maxNodes = spec.maxNodes ?? Infinity;
    let expanded = 0;
    let current = -1;
    const push = (next: number, cost: number): void => {
      if (closed[next] === gen) return;
      const ng = g[current]! + cost;
      if (stamp[next] === gen && g[next]! <= ng) return;
      stamp[next] = gen;
      g[next] = ng;
      parent[next] = current;
      this.push(next, ng + spec.heuristic(next));
    };
    while (this.heapSize > 0) {
      const node = this.pop();
      if (closed[node] === gen) continue;
      closed[node] = gen;
      if (spec.isGoal(node)) {
        this.lastExpanded = expanded;
        const path: number[] = [];
        for (let n = node; n !== -1; n = parent[n]!) path.push(n);
        path.reverse();
        return path;
      }
      if (++expanded > maxNodes) break;
      current = node;
      spec.neighbors(node, push);
    }
    this.lastExpanded = expanded;
    return null;
  }

  /** Cost (g) of a node reached in the last search. */
  costOf(node: number): number {
    return this.stamp[node] === this.gen ? this.g[node]! : Infinity;
  }

  // ------------------------------------------------------------ heap
  private push(node: number, key: number): void {
    if (this.heapSize >= this.heapNodes.length) {
      const nn = new Int32Array(this.heapNodes.length * 2);
      nn.set(this.heapNodes);
      const nk = new Float64Array(this.heapKeys.length * 2);
      nk.set(this.heapKeys);
      this.heapNodes = nn;
      this.heapKeys = nk;
    }
    const nodes = this.heapNodes;
    const keys = this.heapKeys;
    let i = this.heapSize++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p]! <= key) break;
      nodes[i] = nodes[p]!;
      keys[i] = keys[p]!;
      i = p;
    }
    nodes[i] = node;
    keys[i] = key;
  }

  private pop(): number {
    const nodes = this.heapNodes;
    const keys = this.heapKeys;
    const top = nodes[0]!;
    const n = --this.heapSize;
    if (n > 0) {
      const lastNode = nodes[n]!;
      const lastKey = keys[n]!;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r]! < keys[l]! ? r : l;
        if (keys[c]! >= lastKey) break;
        nodes[i] = nodes[c]!;
        keys[i] = keys[c]!;
        i = c;
      }
      nodes[i] = lastNode;
      keys[i] = lastKey;
    }
    return top;
  }
}
