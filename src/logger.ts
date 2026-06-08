import pino from 'pino';

const logger = pino({
  level: process.env.RESTFULDB_LOG_LEVEL || 'info',
  ...(process.env.RESTFULDB_LOG_PRETTY === 'true' ? { transport: { target: 'pino-pretty' } } : {}),
});

export default logger;
