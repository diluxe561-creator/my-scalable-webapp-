import fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';

const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'], // helpful for optimization
});

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

const app = fastify({ logger: true });

await app.register(helmet);
await app.register(cors, { origin: process.env.FRONTEND_URL || '*' });
await app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  keyGenerator: (req) => req.ip,
});

// Health check
app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));

// Example optimized route with caching
app.get('/posts', async (request, reply) => {
  const cacheKey = 'posts:published';
  const cached = await redis.get(cacheKey);

  if (cached) {
    return reply.send(JSON.parse(cached));
  }

  const posts = await prisma.post.findMany({
    where: { published: true },
    take: 50,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      createdAt: true,
      author: { select: { username: true } },
      _count: { select: { likes: true } },
    },
  });

  // Cache for 5 minutes – adjust TTL based on freshness needs
  await redis.set(cacheKey, JSON.stringify(posts), 'EX', 300);

  return posts;
});

// Invalidate cache when new post is created (example)
app.post('/posts', async (request, reply) => {
  // ... create logic ...
  await redis.del('posts:published'); // invalidate
  return { success: true };
});

const start = async () => {
  try {
    await app.listen({ port: Number(process.env.PORT) || 4000, host: '0.0.0.0' });
    app.log.info(`Server listening on ${app.server.address()?.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();