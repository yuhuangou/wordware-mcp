import { createSubLogger } from "./logger.js";
import { logApiResponse } from "./fileLogger.js";

const log = createSubLogger("api");

// Flag to temporarily disable logging
let DISABLE_LOGGING = false;

// Safe logging function that respects the disable flag
function safeLog(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: any): void {
  if (DISABLE_LOGGING) return;
  
  switch (level) {
    case 'debug':
      log.debug(message, data);
      break;
    case 'info':
      log.info(message, data);
      break;
    case 'warn':
      log.warn(message, data);
      break;
    case 'error':
      log.error(message, data);
      break;
  }
}

const WORDWARE_API_KEY =
  "ww-Ak3ZgfQpaNXyLFLFfton80EPikdvxWTpxrLleohCKcybK08sinGy7";

export type StreamCallback = (content: any) => void;

// Define interfaces for the Wordware API responses
export interface WordwareRunResponse {
  data: {
    id: string;
    type: string;
    attributes: {
      status: string;
      version: string;
      inputs: Record<string, any>;
      outputs?: Record<string, any>;
      startedAt: string;
      completedAt?: string;
    };
    links: {
      self: string;
      stream: string;
    };
  };
}

// Define types for run responses
export interface RunResponse {
  data: {
    id: string;
    type: string;
    attributes: {
      status: string;
      inputs: Record<string, any>;
      outputs?: Record<string, any>;
      error?: string;
      startedAt: string;
      completedAt?: string;
    };
    links: {
      self: string;
    };
  };
}

// Define interfaces for app details response
export interface AppInputSchema {
  type: string;
  additionalProperties: boolean;
  properties: Record<string, any>;
  required: string[];
}

export interface AppOutputSchema {
  type: string;
  additionalProperties: boolean;
  properties: Record<string, any>;
  required: string[];
}

export interface AppAttributes {
  title: string;
  description: string;
  inputSchema: AppInputSchema;
  outputSchema: AppOutputSchema;
  // Add other attributes as needed
}

export interface AppDetails {
  data: {
    id: string;
    type: string;
    attributes: AppAttributes;
    links: {
      self: string;
    };
    relationships: {
      versions: {
        links: {
          related: string;
        };
      };
      latestVersion: {
        links: {
          related: string;
        };
      };
    };
  };
}

/**
 * Sanitize and validate stream response chunks
 * @param line The raw response line to sanitize and parse
 * @returns Parsed JSON object or null if invalid
 */
function sanitizeAndParseStreamResponse(line: string): any | null {
  try {
    // Skip empty lines
    if (!line || !line.trim()) {
      return null;
    }
    
    // Check if the line starts with a log prefix and skip it
    if (line.match(/^\[.*?\] \[.*?\] \[.*?\]/) || 
        line.startsWith('INFO:') || 
        line.startsWith('DEBUG:') || 
        line.startsWith('WARN:') || 
        line.startsWith('ERROR:')) {
      return null;
    }
    
    // Temporarily disable logging during JSON parsing
    DISABLE_LOGGING = true;
    
    try {
      // Try to parse the JSON
      const parsed = JSON.parse(line);
      return parsed;
    } finally {
      // Re-enable logging
      DISABLE_LOGGING = false;
    }
  } catch (error) {
    // Re-enable logging in case of error
    DISABLE_LOGGING = false;
    
    safeLog('error', `Failed to parse stream response`, { 
      linePreview: line.substring(0, 100) + (line.length > 100 ? '...' : ''),
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

// Helper function for making Wordware API requests
export async function makeWordwareRequest<T = WordwareRunResponse>(
  appId: string,
  body: any,
  onStream?: StreamCallback
): Promise<T | null> {
  try {
    // Update to use the new API endpoint format
    const url = `https://api.wordware.ai/v1/apps/${appId}/runs`;
    safeLog('info', `API REQUEST`, { 
      url,
      appId, 
      method: 'POST',
      inputKeys: Object.keys(body.inputs || {}),
      version: body.version
    });
    
    // Format the request body according to the new API format
    const requestBody = JSON.stringify({
      version: body.version || "1.0",
      inputs: body.inputs || {}
    });
    safeLog('info', "REQUEST BODY", { requestBody });
    
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Include the Authorization header with the API key
        "Authorization": `Bearer ${WORDWARE_API_KEY}`,
      },
      body: requestBody,
    });

    if (!response.ok) {
      const errorStatus = response.status;
      const errorText = await response.text();
      safeLog('error', "HTTP ERROR FROM API", { 
        status: errorStatus,
        statusText: response.statusText,
        responseText: errorText
      });
      throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
    }

    safeLog('info', "RECEIVED API RESPONSE", { 
      status: response.status,
      contentType: response.headers.get('content-type')
    });

    // Parse the initial response to get the run ID and stream token
    const initialResponse = await response.json() as WordwareRunResponse;
    safeLog('info', "INITIAL RESPONSE", {
      responseType: typeof initialResponse,
      responseKeys: Object.keys(initialResponse || {})
    });

    const runId = initialResponse.data?.id;
    const streamUrl = initialResponse.data?.links?.stream;

    if (!runId) {
      safeLog('error', "MISSING RUN ID IN RESPONSE", { initialResponse });
      throw new Error("Missing run ID in response");
    }

    safeLog('info', "RUN DETAILS", {
      runId,
      hasStreamUrl: !!streamUrl
    });

    if (onStream && streamUrl) {
      // Handle streaming response
      safeLog('info', "PROCESSING STREAMED RESPONSE", { streamUrl });
      
      const streamResponse = await fetch(streamUrl, {
        headers: {
          "Authorization": `Bearer ${WORDWARE_API_KEY}`,
        }
      });
      if (!streamResponse.ok) {
        safeLog('error', "STREAM FETCH ERROR", {
          status: streamResponse.status,
          statusText: streamResponse.statusText
        });
        throw new Error(`Stream fetch error: ${streamResponse.status}`);
      }

      const reader = streamResponse.body!.getReader();
      const decoder = new TextDecoder();
      let buffer: string[] = [];
      let chunkCount = 0;
      let lineCount = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            safeLog('info', "STREAM FINISHED", { totalChunks: chunkCount, totalLines: lineCount });
            break;
          }

          chunkCount++;
          const chunk = decoder.decode(value);
          safeLog('info', `RECEIVED RAW CHUNK #${chunkCount}`, { 
            chunkSize: chunk.length,
            chunkPreview: chunk.substring(0, 50) + (chunk.length > 50 ? '...' : '')
          });
          
          for (let i = 0; i < chunk.length; i++) {
            if (chunk[i] === "\n") {
              const line = buffer.join("").trim();
              if (line) {
                lineCount++;
                safeLog('info', `PROCESSING LINE #${lineCount}`, { 
                  lineLength: line.length,
                });
                
                const content = sanitizeAndParseStreamResponse(line);
                if (content) {
                  safeLog('info', "CALLING STREAM CALLBACK WITH CONTENT");
                  onStream(content);
                } else {
                  safeLog('warn', "NULL CONTENT FROM STREAM LINE", { line: line.substring(0, 50) });
                }
              } else {
                safeLog('info', "EMPTY LINE IN STREAM, SKIPPING");
              }
              buffer = [];
            } else {
              buffer.push(chunk[i]);
            }
          }
        }
        safeLog('info', "STREAM PROCESSING COMPLETE");
        return null;
      } catch (streamError) {
        safeLog('error', "STREAM PROCESSING ERROR", { 
          error: streamError instanceof Error ? streamError.message : String(streamError),
          stack: streamError instanceof Error ? streamError.stack : undefined
        });
        return null;
      } finally {
        reader.releaseLock();
        safeLog('info', "STREAM READER RELEASED");
      }
    } else {
      // For non-streaming response, poll the run endpoint until completion
      safeLog('info', "POLLING FOR RUN COMPLETION");
      
      const pollUrl = `https://api.wordware.ai/v1/runs/${runId}`;
      let isCompleted = false;
      let result: WordwareRunResponse | null = null;
      
      while (!isCompleted) {
        safeLog('info', "POLLING RUN STATUS", { pollUrl });
        
        const pollResponse = await fetch(pollUrl, {
          headers: {
            "Authorization": `Bearer ${WORDWARE_API_KEY}`,
          }
        });
        if (!pollResponse.ok) {
          safeLog('error', "POLL ERROR", {
            status: pollResponse.status,
            statusText: pollResponse.statusText
          });
          throw new Error(`Poll error: ${pollResponse.status}`);
        }
        
        const pollData = await pollResponse.json() as WordwareRunResponse;
        safeLog('info', "POLL RESPONSE", {
          status: pollData.data?.attributes?.status,
          hasOutputs: !!pollData.data?.attributes?.outputs
        });
        
        if (pollData.data?.attributes?.status === "completed") {
          isCompleted = true;
          result = pollData;
        } else if (pollData.data?.attributes?.status === "failed") {
          safeLog('error', "RUN FAILED", { pollData });
          throw new Error("Run failed");
        } else {
          // Wait before polling again
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      safeLog('info', "RUN COMPLETED", {
        resultType: typeof result,
        resultKeys: result ? Object.keys(result) : []
      });
      
      return result as unknown as T;
    }
  } catch (error) {
    safeLog('error', "API REQUEST ERROR", { 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    return null;
  }
}

/**
 * Fetches app details from the Wordware API
 * @param appId The ID of the app to fetch details for
 * @returns The app details or null if the request failed
 */
export async function fetchAppDetails(appId: string): Promise<AppDetails | null> {
  try {
    safeLog('info', `Fetching app details for app ID: ${appId}`);
    
    const response = await fetch(`https://api.wordware.ai/v1/apps/${appId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${WORDWARE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      safeLog('error', `Failed to fetch app details: ${response.status} ${response.statusText}`, { error: errorText });
      
      // Log the error response to a file
      logApiResponse(appId, {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
        timestamp: new Date().toISOString(),
        endpoint: `https://api.wordware.ai/v1/apps/${appId}`
      });
      
      return null;
    }
    
    const appDetails: AppDetails = await response.json();
    safeLog('info', `Successfully fetched app details`, { 
      title: appDetails.data.attributes.title,
      appId 
    });
    
    // Log the successful response to a file
    logApiResponse(appId, {
      success: true,
      timestamp: new Date().toISOString(),
      endpoint: `https://api.wordware.ai/v1/apps/${appId}`,
      appDetails
    });
    
    return appDetails;
  } catch (error) {
    safeLog('error', `Error fetching app details`, { appId, error });
    
    // Log the error to a file
    logApiResponse(appId, {
      success: false,
      timestamp: new Date().toISOString(),
      endpoint: `https://api.wordware.ai/v1/apps/${appId}`,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    
    return null;
  }
}

/**
 * Executes a Wordware app with the given inputs
 * @param appId The ID of the app to execute
 * @param inputs The inputs to pass to the app
 * @returns The result of the execution or null if it failed
 */
export async function executeApp(appId: string, inputs: Record<string, any>): Promise<any> {
  try {
    safeLog('info', `Executing app with ID: ${appId}`, { inputs });
    
    // Ensure inputs is a valid object
    const safeInputs = typeof inputs === 'object' && inputs !== null ? inputs : {};
    
    // Construct the request body according to the API format
    const requestBody = {
      data: {
        type: "runs",
        attributes: {
          version: "1.0",
          inputs: safeInputs
        }
      }
    };
    
    safeLog('debug', `Request body for app execution`, { 
      requestBody: JSON.stringify(requestBody),
      appId
    });
    
    // Log the request payload to a file
    logApiResponse(appId, {
      type: 'execution_request',
      timestamp: new Date().toISOString(),
      endpoint: `https://api.wordware.ai/v1/apps/${appId}/runs`,
      requestBody
    });
    
    const response = await fetch(`https://api.wordware.ai/v1/apps/${appId}/runs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WORDWARE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      safeLog('error', `Failed to execute app: ${response.status} ${response.statusText}`, { 
        error: errorText,
        appId
      });
      
      // Log the error response to a file
      logApiResponse(appId, {
        type: 'execution_error',
        status: response.status,
        statusText: response.statusText,
        error: errorText,
        timestamp: new Date().toISOString(),
        endpoint: `https://api.wordware.ai/v1/apps/${appId}/runs`
      });
      
      return { error: `API error: ${response.status} ${response.statusText}` };
    }
    
    const result = await response.json() as RunResponse;
    safeLog('info', `Successfully started app execution`, { 
      appId,
      runId: result.data?.id,
      status: result.data?.attributes?.status
    });
    
    // Log the successful response to a file
    logApiResponse(appId, {
      type: 'execution_response',
      success: true,
      timestamp: new Date().toISOString(),
      endpoint: `https://api.wordware.ai/v1/apps/${appId}/runs`,
      runId: result.data?.id,
      status: result.data?.attributes?.status
    });
    
    // Check if the app has already completed
    if (result.data?.attributes?.status === 'completed' && result.data?.attributes?.outputs) {
      safeLog('info', `App execution completed immediately`, { 
        appId,
        runId: result.data?.id,
        outputKeys: Object.keys(result.data.attributes.outputs)
      });
      
      // Log the outputs to a file
      logApiResponse(appId, {
        type: 'execution_completed',
        timestamp: new Date().toISOString(),
        runId: result.data?.id,
        outputs: result.data.attributes.outputs
      });
      
      return result.data.attributes.outputs;
    }
    
    // Wait for completion
    return await waitForRunCompletion(result.data.id);
  } catch (error) {
    safeLog('error', `Error executing app`, { 
      appId, 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    
    // Log the error to a file
    logApiResponse(appId, {
      type: 'execution_exception',
      success: false,
      timestamp: new Date().toISOString(),
      endpoint: `https://api.wordware.ai/v1/apps/${appId}/runs`,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    
    return { error: `Execution error: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Waits for a run to complete by polling the API
 * @param runId The ID of the run to wait for
 * @returns The outputs of the run or null if it failed
 */
async function waitForRunCompletion(runId: string): Promise<any> {
  try {
    safeLog('info', `Waiting for run completion`, { runId });
    
    // Poll the API every 2 seconds for up to 60 seconds (30 attempts)
    for (let attempt = 0; attempt < 30; attempt++) {
      // Wait for 2 seconds
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Check the run status
      safeLog('debug', `Polling run status (attempt ${attempt + 1}/30)`, { runId });
      
      const response = await fetch(`https://api.wordware.ai/v1/runs/${runId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${WORDWARE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        safeLog('warn', `Failed to check run status: ${response.status} ${response.statusText}`, { 
          runId, 
          error: errorText,
          attempt: attempt + 1 
        });
        
        // Log the polling error to a file
        logApiResponse(runId, {
          type: 'polling_error',
          status: response.status,
          statusText: response.statusText,
          error: errorText,
          timestamp: new Date().toISOString(),
          endpoint: `https://api.wordware.ai/v1/runs/${runId}`,
          attempt: attempt + 1
        });
        
        continue; // Continue trying if there's an error
      }
      
      const result = await response.json() as RunResponse;
      const status = result.data?.attributes?.status;
      
      safeLog('debug', `Run status: ${status}`, { runId, attempt: attempt + 1 });
      
      // Log the polling result to a file
      logApiResponse(runId, {
        type: 'polling_response',
        timestamp: new Date().toISOString(),
        endpoint: `https://api.wordware.ai/v1/runs/${runId}`,
        attempt: attempt + 1,
        status,
        hasOutputs: !!result.data?.attributes?.outputs
      });
      
      if (status === 'completed' && result.data?.attributes?.outputs) {
        safeLog('info', `Run completed successfully`, { 
          runId, 
          outputKeys: Object.keys(result.data.attributes.outputs || {})
        });
        
        // Log the successful completion to a file
        logApiResponse(runId, {
          type: 'polling_completed',
          timestamp: new Date().toISOString(),
          endpoint: `https://api.wordware.ai/v1/runs/${runId}`,
          attempt: attempt + 1,
          outputs: result.data.attributes.outputs
        });
        
        return result.data.attributes.outputs;
      } else if (status === 'failed') {
        safeLog('error', `Run failed`, { runId });
        
        // Log the failure to a file
        logApiResponse(runId, {
          type: 'polling_failed',
          timestamp: new Date().toISOString(),
          endpoint: `https://api.wordware.ai/v1/runs/${runId}`,
          attempt: attempt + 1,
          status: 'failed'
        });
        
        return { error: 'Run failed' };
      }
    }
    
    safeLog('error', `Run timed out`, { runId });
    
    // Log the timeout to a file
    logApiResponse(runId, {
      type: 'polling_timeout',
      timestamp: new Date().toISOString(),
      endpoint: `https://api.wordware.ai/v1/runs/${runId}`,
      message: 'Run timed out after 30 attempts (60 seconds)'
    });
    
    return { error: 'Run timed out' };
  } catch (error) {
    safeLog('error', `Error waiting for run completion`, { 
      runId, 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    
    // Log the error to a file
    logApiResponse(runId, {
      type: 'polling_exception',
      timestamp: new Date().toISOString(),
      endpoint: `https://api.wordware.ai/v1/runs/${runId}`,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    
    return { error: `Error waiting for run completion: ${error instanceof Error ? error.message : String(error)}` };
  }
}