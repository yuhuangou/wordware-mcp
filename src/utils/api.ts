// Flag to temporarily disable logging
let DISABLE_LOGGING = false;

// Safe logging function that respects the disable flag
function safeLog(
  level: "debug" | "info" | "warn" | "error",
  message: string,
  data?: any
): void {
  if (DISABLE_LOGGING) return;

  switch (level) {
    case "debug":
      console.debug(message, data ? JSON.stringify(data) : "");
      break;
    case "info":
      console.info(message, data ? JSON.stringify(data) : "");
      break;
    case "warn":
      console.warn(message, data ? JSON.stringify(data) : "");
      break;
    case "error":
      console.error(message, data ? JSON.stringify(data) : "");
      break;
  }
}

// Get API key from environment
const WORDWARE_API_KEY = process.env.WORDWARE_API_KEY || "";

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
      error?: string;
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
    if (
      line.match(/^\[.*?\] \[.*?\] \[.*?\]/) ||
      line.startsWith("INFO:") ||
      line.startsWith("DEBUG:") ||
      line.startsWith("WARN:") ||
      line.startsWith("ERROR:")
    ) {
      return null;
    }

    // Parse the JSON
    const parsed = JSON.parse(line);
    return parsed;
  } catch (error) {
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

    // Format the request body according to the new API format
    const requestBody = JSON.stringify({
      version: body.version || "1.0",
      inputs: body.inputs || {},
    });

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Include the Authorization header with the API key
        Authorization: `Bearer ${WORDWARE_API_KEY}`,
      },
      body: requestBody,
    });

    if (!response.ok) {
      const errorStatus = response.status;
      const errorText = await response.text();
      throw new Error(
        `HTTP error! status: ${response.status}, body: ${errorText}`
      );
    }

    // Parse the initial response to get the run ID and stream token
    const initialResponse = (await response.json()) as WordwareRunResponse;

    const runId = initialResponse.data?.id;
    const streamUrl = initialResponse.data?.links?.stream;

    if (!runId) {
      throw new Error("Missing run ID in response");
    }

    if (onStream && streamUrl) {
      // Handle streaming response
      const streamResponse = await fetch(streamUrl, {
        headers: {
          Authorization: `Bearer ${WORDWARE_API_KEY}`,
        },
      });
      if (!streamResponse.ok) {
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
            break;
          }

          chunkCount++;
          const chunk = decoder.decode(value);

          for (let i = 0; i < chunk.length; i++) {
            if (chunk[i] === "\n") {
              const line = buffer.join("").trim();
              if (line) {
                lineCount++;
                const content = sanitizeAndParseStreamResponse(line);
                if (content) {
                  onStream(content);
                }
              }
              buffer = [];
            } else {
              buffer.push(chunk[i]);
            }
          }
        }
        return null;
      } catch (streamError) {
        return null;
      } finally {
        reader.releaseLock();
      }
    } else {
      // For non-streaming response, poll the run endpoint until completion
      const pollUrl = `https://api.wordware.ai/v1/runs/${runId}`;
      let isCompleted = false;
      let result: WordwareRunResponse | null = null;

      while (!isCompleted) {
        const pollResponse = await fetch(pollUrl, {
          headers: {
            Authorization: `Bearer ${WORDWARE_API_KEY}`,
          },
        });
        if (!pollResponse.ok) {
          throw new Error(`Poll error: ${pollResponse.status}`);
        }

        const pollData = (await pollResponse.json()) as WordwareRunResponse;

        if (pollData.data?.attributes?.status === "completed") {
          isCompleted = true;
          result = pollData;
        } else if (pollData.data?.attributes?.status === "failed") {
          throw new Error("Run failed");
        } else {
          // Wait before polling again
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      return result as unknown as T;
    }
  } catch (error) {
    return null;
  }
}

/**
 * Fetches app details from the Wordware API
 * @param appId The ID of the app to fetch details for
 * @returns The app details or null if the request failed
 */
export async function fetchAppDetails(
  appId: string
): Promise<AppDetails | null> {
  try {
    const response = await fetch(`https://api.wordware.ai/v1/apps/${appId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${WORDWARE_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      return null;
    }

    const appDetails = (await response.json()) as AppDetails;
    return appDetails;
  } catch (error) {
    return null;
  }
}

/**
 * Executes a Wordware app with the given inputs
 * @param appId The ID of the app to execute
 * @param inputs The inputs to pass to the app
 * @returns The result of the execution or null if it failed
 */
export async function executeApp(
  appId: string,
  inputs: Record<string, any>
): Promise<any> {
  try {
    // Format the request body
    const requestBody = {
      version: "1.0", // Default version
      inputs: inputs || {},
    };

    // Make the API request
    const response = await makeWordwareRequest(appId, requestBody);

    if (!response || !response.data || !response.data.attributes) {
      return { error: "Failed to execute app" };
    }

    const status = response.data.attributes.status;

    if (status === "succeeded") {
      return response.data.attributes.outputs || {};
    } else {
      return {
        error: response.data.attributes.error || "Unknown error",
      };
    }
  } catch (error) {
    return { error: "Failed to execute app: " + String(error) };
  }
}

/**
 * Waits for a run to complete by polling the API
 * @param runId The ID of the run to wait for
 * @returns The outputs of the run or null if it failed
 */
async function waitForRunCompletion(runId: string): Promise<any> {
  // Initialize max retries and delay
  const MAX_RETRIES = 30;
  const DELAY_MS = 1000;
  let retryCount = 0;

  while (retryCount < MAX_RETRIES) {
    try {
      // Make request to check run status
      const response = await fetch(`https://api.wordware.ai/v1/runs/${runId}`, {
        headers: {
          Authorization: `Bearer ${WORDWARE_API_KEY}`,
        },
      });

      if (!response.ok) {
        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
        retryCount++;
        continue;
      }

      // Parse response
      const runData = (await response.json()) as RunResponse;
      const status = runData.data?.attributes?.status;

      // Check if run is complete
      if (status === "succeeded") {
        return runData.data?.attributes?.outputs || {};
      } else if (status === "failed") {
        return { error: runData.data?.attributes?.error || "Run failed" };
      }

      // If still processing, wait and retry
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      retryCount++;
    } catch (error) {
      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      retryCount++;
    }
  }

  // If we reach this point, we've exceeded max retries
  return { error: "Timeout waiting for run completion" };
}

/**
 * Executes a tool with the given parameters
 * @param {string} appId - The ID of the Wordware app to execute
 * @param {Object} params - The parameters from the schema
 * @returns {Promise<Object>} - The formatted result with content structure
 */
export async function executeTool(
  appId: string,
  params: Record<string, any>
): Promise<{ content: Array<{ type: string; text?: string; html?: string }> }> {
  try {
    // Execute the app with the provided parameters
    const result = await executeApp(appId, params);

    // Check if there was an error
    if (result.error) {
      return {
        content: [{ type: "text", text: `Error: ${result.error}` }],
      };
    }

    // Extract the actual output from nested response structures
    let cleanedResult = result;

    // Look for output in nested objects (like search results)
    if (typeof result === "object" && result !== null) {
      // Check if there's a direct output field
      if (result.output) {
        cleanedResult = result.output;
      } else {
        // Look for output in the first nested object
        const firstKey = Object.keys(result)[0];
        if (
          firstKey &&
          typeof result[firstKey] === "object" &&
          result[firstKey] !== null
        ) {
          if (result[firstKey].output) {
            cleanedResult = result[firstKey].output;
          }
        }
      }
    }

    // If the result already has a 'content' field with the right structure, use it
    if (cleanedResult.content && Array.isArray(cleanedResult.content)) {
      return { content: cleanedResult.content };
    }

    // For markdown result
    if (cleanedResult.markdown) {
      return {
        content: [{ type: "text", text: cleanedResult.markdown }],
      };
    }

    // For HTML result
    if (cleanedResult.html) {
      return {
        content: [{ type: "html", html: cleanedResult.html }],
      };
    }

    // For simple text result
    if (cleanedResult.text) {
      return {
        content: [{ type: "text", text: cleanedResult.text }],
      };
    }

    // For structured data that might need to be displayed as JSON
    if (cleanedResult.data) {
      return {
        content: [
          {
            type: "text",
            text:
              typeof cleanedResult.data === "string"
                ? cleanedResult.data
                : JSON.stringify(cleanedResult.data, null, 2),
          },
        ],
      };
    }

    // Handle string output directly
    if (typeof cleanedResult === "string") {
      return {
        content: [{ type: "text", text: cleanedResult }],
      };
    }

    // Otherwise, format the result as text content
    let responseText: string;

    // Handle different potential result types
    if (cleanedResult === null || cleanedResult === undefined) {
      responseText = "No response received from the tool.";
    } else {
      // For objects or other types, stringify
      responseText = JSON.stringify(cleanedResult, null, 2);
    }

    return {
      content: [{ type: "text", text: responseText }],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `An error occurred while executing the tool: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
    };
  }
}
