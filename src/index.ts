import './utils/dotenv-config.js';

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createSubLogger } from "./utils/logger.js";
import { fetchAppDetails, executeApp, executeTool } from "./utils/api.js";
import { writeToLogFile } from "./utils/fileLogger.js";

const log = createSubLogger("index");

// IMPORTANT: We've found that aggressively modifying schemas by removing fields
// like "description" can break client connections. The MCP protocol expects certain
// fields to be present even if we don't need them in our specific implementation.
// Instead of modifying messages, we're now focused on proper logging to understand
// the format without breaking the protocol.

// Redirect console.log to stderr to avoid interfering with JSON output
// This prevents log messages from being parsed as JSON by the MCP client
console.log = (...args) => process.stderr.write(args.join(' ') + '\n');
console.info = (...args) => process.stderr.write(args.join(' ') + '\n');
console.warn = (...args) => process.stderr.write(args.join(' ') + '\n');
console.error = (...args) => process.stderr.write(args.join(' ') + '\n');
console.debug = (...args) => process.stderr.write(args.join(' ') + '\n');

// Create server instance with proper configuration
const server = new McpServer({
  name: "wordware",
  version: "0.1.0",
});

// IMPORTANT: Patch the server to intercept tool registration and fix schema issues
const originalTool = server.tool;
server.tool = function(name, description, schema, handler) {
  log.info(`Registering tool with original parameters: ${name}`, { 
    schema: typeof schema === 'object' ? JSON.stringify(schema) : 'non-object schema'
  });
  
  // Call the original method to register the tool
  const result = originalTool.call(this, name, description, schema, handler);
  
  return result;
};

// Patch the server to intercept tool discovery messages
const originalSendNotification = (server as any)._sendNotification;
if (originalSendNotification) {
  (server as any)._sendNotification = function(method: string, params: any) {
    // Intercept and patch tools/update notifications
    if (method === 'tools/update' && params && params.tools) {
      log.info('Intercepting tools/update notification', { 
        toolCount: params.tools.length 
      });
      
      // Go through each tool and ensure it has the correct schema
      params.tools.forEach((tool: any) => {
        if (tool.name && (this as any)._toolSchemas && (this as any)._toolSchemas[tool.name]) {
          // Replace with our patched schema from _toolSchemas
          tool.schema = (this as any)._toolSchemas[tool.name];
          log.info(`Updated schema in notification for ${tool.name}`, {
            properties: Object.keys(tool.schema.properties || {})
          });
        }
      });
    }
    
    return originalSendNotification.call(this, method, params);
  };
  log.info('Patched _sendNotification method');
} else {
  log.warn('Could not find _sendNotification method to patch');
}

// Patch the server to intercept JSON-RPC responses
if ((server as any).request) {
  const originalRequest = (server as any).request as (method: string, params: any) => Promise<any>;
  (server as any).request = async function(method: string, params: any) {
    // Get the original response
    let response = await originalRequest.call(this, method, params);
    
    // Patch initialize and rpc.discover responses which contain tool information
    if ((method === 'initialize' || method === 'rpc.discover') && response && response.tools) {
      log.info(`Intercepting ${method} response`, {
        toolCount: response.tools.length
      });
      
      // Go through each tool and ensure it has the correct schema
      response.tools.forEach((tool: any) => {
        if (tool.name && (this as any)._toolSchemas && (this as any)._toolSchemas[tool.name]) {
          // Get the original schema
          const originalSchema = (this as any)._toolSchemas[tool.name];
          
          // Transform it to match the JSON-RPC format
          const transformedSchema = transformInputSchema(originalSchema, tool.name);
          
          // Update the tool schema to use the correct format
          if (transformedSchema) {
            // Ensure that the schema format matches the expected JSON-RPC response format
            // Always use inputSchema as the field name
            tool.inputSchema = transformedSchema;
            
            // Remove schema field if it exists to avoid confusion
            if (tool.schema) {
              delete tool.schema;
            }
            
            log.info(`Updated schema in ${method} response for ${tool.name}`, {
              properties: Object.keys(transformedSchema.properties || {})
            });
          }
        }
      });
      
      // Transform the entire response to match the expected format
      response = transformResponseFormat(response, method);
    }
    
    return response;
  };
  log.info('Patched request method');
} else {
  log.warn('Could not find request method to patch');
}

// Log the server object structure to understand what's happening
log.info("Server structure:", {
  keys: Object.keys(server),
  hasToolFunction: typeof server.tool === 'function',
  prototypeKeys: Object.getOwnPropertyNames(Object.getPrototypeOf(server))
});

// Inspect the internal structure of the McpServer tools
let originalTools = null;
let originalToolSchemas = null;

// Check if the server has internal properties to track tools and schemas
if ((server as any)._tools) {
  originalTools = (server as any)._tools;
  log.info("Server has _tools property", { count: Object.keys(originalTools).length });
}
if ((server as any)._toolSchemas) {
  originalToolSchemas = (server as any)._toolSchemas;
  log.info("Server has _toolSchemas property", { count: Object.keys(originalToolSchemas).length });
}

// Function to transform inputSchema to match the expected JSON-RPC format
function transformInputSchema(inputSchema: any, toolName: string): any {
  if (!inputSchema) return null;
  
  log.info(`Transforming inputSchema for ${toolName}`, {
    inputSchema: JSON.stringify(inputSchema).substring(0, 100) + '...'
  });
  
  // If the schema already has properties (but not just random_string), use those
  if (inputSchema.properties && 
      !(inputSchema.properties.random_string && Object.keys(inputSchema.properties).length === 1)) {
    
    const properties: Record<string, any> = {};
    
    // Convert each property in the original schema to the expected format (remove descriptions)
    Object.entries(inputSchema.properties).forEach(([key, value]: [string, any]) => {
      properties[key] = {
        type: value.type || "string"
        // Removed description field
      };
    });
    
    // If we have properties, use them
    if (Object.keys(properties).length > 0) {
      return {
        type: "object",
        properties: properties
      };
    }
  }
  
  // For other tools, use a default input schema
  return {
    type: "object",
    properties: {
      input: {
        type: "string"
      }
    }
  };
}

// Add a function to log the exact client-side format
function logClientToolFormat(appId: string, name: string, description: string, inputSchema: any): void {
  // Create clean properties without descriptions
  const cleanProperties: Record<string, any> = {};
  
  if (inputSchema.properties) {
    Object.entries(inputSchema.properties).forEach(([key, value]: [string, any]) => {
      cleanProperties[key] = {
        type: value.type || "string"
        // No description field
      };
    });
  }
  
  // Create an object that exactly matches what the client will receive
  const clientFormat = {
    name,
    description,
    inputSchema: {
      type: inputSchema.type || "object",
      properties: cleanProperties
    }
  };
  
  // Log to a separate file for client-format tools
  writeToLogFile(`client_tool_${appId}.log`, clientFormat);
  
  // Also log to a consolidated file
  writeToLogFile('client_tools.log', clientFormat, true);
}

// Register tools from app IDs
async function registerTools() {
  // Get app IDs directly from process.env instead of getAppIds()
  const appIdsString = process.env.APP_IDS || '';
  const APP_IDS = appIdsString
    .split(',')
    .map(id => id.trim())
    .filter(id => id.length > 0);
  
  log.info("Registering tools from app IDs", { appIds: APP_IDS });
  
  // Create a log file for all registered tools
  writeToLogFile('registered_tools.log', {
    timestamp: new Date().toISOString(),
    appIds: APP_IDS,
    message: 'Starting tool registration process'
  }, false); // Overwrite the file at the start
  
  for (const appId of APP_IDS) {
    try {
      log.info("Fetching app details for", { appId });
      
      // Fetch app details from API
      const appDetails = await fetchAppDetails(appId);
      
      if (!appDetails || !appDetails.data) {
        log.error("Failed to fetch app details", { appId });
        
        // Log the registration failure
        writeToLogFile('registered_tools.log', {
          timestamp: new Date().toISOString(),
          appId,
          status: 'failed',
          reason: 'Failed to fetch app details'
        });
        
        continue;
      }
      
      const { title, description, inputSchema } = appDetails.data.attributes;
      
      // Format the tool name to ensure MCP compatibility
      // Make sure it follows the pattern ^[a-zA-Z0-9_-]{1,64}$
      let formattedTitle = title.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
      
      // Log the tool info before registration
      writeToLogFile('registered_tools.log', {
        timestamp: new Date().toISOString(),
        appId,
        status: 'processing',
        originalTitle: title,
        formattedTitle,
        description,
        // Only include type and properties for consistency
        inputSchema: {
          type: inputSchema?.type || "object",
          properties: inputSchema?.properties || {}
        }
      });
      
      
      
      log.info("Registering tool", { originalTitle: title, formattedTitle, appId });
      
      // Ensure the input schema has the correct format for MCP
      let formattedSchema = inputSchema;
      
      // If the schema is not well-formed, create a default one
      if (!formattedSchema || !formattedSchema.type || !formattedSchema.properties) {
        formattedSchema = {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Input for the tool"
            }
          },
          required: ["query"],
          additionalProperties: false
        };
        
        // Log the schema creation
        writeToLogFile('registered_tools.log', {
          timestamp: new Date().toISOString(),
          appId,
          status: 'schema_created',
          reason: 'Original schema was invalid or missing',
          createdSchema: {
            type: "object",
            properties: {
              query: {
                type: "string"
                // Removed description
              }
            }
          }
        });
      }
      
      // Make sure required and additionalProperties are present
      if (!formattedSchema.required || !Array.isArray(formattedSchema.required) || formattedSchema.required.length === 0) {
        formattedSchema.required = Object.keys(formattedSchema.properties || {});
        
        // No need to log this modification since we don't want to include required fields
      }
      if (formattedSchema.additionalProperties === undefined) {
        formattedSchema.additionalProperties = false;
        
        // No need to log this modification since we don't want to include additionalProperties field
      }
      
      // Transform the schema to match the expected JSON-RPC format
      const transformedSchema = transformInputSchema(formattedSchema, formattedTitle);
      
      // Log the schema transformation
      writeToLogFile('registered_tools.log', {
        timestamp: new Date().toISOString(),
        appId,
        status: 'schema_transformed',
        formattedTitle,
        inputSchema: transformedSchema // Keep only the inputSchema
      });
      
      log.info("Using formatted schema", { 
        formattedTitle,
        schemaProperties: Object.keys(formattedSchema.properties || {}),
        transformedSchema: transformedSchema ? JSON.stringify(transformedSchema).substring(0, 100) + '...' : 'null'
      });
      
      try {
        // Prepare a clean schema without additionalProperties and required fields
        const cleanSchema = Object.entries(formattedSchema.properties || {}).reduce((acc: Record<string, any>, [key, prop]: [string, any]) => {
          // Map JSON schema types to zod types
          if (prop.type === "string") {
            acc[key] = z.string().describe(prop.description || "string input for the tool"); // provides a default description as no description exists for input parameters yet
          } else if (prop.type === "number") {
            acc[key] = z.number().describe(prop.description || "number input for the tool");
          } else if (prop.type === "boolean") {
            acc[key] = z.boolean().describe(prop.description || "boolean input for the tool");
          } else {
            // Default to string for unknown types
            acc[key] = z.string().describe(prop.description || "string input for the tool");
          }
          return acc;
        }, {});

        // Log the resulting schema for debugging
        log.info("cleanSchema created with Zod:", {
          keys: Object.keys(cleanSchema),
          sample: JSON.stringify(cleanSchema).substring(0, 100) + '...'
        });

        // Register the tool with the MCP server
        server.tool(
          formattedTitle,
          description,
          cleanSchema, // Use the clean schema without additionalProperties and required
          async (params: any) => {
            try {
              // Execute the tool with the given parameters
              log.info("Executing tool", { title: formattedTitle, params });
              
              // Ensure params is an object
              const safeParams = typeof params === 'object' && params !== null 
                ? params 
                : {};
              
              log.info("Using parameters", { 
                title: formattedTitle, 
                params: JSON.stringify(safeParams)
              });
              
              // Use the new executeTool function which properly formats responses
              return await executeTool(appId, safeParams);
            } catch (error) {
              log.error("Error in tool handler", { title: formattedTitle, error });
              
              // Return a user-friendly error message rather than throwing
              return {
                content: [
                  {
                    type: "text",
                    text: `Error in ${formattedTitle} handler: ${error instanceof Error ? error.message : String(error)}`
                  }
                ]
              };
            }
          }
        );
        
        // Log the successful registration with internal metadata
        writeToLogFile('registered_tools.log', {
          timestamp: new Date().toISOString(),
          appId,
          status: 'registered_success',
          formattedTitle,
          description: description.substring(0, 100) + (description.length > 100 ? '...' : '')
        });
        
        // Log the exact client-side format
        logClientToolFormat(appId, formattedTitle, description, transformedSchema);
        
        log.info("Tool registered successfully", { title: formattedTitle });
      } catch (error) {
        log.error("Error registering tool with MCP server", { 
          title: formattedTitle, 
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
        
        // Log the registration error
        writeToLogFile('registered_tools.log', {
          timestamp: new Date().toISOString(),
          appId,
          status: 'registration_error',
          formattedTitle,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
      }
    } catch (error) {
      log.error("Error registering tool", { appId, error });
      
      // Log the registration error
      writeToLogFile('registered_tools.log', {
        timestamp: new Date().toISOString(),
        appId,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }
  
  // Log the completion of registration
  writeToLogFile('registered_tools.log', {
    timestamp: new Date().toISOString(),
    status: 'registration_completed',
    totalTools: (server as any)._tools ? Object.keys((server as any)._tools).length : 0
  });
}

// Patch the StdioServerTransport to intercept and log outgoing messages
// This will let us verify what's actually being sent to the client
let originalSend: Function | null = null;

// Helper function to intercept and log stdio messages
function patchTransport(transport: any) {
  try {
    if (transport && transport.send && typeof transport.send === 'function') {
      log.info('Patching StdioServerTransport.send method for logging only');
      originalSend = transport.send;
      
      transport.send = function(message: string) {
        try {
          // Try to parse the message to see if it contains tools
          const parsed = JSON.parse(message);
          
          if (parsed && 
              ((parsed.method === 'tools/update' && parsed.params?.tools) || 
               (parsed.result?.tools))) {
            
            const tools = parsed.params?.tools || parsed.result?.tools;
            
            if (Array.isArray(tools) && tools.length > 0) {
              log.info(`OUTGOING STDIO MESSAGE WITH TOOLS (${tools.length})`, {
                method: parsed.method || 'response',
                toolSample: JSON.stringify(tools[0]).substring(0, 300) + '...',
                hasInputSchema: tools[0].inputSchema !== undefined,
                schemaProperties: tools[0].inputSchema ? Object.keys(tools[0].inputSchema.properties || {}) : []
              });
              
              // Log the full message to verify format
              writeToLogFile('stdio_outgoing_tools.log', {
                timestamp: new Date().toISOString(),
                message: parsed
              });
            }
          }
        } catch (error) {
          // Not JSON or other error, ignore
        }
        
        // Call the original send method - don't modify the message!
        const sendFn = originalSend as Function;
        return sendFn.call(this, message);
      };
      
      log.info('Successfully patched StdioServerTransport.send method');
      return true;
    }
  } catch (error) {
    log.error('Error patching StdioServerTransport', { error });
  }
  
  return false;
}

// Clean all registered tool schemas at once
function cleanAllRegisteredTools() {
  // This function is removed - it was aggressively modifying schemas
  log.info("cleanAllRegisteredTools is disabled to avoid breaking client connections");
  return;
}

// Patch the server's registerTool method to log tools as they're registered
function patchRegisterTool() {
  // This function is removed - it was interfering with tool registration
  log.info("patchRegisterTool is disabled to avoid breaking client connections");
  return;
}

// In the patchRequest function, add special handling for rpc.discover responses
function patchRequest() {
  // This function is removed - it was changing rpc.discover responses
  log.info("patchRequest is disabled to avoid breaking client connections");
  return;
}

// Start the server
export async function main() {
  try {
    // Register tools before connecting
    await registerTools();
    
    // Log the final state of tools before connecting
    if ((server as any)._tools) {
      log.info("Final tool count before connecting", { 
        count: Object.keys((server as any)._tools).length,
        toolNames: Object.keys((server as any)._tools)
      });
    }
    
    if ((server as any)._toolSchemas) {
      log.info("Final tool schemas before connecting", { 
        count: Object.keys((server as any)._toolSchemas).length,
        schemaList: Object.entries((server as any)._toolSchemas).map(([name, schema]) => ({
          name,
          schema: JSON.stringify(schema).substring(0, 300) + '...' // Truncate for logging
        }))
      });
    }
    
    log.info("Starting MCP server with stdio transport");
    
    // Use the stdio transport to communicate with the client
    const transport = new StdioServerTransport();

    // Patch the transport to log outgoing messages, but don't modify messages
    const patchSuccess = patchTransport(transport);
    log.info(`Transport patch ${patchSuccess ? 'succeeded' : 'failed'}`);
    
    // Don't patch server.connect, use original implementation
    await server.connect(transport);
    
    log.info("Server running");
  } catch (error) {
    log.error("Fatal error in main()", { error });
  }
}

main().catch((error) => {
  log.error("Unhandled error in main()", { error });
});

// Add another export for the Cloudflare worker
export default {
  async fetch(request: Request, env: any) {
    // This is just a placeholder since the Worker functionality
    // is implemented in worker.ts
    return new Response("MCP Server is running, use the standard HTTP endpoint instead", {
      headers: { "Content-Type": "text/plain" }
    });
  }
};

// Function to transform the entire response to match the expected JSON-RPC 2.0 format
function transformResponseFormat(response: any, method: string): any {
  if (!response || !response.tools || !Array.isArray(response.tools)) {
    return response;
  }
  
  log.info(`Transforming entire response for ${method}`, {
    originalFormat: Object.keys(response)
  });
  
  // Create a properly formatted JSON-RPC 2.0 response
  const formattedResponse = {
    jsonrpc: "2.0",
    id: 1, // This should ideally match the request ID
    result: {
      tools: response.tools.map((tool: any) => {
        const toolName = tool.name || tool.id;
        
        // Get the tool's input schema
        let schema = tool.schema || tool.inputSchema || {
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
          Object.entries(schema.properties).forEach(([key, value]: [string, any]) => {
            cleanProperties[key] = {
              type: (value as any).type || "string"
              // No description field
            };
          });
        }
        
        return {
          name: toolName,
          description: tool.description || "",
          // Always use inputSchema as the field name, and exclude additionalProperties and required fields
          // inputSchema: {
          //   type: schema.type || "object",
          //   properties: cleanProperties
          // }
          input: {
            type: "object",
            properties: {
              location: {
                type: "string",
                description: "The location of the tool"
              }
            }
          }
        };
      }),
      nextCursor: response.nextCursor || null
    }
  };
  
  // Final safety check - go through all tools and ensure they only have inputSchema with type and properties
  formattedResponse.result.tools.forEach((tool: any) => {
    if (tool.inputSchema) {
      // Make sure there's only type and properties, and remove descriptions from properties
      const cleanProperties: Record<string, any> = {};
      
      if (tool.inputSchema.properties) {
        Object.entries(tool.inputSchema.properties).forEach(([key, value]: [string, any]) => {
          cleanProperties[key] = {
            type: (value as any).type || "string"
            // No description field
          };
        });
      }
      
      const cleanSchema = {
        type: tool.inputSchema.type || "object",
        properties: cleanProperties
      };
      tool.inputSchema = cleanSchema;
    }
    
    // Delete any other schema-related fields
    if (tool.schema) delete tool.schema;
    if (tool.parameters) delete tool.parameters;
    
    // Log the exact client-side format for this tool
    writeToLogFile('client_response_tools.log', {
      name: tool.name,
      description: tool.description || "",
      inputSchema: tool.inputSchema
    });
  });
  
  log.info(`Response transformed to JSON-RPC 2.0 format`, {
    toolCount: formattedResponse.result.tools.length,
    sampleTool: formattedResponse.result.tools.length > 0 
      ? JSON.stringify(formattedResponse.result.tools[0]).substring(0, 200) + '...' 
      : 'No tools'
  });
  
  // Also log the complete client response for reference
  writeToLogFile('client_full_response.log', formattedResponse);
  
  return formattedResponse;
}
