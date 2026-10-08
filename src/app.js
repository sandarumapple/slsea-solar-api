require('dotenv').config();
const express = require('express'),
  helmet = require('helmet'),
  cors = require('cors'),
  morgan = require('morgan'),
  swaggerUi = require('swagger-ui-express');
const routes = require('./routes'),
  spec = require('./docs/swagger');
const { notFoundHandler, errorHandler } = require('./middleware/error');
const app = express();
// Set only for a known proxy topology; never blindly trust all forwarded IPs.
const proxyHops = process.env.TRUST_PROXY_HOPS || '0';
if (!/^\d+$/.test(proxyHops) || Number(proxyHops) > 10)
  throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 10');
app.set('trust proxy', Number(proxyHops));
app.use(helmet());
app.use(cors());
if (process.env.NODE_ENV !== 'test')
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '100kb' }));
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/docs')) return next();
  if (!req.accepts('json'))
    return next(
      new (require('./utils/errors').ApiError)(
        406,
        'NOT_ACCEPTABLE',
        'This API serves application/json'
      )
    );
  if (
    ['POST', 'PUT', 'PATCH'].includes(req.method) &&
    !req.is('application/json')
  )
    return next(
      new (require('./utils/errors').ApiError)(
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        'Content-Type application/json is required'
      )
    );
  next();
});
app.get('/', (req, res) =>
  res.json({
    name: 'SLSEA Real-Time Solar Generation Data API',
    status: 'ok',
    health: '/health',
    documentation: '/api/docs',
    apiBase: '/api'
  })
);
app.get('/health', (req, res) => {
  const connected = require('mongoose').connection.readyState === 1;
  res
    .status(connected ? 200 : 503)
    .json({
      status: connected ? 'ok' : 'unavailable',
      database: connected ? 'connected' : 'disconnected'
    });
});
app.get('/api/openapi.json', (req, res) => res.json(spec));
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(spec));
app.use('/api', routes);
app.use(notFoundHandler);
app.use(errorHandler);
module.exports = app;
