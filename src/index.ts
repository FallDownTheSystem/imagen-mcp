#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import OpenAI, { toFile } from "openai";
import * as z from "zod/v4";
import { commonInput, resolveModel, resolveSize, type CommonInput } from "./params.js";

// A .env next to the project is a convenience for local runs; MCP client configs normally pass env directly.
try {
	process.loadEnvFile(path.join(import.meta.dirname, "..", ".env"));
} catch {
	// No .env file present; rely on the process environment.
}

const client = new OpenAI();
const server = new McpServer({ name: "imagen-mcp", version: "0.1.1" });

const MIME: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };

type ImageResult = {
	data?: Array<{ b64_json?: string }>;
	usage?: { input_tokens: number; output_tokens: number; total_tokens: number };
};

const outputSchema = z.object({
	files: z.array(z.string()),
	model: z.string(),
	size: z.string(),
	usage: z
		.object({
			input_tokens: z.number(),
			output_tokens: z.number(),
			total_tokens: z.number(),
			input_tokens_details: z.object({ image_tokens: z.number(), text_tokens: z.number() }).optional(),
			output_tokens_details: z.object({ image_tokens: z.number(), text_tokens: z.number() }).optional(),
		})
		.optional(),
});

const annotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

function slug(text: string): string {
	return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "image";
}

function apiParams(input: CommonInput) {
	return {
		model: resolveModel(input.model),
		prompt: input.prompt,
		size: resolveSize(input),
		quality: input.quality,
		background: input.background,
		output_format: input.output_format,
		output_compression: input.output_compression,
		n: input.n,
	};
}

async function saveImages(result: ImageResult, input: CommonInput, model: string, size: string | undefined) {
	const images = result.data ?? [];
	if (images.length === 0) throw new Error("The API returned no images.");

	const ext = input.output_format ?? "png";
	const dir = path.resolve(input.output_dir ?? process.env.IMAGEN_OUTPUT_DIR ?? "output");
	await fs.mkdir(dir, { recursive: true });
	const base = input.file_name ?? `${new Date().toISOString().replace(/[:.]/g, "-")}-${slug(input.prompt)}`;

	const files: string[] = [];
	const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];
	for (const [i, image] of images.entries()) {
		if (!image.b64_json) throw new Error(`Image ${i + 1} has no b64_json payload.`);
		const file = path.join(dir, images.length > 1 ? `${base}-${i + 1}.${ext}` : `${base}.${ext}`);
		await fs.writeFile(file, Buffer.from(image.b64_json, "base64"));
		files.push(file);
		if (input.return_image) content.push({ type: "image", data: image.b64_json, mimeType: MIME[ext] });
	}

	const output = { files, model, size: size ?? "auto", usage: result.usage };
	content.unshift({ type: "text", text: JSON.stringify(output, null, 2) });
	return { content, structuredContent: output };
}

async function loadImage(file: string) {
	const abs = path.resolve(file);
	const ext = path.extname(abs).slice(1).toLowerCase();
	const type = MIME[ext === "jpg" ? "jpeg" : ext] ?? "application/octet-stream";
	return toFile(await fs.readFile(abs), path.basename(abs), { type });
}

server.registerTool(
	"generate_image",
	{
		title: "Generate image",
		description:
			"Generate images from a text prompt with OpenAI GPT Image 2.5. Saves files to disk and returns paths and token usage.",
		inputSchema: z.object({
			...commonInput,
			moderation: z
				.enum(["auto", "low"])
				.optional()
				.describe("OpenAI content filter. low refuses fewer borderline prompts. Default low."),
		}),
		outputSchema,
		annotations,
	},
	async (input) => {
		const params = apiParams(input);
		const result = await client.images.generate({ ...params, moderation: input.moderation ?? "low" });
		return saveImages(result, input, params.model, params.size);
	},
);

server.registerTool(
	"edit_image",
	{
		title: "Edit image",
		description:
			"Edit, restyle, or combine 1-16 reference images with a text prompt using OpenAI GPT Image 2.5. The whole picture is regenerated; without a mask the prompt decides what changes. Reference details are always kept at high fidelity (no input_fidelity option). Saves files to disk and returns paths and token usage.",
		inputSchema: z.object({
			...commonInput,
			images: z
				.array(z.string())
				.min(1)
				.max(16)
				.describe("Paths of 1-16 reference images (png/jpeg/webp). First = main subject; others = elements to combine. Relative to server cwd."),
			mask: z
				.string()
				.optional()
				.describe("Path of a PNG with alpha, same size as first image. Transparent pixels = region to repaint (guidance, not a hard lock). Default none."),
		}),
		outputSchema,
		annotations,
	},
	async (input) => {
		const params = apiParams(input);
		const result = await client.images.edit({
			...params,
			image: await Promise.all(input.images.map(loadImage)),
			mask: input.mask ? await loadImage(input.mask) : undefined,
		});
		return saveImages(result, input, params.model, params.size);
	},
);

await server.connect(new StdioServerTransport());
