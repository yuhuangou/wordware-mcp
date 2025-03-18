import fs from "fs";
import path from "path";
import { promisify } from "util";
import { exec } from "child_process";

const execAsync = promisify(exec);

/**
 * Gets the path to Claude config file based on the platform
 */
export function getClaudeConfigPath(): string | null {
  const platform = process.platform;
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (!homeDir) return null;

  if (platform === "darwin") {
    return path.join(
      homeDir,
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json"
    );
  } else if (platform === "win32") {
    return path.join(
      homeDir,
      "AppData",
      "Roaming",
      "Claude",
      "claude_desktop_config.json"
    );
  } else if (platform === "linux") {
    return path.join(
      homeDir,
      ".config",
      "Claude",
      "claude_desktop_config.json"
    );
  }

  return null;
}

/**
 * Updates the Claude desktop configuration with Wordware MCP settings
 */
export async function updateClaudeConfig(
  apiKey: string,
  appIds: string[],
  port: string = "3000"
): Promise<boolean> {
  const configPath = getClaudeConfigPath();
  if (!configPath) {
    console.log("Could not determine Claude config path for your platform");
    return false;
  }

  try {
    console.log(`Looking for Claude config at: ${configPath}`);

    // Check if config file exists
    if (!fs.existsSync(configPath)) {
      console.log(`Claude config file not found at ${configPath}`);
      return false;
    }

    // Read the config file
    const configContent = fs.readFileSync(configPath, "utf-8");
    let config;
    try {
      config = JSON.parse(configContent);
      console.log("Successfully parsed Claude config");
    } catch (e) {
      console.error("Error parsing Claude config file:", e);
      return false;
    }

    // Set command to "node" explicitly
    const nodeCommand = "node";
    console.log(`Using Node command: ${nodeCommand}`);

    // Get the path to our index.js
    const { fileURLToPath } = await import("url");
    const currentDirname = path.dirname(fileURLToPath(import.meta.url));
    const buildDir = path.resolve(currentDirname, "..");
    const indexJsPath = path.join(buildDir, "index.js");
    console.log(`Using index.js path: ${indexJsPath}`);

    // Create the Wordware configuration matching the expected structure
    const wordwareConfig = {
      transport: "stdio",
      command: nodeCommand,
      args: [indexJsPath],
    };

    console.log(
      "Wordware config to apply:",
      JSON.stringify(wordwareConfig, null, 2)
    );

    // Ensure the mcpServers section exists
    if (!config.mcpServers) {
      config.mcpServers = {};
    }

    // Add or update the Wordware server configuration under mcpServers
    config.mcpServers["Wordware"] = wordwareConfig;

    // Write the updated configuration back to the file
    console.log("Writing updated configuration to file");
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(
      "Successfully updated Claude desktop configuration with Wordware MCP settings"
    );
    return true;
  } catch (error) {
    console.error("Error updating Claude config:", error);
    return false;
  }
}

/**
 * Checks if Claude desktop is running
 */
export async function isClaudeRunning(): Promise<boolean> {
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
 * Prompts the user to restart Claude desktop app and handles the restart
 */
export async function restartClaudeDesktop(): Promise<boolean> {
  try {
    const platform = process.platform;
    if (platform === "win32") {
      await execAsync('taskkill /F /IM "Claude.exe"');
    } else if (platform === "darwin") {
      await execAsync('killall "Claude"');
    } else if (platform === "linux") {
      await execAsync('pkill -f "claude"');
    } else {
      console.log("Unsupported platform for Claude restart");
      return false;
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

    console.log("Claude desktop app has been restarted successfully");
    return true;
  } catch (error) {
    console.error("Failed to restart Claude desktop app:", error);
    return false;
  }
}
