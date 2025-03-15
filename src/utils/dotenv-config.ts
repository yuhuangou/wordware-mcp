import { createSubLogger } from './logger.js';

const log = createSubLogger('dotenv-config');

// Check if we're in a Cloudflare Workers environment
const isWorkerEnv = typeof globalThis.process === 'undefined';

// Only load dotenv in Node.js environment
if (!isWorkerEnv) {
  try {
    const { config } = await import('dotenv');
    const { fileURLToPath } = await import('url');
    const path = await import('path');

    // Get the directory name of the current module
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    // Path to the root directory (2 levels up from utils directory)
    const rootDir = path.resolve(__dirname, '../..');

    // Load environment variables from the root .env file
    const result = config({ path: path.join(rootDir, '.env') });

    if (result.error) {
      log.error('Error loading .env file', { error: result.error.message });
    } else {
      log.info('Loaded environment variables from .env file');
      
      // Verify that important environment variables are loaded
      const requiredVars = ['PORT', 'WORDWARE_API_KEY', 'APP_IDS'];
      const missingVars = requiredVars.filter(v => !process.env[v]);
      
      if (missingVars.length > 0) {
        log.warn('Missing required environment variables', { missingVars });
      } else {
        log.info('All required environment variables are set');
      }
    }
  } catch (error) {
    log.error('Error importing Node.js modules', { error });
  }
} else {
  // In Workers environment, environment variables are provided by Wrangler
  log.info('Running in Workers environment, environment variables are provided by Wrangler');
}

// No export needed for Workers environment
export default {}; 