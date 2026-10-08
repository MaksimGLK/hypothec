import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { API_PREFIX } from '@hypothec/api-contract';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors, jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { authenticate } from './auth/plugin.js';
import type { AppDeps } from './deps.js';
import { AppError } from './lib/errors.js';
import { authRoutes } from './routes/auth.js';
import { contentRoutes } from './routes/content.js';
import { financeRoutes } from './routes/finance.js';
import { householdRootRoutes, householdRoutes } from './routes/households.js';
import { meRoutes } from './routes/me.js';
import { planRoutes } from './routes/plan.js';
import { prepaymentRoutes } from './routes/prepayments.js';
import { recommendationRoutes } from './routes/recommendations.js';
import { stageRoutes } from './routes/stages.js';
import { getAccess } from './services/households.js';

// сообщения валидации — по-русски
z.config(z.locales.ru());

export interface BuildAppOptions {
  logger?: boolean;
  /** В тестах лимиты запросов мешают — их можно отключить. */
  rateLimit?: boolean;
}

export async function buildApp(deps: AppDeps, options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger === false ? false : { level: deps.config.LOG_LEVEL, redact: ['req.headers.authorization', 'req.headers.cookie'] },
    trustProxy: true,
    bodyLimit: 1_000_000,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('deps', deps);
  app.decorateRequest('user', null as never);
  app.decorateRequest('household', null as never);

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) });
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({
        code: 'validation_error',
        message: 'Проверьте введённые данные',
        details: err.validation.map((v) => {
          const issue = (v.params as { issue?: { path?: PropertyKey[]; message?: string } }).issue;
          return { path: v.instancePath.replace(/^\//, '').replace(/\//g, '.') || issue?.path?.map(String).join('.'), message: issue?.message ?? v.message };
        }),
      });
    }
    if (err.statusCode === 429) return reply.code(429).send({ code: 'rate_limited', message: 'Слишком много запросов. Подождите немного и попробуйте снова.' });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ code: 'validation_error', message: err.message });
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ code: 'internal_error', message: 'Что-то пошло не так. Мы уже разбираемся.' });
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: deps.config.webOrigins, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] });
  await app.register(cookie);
  // клиент после правки перечитывает данные семьи пачкой запросов — общий лимит щедрый, строгие лимиты стоят на входе и письмах
  await app.register(rateLimit, { global: true, max: 1200, timeWindow: '1 minute', enableDraftSpec: true, ...(options.rateLimit === false ? { max: 1_000_000, allowList: () => true } : {}) });

  await app.register(swagger, {
    openapi: {
      info: { title: 'Ипотечный планировщик API', version: '1.0.0', description: 'Публичное API для веб- и мобильных клиентов. Все суммы — целые копейки, даты — ГГГГ-ММ-ДД.' },
      components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
      security: [{ bearer: [] }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: `${API_PREFIX}/docs` });

  app.get(`${API_PREFIX}/health`, { schema: { hide: true } }, async () => {
    await deps.db.execute(sql`select 1`);
    return { status: 'ok' };
  });

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(async (authed) => {
        authed.addHook('onRequest', authenticate);
        await authed.register(meRoutes);
        await authed.register(contentRoutes);
        await authed.register(householdRootRoutes);
        await authed.register(
          async (h) => {
            // onRequest: параметры ещё сырые (схемы маршрутов не описывают :hid)
            h.addHook('onRequest', async (req) => {
              req.household = await getAccess(deps, (req.params as { hid: string }).hid, req.user.id);
            });
            await h.register(householdRoutes);
            await h.register(stageRoutes);
            await h.register(financeRoutes);
            await h.register(prepaymentRoutes);
            await h.register(planRoutes);
            await h.register(recommendationRoutes);
          },
          { prefix: '/households/:hid' },
        );
      });
    },
    { prefix: API_PREFIX },
  );

  return app;
}
