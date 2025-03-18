// This file contains type declarations for modules that don't have type definitions

declare module "@modelcontextprotocol/sdk/server/mcp.js" {
  export class McpServer {
    constructor(options: { name: string; version: string });

    tool(name: string, description: string, schema: any, handler: any): void;

    handleMessage(message: any): Promise<any>;

    connect(transport: any): Promise<void>;
  }
}

declare module "@modelcontextprotocol/sdk/server/stdio.js" {
  export class StdioServerTransport {
    constructor();
  }
}
