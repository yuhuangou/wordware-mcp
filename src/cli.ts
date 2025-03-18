#!/usr/bin/env node

import { startMCP } from "./index.js";

// Parse command line arguments
const args = process.argv.slice(2);
let apiKey: string | undefined;
let appIds: string[] = [];
let port: string | undefined;

// Process command line arguments
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--api-key" || arg === "-k") {
    apiKey = args[++i];
  } else if (arg === "--app-ids" || arg === "-a") {
    // Parse app IDs - can be comma-separated or multiple arguments
    const appIdArg = args[++i];
    if (appIdArg.includes(",")) {
      appIds = appIdArg
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id);
    } else {
      appIds.push(appIdArg);
      // Look ahead for more app IDs (not starting with --)
      while (args[i + 1] && !args[i + 1].startsWith("-")) {
        appIds.push(args[++i]);
      }
    }
  } else if (arg === "--port" || arg === "-p") {
    port = args[++i];
  } else if (arg === "--help" || arg === "-h") {
    showHelp();
    process.exit(0);
  }
}

// Set environment variables if provided via command line
if (apiKey) {
  process.env.WORDWARE_API_KEY = apiKey;
}

if (appIds.length > 0) {
  process.env.APP_IDS = JSON.stringify(appIds);
}

if (port) {
  process.env.PORT = port;
}

// Show help if missing required parameters
if (!process.env.WORDWARE_API_KEY || !process.env.APP_IDS) {
  console.error("Error: Missing required parameters.");
  showHelp();
  process.exit(1);
}

// Start the MCP server
startMCP().catch((error) => {
  console.error("Error starting MCP server:", error);
  process.exit(1);
});

function showHelp() {
  console.log(`
Wordware MCP Server CLI

Usage:
  wordware-mcp [options]

Options:
  --api-key, -k <key>      Wordware API key (required unless in .env file)
  --app-ids, -a <ids>      Comma-separated list of app IDs (required unless in .env file)
  --port, -p <port>        Port to run the server on (default: 3000)
  --help, -h               Show this help message

Environment Variables:
  You can also set these values using environment variables or a .env file:
  WORDWARE_API_KEY         Your Wordware API key
  APP_IDS                  JSON array or comma-separated list of app IDs
  PORT                     Port to run the server on

Examples:
  wordware-mcp --api-key ww-yourapikey --app-ids app1,app2
  wordware-mcp -k ww-yourapikey -a app1 app2 app3 -p 4000
  `);
}
