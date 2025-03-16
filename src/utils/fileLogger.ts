import { createSubLogger } from './logger.js';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const log = createSubLogger('fileLogger');

// Check if we're in a Node.js environment (not Cloudflare Workers)
const isNodeEnv = typeof globalThis.process !== 'undefined';

// Get the root directory path
let rootDir = '';
if (isNodeEnv) {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    rootDir = path.resolve(__dirname, '../..');
  } catch (error) {
    log.error('Failed to resolve root directory', { error });
  }
}

// Directory for log files
const logsDir = path.join(rootDir, 'logs');

/**
 * Ensures the logs directory exists
 */
export function ensureLogsDirectory(): void {
  if (!isNodeEnv) {
    log.warn('File logging is only available in Node.js environment');
    return;
  }

  try {
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
      log.info(`Created logs directory at ${logsDir}`);
    }
  } catch (error) {
    log.error('Failed to create logs directory', { error });
  }
}

/**
 * Writes data to a log file
 * @param filename The name of the log file
 * @param data The data to write to the file
 * @param append Whether to append to the file or overwrite it
 */
export function writeToLogFile(filename: string, data: any, append = true): void {
  if (!isNodeEnv) {
    log.warn('File logging is only available in Node.js environment');
    return;
  }

  try {
    ensureLogsDirectory();
    
    const filePath = path.join(logsDir, filename);
    
    // Format the data as a string
    let content = '';
    if (typeof data === 'string') {
      content = data;
    } else {
      try {
        content = JSON.stringify(data, null, 2);
      } catch (error) {
        content = `[Error stringifying data: ${error instanceof Error ? error.message : String(error)}]`;
      }
    }
    
    // Add timestamp
    const timestamp = new Date().toISOString();
    const entry = `\n[${timestamp}]\n${content}\n${'='.repeat(80)}\n`;
    
    // Write to file
    if (append && fs.existsSync(filePath)) {
      fs.appendFileSync(filePath, entry);
      log.info(`Appended to log file: ${filename}`, { size: entry.length });
    } else {
      fs.writeFileSync(filePath, entry);
      log.info(`Created new log file: ${filename}`, { size: entry.length });
    }
  } catch (error) {
    log.error(`Failed to write to log file: ${filename}`, { error });
  }
}

/**
 * Logs API responses to a file
 * @param appId The ID of the app
 * @param response The API response
 */
export function logApiResponse(appId: string, response: any): void {
  const filename = `api_response_${appId}.log`;
  writeToLogFile(filename, response);
} 