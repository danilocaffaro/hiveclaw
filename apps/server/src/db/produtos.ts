import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

// ── Types ──────────────────────────────────────────────

export interface Produto {
  id: string;
  nome: string;
  descricao: string | null;
  preco: number;
  estoque: number;
  categoria: string | null;
  ativo: boolean;
  criado_em: string;
  atualizado_em: string;
}

export interface ProdutoCreateInput {
  nome: string;
  descricao?: string;
  preco: number;
  estoque: number;
  categoria?: string;
  ativo?: boolean;
}

export interface ProdutoFilters {
  categoria?: string;
  ativo?: string;       // "true" | "false" (query string)
  busca?: string;
  ordenar?: 'preco' | 'nome' | 'criado_em';
  direcao?: 'asc' | 'desc';
  limit?: string;
  // Cursor-based pagination
  cursor?: string;      // opaque Base64 cursor from previous response
}

// ── Cursor encoding ────────────────────────────────────
// Cursor = Base64({ sort_value, id })
// Encodes the position of the last item so the next page
// starts right after it. Opaque to the client.

interface CursorPayload {
  v: string | number;   // sort column value
  id: string;           // tiebreaker (UUID)
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf-8');
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed.id === 'string' && parsed.v !== undefined) {
      return parsed as CursorPayload;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Cursor-paginated response ──────────────────────────

export interface CursorPaginatedResult<T> {
  data: T[];
  meta: {
    limit: number;
    has_more: boolean;
    next_cursor: string | null;
  };
}

// ── Legacy offset-based (kept for backwards compat) ────

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

// ── Repository ─────────────────────────────────────────

export class ProdutoRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.ensureTable();
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS produtos (
        id TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        descricao TEXT,
        preco REAL NOT NULL CHECK(preco >= 0),
        estoque INTEGER NOT NULL DEFAULT 0 CHECK(estoque >= 0),
        categoria TEXT,
        ativo INTEGER NOT NULL DEFAULT 1,
        criado_em TEXT NOT NULL DEFAULT (datetime('now')),
        atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    // Indexes for common query patterns
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_produtos_categoria ON produtos(categoria)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_produtos_criado_em_id ON produtos(criado_em, id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_produtos_preco_id ON produtos(preco, id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_produtos_nome_id ON produtos(nome, id)`);
  }

  // ── LIST — cursor-based pagination + filters ─────────
  //
  // How cursor-based pagination works:
  //
  // 1. Client requests: GET /produtos?limit=20&categoria=eletronicos
  //    → Returns first 20 items + next_cursor
  //
  // 2. Client requests: GET /produtos?limit=20&categoria=eletronicos&cursor=<next_cursor>
  //    → Returns next 20 items after the cursor position
  //
  // The cursor encodes (sort_value, id) of the last row.
  // We use a WHERE clause like:
  //   (sort_col > :cursor_value) OR (sort_col = :cursor_value AND id > :cursor_id)
  // This is O(1) seek — no OFFSET scanning.

  list(filters: ProdutoFilters = {}): CursorPaginatedResult<Produto> {
    const parsed = parseInt(filters.limit || '20', 10);
    const limit = Math.min(100, Math.max(1, Number.isNaN(parsed) ? 20 : parsed));

    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    // ── Filters ──────────────────────────────────────

    if (filters.categoria) {
      conditions.push('LOWER(categoria) = LOWER(@categoria)');
      params.categoria = filters.categoria;
    }

    if (filters.ativo !== undefined) {
      conditions.push('ativo = @ativo');
      params.ativo = filters.ativo === 'true' ? 1 : 0;
    }

    if (filters.busca) {
      conditions.push('(nome LIKE @busca OR descricao LIKE @busca)');
      params.busca = `%${filters.busca}%`;
    }

    // ── Sort column — whitelist to prevent SQL injection ─

    const allowedSort = ['preco', 'nome', 'criado_em'] as const;
    const sortCol = allowedSort.includes(filters.ordenar as any)
      ? filters.ordenar!
      : 'criado_em';
    const sortDir = filters.direcao === 'desc' ? 'DESC' : 'ASC';
    const isAsc = sortDir === 'ASC';

    // ── Cursor decode + seek condition ───────────────

    if (filters.cursor) {
      const payload = decodeCursor(filters.cursor);
      if (payload) {
        // Seek past the cursor position using (sort_col, id) composite comparison
        // ASC:  (col > val) OR (col = val AND id > cursor_id)
        // DESC: (col < val) OR (col = val AND id > cursor_id)  ← id tiebreaker always ASC
        const op = isAsc ? '>' : '<';
        conditions.push(
          `((${sortCol} ${op} @cursor_value) OR (${sortCol} = @cursor_value AND id > @cursor_id))`
        );
        params.cursor_value = payload.v;
        params.cursor_id = payload.id;
      }
    }

    // ── Build query ──────────────────────────────────

    const where = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    // Fetch limit+1 to know if there's a next page
    const sql = `
      SELECT * FROM produtos
      ${where}
      ORDER BY ${sortCol} ${sortDir}, id ASC
      LIMIT @fetch_limit
    `;

    const rows = this.db
      .prepare(sql)
      .all({ ...params, fetch_limit: limit + 1 }) as Produto[];

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;

    // Build next cursor from the last returned item
    let nextCursor: string | null = null;
    if (hasMore && data.length > 0) {
      const last = data[data.length - 1];
      nextCursor = encodeCursor({
        v: last[sortCol as keyof Produto] as string | number,
        id: last.id,
      });
    }

    return {
      data: data.map(this.hydrate),
      meta: {
        limit,
        has_more: hasMore,
        next_cursor: nextCursor,
      },
    };
  }

  // ── GET by ID ────────────────────────────────────────

  getById(id: string): Produto | null {
    const row = this.db
      .prepare('SELECT * FROM produtos WHERE id = ?')
      .get(id) as Produto | undefined;
    return row ? this.hydrate(row) : null;
  }

  // ── CREATE ───────────────────────────────────────────

  create(input: ProdutoCreateInput): Produto {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO produtos (id, nome, descricao, preco, estoque, categoria, ativo, criado_em, atualizado_em)
      VALUES (@id, @nome, @descricao, @preco, @estoque, @categoria, @ativo, @criado_em, @atualizado_em)
    `).run({
      id,
      nome: input.nome,
      descricao: input.descricao ?? null,
      preco: input.preco,
      estoque: input.estoque,
      categoria: input.categoria ?? null,
      ativo: input.ativo !== false ? 1 : 0,
      criado_em: now,
      atualizado_em: now,
    });

    return this.getById(id)!;
  }

  // ── UPDATE (partial) ────────────────────────────────

  update(id: string, input: Partial<ProdutoCreateInput>): Produto {
    const existing = this.getById(id);
    if (!existing) throw new Error(`Produto ${id} not found`);

    const fields: string[] = [];
    const params: Record<string, unknown> = { id };

    if (input.nome !== undefined) { fields.push('nome = @nome'); params.nome = input.nome; }
    if (input.descricao !== undefined) { fields.push('descricao = @descricao'); params.descricao = input.descricao; }
    if (input.preco !== undefined) { fields.push('preco = @preco'); params.preco = input.preco; }
    if (input.estoque !== undefined) { fields.push('estoque = @estoque'); params.estoque = input.estoque; }
    if (input.categoria !== undefined) { fields.push('categoria = @categoria'); params.categoria = input.categoria; }
    if (input.ativo !== undefined) { fields.push('ativo = @ativo'); params.ativo = input.ativo ? 1 : 0; }

    if (fields.length === 0) return existing;

    fields.push("atualizado_em = datetime('now')");

    this.db.prepare(`UPDATE produtos SET ${fields.join(', ')} WHERE id = @id`).run(params);

    return this.getById(id)!;
  }

  // ── DELETE ───────────────────────────────────────────

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM produtos WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ── Hydrate (SQLite integers → booleans) ─────────────

  private hydrate(row: Produto): Produto {
    return {
      ...row,
      ativo: Boolean(row.ativo),
    };
  }
}
