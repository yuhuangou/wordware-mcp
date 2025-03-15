/**
 * Simple logger utility for the MCP server
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface Logger {
  debug: (message: string, data?: any) => void;
  info: (message: string, data?: any) => void;
  warn: (message: string, data?: any) => void;
  error: (message: string, data?: any) => void;
}

// Check if we're in a Cloudflare Workers environment
const isWorkerEnv = typeof globalThis.process === 'undefined';

// Force debug mode for development
const DEBUG_MODE = true;

// Control double logging for info level - TURNING OFF to prevent JSON parsing issues
const INFO_DOUBLE_LOG = false;

/**
 * Creates a sub-logger with a specific context name
 * @param context The name of the context/file using the logger
 * @returns A logger instance
 */
export const createSubLogger = (context: string): Logger => {
  const formatLog = (level: LogLevel, message: string, data?: any): string => {
    const timestamp = new Date().toISOString();
    // Safely stringify data to prevent JSON parsing errors
    let dataString = '';
    if (data) {
      try {
        dataString = ` ${JSON.stringify(data, null, 2)}`;
      } catch (error) {
        dataString = ` [Error stringifying data: ${error instanceof Error ? error.message : String(error)}]`;
      }
    }
    return `[${timestamp}] [${level.toUpperCase()}] [${context}] ${message}${dataString}`;
  };

  // In Workers environment, use console without process
  return {
    debug: (message: string, data?: any) => {
      const logMessage = formatLog('debug', message, data);
      console.debug(logMessage);
      // Also log to info level to ensure visibility - but only in debug mode
      if (DEBUG_MODE) {
        // Remove the "DEBUG: " prefix to avoid JSON parsing issues
        console.log(logMessage);
      }
    },
    info: (message: string, data?: any) => {
      const logMessage = formatLog('info', message, data);
      console.info(logMessage);
      // Disable double logging to prevent JSON parsing issues
      // if (INFO_DOUBLE_LOG) {
      //   console.log(`INFO: ${logMessage}`);
      // }
    },
    warn: (message: string, data?: any) => {
      const logMessage = formatLog('warn', message, data);
      console.warn(logMessage);
      // Remove the "WARN: " prefix to avoid JSON parsing issues
      console.log(logMessage);
    },
    error: (message: string, data?: any) => {
      const logMessage = formatLog('error', message, data);
      console.error(logMessage);
      // Remove the "ERROR: " prefix to avoid JSON parsing issues
      console.log(logMessage);
    }
  };
}; 