import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  mineru: {
    apiToken: process.env.MINERU_API_TOKEN || '',
    apiBaseUrl: process.env.MINERU_API_BASE_URL || 'https://mineru.net/api/v4',
  },

  storage: {
    uploadDir: path.resolve(process.env.UPLOAD_DIR || './uploads'),
    outputDir: path.resolve(process.env.OUTPUT_DIR || './outputs'),
    templateDir: path.resolve(process.env.TEMPLATE_DIR || './templates'),
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '209715200', 10), // 200MB
  },

  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  },
};
