import { createSubLogger } from "./utils/logger.js";
// Remove the import for setEnv
// import { setEnv } from "./utils/env.js";

const log = createSubLogger("worker");

// Create dedicated debug tracking that won't interfere with the response
let debugMessages: string[] = [];

// Safe debug function that doesn't interfere with the response
function debugLog(message: string, data?: any): void {
  // Only log essential information
  if (message.includes("error") || message.includes("Error") || 
      message.includes("fetch") || message.includes("Forwarding") ||
      message.includes("Worker module loaded")) {
    const timestamp = new Date().toISOString();
    const formattedMessage = data 
      ? `[${timestamp}] [WORKER-DEBUG] ${message} ${JSON.stringify(data)}`
      : `[${timestamp}] [WORKER-DEBUG] ${message}`;
    
    debugMessages.push(formattedMessage);
  }
}

// Commented out direct logs to prevent response interference
// console.log("==================================================");
// console.log("SUPER DIRECT: Worker module loaded");
// console.log("==================================================");
debugLog("Worker module loaded");

// Declare the interface for our environment bindings
export interface Env {
  // Environment variables
  OPENAI_API_KEY?: string;
  NOTION_SECRET?: string;
  NOTION_PARENT_PAGE_ID?: string;
  RESEARCH_FOUNDER_APP_ID?: string;
  LEAD_ENRICHMENT_APP_ID?: string;
  SAVE_TO_NOTION_APP_ID?: string;
  SEARCH_GOOGLE_APP_ID?: string;
  
  // New hardcoded app IDs
  APP_IDS?: string; // Comma-separated list of app IDs
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Clear debug messages for this request
    debugMessages = [];
    debugLog(`Fetch called with URL: ${request.url}`);
    
    const url = new URL(request.url);
    
    // Handle debug endpoint
    if (url.pathname === "/debug-log") {
      return new Response(debugMessages.join('\n'), {
        headers: { "Content-Type": "text/plain" }
      });
    }
    
    // Instead of using setEnv, directly set process.env values if needed
    // This is only needed if you're running in an environment where process.env is accessible
    if (typeof process !== 'undefined' && process.env) {
      if (env.APP_IDS) process.env.APP_IDS = env.APP_IDS;
      if (env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = env.OPENAI_API_KEY;
      if (env.NOTION_SECRET) process.env.NOTION_SECRET = env.NOTION_SECRET;
      if (env.NOTION_PARENT_PAGE_ID) process.env.NOTION_PARENT_PAGE_ID = env.NOTION_PARENT_PAGE_ID;
      // Add any other environment variables as needed
    }
    
    // Debug log the environment variables that are set
    debugLog("Environment variables", {
      hasOpenAI: !!env.OPENAI_API_KEY,
      hasNotion: !!env.NOTION_SECRET && !!env.NOTION_PARENT_PAGE_ID,
      hasResearchFounder: !!env.RESEARCH_FOUNDER_APP_ID,
      hasLeadEnrichment: !!env.LEAD_ENRICHMENT_APP_ID,
      hasSaveToNotion: !!env.SAVE_TO_NOTION_APP_ID,
      hasSearchGoogle: !!env.SEARCH_GOOGLE_APP_ID,
      appIds: env.APP_IDS
    });
    
    debugLog(`Received request: ${request.method} ${url.pathname}`);

    try {
      // Simple response for now since durable objects are removed
      return new Response(JSON.stringify({ 
        message: "Worker is running without durable objects. Functionality needs to be reimplemented."
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    } catch (error) {
      debugLog("Error in request handling", error);
      
      // Capture detailed error information
      let errorMessage = "Internal Server Error";
      let errorDetails = {};
      
      if (error instanceof Error) {
        errorMessage = error.message;
        errorDetails = {
          name: error.name,
          stack: error.stack,
        };
      }
      
      log.error("Error handling request", { error: errorMessage, details: errorDetails });
      
      return new Response(JSON.stringify({ 
        error: errorMessage,
        details: errorDetails
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
  }
}; 