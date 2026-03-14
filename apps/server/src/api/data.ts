import type { FastifyInstance } from 'fastify';
import { getEngineService } from '../engine/engine-service.js';

interface AnalyzeBody {
  action: string;
  filePath?: string;
  query?: string;
  column?: string;
  chartType?: string;
  xColumn?: string;
  yColumn?: string;
  limit?: number;
}

export function registerDataRoutes(app: FastifyInstance): void {
  // POST /data/analyze — direct data analysis endpoint
  app.post<{ Body: AnalyzeBody }>('/data/analyze', async (req, reply) => {
    const body = req.body;
    if (!body?.action) {
      return reply
        .status(400)
        .send({ error: { code: 'VALIDATION', message: 'action is required' } });
    }

    const output = await getEngineService().data.tool.execute({
      action: body.action,
      filePath: body.filePath,
      query: body.query,
      column: body.column,
      chartType: body.chartType,
      xColumn: body.xColumn,
      yColumn: body.yColumn,
      limit: body.limit,
    });

    if (!output.success) {
      return reply
        .status(400)
        .send({ error: { code: 'ANALYSIS_ERROR', message: output.error ?? 'Analysis failed' } });
    }

    return reply.send({ data: { result: output.result } });
  });
}
