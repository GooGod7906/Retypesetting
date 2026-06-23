import express from 'express';
import cors from 'cors';
import { config } from './config';
import { errorHandler } from './middleware/errorHandler';
import { uploadRouter } from './routes/upload';
import { parseRouter } from './routes/parse';
import { templateRouter } from './routes/template';
import { formatRouter } from './routes/format';
import { downloadRouter } from './routes/download';

const app = express();

// Middleware
app.use(cors({ origin: config.cors.origin }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/upload', uploadRouter);
app.use('/api/parse', parseRouter);
app.use('/api/templates', templateRouter);
app.use('/api/format', formatRouter);
app.use('/api/download', downloadRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling
app.use(errorHandler);

export { app };
