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
    if (
      line.match(/^\[.*?\] \[.*?\] \[.*?\]/) ||
      line.startsWith("INFO:") ||
      line.startsWith("DEBUG:") ||
      line.startsWith("WARN:") ||
      line.startsWith("ERROR:")
    ) {
      return null;
    }
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
    // Get the API key from environment variables at execution time
    const WORDWARE_API_KEY = process.env.WORDWARE_API_KEY;
    if (!WORDWARE_API_KEY) {
      throw new Error("WORDWARE_API_KEY environment variable is not set");
    }

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
    }

    // Parse the initial response to get the run ID and stream token
    const initialResponse = (await response.json()) as WordwareRunResponse;

    const runId = initialResponse.data?.id;
    const streamUrl = initialResponse.data?.links?.stream;

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
                } else {
                }
              } else {
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

// Updated to use new JSON-RPC API endpoint
export async function fetchAvailableTools(): Promise<any> {
  try {
    // Get the API key from environment variables
    const WORDWARE_API_KEY = process.env.WORDWARE_API_KEY;
    if (!WORDWARE_API_KEY) {
      throw new Error("WORDWARE_API_KEY environment variable is not set");
    }

    // Use the new endpoint format - direct access to RPC endpoint
    const url = `http://localhost:9000/${WORDWARE_API_KEY}/rpc`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {
          cursor: null,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Error fetching available tools: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    // console.error("Failed to fetch available tools:", error);
    return null;
  }
}

// Legacy function that now uses the new API endpoint
export async function fetchAppDetails(
  appId: string
): Promise<AppDetails | null> {
  try {
    // Call the new function to get all tools
    const toolsResponse = await fetchAvailableTools();

    if (
      !toolsResponse ||
      !toolsResponse.result ||
      !toolsResponse.result.tools
    ) {
      return null;
    }

    // Find the tool with matching name or ID
    const tool = toolsResponse.result.tools.find(
      (t: any) => t.name === appId || t.id === appId
    );

    if (!tool) {
      return null;
    }

    // Transform the tool data to match the expected AppDetails format
    return {
      data: {
        id: appId,
        type: "app",
        attributes: {
          title: tool.name,
          description: tool.description || "",
          inputSchema: tool.inputSchema || {
            type: "object",
            additionalProperties: false,
            properties: {},
            required: [],
          },
          outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {},
            required: [],
          },
        },
        links: {
          self: "",
        },
        relationships: {
          versions: {
            links: {
              related: "",
            },
          },
          latestVersion: {
            links: {
              related: "",
            },
          },
        },
      },
    };
  } catch (error) {
    // console.error("Failed to fetch app details:", error);
    return null;
  }
}

// Updated to use new API endpoint
export async function executeApp(
  toolName: string,
  inputs: Record<string, any>
): Promise<any> {
  try {
    // Get the API key from environment variables
    const WORDWARE_API_KEY = process.env.WORDWARE_API_KEY;
    if (!WORDWARE_API_KEY) {
      throw new Error("WORDWARE_API_KEY environment variable is not set");
    }

    // Use the new endpoint format with the /rpc endpoint
    const url = `http://localhost:9000/${WORDWARE_API_KEY}/rpc`;

    // Use the direct tool execution method with the tool name
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: toolName,
        params: inputs,
      }),
    });

    if (!response.ok) {
      throw new Error(`Error executing tool: ${response.status}`);
    }

    const data = await response.json();

    // Check for JSON-RPC error
    if (data.error) {
      throw new Error(`JSON-RPC error: ${data.error.message}`);
    }

    return data.result;
  } catch (error) {
    // console.error(`Failed to execute tool ${toolName}:`, error);
    throw error;
  }
}

// Updated to work with the new tools API
export async function executeTool(
  appId: string,
  params: Record<string, any>
): Promise<{ content: Array<{ type: string; text?: string; html?: string }> }> {
  try {
    const result = await executeApp(appId, params);

    // Format the response to match the expected MCP format
    return {
      content: [
        {
          type: "text",
          text:
            typeof result === "string"
              ? result
              : JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error executing tool ${appId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
    };
  }
}

// Add a health check function to test the API connection
export async function checkApiHealth(): Promise<boolean> {
  try {
    // Get the API key from environment variables
    const WORDWARE_API_KEY = process.env.WORDWARE_API_KEY;
    if (!WORDWARE_API_KEY) {
      throw new Error("WORDWARE_API_KEY environment variable is not set");
    }

    // Try both endpoints - first the worker health endpoint
    const workerHealthUrl = `http://localhost:9000/api/health`;
    try {
      const workerResponse = await fetch(workerHealthUrl);
      if (workerResponse.ok) {
        const data = await workerResponse.json();
        if (data.status === "ok") {
          // console.log("API worker health check successful");
          return true;
        }
      }
    } catch (workerError) {
      // console.error("Worker health check failed:", workerError);
    }

    // Then try the durable object health endpoint
    const doHealthUrl = `http://localhost:9000/${WORDWARE_API_KEY}/health`;
    try {
      const doResponse = await fetch(doHealthUrl);
      if (doResponse.ok) {
        const data = await doResponse.json();
        if (data.status === "ok") {
          // console.log("API durable object health check successful");
          return true;
        }
      }
    } catch (doError) {
      // console.error("Durable object health check failed:", doError);
    }

    // Both health checks failed
    return false;
  } catch (error) {
    // console.error("Health check error:", error);
    return false;
  }
}

// Add a function to test the ping method
export async function pingApi(): Promise<boolean> {
  try {
    // Get the API key from environment variables
    const WORDWARE_API_KEY = process.env.WORDWARE_API_KEY;
    if (!WORDWARE_API_KEY) {
      throw new Error("WORDWARE_API_KEY environment variable is not set");
    }

    const url = `http://localhost:9000/${WORDWARE_API_KEY}/rpc`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "ping",
      }),
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    if (data.result && data.result.status === "pong") {
      // console.log("API ping successful");
      return true;
    }

    return false;
  } catch (error) {
    // console.error("Ping error:", error);
    return false;
  }
}
