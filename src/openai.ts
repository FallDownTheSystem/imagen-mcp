import fs from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import OpenAI, { toFile } from "openai";
import * as z from "zod/v4";
import { annotations, MIME, saveImages } from "./output.js";
import { commonInput, resolveModel, resolveSize, type CommonInput } from "./params.js";

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

function saveResult(result: ImageResult, input: CommonInput, model: string, size: string | undefined) {
	const ext = input.output_format ?? "png";
	const images = (result.data ?? []).map((image, i) => {
		if (!image.b64_json) throw new Error(`Image ${i + 1} has no b64_json payload.`);
		return { data: Buffer.from(image.b64_json, "base64"), ext };
	});
	return saveImages(images, input, { model, size: size ?? "auto", usage: result.usage });
}

async function loadImage(file: string) {
	const abs = path.resolve(file);
	const ext = path.extname(abs).slice(1).toLowerCase();
	const type = MIME[ext === "jpg" ? "jpeg" : ext] ?? "application/octet-stream";
	return toFile(await fs.readFile(abs), path.basename(abs), { type });
}

export function registerOpenAITools(server: McpServer) {
	const client = new OpenAI();

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
			return saveResult(result, input, params.model, params.size);
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
			return saveResult(result, input, params.model, params.size);
		},
	);
}
