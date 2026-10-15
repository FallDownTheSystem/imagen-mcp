import fs from "node:fs/promises";
import path from "node:path";
import * as z from "zod/v4";

export const MIME: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };

export const outputInput = {
	output_dir: z.string().optional().describe("Save directory. Default IMAGEN_OUTPUT_DIR env or ./output (relative to server cwd)."),
	file_name: z.string().optional().describe("Base name without extension. Default timestamp + prompt slug."),
	return_image: z
		.boolean()
		.optional()
		.describe("Also return the image inline (base64, ~1.4 MB per 1024x1024 png) so it can be viewed. File is saved either way. Default false."),
};

type OutputOptions = z.infer<z.ZodObject<typeof outputInput>> & { prompt: string };

export type ImageFile = { data: Buffer; ext: string };

export const annotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

function slug(text: string): string {
	return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "image";
}

export async function saveImages<Meta extends object>(images: ImageFile[], options: OutputOptions, meta: Meta) {
	if (images.length === 0) throw new Error("The API returned no images.");

	const dir = path.resolve(options.output_dir ?? process.env.IMAGEN_OUTPUT_DIR ?? "output");
	await fs.mkdir(dir, { recursive: true });
	const base = options.file_name ?? `${new Date().toISOString().replace(/[:.]/g, "-")}-${slug(options.prompt)}`;

	const files: string[] = [];
	const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];
	for (const [i, image] of images.entries()) {
		const file = path.join(dir, images.length > 1 ? `${base}-${i + 1}.${image.ext}` : `${base}.${image.ext}`);
		await fs.writeFile(file, image.data);
		files.push(file);
		const mimeType = MIME[image.ext];
		if (options.return_image && mimeType) content.push({ type: "image", data: image.data.toString("base64"), mimeType });
	}

	const output = { files, ...meta };
	content.unshift({ type: "text", text: JSON.stringify(output, null, 2) });
	return { content, structuredContent: output };
}
