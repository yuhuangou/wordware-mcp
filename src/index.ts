#!/usr/bin/env node
import "./utils/dotenv-config.js";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  fetchAppDetails,
  executeApp,
  executeTool,
  fetchAvailableTools,
  checkApiHealth,
  pingApi,
} from "./utils/api.js";

// Create server instance with proper configuration
const server = new McpServer({
  name: "wordware",
  version: "0.1.0",
});

// Patch the server to intercept tool registration and fix schema issues
const originalTool = server.tool;
server.tool = function (name, description, schema, handler) {
  // Call the original method to register the tool
  const result = originalTool.call(this, name, description, schema, handler);

  return result;
};

// Patch the server to intercept tool discovery messages
const originalSendNotification = (server as any)._sendNotification;
if (originalSendNotification) {
  (server as any)._sendNotification = function (method: string, params: any) {
    // Intercept and patch tools/update notifications
    if (method === "tools/update" && params && params.tools) {
      // Go through each tool and ensure it has the correct schema
      params.tools.forEach((tool: any) => {
        if (
          tool.name &&
          (this as any)._toolSchemas &&
          (this as any)._toolSchemas[tool.name]
        ) {
          // Replace with our patched schema from _toolSchemas
          tool.schema = (this as any)._toolSchemas[tool.name];
        }
      });
    }

    return originalSendNotification.call(this, method, params);
  };
}

// Patch the server to intercept JSON-RPC responses
if ((server as any).request) {
  const originalRequest = (server as any).request as (
    method: string,
    params: any
  ) => Promise<any>;
  (server as any).request = async function (method: string, params: any) {
    // Get the original response
    let response = await originalRequest.call(this, method, params);

    // Patch initialize and rpc.discover responses which contain tool information
    if (
      (method === "initialize" || method === "rpc.discover") &&
      response &&
      response.tools
    ) {
      // Go through each tool and ensure it has the correct schema
      response.tools.forEach((tool: any) => {
        if (
          tool.name &&
          (this as any)._toolSchemas &&
          (this as any)._toolSchemas[tool.name]
        ) {
          // Get the original schema
          const originalSchema = (this as any)._toolSchemas[tool.name];

          // Transform it to match the JSON-RPC format
          const transformedSchema = transformInputSchema(
            originalSchema,
            tool.name
          );

          // Update the tool schema to use the correct format
          if (transformedSchema) {
            // Ensure that the schema format matches the expected JSON-RPC response format
            // Always use inputSchema as the field name
            tool.inputSchema = transformedSchema;

            // Remove schema field if it exists to avoid confusion
            if (tool.schema) {
              delete tool.schema;
            }
          }
        }
      });

      // Transform the entire response to match the expected format
      response = transformResponseFormat(response, method);
    }

    return response;
  };
}

// Inspect the internal structure of the McpServer tools
let originalTools = null;
let originalToolSchemas = null;

// Check if the server has internal properties to track tools and schemas
if ((server as any)._tools) {
  originalTools = (server as any)._tools;
}
if ((server as any)._toolSchemas) {
  originalToolSchemas = (server as any)._toolSchemas;
}

// Function to transform inputSchema to match the expected JSON-RPC format
function transformInputSchema(inputSchema: any, toolName: string): any {
  if (!inputSchema) return null;

  // If the schema already has properties (but not just random_string), use those
  if (
    inputSchema.properties &&
    !(
      inputSchema.properties.random_string &&
      Object.keys(inputSchema.properties).length === 1
    )
  ) {
    const properties: Record<string, any> = {};

    // Convert each property in the original schema to the expected format (remove descriptions)
    Object.entries(inputSchema.properties).forEach(
      ([key, value]: [string, any]) => {
        properties[key] = {
          type: value.type || "string",
          // Removed description field
        };
      }
    );

    // If we have properties, use them
    if (Object.keys(properties).length > 0) {
      return {
        type: "object",
        properties: properties,
      };
    }
  }

  // For other tools, use a default input schema
  return {
    type: "object",
    properties: {
      input: {
        type: "string",
      },
    },
  };
}

// Add a function to log the exact client-side format
function logClientToolFormat(
  appId: string,
  name: string,
  description: string,
  inputSchema: any
): void {
  // Create clean properties without descriptions
  const cleanProperties: Record<string, any> = {};

  if (inputSchema.properties) {
    Object.entries(inputSchema.properties).forEach(
      ([key, value]: [string, any]) => {
        cleanProperties[key] = {
          type: value.type || "string",
          // No description field
        };
      }
    );
  }

  // Create an object that exactly matches what the client will receive
  const clientFormat = {
    name,
    description,
    inputSchema: {
      type: inputSchema.type || "object",
      properties: cleanProperties,
    },
  };
}

// Register tools from the API
export async function registerTools() {
  try {
    // Fetch available tools from the new endpoint
    const toolsResponse = await fetchAvailableTools();

    if (
      !toolsResponse ||
      !toolsResponse.result ||
      !toolsResponse.result.tools ||
      !Array.isArray(toolsResponse.result.tools)
    ) {
      // console.error(
      //   "Failed to fetch available tools or invalid response format"
      // );
      return;
    }

    // Process each tool from the API response
    for (const tool of toolsResponse.result.tools) {
      try {
        // Check if the tool has the required name
        if (!tool.name) {
          // console.error("Tool missing name property, skipping");
          continue;
        }

        // Format the tool name to ensure MCP compatibility
        // Make sure it follows the pattern ^[a-zA-Z0-9_-]{1,64}$
        let formattedTitle = tool.name
          .replace(/\s+/g, "_")
          .replace(/[^a-zA-Z0-9_-]/g, "");

        const description = tool.description || "";

        // Get the input schema from the tool
        let formattedSchema = tool.inputSchema || {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Input for the tool",
            },
          },
          required: ["query"],
          additionalProperties: false,
        };

        // Add required field if missing
        if (!formattedSchema.required) {
          formattedSchema.required = Object.keys(
            formattedSchema.properties || {}
          );
        }

        // Add additionalProperties if missing
        if (formattedSchema.additionalProperties === undefined) {
          formattedSchema.additionalProperties = false;
        }

        // Transform the schema to match the expected JSON-RPC format
        const transformedSchema = transformInputSchema(
          formattedSchema,
          formattedTitle
        );

        try {
          // Prepare a clean schema for zod
          const cleanSchema = Object.entries(
            formattedSchema.properties || {}
          ).reduce((acc: Record<string, any>, [key, prop]: [string, any]) => {
            // Map JSON schema types to zod types
            if (prop.type === "string") {
              acc[key] = z
                .string()
                .describe(prop.description || "string input for the tool");
            } else if (prop.type === "number") {
              acc[key] = z
                .number()
                .describe(prop.description || "number input for the tool");
            } else if (prop.type === "boolean") {
              acc[key] = z
                .boolean()
                .describe(prop.description || "boolean input for the tool");
            } else {
              // Default to string for unknown types
              acc[key] = z
                .string()
                .describe(prop.description || "string input for the tool");
            }
            return acc;
          }, {});

          // Register the tool with the MCP server
          server.tool(
            formattedTitle,
            description,
            cleanSchema, // Use the clean schema without additionalProperties and required
            async (params: any) => {
              try {
                // Execute the tool with the given parameters
                // Ensure params is an object
                const safeParams =
                  typeof params === "object" && params !== null ? params : {};

                // Use the executeTool function which properly formats responses
                // Pass the original tool name
                return await executeTool(tool.name, safeParams);
              } catch (error) {
                // Return a user-friendly error message rather than throwing
                return {
                  content: [
                    {
                      type: "text",
                      text: `Error in ${formattedTitle} handler: ${
                        error instanceof Error ? error.message : String(error)
                      }`,
                    },
                  ],
                };
              }
            }
          );

          // Log the exact client-side format
          logClientToolFormat(
            tool.name,
            formattedTitle,
            description,
            transformedSchema
          );
        } catch (error) {
          // console.error(`Failed to register tool ${formattedTitle}:`, error);
        }
      } catch (error) {
        // console.error("Error processing tool:", error);
      }
    }
  } catch (error) {
    // console.error("Failed to register tools:", error);
  }
}

// Patch the StdioServerTransport to intercept and log outgoing messages
// This will let us verify what's actually being sent to the client
let originalSend: Function | null = null;

// Helper function to intercept and log stdio messages
function patchTransport(transport: any) {
  try {
    if (transport && transport.send && typeof transport.send === "function") {
      originalSend = transport.send;

      transport.send = function (message: string) {
        try {
          // Try to parse the message to see if it contains tools
          const parsed = JSON.parse(message);

          if (
            parsed &&
            ((parsed.method === "tools/update" && parsed.params?.tools) ||
              parsed.result?.tools)
          ) {
            // All logging removed
          }
        } catch (error) {
          // Not JSON or other error, ignore
        }

        // Call the original send method - don't modify the message!
        const sendFn = originalSend as Function;
        return sendFn.call(this, message);
      };

      return true;
    }
  } catch (error) {
    // Error handling is kept but logging removed
  }

  return false;
}

// Clean all registered tool schemas at once
function cleanAllRegisteredTools() {
  // This function is removed - it was aggressively modifying schemas
  return;
}

// Patch the server's registerTool method to log tools as they're registered
function patchRegisterTool() {
  // This function is removed - it was interfering with tool registration
  return;
}

// In the patchRequest function, add special handling for rpc.discover responses
function patchRequest() {
  // This function is removed - it was changing rpc.discover responses
  return;
}

// Start the server
export async function main() {
  try {
    // console.log("Starting Wordware MCP Server...");

    // Check API health before attempting to register tools
    const isApiHealthy = await checkApiHealth();
    if (!isApiHealthy) {
      // console.log("Attempting to ping API...");
      const pingSuccess = await pingApi();

      if (!pingSuccess) {
        // console.error(
        //   "⚠️ Warning: API health check failed. The MCP server will still start, but tools may not be available."
        // );
        // console.error(
        //   "Make sure the API is running at http://localhost:9000 and your API key is valid."
        // );
        // console.error(
        //   "You can still start the MCP server, but it may not work correctly."
        // );
      }
    }

    // Register tools before connecting
    // console.log("Registering tools...");
    await registerTools();

    // Use the stdio transport to communicate with the client
    const transport = new StdioServerTransport();

    // Patch the transport to log outgoing messages, but don't modify messages
    const patchSuccess = patchTransport(transport);

    // Don't patch server.connect, use original implementation
    // console.log("Connecting to transport...");
    await server.connect(transport);
    // console.log("MCP Server started successfully");
  } catch (error) {
    // console.error("Error starting MCP server:", error);
  }
}

main().catch((error) => {
  // Error handling is kept but logging removed
});

// Add another export for the Cloudflare worker
export default {
  async fetch(request: Request, env: any) {
    // This is just a placeholder since the Worker functionality
    // is implemented in worker.ts
    return new Response(
      "MCP Server is running, use the standard HTTP endpoint instead",
      {
        headers: { "Content-Type": "text/plain" },
      }
    );
  },
};

// Function to transform the entire response to match the expected JSON-RPC 2.0 format
function transformResponseFormat(response: any, method: string): any {
  if (!response || !response.tools || !Array.isArray(response.tools)) {
    return response;
  }

  // Create a properly formatted JSON-RPC 2.0 response
  const formattedResponse = {
    jsonrpc: "2.0",
    id: 1, // This should ideally match the request ID
    result: {
      tools: response.tools.map((tool: any) => {
        const toolName = tool.name || tool.id;

        // Get the tool's input schema
        let schema = tool.schema ||
          tool.inputSchema || {
            type: "object",
            properties: {},
          };

        // If there's a schema.parameters structure, that's the actual schema
        if (tool.schema && tool.schema.parameters) {
          schema = tool.schema.parameters;
        }

        // Format according to MCP spec
        const cleanProperties: Record<string, any> = {};

        // Remove descriptions from properties
        if (schema.properties) {
          Object.entries(schema.properties).forEach(
            ([key, value]: [string, any]) => {
              cleanProperties[key] = {
                type: (value as any).type || "string",
                // No description field
              };
            }
          );
        }

        return {
          name: toolName,
          description: tool.description || "",
          // Always use inputSchema as the field name, and exclude additionalProperties and required fields
          inputSchema: {
            type: schema.type || "object",
            properties: cleanProperties,
          },
        };
      }),
      nextCursor: response.nextCursor || null,
    },
  };

  // Final safety check - go through all tools and ensure they only have inputSchema with type and properties
  formattedResponse.result.tools.forEach((tool: any) => {
    if (tool.inputSchema) {
      // Make sure there's only type and properties, and remove descriptions from properties
      const cleanProperties: Record<string, any> = {};

      if (tool.inputSchema.properties) {
        Object.entries(tool.inputSchema.properties).forEach(
          ([key, value]: [string, any]) => {
            cleanProperties[key] = {
              type: (value as any).type || "string",
              // No description field
            };
          }
        );
      }

      const cleanSchema = {
        type: tool.inputSchema.type || "object",
        properties: cleanProperties,
      };
      tool.inputSchema = cleanSchema;
    } else if (!tool.inputSchema) {
      // If no inputSchema exists, create a default one
      tool.inputSchema = {
        type: "object",
        properties: {},
      };
    }

    // Delete any other schema-related fields
    if (tool.schema) delete tool.schema;
    if (tool.parameters) delete tool.parameters;
  });

  return formattedResponse;
}
