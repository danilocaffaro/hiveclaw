import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { ProdutoRepository } from '../db/produtos.js';

function createRepo(): ProdutoRepository {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  return new ProdutoRepository(db);
}

/** Seed N products across categories */
function seed(repo: ProdutoRepository, n: number) {
  const categorias = ['eletronicos', 'roupas', 'alimentos', 'livros'];
  const items = [];
  for (let i = 1; i <= n; i++) {
    items.push(
      repo.create({
        nome: `Produto ${String(i).padStart(3, '0')}`,
        preco: i * 10,
        estoque: i,
        categoria: categorias[(i - 1) % categorias.length],
      })
    );
  }
  return items;
}

describe('GET /produtos — cursor-based pagination', () => {

  let repo: ProdutoRepository;

  beforeEach(() => {
    repo = createRepo();
  });

  // ── Basic listing ───────────────────────────────────

  it('returns empty when no products', () => {
    const result = repo.list();
    expect(result.data).toEqual([]);
    expect(result.meta.has_more).toBe(false);
    expect(result.meta.next_cursor).toBeNull();
  });

  it('returns all items when count < limit', () => {
    seed(repo, 5);
    const result = repo.list({ limit: '20' });
    expect(result.data).toHaveLength(5);
    expect(result.meta.has_more).toBe(false);
    expect(result.meta.next_cursor).toBeNull();
  });

  // ── Cursor paging ──────────────────────────────────

  it('paginates with cursor — page 1 + page 2', () => {
    seed(repo, 5);

    // Page 1: 3 items
    const page1 = repo.list({ limit: '3' });
    expect(page1.data).toHaveLength(3);
    expect(page1.meta.has_more).toBe(true);
    expect(page1.meta.next_cursor).toBeTruthy();

    // Page 2: remaining 2 items
    const page2 = repo.list({ limit: '3', cursor: page1.meta.next_cursor! });
    expect(page2.data).toHaveLength(2);
    expect(page2.meta.has_more).toBe(false);
    expect(page2.meta.next_cursor).toBeNull();

    // No overlap between pages
    const ids1 = page1.data.map(p => p.id);
    const ids2 = page2.data.map(p => p.id);
    expect(ids1.filter(id => ids2.includes(id))).toEqual([]);
  });

  it('walks through all pages without missing or duplicating items', () => {
    const all = seed(repo, 25);
    const seen = new Set<string>();
    let cursor: string | undefined;

    for (let page = 0; page < 20; page++) { // safety limit
      const result = repo.list({ limit: '7', cursor });
      for (const item of result.data) {
        expect(seen.has(item.id)).toBe(false); // no duplicates
        seen.add(item.id);
      }
      if (!result.meta.has_more) break;
      cursor = result.meta.next_cursor!;
    }

    expect(seen.size).toBe(25);
  });

  // ── Filters ─────────────────────────────────────────

  it('filters by categoria', () => {
    seed(repo, 12);
    const result = repo.list({ categoria: 'eletronicos' });
    expect(result.data.length).toBe(3); // items 1,5,9
    expect(result.data.every(p => p.categoria === 'eletronicos')).toBe(true);
  });

  it('filters by categoria (case-insensitive)', () => {
    seed(repo, 4);
    const result = repo.list({ categoria: 'ELETRONICOS' });
    expect(result.data.length).toBe(1);
  });

  it('cursor + categoria filter works across pages', () => {
    seed(repo, 20); // 5 per category (eletronicos at i=1,5,9,13,17)

    const page1 = repo.list({ categoria: 'eletronicos', limit: '2' });
    expect(page1.data).toHaveLength(2);
    expect(page1.meta.has_more).toBe(true);

    const page2 = repo.list({ categoria: 'eletronicos', limit: '2', cursor: page1.meta.next_cursor! });
    expect(page2.data).toHaveLength(2);
    expect(page2.meta.has_more).toBe(true);

    const page3 = repo.list({ categoria: 'eletronicos', limit: '2', cursor: page2.meta.next_cursor! });
    expect(page3.data).toHaveLength(1);
    expect(page3.meta.has_more).toBe(false);

    // All should be eletronicos
    const all = [...page1.data, ...page2.data, ...page3.data];
    expect(all.every(p => p.categoria === 'eletronicos')).toBe(true);
    expect(all.length).toBe(5);
  });

  it('filters by ativo', () => {
    const repo2 = createRepo();
    repo2.create({ nome: 'Ativo', preco: 10, estoque: 1, ativo: true });
    repo2.create({ nome: 'Inativo', preco: 20, estoque: 2, ativo: false });

    const ativos = repo2.list({ ativo: 'true' });
    expect(ativos.data).toHaveLength(1);
    expect(ativos.data[0].nome).toBe('Ativo');

    const inativos = repo2.list({ ativo: 'false' });
    expect(inativos.data).toHaveLength(1);
    expect(inativos.data[0].nome).toBe('Inativo');
  });

  it('filters by busca (partial match)', () => {
    seed(repo, 10);
    const result = repo.list({ busca: 'Produto 00' });
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data.every(p => p.nome.includes('Produto 00'))).toBe(true);
  });

  // ── Sorting ─────────────────────────────────────────

  it('sorts by preco ASC with cursor', () => {
    seed(repo, 10);
    const page1 = repo.list({ ordenar: 'preco', direcao: 'asc', limit: '4' });
    const precos1 = page1.data.map(p => p.preco);
    expect(precos1).toEqual([...precos1].sort((a, b) => a - b));

    const page2 = repo.list({ ordenar: 'preco', direcao: 'asc', limit: '4', cursor: page1.meta.next_cursor! });
    const precos2 = page2.data.map(p => p.preco);
    expect(precos2).toEqual([...precos2].sort((a, b) => a - b));

    // Page 2 should start after page 1
    expect(precos2[0]).toBeGreaterThanOrEqual(precos1[precos1.length - 1]);
  });

  it('sorts by preco DESC with cursor', () => {
    seed(repo, 10);
    const page1 = repo.list({ ordenar: 'preco', direcao: 'desc', limit: '4' });
    const precos1 = page1.data.map(p => p.preco);
    expect(precos1).toEqual([...precos1].sort((a, b) => b - a));

    const page2 = repo.list({ ordenar: 'preco', direcao: 'desc', limit: '4', cursor: page1.meta.next_cursor! });
    const precos2 = page2.data.map(p => p.preco);
    expect(precos2).toEqual([...precos2].sort((a, b) => b - a));

    // Page 2 precos should all be <= last of page 1
    expect(precos2[0]).toBeLessThanOrEqual(precos1[precos1.length - 1]);
  });

  it('sorts by nome ASC', () => {
    seed(repo, 5);
    const result = repo.list({ ordenar: 'nome', direcao: 'asc' });
    const nomes = result.data.map(p => p.nome);
    expect(nomes).toEqual([...nomes].sort());
  });

  // ── Edge cases ──────────────────────────────────────

  it('limit clamped to max 100', () => {
    seed(repo, 3);
    const result = repo.list({ limit: '999' });
    expect(result.meta.limit).toBe(100);
  });

  it('limit clamped to min 1', () => {
    seed(repo, 3);
    const result = repo.list({ limit: '0' });
    expect(result.meta.limit).toBe(1);
  });

  it('invalid cursor is ignored (returns from start)', () => {
    seed(repo, 5);
    const result = repo.list({ cursor: 'garbage!!!not-base64' });
    expect(result.data).toHaveLength(5); // returns everything
  });

  it('combined: categoria + busca + sort + cursor', () => {
    seed(repo, 20);
    // eletronicos at i=1,5,9,13,17 → preco 10,50,90,130,170
    const result = repo.list({
      categoria: 'eletronicos',
      ordenar: 'preco',
      direcao: 'desc',
      limit: '2',
    });
    expect(result.data).toHaveLength(2);
    expect(result.data[0].preco).toBe(170);
    expect(result.data[1].preco).toBe(130);
    expect(result.meta.has_more).toBe(true);

    const page2 = repo.list({
      categoria: 'eletronicos',
      ordenar: 'preco',
      direcao: 'desc',
      limit: '2',
      cursor: result.meta.next_cursor!,
    });
    expect(page2.data[0].preco).toBe(90);
    expect(page2.data[1].preco).toBe(50);
  });
});

// ── CRUD tests (regression) ──────────────────────────────

describe('Produto CRUD', () => {
  let repo: ProdutoRepository;

  beforeEach(() => {
    repo = createRepo();
  });

  it('creates and retrieves a product', () => {
    const p = repo.create({ nome: 'Teclado', preco: 150, estoque: 10, categoria: 'eletronicos' });
    expect(p.id).toBeTruthy();
    expect(p.nome).toBe('Teclado');
    expect(p.preco).toBe(150);
    expect(p.ativo).toBe(true);

    const fetched = repo.getById(p.id);
    expect(fetched).toEqual(p);
  });

  it('updates partially', () => {
    const p = repo.create({ nome: 'Mouse', preco: 50, estoque: 5 });
    const updated = repo.update(p.id, { preco: 75 });
    expect(updated.preco).toBe(75);
    expect(updated.nome).toBe('Mouse'); // unchanged
  });

  it('deletes a product', () => {
    const p = repo.create({ nome: 'Monitor', preco: 800, estoque: 3 });
    expect(repo.delete(p.id)).toBe(true);
    expect(repo.getById(p.id)).toBeNull();
    expect(repo.delete(p.id)).toBe(false); // already gone
  });

  it('getById returns null for unknown id', () => {
    expect(repo.getById('nope')).toBeNull();
  });

  it('update throws for unknown id', () => {
    expect(() => repo.update('nope', { nome: 'x' })).toThrow('not found');
  });
});
