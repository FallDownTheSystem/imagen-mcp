#!/usr/bin/env node
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { registerKreaTools } from "./krea.js";
import { registerOpenAITools } from "./openai.js";

// A .env next to the project is a convenience for local runs; MCP client configs normally pass env directly.
try {
	process.loadEnvFile(path.join(import.meta.dirname, "..", ".env"));
} catch {
	// No .env file present; rely on the process environment.
}

const openaiKey = process.env.OPENAI_API_KEY;
const kreaKey = process.env.KREA_API_KEY;
if (!openaiKey && !kreaKey) {
	console.error("imagen-mcp: set OPENAI_API_KEY, KREA_API_KEY, or both.");
	process.exit(1);
}

const server = new McpServer({ name: "imagen-mcp", version: "0.1.1" });

// Tools are registered per configured provider so clients never see a tool that can only fail.
if (openaiKey) registerOpenAITools(server);
if (kreaKey) registerKreaTools(server, kreaKey);

await server.connect(new StdioServerTransport());
