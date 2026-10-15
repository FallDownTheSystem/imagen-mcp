import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { annotations, MIME, saveImages, outputInput, type ImageFile } from "./output.js";

const API = "https://api.krea.ai";
const ENDPOINT = "/generate/image/krea/krea-3";
const POLL_INTERVAL_MS = 2000;
// Krea times out hosted jobs after 3 minutes; the extra margin covers queueing behind the concurrency limit.
const JOB_TIMEOUT_MS = 5 * 60_000;
const PENDING = new Set(["backlogged", "queued", "scheduled", "processing", "sampling", "intermediate-complete"]);

const ASPECT_RATIOS = ["1:1", "4:5", "3:4", "2:3", "9:16", "5:4", "4:3", "3:2", "16:9", "21:9"] as const;

const kreaInput = {
	prompt: z
		.string()
		.min(1)
		.describe("Plain-language instruction. Lead with the change; end with one sentence on what to keep. Name multiple references by what they show."),
	thinking_mode: z
		.enum(["fast", "high"])
		.optional()
		.describe("Prompt planning before generation. high = stronger reasoning for complex or multi-reference edits, slower, +$0.02. Default fast."),
	resolution: z.enum(["1K", "2K"]).optional().describe("Output canvas. 1K = $0.03, 2K = $0.06 base price. Default 2K."),
	aspect_ratio: z.enum(ASPECT_RATIOS).optional().describe("Default none (automatic framing)."),
	negative_prompt: z.string().max(1024).optional().describe("What to avoid. Default none."),
	seed: z
		.number()
		.int()
		.optional()
		.describe("Fixed seed; with n > 1 each variation uses seed + index. Prompt expansion still varies between runs. Default random."),
	n: z
		.number()
		.int()
		.min(1)
		.max(4)
		.optional()
		.describe("Number of variations; each is a separate paid job. Files get -1, -2 suffixes. Default 1."),
	...outputInput,
};

type KreaInput = z.infer<z.ZodObject<typeof kreaInput>> & { images?: string[]; regional_edit?: boolean };

type Job = {
	job_id: string;
	status: string;
	result?: { urls?: string[]; error?: unknown } | null;
	error?: { code?: string; message?: string } | null;
};

const outputSchema = z.object({
	files: z.array(z.string()),
	model: z.string(),
	resolution: z.string(),
	aspect_ratio: z.string(),
	thinking_mode: z.string(),
	job_ids: z.array(z.string()),
	errors: z.array(z.string()).optional(),
});

function sniffExt(data: Buffer, url: string): string {
	if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
	if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpeg";
	if (data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") return "webp";
	// An unknown format is still a paid result, so keep it under whatever extension the URL carries.
	return path.extname(new URL(url).pathname).slice(1).toLowerCase() || "img";
}

function jobError(job: Job): string {
	const detail = job.error?.message ?? job.error?.code ?? job.result?.error;
	return `Krea job ${job.job_id} ${job.status}${detail ? `: ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`;
}

function createClient(apiKey: string) {
	async function request<T>(pathname: string, init: RequestInit = {}): Promise<T> {
		const res = await fetch(`${API}${pathname}`, {
			...init,
			headers: { Authorization: `Bearer ${apiKey}`, ...init.headers },
		});
		const text = await res.text();
		if (!res.ok) {
			let message = text;
			try {
				message = JSON.parse(text).error ?? text;
			} catch {
				// Non-JSON error body; report it verbatim.
			}
			throw new Error(`Krea ${init.method ?? "GET"} ${pathname} failed (${res.status}): ${message}`);
		}
		return (text ? JSON.parse(text) : undefined) as T;
	}

	async function upload(file: string, signal: AbortSignal) {
		const abs = path.resolve(file);
		const ext = path.extname(abs).slice(1).toLowerCase();
		const type = MIME[ext === "jpg" ? "jpeg" : ext] ?? "application/octet-stream";
		const form = new FormData();
		form.append("file", new Blob([await fs.readFile(abs)], { type }), path.basename(abs));
		return request<{ id: string; image_url: string }>("/assets", { method: "POST", body: form, signal });
	}

	async function cancel(jobId: string) {
		await request(`/jobs/${jobId}`, { method: "DELETE" }).catch(() => {});
	}

	async function run(body: Record<string, unknown>, signal: AbortSignal) {
		const created = await request<Job>(ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal,
		});
		const deadline = Date.now() + JOB_TIMEOUT_MS;
		let job = created;
		try {
			while (PENDING.has(job.status)) {
				if (Date.now() > deadline) throw new Error(`Krea job ${job.job_id} still ${job.status} after ${JOB_TIMEOUT_MS / 1000}s.`);
				await sleep(POLL_INTERVAL_MS, undefined, { signal });
				job = await request<Job>(`/jobs/${job.job_id}`, { signal });
			}
		} catch (error) {
			// Failed and cancelled jobs are not billed, so stop work the caller will never receive.
			await cancel(created.job_id);
			throw error;
		}
		if (job.status !== "completed") throw new Error(jobError(job));
		const urls = job.result?.urls ?? [];
		if (urls.length === 0) throw new Error(`Krea job ${job.job_id} completed without output URLs.`);
		const images = await Promise.all(
			urls.map(async (url): Promise<ImageFile> => {
				const res = await fetch(url, { signal });
				if (!res.ok) throw new Error(`Download of ${url} failed (${res.status}).`);
				const data = Buffer.from(await res.arrayBuffer());
				return { data, ext: sniffExt(data, url) };
			}),
		);
		return { jobId: job.job_id, images };
	}

	async function generate(input: KreaInput, signal: AbortSignal) {
		const uploaded: string[] = [];
		try {
			const imageUrls = input.images
				? await Promise.all(
						input.images.map(async (ref) => {
							if (/^https?:\/\//i.test(ref)) return ref;
							const asset = await upload(ref, signal);
							uploaded.push(asset.id);
							return asset.image_url;
						}),
					)
				: undefined;

			const resolution = input.resolution ?? "2K";
			const thinkingMode = input.thinking_mode ?? "fast";
			const runs = await Promise.allSettled(
				Array.from({ length: input.n ?? 1 }, (_, i) =>
					run(
						{
							prompt: input.prompt,
							thinking_mode: thinkingMode,
							resolution,
							aspect_ratio: input.aspect_ratio,
							negative_prompt: input.negative_prompt,
							seed: input.seed === undefined ? undefined : input.seed + i,
							image_urls: imageUrls,
							regional_edit: input.regional_edit,
						},
						signal,
					),
				),
			);

			const done = runs.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
			const errors = runs.flatMap((r) => (r.status === "rejected" ? [String(r.reason instanceof Error ? r.reason.message : r.reason)] : []));
			// Completed variations are already billed, so save them even when siblings fail.
			if (done.length === 0) throw new Error(errors.join("\n"));

			return saveImages(
				done.flatMap((d) => d.images),
				input,
				{
					model: "krea-3",
					resolution,
					aspect_ratio: input.aspect_ratio ?? "auto",
					thinking_mode: thinkingMode,
					job_ids: done.map((d) => d.jobId),
					...(errors.length > 0 && { errors }),
				},
			);
		} finally {
			// Reference uploads exist only for this request; keep them out of the user's Krea asset library.
			await Promise.allSettled(uploaded.map((id) => request(`/assets/${id}`, { method: "DELETE" })));
		}
	}

	return { generate };
}

export function registerKreaTools(server: McpServer, apiKey: string) {
	const krea = createClient(apiKey);

	server.registerTool(
		"krea_generate_image",
		{
			title: "Generate image (Krea 3)",
			description:
				"Generate images from a text prompt with Krea 3 (early-access beta). Saves files to disk and returns paths and Krea job IDs.",
			inputSchema: z.object(kreaInput),
			outputSchema,
			annotations,
		},
		(input, ctx) => krea.generate(input, ctx.mcpReq.signal),
	);

	server.registerTool(
		"krea_edit_image",
		{
			title: "Edit image (Krea 3)",
			description:
				"Edit or combine 1-8 reference images with a plain-language instruction using Krea 3 (early-access beta). Without regional_edit the whole picture is re-rendered. Saves files to disk and returns paths and Krea job IDs.",
			inputSchema: z.object({
				...kreaInput,
				images: z
					.array(z.string())
					.min(1)
					.max(8)
					.describe("1-8 reference images: local paths (png/jpeg/webp, relative to server cwd) or https URLs. Each costs +$0.02 (1K) or +$0.07 (2K). Over 4 refs are downscaled to 1536 px."),
				regional_edit: z
					.boolean()
					.optional()
					.describe("true = regenerate only what must change and keep the rest pixel-exact; use for local edits and chained edits. Omit for restyle, relight, reframe, or compositing. Default false."),
			}),
			outputSchema,
			annotations,
		},
		(input, ctx) => krea.generate(input, ctx.mcpReq.signal),
	);
}
