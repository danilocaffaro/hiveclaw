import type { FastifyInstance } from 'fastify';
import type { ProdutoRepository, ProdutoCreateInput, ProdutoFilters } from '../db/produtos.js';

export function registerProdutoRoutes(app: FastifyInstance, repo: ProdutoRepository): void {

  // ── GET /api/produtos — list with filters + cursor pagination ──

  app.get<{
    Querystring: ProdutoFilters;
  }>('/api/produtos', async (request, reply) => {
    const filters: ProdutoFilters = {
      categoria: request.query.categoria,
      ativo: request.query.ativo,
      busca: request.query.busca,
      ordenar: request.query.ordenar,
      direcao: request.query.direcao,
      limit: request.query.limit,
      cursor: request.query.cursor,
    };

    const result = repo.list(filters);
    return reply.status(200).send(result);
  });

  // ── GET /api/produtos/:id ─────────────────────────────────────

  app.get<{
    Params: { id: string };
  }>('/api/produtos/:id', async (request, reply) => {
    const produto = repo.getById(request.params.id);
    if (!produto) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Produto não encontrado' },
      });
    }
    return reply.status(200).send({ data: produto });
  });

  // ── POST /api/produtos ────────────────────────────────────────

  app.post<{
    Body: ProdutoCreateInput;
  }>('/api/produtos', async (request, reply) => {
    const { nome, descricao, preco, estoque, categoria, ativo } = request.body || {};

    // Validation
    const errors: string[] = [];
    if (!nome || typeof nome !== 'string') errors.push("Campo 'nome' é obrigatório");
    if (preco === undefined || typeof preco !== 'number' || preco < 0) errors.push("Campo 'preco' deve ser um número >= 0");
    if (estoque === undefined || typeof estoque !== 'number' || estoque < 0) errors.push("Campo 'estoque' deve ser um inteiro >= 0");

    if (errors.length > 0) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: errors[0], details: errors },
      });
    }

    const produto = repo.create({ nome, descricao, preco, estoque, categoria, ativo });
    return reply.status(201).send({ data: produto });
  });

  // ── PUT /api/produtos/:id — full replace ──────────────────────

  app.put<{
    Params: { id: string };
    Body: ProdutoCreateInput;
  }>('/api/produtos/:id', async (request, reply) => {
    const { nome, preco, estoque } = request.body || {};

    const errors: string[] = [];
    if (!nome || typeof nome !== 'string') errors.push("Campo 'nome' é obrigatório");
    if (preco === undefined || typeof preco !== 'number' || preco < 0) errors.push("Campo 'preco' deve ser um número >= 0");
    if (estoque === undefined || typeof estoque !== 'number' || estoque < 0) errors.push("Campo 'estoque' deve ser um inteiro >= 0");

    if (errors.length > 0) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: errors[0], details: errors },
      });
    }

    try {
      const produto = repo.update(request.params.id, request.body);
      return reply.status(200).send({ data: produto });
    } catch {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Produto não encontrado' },
      });
    }
  });

  // ── PATCH /api/produtos/:id — partial update ─────────────────

  app.patch<{
    Params: { id: string };
    Body: Partial<ProdutoCreateInput>;
  }>('/api/produtos/:id', async (request, reply) => {
    try {
      const produto = repo.update(request.params.id, request.body);
      return reply.status(200).send({ data: produto });
    } catch {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Produto não encontrado' },
      });
    }
  });

  // ── DELETE /api/produtos/:id ──────────────────────────────────

  app.delete<{
    Params: { id: string };
  }>('/api/produtos/:id', async (request, reply) => {
    const deleted = repo.delete(request.params.id);
    if (!deleted) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Produto não encontrado' },
      });
    }
    return reply.status(204).send();
  });
}
