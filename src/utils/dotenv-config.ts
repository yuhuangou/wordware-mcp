try {
  const { config } = await import("dotenv");
  const { fileURLToPath } = await import("url");
  const path = await import("path");
  const fs = await import("fs");
  const readline = await import("readline");

  // Get the directory name of the current module
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // Path to the root directory (2 levels up from utils directory)
  const rootDir = path.resolve(__dirname, "../..");

  // Path to the .env file
  const envPath = path.join(rootDir, ".env");

  // Load environment variables from the root .env file immediately
  // This ensures variables are loaded early in the process
  config({ path: envPath });

  // Import Claude desktop integration utilities
  const { updateClaudeConfig, isClaudeRunning, restartClaudeDesktop } =
    await import("./claude-integration.js");

  // Create a readline interface for user input
  const getUserInput = async (question: string): Promise<string> => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  };

  // Get user yes/no confirmation
  const getUserConfirmation = async (question: string): Promise<boolean> => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question(`${question} (y/n): `, (answer) => {
        rl.close();
        resolve(answer.toLowerCase().startsWith("y"));
      });
    });
  };

  // Function to collect configuration from user
  const collectConfiguration = async (): Promise<Record<string, string>> => {
    console.log("\n🔧 Wordware MCP Setup");
    console.log("====================");

    console.log(
      "\nTo use Wordware MCP, you need to configure your API key and app IDs."
    );

    // Get API key
    const apiKey = await getUserInput("\n👉 Enter your Wordware API key: ");
    if (!apiKey.trim()) {
      console.error("API key is required to continue. Please try again.");
      process.exit(1);
    }

    // Get app IDs
    console.log("\nApp IDs should be comma-separated (e.g., app-123,app-456)");
    const appIds = await getUserInput("👉 Enter your Wordware app IDs: ");
    if (!appIds.trim()) {
      console.error(
        "At least one app ID is required to continue. Please try again."
      );
      process.exit(1);
    }

    // Optionally get port
    const port = await getUserInput("\n👉 Enter server port (default: 3000): ");

    // Ask if user wants to configure Claude desktop
    const configClaude = await getUserConfirmation(
      "\n👉 Would you like to configure Claude desktop with these settings?"
    );

    if (configClaude) {
      // Parse app IDs from comma-separated string
      const appIdsArray = appIds.split(",").map((id) => id.trim());

      // Update Claude desktop configuration
      const success = await updateClaudeConfig(
        apiKey,
        appIdsArray,
        port || "3000"
      );

      if (success) {
        console.log("✅ Claude desktop configuration updated successfully!");

        // Check if Claude is running and offer to restart
        const claudeRunning = await isClaudeRunning();
        if (claudeRunning) {
          const shouldRestart = await getUserConfirmation(
            "Claude desktop is currently running. Would you like to restart it to apply the new settings?"
          );

          if (shouldRestart) {
            console.log("Restarting Claude desktop...");
            await restartClaudeDesktop();
          } else {
            console.log(
              "Please restart Claude desktop manually to apply the new settings."
            );
          }
        }
      }
    }

    return {
      WORDWARE_API_KEY: apiKey.trim(),
      APP_IDS: appIds.trim(),
      PORT: port.trim() || "3000",
    };
  };

  // Check if .env file exists, if not create it with user input
  if (!fs.existsSync(envPath)) {
    console.log("No .env file found. Starting configuration wizard...");

    const userConfig = await collectConfiguration();

    const envContent = Object.entries(userConfig)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    fs.writeFileSync(envPath, envContent);
    console.log("\n✅ Configuration complete! .env file created successfully.");

    // Load the newly created environment variables
    config({ path: envPath });
  } else {
    // Verify that important environment variables are loaded
    const requiredVars = ["PORT", "WORDWARE_API_KEY", "APP_IDS"];
    const missingVars = requiredVars.filter(
      (v) =>
        !process.env[v] ||
        process.env[v] === "your-api-key-here" ||
        process.env[v] === "your-app-ids-here"
    );

    if (missingVars.length > 0) {
      console.log(
        "\n⚠️ Your configuration is incomplete. Starting configuration wizard..."
      );

      const newConfig = await collectConfiguration();

      // Update only the missing variables in the existing .env file
      let currentEnv = fs.readFileSync(envPath, "utf8");

      for (const [key, value] of Object.entries(newConfig)) {
        // If the variable is already in the file with a valid value, skip it
        if (
          process.env[key] &&
          process.env[key] !== "your-api-key-here" &&
          process.env[key] !== "your-app-ids-here"
        ) {
          continue;
        }

        // Check if the variable already exists in the file
        const regex = new RegExp(`^${key}=.*$`, "m");
        if (regex.test(currentEnv)) {
          // Replace the existing variable
          currentEnv = currentEnv.replace(regex, `${key}=${value}`);
        } else {
          // Add the variable
          currentEnv += `\n${key}=${value}`;
        }
      }

      fs.writeFileSync(envPath, currentEnv);
      console.log("\n✅ Configuration updated successfully!");

      // Reload environment variables
      config({ path: envPath });
    }
  }
} catch (error) {
  console.error("Error during configuration", { error });
}

// No export needed for Workers environment
export default {};
