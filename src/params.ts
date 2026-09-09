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
	prompt: z
		.string()
		.min(1)
		.max(32000)
		.describe("Image description, or the change to make when editing."),
	model: z
		.enum(["flare", "sunburst"])
		.optional()
		.describe("flare = fast, general purpose. sunburst = slower, higher precision. Same price. Default flare."),
	size: z
		.string()
		.regex(/^(auto|\d+x\d+)$/)
		.optional()
		.describe("auto | 1024x1024 | 1536x1024 | 1024x1536 | WIDTHxHEIGHT (multiples of 16, ratio 1:3..3:1, max edge 3840). Overrides aspect_ratio. Default auto."),
	aspect_ratio: z
		.enum(Object.keys(ASPECT_RATIOS) as [AspectRatio, ...AspectRatio[]])
		.optional()
		.describe("Computes size together with long_edge. Default none."),
	long_edge: z
		.number()
		.int()
		.min(256)
		.max(MAX_LONG_EDGE)
		.optional()
		.describe(`Longer side in px, used with aspect_ratio. Default ${DEFAULT_LONG_EDGE}.`),
	quality: z
		.enum(["low", "medium", "high", "xhigh", "max", "auto"])
		.optional()
		.describe("Higher = more detail, more output tokens. auto lets the model choose (may be costly). Default auto."),
	background: z
		.enum(["transparent", "opaque", "auto"])
		.optional()
		.describe("transparent needs png or webp. Default auto."),
	output_format: z.enum(["png", "jpeg", "webp"]).optional().describe("Also the file extension. Default png."),
	output_compression: z
		.number()
		.int()
		.min(0)
		.max(100)
		.optional()
		.describe("jpeg/webp quality like JPEG: lower = smaller file, more artifacts. Default 100."),
	n: z
		.number()
		.int()
		.min(1)
		.max(10)
		.optional()
		.describe("Number of variations to generate; each costs output tokens. Files get -1, -2 suffixes. Default 1."),
	output_dir: z.string().optional().describe("Save directory. Default IMAGEN_OUTPUT_DIR env or ./output (relative to server cwd)."),
	file_name: z.string().optional().describe("Base name without extension. Default timestamp + prompt slug."),
	return_image: z
		.boolean()
		.optional()
		.describe("Also return the image inline (base64, ~1.4 MB per 1024x1024 png) so it can be viewed. File is saved either way. Default false."),
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
