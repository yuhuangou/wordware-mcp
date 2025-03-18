#!/usr/bin/env node

// This is a dedicated entry point for npx
// It only runs the installation process and never tries to start the server

import { main } from "./install.js";

// Execute the installation
main();
