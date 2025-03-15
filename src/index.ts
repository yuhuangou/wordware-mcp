import './utils/dotenv-config.js';

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createSubLogger } from "./utils/logger.js";
import { fetchAppDetails, executeApp } from "./utils/api.js";

const log = createSubLogger("index");

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
  
  // After registration, patch the internal schema if needed
  if ((this as any)._toolSchemas && (this as any)._toolSchemas[name]) {
    log.info(`Tool registered, checking schema for ${name}`);
    const storedSchema = (this as any)._toolSchemas[name];
    
    // Check if the schema has been transformed to use random_string
    if (storedSchema && 
        storedSchema.properties && 
        storedSchema.properties.random_string && 
        (!schema.properties || !schema.properties.random_string)) {
      
      log.info(`Detected random_string transformation in ${name}, fixing schema`);
      
      // Get the original properties from our schema
      const originalProperties = schema.properties || {};
      const originalPropertyNames = Object.keys(originalProperties);
      
      if (originalPropertyNames.length > 0) {
        // Replace the random_string with our original properties
        (this as any)._toolSchemas[name] = {
          ...storedSchema,
          properties: originalProperties,
          required: schema.required || originalPropertyNames
        };
        
        log.info(`Fixed schema for ${name}`, { 
          fixed: JSON.stringify((this as any)._toolSchemas[name])
        });
      }
    }
  }
  
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
            tool.inputSchema = transformedSchema;
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
    originalSchema: JSON.stringify(inputSchema).substring(0, 100) + '...'
  });
  
  // If the schema already has properties (but not just random_string), use those
  if (inputSchema.properties && 
      !(inputSchema.properties.random_string && Object.keys(inputSchema.properties).length === 1)) {
    
    const properties: Record<string, any> = {};
    
    // Convert each property in the original schema to the expected format
    Object.entries(inputSchema.properties).forEach(([key, value]: [string, any]) => {
      // Skip the random_string parameter if it exists
      if (key === "random_string") {
        return;
      }
      
      properties[key] = {
        type: value.type || "string",
        description: value.description || `Input parameter ${key}`
      };
    });
    
    // If we have properties, use them
    if (Object.keys(properties).length > 0) {
      return {
        type: "object",
        properties: properties,
        required: inputSchema.required?.filter((r: string) => r !== "random_string") || Object.keys(properties)
      };
    }
  }
  
  // Handle special case for random_string or empty properties
  
  // For Google Search, use the actual Google Search schema
  if (toolName.includes("Google_Search")) {
    return {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query for Google"
        }
      },
      required: ["query"]
    };
  }
  
  // For LinkedIn Profile, use the actual LinkedIn Profile schema
  if (toolName.includes("LinkedIn_Profile")) {
    return {
      type: "object",
      properties: {
        profile_url: {
          type: "string",
          description: "LinkedIn profile URL to fetch data from"
        }
      },
      required: ["profile_url"]
    };
  }
  
  // For other tools, use a default input schema
  return {
    type: "object",
    properties: {
      input: {
        type: "string",
        description: "Input for the tool"
      }
    },
    required: ["input"]
  };
}

// Register tools from app IDs
async function registerTools() {
  // Get app IDs directly from process.env instead of getAppIds()
  const appIdsString = process.env.APP_IDS || '';
  const APP_IDS = appIdsString
    .split(',')
    .map(id => id.trim())
    .filter(id => id.length > 0);
  
  // Include default test IDs if needed
  if (APP_IDS.length === 0) {
    APP_IDS.push(
      "f41a2109-2f79-4cd0-9d45-70d9f8bf71ed",
      "b9b9967e-5f18-4bd1-ad5b-dd5e71909fd5"
    );
  }
  
  log.info("Registering tools from app IDs", { appIds: APP_IDS });
  
  for (const appId of APP_IDS) {
    try {
      log.info("Fetching app details for", { appId });
      
      // Fetch app details from API
      const appDetails = await fetchAppDetails(appId);
      
      if (!appDetails || !appDetails.data) {
        log.error("Failed to fetch app details", { appId });
        continue;
      }
      
      const { title, description, inputSchema } = appDetails.data.attributes;
      
      // Format the tool name to ensure MCP compatibility
      // Make sure it follows the pattern ^[a-zA-Z0-9_-]{1,64}$
      let formattedTitle = title.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
      
      // Special handling for Google Search tool
      if (title.toLowerCase().includes('google') && title.toLowerCase().includes('search')) {
        formattedTitle = "Google_Search";
        log.info("Special handling for Google Search tool", { 
          originalTitle: title, 
          formattedTitle
        });
        
        // Use a properly formatted JSON schema for Google Search
        const googleSearchSchema = {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query for Google"
            }
          },
          required: ["query"],
          additionalProperties: false
        };
        
        log.info("Using custom schema for Google Search");
        
        try {
          // Register the Google Search tool with our custom schema
          server.tool(
            formattedTitle,
            "Give your agent the power to query Google.",
            googleSearchSchema,
            async (params: any) => {
              try {
                log.info("Executing Google Search tool", { params });
                
                // Ensure params is an object with a query
                const safeParams = typeof params === 'object' && params !== null 
                  ? params 
                  : {};
                
                // Make sure we have a query parameter
                const query = safeParams.query || "No query provided";
                
                log.info("Google Search query", { query });
                
                // Execute the app using the Wordware API
                const result = await executeApp(appId, { query });
                
                if (!result) {
                  throw new Error(`Failed to execute Google Search`);
                }
                
                return result;
              } catch (error) {
                log.error("Error in Google Search tool", { error });
                
                return {
                  content: [
                    {
                      type: "text",
                      text: `Error in Google Search: ${error instanceof Error ? error.message : String(error)}`
                    }
                  ]
                };
              }
            }
          );
          
          log.info("Google Search tool registered successfully");
          
          // Skip the regular tool registration process
          continue;
        } catch (error) {
          log.error("Error registering Google Search tool", { error });
          // Fall through to regular registration if special handling fails
        }
      }
      
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
      }
      
      // Make sure required and additionalProperties are present
      if (!formattedSchema.required || !Array.isArray(formattedSchema.required) || formattedSchema.required.length === 0) {
        formattedSchema.required = Object.keys(formattedSchema.properties || {});
      }
      if (formattedSchema.additionalProperties === undefined) {
        formattedSchema.additionalProperties = false;
      }
      
      // Transform the schema to match the expected JSON-RPC format
      const transformedSchema = transformInputSchema(formattedSchema, formattedTitle);
      
      log.info("Using formatted schema", { 
        formattedTitle,
        schemaProperties: Object.keys(formattedSchema.properties || {}),
        transformedSchema: transformedSchema ? JSON.stringify(transformedSchema).substring(0, 100) + '...' : 'null'
      });
      
      try {
        // Register the tool with the MCP server
        server.tool(
          formattedTitle,
          description,
          formattedSchema, // Use the original formatted schema for registration
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
              
              try {
                // Execute the app using the Wordware API
                const result = await executeApp(appId, safeParams);
                
                if (!result) {
                  throw new Error(`Failed to execute app ${formattedTitle}`);
                }
                
                log.info("Tool execution successful", { 
                  title: formattedTitle, 
                  resultType: typeof result
                });
                
                return result;
              } catch (error) {
                log.error("Error executing app", { 
                  title: formattedTitle, 
                  error: error instanceof Error ? error.message : String(error),
                  stack: error instanceof Error ? error.stack : undefined
                });
                
                // Return a user-friendly error message
                return {
                  content: [
                    {
                      type: "text",
                      text: `Error executing ${formattedTitle}: ${error instanceof Error ? error.message : String(error)}`
                    }
                  ]
                };
              }
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
        
        log.info("Tool registered successfully", { title: formattedTitle });
      } catch (error) {
        log.error("Error registering tool with MCP server", { 
          title: formattedTitle, 
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
      }
    } catch (error) {
      log.error("Error registering tool", { appId, error });
    }
  }
}

// Start the server
async function main() {
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
    
    // We can't modify the transport directly, so we'll add a custom handler to the server
    const originalConnect = server.connect;
    server.connect = async function(transport) {
      log.info("Server connecting to transport");
      
      // Patch the server's request method to intercept responses
      if ('request' in server) {
        const originalRequest = server.request as (method: string, params: any) => Promise<any>;
        server.request = async function(method: string, params: any) {
          const response = await originalRequest.call(this, method, params);
          
          // Intercept responses that might contain tool information
          if ((method === 'initialize' || method === 'rpc.discover') && response && response.tools) {
            log.info(`Intercepted ${method} response with ${response.tools.length} tools`);
            
            // Process each tool to ensure correct schema format
            for (let i = 0; i < response.tools.length; i++) {
              const tool = response.tools[i];
              const toolName = tool.name || tool.id;
              
              // Transform tool structure to match JSON-RPC 2.0 format
              if (tool.schema && tool.schema.parameters) {
                log.info(`Transforming tool structure for ${toolName}`);
                
                // Save the current schema parameters
                const schemaParams = tool.schema.parameters;
                
                // Make sure the properties object is valid
                if (!schemaParams.properties || typeof schemaParams.properties !== 'object') {
                  schemaParams.properties = {};
                }
                
                // Handle case where we have random_string parameter
                if (schemaParams.properties && schemaParams.properties.random_string) {
                  log.info(`Found random_string parameter in ${toolName}, replacing with proper schema`);
                  
                  // Use the transformInputSchema function to get the proper schema
                  const properSchema = transformInputSchema({ 
                    type: "object", 
                    properties: schemaParams.properties,
                    required: schemaParams.required
                  }, toolName);
                  
                  // Copy over the transformed properties
                  schemaParams.properties = properSchema.properties;
                  schemaParams.required = properSchema.required;
                }
                
                // Ensure all properties have type and description
                for (const [propName, propValue] of Object.entries(schemaParams.properties)) {
                  const typedPropValue = propValue as any;
                  if (!typedPropValue.type) {
                    typedPropValue.type = "string";
                  }
                  if (!typedPropValue.description) {
                    typedPropValue.description = `Parameter: ${propName}`;
                  }
                }
                
                // Create the proper JSON-RPC 2.0 tool format with inputSchema
                tool.inputSchema = {
                  type: schemaParams.type || "object",
                  properties: schemaParams.properties || {},
                  required: schemaParams.required || Object.keys(schemaParams.properties || {})
                };
                
                // Remove the old schema format if we successfully created a new inputSchema
                if (tool.inputSchema) {
                  delete tool.schema;
                }
              }
            }
            
            // Finally, transform the entire response to the proper JSON-RPC 2.0 format
            return transformResponseFormat(response, method);
          }
          
          return response;
        };
        
        log.info('Successfully patched server request method to intercept responses');
      } else {
        log.warn('Could not patch server request method - request method not available');
      }
      
      // Fix any tool schemas before connecting
      if ((server as any)._toolSchemas) {
        log.info("Checking tool schemas before connecting");
        
        // Get all tool names
        const toolNames = Object.keys((server as any)._toolSchemas);
        
        for (const toolName of toolNames) {
          const schema = (server as any)._toolSchemas[toolName];
          
          // Check if this schema has only random_string parameter
          if (schema.properties && 
              schema.properties.random_string && 
              Object.keys(schema.properties).length === 1) {
            
            log.info(`Tool ${toolName} has only random_string, replacing with proper schema`);
            
            // Get proper schema for this tool
            const properSchema = transformInputSchema(schema, toolName);
            
            // Replace the schema
            (server as any)._toolSchemas[toolName] = properSchema;
            
            log.info(`Replaced schema for ${toolName}`, { 
              newProperties: Object.keys(properSchema.properties) 
            });
          }
        }
      }
      
      // Capture any tool schemas being exposed
      if ((server as any)._toolSchemas) {
        log.info("Tools being exposed during connection:", {
          toolCount: Object.keys((server as any)._toolSchemas).length,
          toolSchemas: Object.keys((server as any)._toolSchemas).map(name => ({
            name,
            properties: Object.keys((server as any)._toolSchemas[name]?.properties || {})
          }))
        });
      }
      
      log.info(`Connecting to MCP server...`);
      log.info(`Number of tools registered: ${Object.keys((server as any)._toolSchemas || {}).length}`);
      
      // Connect using the original method
      return originalConnect.call(this, transport);
    };
    
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
          required: []
        };
        
        // If there's a schema.parameters structure, that's the actual schema
        if (tool.schema && tool.schema.parameters) {
          schema = tool.schema.parameters;
        }
        
        // Preserve the schema, but remove any random_string parameter if it's the only one
        if (schema.properties && 
            schema.properties.random_string && 
            Object.keys(schema.properties).length === 1) {
          
          log.info(`Tool ${toolName} has only random_string parameter, using proper schema`);
          
          // Use the transformInputSchema function to get the proper schema for this tool
          schema = transformInputSchema(schema, toolName);
        }
        
        // Always remove random_string if it exists among other properties
        if (schema.properties && schema.properties.random_string) {
          delete schema.properties.random_string;
          if (schema.required) {
            schema.required = schema.required.filter((r: string) => r !== "random_string");
          }
        }
        
        // Format according to MCP spec
        return {
          name: toolName,
          description: tool.description || "",
          inputSchema: {
            type: schema.type || "object",
            properties: schema.properties || {},
            required: schema.required || Object.keys(schema.properties || {})
          }
        };
      }),
      nextCursor: response.nextCursor || null
    }
  };
  
  log.info(`Response transformed to JSON-RPC 2.0 format`, {
    toolCount: formattedResponse.result.tools.length,
    sampleTool: formattedResponse.result.tools.length > 0 
      ? JSON.stringify(formattedResponse.result.tools[0]).substring(0, 200) + '...' 
      : 'No tools'
  });
  
  return formattedResponse;
}
