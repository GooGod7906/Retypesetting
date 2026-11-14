import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';

type Category = 'runs' | 'exports' | 'templates' | 'corrections' | 'roles';

async function replaceFile(temporary: string, file: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(temporary, file);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform !== 'win32' || attempt >= 7 || !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '')) throw error;
      await delay(20 * (attempt + 1));
    }
  }
}

export class WorkspaceStore {
  private readonly pool: Pool | undefined;
  private readonly patches = new Map<string, Promise<void>>();

  constructor(private readonly directory: string, connectionString?: string) {
    if (connectionString) {
      this.pool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 5_000 });
      this.pool.on('error', error => console.error('PostgreSQL 连接断开：', error.message));
    }
  }

  async init() {
    if (!this.pool) {
      if (process.env.NODE_ENV === 'production') throw new Error('请设置 DATABASE_URL 后再启动生产服务。');
      return;
    }
    await this.pool.query(`CREATE TABLE IF NOT EXISTS typesetting_records (
      category text NOT NULL,
      id text NOT NULL,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (category, id)
    )`);
  }

  async save(category: Category, id: string, value: unknown): Promise<void> {
    if (this.pool) {
      await this.pool.query(`INSERT INTO typesetting_records (category, id, data) VALUES ($1, $2, $3)
        ON CONFLICT (category, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [category, id, JSON.stringify(value)]);
      return;
    }
    const folder = path.join(this.directory, category);
    await mkdir(folder, { recursive: true });
    const file = path.join(folder, `${id}.json`);
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(value), { flag: 'wx' });
      await replaceFile(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async get<T>(category: Category, id: string): Promise<T | undefined> {
    if (this.pool) return (await this.pool.query('SELECT data FROM typesetting_records WHERE category=$1 AND id=$2', [category, id])).rows[0]?.data;
    try {
      return JSON.parse(await readFile(path.join(this.directory, category, `${id}.json`), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async patch(category: 'corrections' | 'roles', id: string, changes: Record<string, string | null>): Promise<void> {
    if (!Object.keys(changes).length) return;
    if (this.pool) {
      await this.pool.query(`INSERT INTO typesetting_records (category, id, data)
        VALUES ($1, $2, jsonb_strip_nulls($3::jsonb))
        ON CONFLICT (category, id) DO UPDATE SET
          data = jsonb_strip_nulls(typesetting_records.data || $3::jsonb), updated_at = now()`, [category, id, JSON.stringify(changes)]);
      return;
    }
    const key = `${category}/${id}`;
    const work = (this.patches.get(key)?.catch(() => undefined) ?? Promise.resolve()).then(async () => {
      const merged = { ...await this.get<Record<string, string | null>>(category, id), ...changes };
      for (const [field, value] of Object.entries(merged)) if (value === null) delete merged[field];
      await this.save(category, id, merged);
    });
    this.patches.set(key, work);
    try { await work; }
    finally { if (this.patches.get(key) === work) this.patches.delete(key); }
  }

  async list<T>(category: Category, prefix = ''): Promise<T[]> {
    if (this.pool) return (await this.pool.query('SELECT data FROM typesetting_records WHERE category=$1 AND starts_with(id, $2) ORDER BY updated_at DESC', [category, prefix])).rows.map(row => row.data);
    const folder = path.join(this.directory, category);
    const files = await readdir(folder).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const result: T[] = [];
    for (const filename of files) {
      if (!filename.endsWith('.json') || !filename.startsWith(prefix)) continue;
      const item = await this.get<T>(category, filename.slice(0, -5));
      if (item !== undefined) result.push(item);
    }
    return result;
  }

  async deletePrefix(category: 'corrections' | 'roles', prefix: string): Promise<void> {
    if (this.pool) {
      await this.pool.query('DELETE FROM typesetting_records WHERE category=$1 AND starts_with(id, $2)', [category, prefix]);
      return;
    }
    const folder = path.join(this.directory, category);
    const files = await readdir(folder).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    await Promise.all(files.filter(file => file.startsWith(prefix)).map(file => rm(path.join(folder, file), { force: true })));
  }

  async delete(category: Category, id: string): Promise<void> {
    if (this.pool) {
      await this.pool.query('DELETE FROM typesetting_records WHERE category=$1 AND id=$2', [category, id]);
      return;
    }
    await rm(path.join(this.directory, category, `${id}.json`), { force: true });
  }
}
