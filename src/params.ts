import * as z from "zod/v4";

export const MODELS = {
	flare: "gpt-image-2.5-flare",
	sunburst: "gpt-image-2.5-sunburst",
} as const;

export type ModelAlias = keyof typeof MODELS;

const ASPECT_RATIOS = {
	"1:1": 1,
	"3:2": 3 / 2,
	"2:3": 2 / 3,
	"4:3": 4 / 3,
	"3:4": 3 / 4,
	"16:9": 16 / 9,
	"9:16": 9 / 16,
	"21:9": 21 / 9,
	"9:21": 9 / 21,
} as const;

type AspectRatio = keyof typeof ASPECT_RATIOS;

// Limits documented by OpenAI for custom WIDTHxHEIGHT sizes on GPT Image models.
const SIZE_STEP = 16;
const MAX_LONG_EDGE = 3840;
const MAX_RATIO = 3;
const DEFAULT_LONG_EDGE = 1536;

export const commonInput = {
	prompt: z.string().min(1).max(32000).describe("Text description of the desired image."),
	model: z
		.enum(["flare", "sunburst"])
		.optional()
		.describe("flare = fast, general purpose (default). sunburst = slower, higher precision."),
	size: z
		.string()
		.regex(/^(auto|\d+x\d+)$/)
		.optional()
		.describe(
			"Exact output size: 'auto', '1024x1024', '1536x1024', '1024x1536', or custom WIDTHxHEIGHT (multiples of 16, ratio 1:3..3:1, long edge <= 3840). Overrides aspect_ratio.",
		),
	aspect_ratio: z
		.enum(Object.keys(ASPECT_RATIOS) as [AspectRatio, ...AspectRatio[]])
		.optional()
		.describe("Aspect ratio when size is not given. Combined with long_edge to compute WIDTHxHEIGHT."),
	long_edge: z
		.number()
		.int()
		.min(256)
		.max(MAX_LONG_EDGE)
		.optional()
		.describe(`Pixel length of the longer side when aspect_ratio is used (default ${DEFAULT_LONG_EDGE}, max ${MAX_LONG_EDGE}).`),
	quality: z.enum(["low", "medium", "high", "xhigh", "max", "auto"]).optional().describe("Render quality. Default auto."),
	background: z.enum(["transparent", "opaque", "auto"]).optional().describe("transparent requires png or webp."),
	output_format: z.enum(["png", "jpeg", "webp"]).optional().describe("File format. Default png."),
	output_compression: z.number().int().min(0).max(100).optional().describe("0-100, jpeg/webp only."),
	n: z.number().int().min(1).max(10).optional().describe("Number of images to produce. Default 1."),
	output_dir: z.string().optional().describe("Directory to save images into. Default: IMAGEN_OUTPUT_DIR env or ./output."),
	file_name: z.string().optional().describe("Base file name without extension. Default: timestamp plus prompt slug."),
	return_image: z.boolean().optional().describe("Also return the image bytes inline as MCP image content. Default false."),
};

export type CommonInput = z.infer<z.ZodObject<typeof commonInput>>;

export function resolveModel(alias: ModelAlias | undefined): string {
	const fallback = process.env.IMAGEN_DEFAULT_MODEL as ModelAlias | undefined;
	return MODELS[alias ?? fallback ?? "flare"] ?? MODELS.flare;
}

function roundToStep(value: number): number {
	return Math.max(SIZE_STEP, Math.round(value / SIZE_STEP) * SIZE_STEP);
}

function validateSize(size: string): string {
	if (size === "auto") return size;
	const [w, h] = size.split("x").map(Number);
	if (w % SIZE_STEP !== 0 || h % SIZE_STEP !== 0) {
		throw new Error(`size ${size}: width and height must be multiples of ${SIZE_STEP}.`);
	}
	if (Math.max(w, h) > MAX_LONG_EDGE) {
		throw new Error(`size ${size}: long edge must be <= ${MAX_LONG_EDGE}.`);
	}
	const ratio = w / h;
	if (ratio > MAX_RATIO || ratio < 1 / MAX_RATIO) {
		throw new Error(`size ${size}: aspect ratio must be between 1:${MAX_RATIO} and ${MAX_RATIO}:1.`);
	}
	return size;
}

export function resolveSize(input: Pick<CommonInput, "size" | "aspect_ratio" | "long_edge">): string | undefined {
	if (input.size) return validateSize(input.size);
	if (!input.aspect_ratio) return undefined;
	const ratio = ASPECT_RATIOS[input.aspect_ratio];
	const long = roundToStep(input.long_edge ?? DEFAULT_LONG_EDGE);
	const short = roundToStep(long / Math.max(ratio, 1 / ratio));
	return ratio >= 1 ? `${long}x${short}` : `${short}x${long}`;
}
