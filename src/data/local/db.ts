/**
 * The local database: every table held in memory, written through a storage
 * driver after each request that changed something.
 *
 * Handlers never touch arrays directly — they go through a `Repository<T>`
 * per table (list / get / insert / update / remove), so persistence, id
 * allocation and dirty-tracking live in one place.
 */
import { SCHEMA_VERSION, TABLE_NAMES, type Meta, type TableName, type Tables } from "./schema";
import type { StorageDriver } from "./storage";

export interface Repository<T extends { id: number }> {
  all(): T[];
  find(predicate: (row: T) => boolean): T | undefined;
  filter(predicate: (row: T) => boolean): T[];
  get(id: number): T | undefined;
  insert(row: Omit<T, "id">): T;
  update(id: number, patch: Partial<T>): T;
  remove(id: number): void;
}

class TableRepository<T extends { id: number }> implements Repository<T> {
  constructor(
    private readonly db: LocalDatabase,
    private readonly name: TableName,
  ) {}

  private rows(): T[] {
    return this.db.tables[this.name] as unknown as T[];
  }

  all() {
    return this.rows();
  }
  find(predicate: (row: T) => boolean) {
    return this.rows().find(predicate);
  }
  filter(predicate: (row: T) => boolean) {
    return this.rows().filter(predicate);
  }
  get(id: number) {
    return this.rows().find((r) => r.id === id);
  }
  insert(row: Omit<T, "id">) {
    const created = { ...row, id: this.db.nextId(this.name) } as T;
    this.rows().push(created);
    this.db.markDirty(this.name);
    return created;
  }
  update(id: number, patch: Partial<T>) {
    const row = this.get(id);
    if (!row) throw new Error(`${this.name} #${id} not found`);
    Object.assign(row, patch, { id });
    this.db.markDirty(this.name);
    return row;
  }
  remove(id: number) {
    const rows = this.rows();
    const index = rows.findIndex((r) => r.id === id);
    if (index >= 0) {
      rows.splice(index, 1);
      this.db.markDirty(this.name);
    }
  }
}

function emptyTables(): Tables {
  return Object.fromEntries(TABLE_NAMES.map((n) => [n, []])) as unknown as Tables;
}

export class LocalDatabase {
  tables: Tables = emptyTables();
  meta: Meta = {
    schema_version: SCHEMA_VERSION,
    seeded_at: "",
    books_start: "",
    sms_wallet: 0,
    opening: { bank: 0, land: 0, buildings: 0, petty_cash_float: 0 },
    counters: {},
  };
  private dirty = new Set<TableName | "meta">();
  private repos = new Map<TableName, Repository<{ id: number }>>();

  constructor(readonly driver: StorageDriver) {}

  repo<N extends TableName>(name: N): Repository<Tables[N][number]> {
    let repo = this.repos.get(name);
    if (!repo) {
      repo = new TableRepository(this, name);
      this.repos.set(name, repo);
    }
    return repo as unknown as Repository<Tables[N][number]>;
  }

  nextId(name: TableName): number {
    const current = this.meta.counters[name] ?? Math.max(0, ...this.tables[name].map((r) => r.id));
    const next = current + 1;
    this.meta.counters[name] = next;
    this.dirty.add("meta");
    return next;
  }

  /** Next value of a named document sequence (receipt, credit-note numbers…). */
  nextSequence(name: string): number {
    const key = `seq:${name}`;
    const next = (this.meta.counters[key] ?? 0) + 1;
    this.meta.counters[key] = next;
    this.dirty.add("meta");
    return next;
  }

  markDirty(name: TableName | "meta") {
    this.dirty.add(name);
  }

  /** Load from storage. Returns false when there is nothing usable stored. */
  async load(): Promise<boolean> {
    const stored = await this.driver.loadTables();
    const meta = stored.meta as Meta | undefined;
    if (!meta || meta.schema_version !== SCHEMA_VERSION) return false;
    this.meta = meta;
    const tables = emptyTables();
    for (const name of TABLE_NAMES) {
      const rows = stored[name];
      if (Array.isArray(rows)) (tables[name] as unknown[]) = rows;
    }
    this.tables = tables;
    return true;
  }

  /** Write every table out (after seeding or a reset). */
  async writeAll() {
    TABLE_NAMES.forEach((n) => this.dirty.add(n));
    this.dirty.add("meta");
    await this.flush();
  }

  /** Persist every table changed since the last flush. */
  async flush() {
    if (this.dirty.size === 0) return;
    const out: Record<string, unknown> = {};
    for (const name of this.dirty) {
      out[name] = name === "meta" ? this.meta : this.tables[name];
    }
    this.dirty.clear();
    await this.driver.saveTables(out);
  }

  /** Throw away unsaved in-memory changes by reloading from storage. */
  async rollback() {
    this.dirty.clear();
    await this.load();
  }
}
