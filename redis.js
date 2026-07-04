/**
 * Root-level re-export so `redis.js` (per project spec) simply proxies to
 * the real implementation in `database/redis.js`. Keeps a single source
 * of truth while satisfying the requested file structure.
 */
export * from './database/redis.js';
export { default } from './database/redis.js';
