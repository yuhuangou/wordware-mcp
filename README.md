# wordware-mcp

The Wordware MCP (Master Control Program) server allows you to run your Wordware apps locally. This enables you to integrate Wordware's powerful AI flows directly into your local development environment, making it easier to test and develop applications that leverage Wordware's capabilities.

## What's New in Version 1.1.4

- Interactive installation process with `npx wordware-mcp`
- Automatic Claude configuration setup
- Enhanced CLI interface with command-line argument support
- Direct specification of API key and app IDs via parameters
- Improved error handling and logging
- Global installation support with simple command syntax

## Installation

The easiest way to get started is using the interactive installation process:

```bash
npx wordware-mcp
```

This will guide you through:

1. Entering your Wordware API key
2. Specifying your app IDs
3. Setting up Claude configuration (optional)

After installation, you can start the MCP server with:

```bash
wordware-mcp-server
```

Alternatively, you can install manually:

```bash
# Install from npm registry
npm install -g wordware-mcp

# Or install locally in your project
npm install wordware-mcp

# Or clone this repository and install globally
git clone https://github.com/yuhuangou/wordware-mcp.git
cd wordware-mcp
npm run install-global
```

## Prerequisites

Before using this package, you need:

1. A Wordware account (sign up at [wordware.ai](http://wordware.ai))
2. A Wordware API key
3. At least one deployed Wordware app

## Basic Usage

### As a global command

If installed globally, you can run in one of two ways:

```bash
# Option 1: Create an .env file in your current directory first (see Configuration section)
wordware-mcp

# Option 2: Pass parameters directly via command line
wordware-mcp --api-key your-api-key --app-ids your-app-id-1,your-app-id-2 --port 3000
```

### Command Line Options

```
Options:
  --api-key, -k <key>      Wordware API key (required unless in .env file)
  --app-ids, -a <ids>      Comma-separated list of app IDs (required unless in .env file)
  --port, -p <port>        Port to run the server on (default: 3000)
  --help, -h               Show this help message
```

### As a package in your project

```javascript
// In your script
import { startMCP } from "wordware-mcp";

// Start the MCP server
startMCP();
```

## Configuration

You can configure the MCP server in two ways:

### 1. Environment Variables or .env File

Create a `.env` file with the following variables:

```
WORDWARE_API_KEY=your-api-key
APP_IDS=["your-app-id-1", "your-app-id-2"]
PORT=3000
```

### 2. Command Line Arguments

Pass the configuration directly when running the command:

```bash
wordware-mcp -k your-api-key -a your-app-id-1,your-app-id-2 -p 3000
```

Or with multiple app IDs as separate arguments:

```bash
wordware-mcp -k your-api-key -a your-app-id-1 your-app-id-2 your-app-id-3
```

## Creating Your Wordware Setup

### Create an account

To start, you'll need a Wordware account. Head to [wordware.ai](http://wordware.ai), sign in and create an account

### Create an API key

For your wordware flows to be accessible via MCP, you'll need to create an API key. For that, click on your profile picture in the top right corner > API keys > Create a new key > Copy your key

### Create an app

Now it's time to get creative. Create a wordware app for whatever you want to achieve, or feel free to fork an app from the explore page (https://app.wordware.ai/explore).

### Deploy your app

For your app to be triggered as MCP, you'll need to deploy it. To do that, head to your app. You should see a "Deploy" button in the top right corner. Then head to the deployment page.

### Get the `app_id`

On the deployment page, you'll see your deployment url: `https://app.wordware.ai/explore/apps/{app_id}`. Get your app_id from there

## Using with Claude Desktop

To use this MCP server with Claude Desktop:

1. Make sure Claude for Desktop is installed
2. Modify the Claude desktop config file located at:
   `~/Library/Application\ Support/Claude/claude_desktop_config.json`

3. Add the following to the file:

```json
{
  "mcpServers": {
    "wordware": {
      "command": "wordware-mcp"
    }
  }
}
```

## Development

If you want to contribute to this package:

```bash
# Clone the repository
git clone https://github.com/yuhuangou/wordware-mcp.git
cd wordware-mcp

# Install dependencies
npm install

# Build the package
npm run build

# Run in development mode
npm run dev
```

## License

MIT
