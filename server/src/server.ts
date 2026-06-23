import { app } from './app';
import { config } from './config';
import { ensureDir } from './utils/fileUtils';

// Ensure required directories exist
ensureDir(config.storage.uploadDir);
ensureDir(config.storage.outputDir);
ensureDir(config.storage.templateDir);

app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`CORS origin: ${config.cors.origin}`);
});
