#!/usr/bin/env node

import { execSync } from "child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { createInterface } from "readline";
import { promisify } from "util";
import { exec } from "child_process";

const execAsync = promisify(exec);

interface ClaudeConfig {
  mcpServers?: {
    wordware?: {
      transport?: string;
      command: string;
      args?: string[];
      env?: {
        WORDWARE_API_KEY: string;
        APP_IDS: string;
      };
    };
  };
  [key: string]: any;
}

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (query: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
};

/**
 * Check if Claude is running
 */
async function isClaudeRunning(): Promise<boolean> {
  try {
    const platform = process.platform;
    if (platform === "win32") {
      const { stdout } = await execAsync(
        'tasklist /FI "IMAGENAME eq Claude.exe" /NH'
      );
      return stdout.includes("Claude.exe");
    } else if (platform === "darwin") {
      const { stdout } = await execAsync('pgrep -x "Claude"');
      return !!stdout.trim();
    } else if (platform === "linux") {
      const { stdout } = await execAsync('pgrep -f "claude"');
      return !!stdout.trim();
    }
    return false;
  } catch (error) {
    // If the command fails, assume Claude is not running
    return false;
  }
}

/**
 * Prompt to restart Claude and perform restart if user agrees
 */
async function promptAndRestartClaude(): Promise<boolean> {
  // Check if Claude is running first
  const claudeRunning = await isClaudeRunning();

  if (!claudeRunning) {
    console.log("Claude is not running. Please start it after installation.");
    return false;
  }

  const shouldRestart = await question(
    "Would you like to restart Claude to apply the changes? (y/n): "
  );

  if (shouldRestart.toLowerCase() === "y") {
    console.log("Restarting Claude desktop app...");
    try {
      const platform = process.platform;
      if (platform === "win32") {
        await execAsync('taskkill /F /IM "Claude.exe"');
      } else if (platform === "darwin") {
        await execAsync('killall "Claude"');
      } else if (platform === "linux") {
        await execAsync('pkill -f "claude"');
      }

      // Wait a moment for the app to close before reopening
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Reopen the app
      if (platform === "win32") {
        await execAsync('start "" "Claude.exe"');
      } else if (platform === "darwin") {
        await execAsync('open -a "Claude"');
      } else if (platform === "linux") {
        await execAsync("claude");
      }

      console.log("Claude desktop app has been restarted.");
    } catch (error) {
      console.error("Failed to restart Claude desktop app:", error);
    }
    return true;
  }

  return false;
}

export async function main() {
  try {
    console.log("Welcome to Wordware MCP Installation!");

    // Get API Key
    const apiKey = await question("Please enter your Wordware API key: ");

    // Get App IDs
    const appIdsInput = await question(
      "Please enter your app IDs (comma or space separated): "
    );

    // Handle both comma and space separated input
    const appIds = appIdsInput
      .replace(/,/g, " ") // Replace commas with spaces
      .split(" ")
      .filter((id) => id.trim()) // Remove empty entries
      .map((id) => id.trim()); // Trim whitespace

    // Ask about setting up Claude configuration
    const shouldSetupClaude = await question(
      "Would you like to set up the MCP configuration for Claude? (y/n): "
    );

    // Create .env file in the current directory
    const envContent = `WORDWARE_API_KEY=${apiKey}
APP_IDS=${appIds.join(",")}
PORT=3000
`;

    writeFileSync(".env", envContent);
    console.log("\n✅ Created .env file with your configuration");

    // Create .env.example file
    const envExampleContent = `WORDWARE_API_KEY=your_api_key_here
APP_IDS=app_id_1,app_id_2
PORT=3000
`;
    writeFileSync(".env.example", envExampleContent);
    console.log("✅ Created .env.example file for reference");

    if (shouldSetupClaude.toLowerCase() === "y") {
      try {
        // Get the home directory
        const homeDir = process.env.HOME || process.env.USERPROFILE;
        if (!homeDir) {
          throw new Error("Could not determine home directory");
        }

        // Possible paths for Claude configuration
        const possiblePaths = [
          // MacOS paths
          join(
            homeDir,
            "Library",
            "Application Support",
            "Claude",
            "claude_desktop_config.json"
          ),
          join(homeDir, ".cursor", "config", "config.json"),
          // Windows paths
          join(
            homeDir,
            "AppData",
            "Roaming",
            "Claude",
            "claude_desktop_config.json"
          ),
          // Linux paths
          join(homeDir, ".config", "Claude", "claude_desktop_config.json"),
        ];

        // Find the first path that exists
        let configPath = "";
        let config: ClaudeConfig = {};

        for (const path of possiblePaths) {
          console.log(`Checking for Claude config at: ${path}`);
          if (existsSync(path)) {
            configPath = path;
            console.log(`Found Claude config at: ${path}`);
            try {
              const existingConfig = readFileSync(path, "utf-8");
              config = JSON.parse(existingConfig);
              break;
            } catch (error) {
              console.log(`Error reading config at ${path}: ${error}`);
            }
          }
        }

        // If no config file found, create one in the default location
        if (!configPath) {
          configPath = possiblePaths[0]; // Use the first path as default
          console.log(
            `No existing config found. Will create at: ${configPath}`
          );
        }

        // Make sure mcpServers exists
        if (!config.mcpServers) {
          config.mcpServers = {};
        }

        // Update MCP configuration
        config.mcpServers.wordware = {
          transport: "stdio",
          command: "node",
          args: [join(process.cwd(), "build", "index.js")],
          env: {
            WORDWARE_API_KEY: apiKey,
            APP_IDS: appIds.join(","),
          },
        };

        // Ensure config directory exists
        const configDir = dirname(configPath);
        if (!existsSync(configDir)) {
          console.log(`Creating directory: ${configDir}`);
          mkdirSync(configDir, { recursive: true });
        }

        // Write updated config
        console.log(`Writing config to: ${configPath}`);
        writeFileSync(configPath, JSON.stringify(config, null, 2));

        console.log("✅ Updated Claude configuration");

        // Prompt to restart Claude
        await promptAndRestartClaude();
      } catch (error) {
        console.error("❌ Error updating Claude configuration:", error);
        console.error(
          "Error details:",
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    console.log("\n✅ Installation complete!");
    console.log("\nYou can now run the MCP server with:");
    console.log("wordware-mcp-server");
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Only run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
