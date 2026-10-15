# imagen-mcp

Minimal MCP server for OpenAI GPT Image 2.5 and Krea 3. Generate and edit tools for each provider.

| Provider | Tools | Models |
|---|---|---|
| OpenAI | `generate_image`, `edit_image` | `flare` (default, `gpt-image-2.5-flare`): fast, general purpose. `sunburst` (`gpt-image-2.5-sunburst`): slower, higher precision. |
| Krea | `krea_generate_image`, `krea_edit_image` | Krea 3: fast, instruction-following editor. Early-access beta. |

The server registers a provider's tools only when that provider's API key is set.

## Setup

Install from npm:

```sh
npm install -g @falldownthesystem/imagen-mcp
```

Or build from source:

```sh
npm install
npm run build
```

Set one or both API keys in the environment, or put them in a `.env` file next to `package.json`:

- `OPENAI_API_KEY`: enables the OpenAI tools.
- `KREA_API_KEY`: enables the Krea tools. Create a token at [krea.ai/settings/api-tokens](https://www.krea.ai/settings/api-tokens). The Krea 3 API is in early access; only workspaces in the beta can call it. Request access at sales@krea.ai.

Optional environment variables:

- `IMAGEN_OUTPUT_DIR`: default directory for saved images (default `./output`).
- `IMAGEN_DEFAULT_MODEL`: `flare` or `sunburst` (default `flare`).

## Client config

Claude Code (`.mcp.json`) or Claude Desktop, using the npm package:

```json
{
	"mcpServers": {
		"imagen": {
			"command": "npx",
			"args": ["-y", "@falldownthesystem/imagen-mcp"],
			"env": {
				"OPENAI_API_KEY": "sk-...",
				"KREA_API_KEY": "...",
				"IMAGEN_OUTPUT_DIR": "C:/Users/me/Pictures/imagen"
			}
		}
	}
}
```

Or with a local build, use `"command": "node"` and `"args": ["path/to/imagen-mcp/dist/index.js"]`.

Claude Code one-liner:

```sh
claude mcp add imagen -e OPENAI_API_KEY=sk-... -e KREA_API_KEY=... -- npx -y @falldownthesystem/imagen-mcp
```

## OpenAI tools

### `generate_image`

Text to image. Required: `prompt`.

| Option | Values | Default | Notes |
|---|---|---|---|
| `moderation` | `auto`, `low` | `low` | OpenAI content filter strictness. `low` refuses fewer borderline prompts; OpenAI usage policies still apply. The API default is `auto`; this tool sends `low` unless set. |

### `edit_image`

Reference images to image. Required: `prompt`, `images`. The model regenerates the whole picture guided by the references and the prompt. Without a mask, the prompt alone decides what changes.

| Option | Values | Default | Notes |
|---|---|---|---|
| `images` | 1 to 16 file paths | required | `png`, `jpeg`, or `webp`. The first image is the main subject; extra images supply elements to combine, such as a logo or a style reference. Relative paths resolve against the server working directory. |
| `mask` | file path | none | PNG with an alpha channel, same width and height as the first image. Fully transparent pixels mark the region the model may repaint; opaque pixels mark what to keep. Use for inpainting one area or filling an extended canvas. It is guidance, not a hard pixel lock. |

There is no `input_fidelity` option. The GPT Image 2.5 models always process reference images at high fidelity, and the API rejects the parameter. Faces, logos, text, and textures from the references are preserved by default.

### Shared options

Only the options you set are sent to the API. The default column shows what applies when an option is omitted.

| Option | Values | Default | Notes |
|---|---|---|---|
| `prompt` | text, up to 32000 chars | required | |
| `model` | `flare`, `sunburst` | `flare` | `flare` (`gpt-image-2.5-flare`) is fast and general purpose. `sunburst` (`gpt-image-2.5-sunburst`) is slower with higher precision. Same token price. `IMAGEN_DEFAULT_MODEL` env changes the default. |
| `size` | `auto`, `1024x1024`, `1536x1024`, `1024x1536`, `WIDTHxHEIGHT` | `auto` | Custom sizes: multiples of 16, ratio 1:3 to 3:1, long edge up to 3840. Overrides `aspect_ratio`. |
| `aspect_ratio` | `1:1`, `3:2`, `2:3`, `4:3`, `3:4`, `16:9`, `9:16`, `21:9`, `9:21` | none | Combined with `long_edge` to compute a size. |
| `long_edge` | 256 to 3840 | 1536 | Only used with `aspect_ratio`. |
| `quality` | `low`, `medium`, `high`, `xhigh`, `max`, `auto` | `auto` | Higher tiers add detail and cost more output tokens. `auto` lets the model choose and may pick an expensive tier. Set it explicitly to control cost. |
| `background` | `transparent`, `opaque`, `auto` | `auto` | `transparent` gives an alpha background for stickers, logos, and cut-outs. Needs `png` or `webp`. |
| `output_format` | `png`, `jpeg`, `webp` | `png` | Also sets the file extension. |
| `output_compression` | 0 to 100 | 100 | `jpeg` and `webp` only. Works like JPEG quality: lower is smaller with more artifacts. |
| `n` | 1 to 10 | 1 | Number of separate variations generated from the same prompt in one call. Each costs its own output tokens. |
| `output_dir` | directory path | `IMAGEN_OUTPUT_DIR` env, else `./output` | Relative to the server working directory. |
| `file_name` | base name without extension | timestamp plus a slug of the prompt | With `n` greater than 1, a `-1`, `-2` suffix is added. |
| `return_image` | boolean | `false` | Also return each image inline as MCP image content, so the client shows it and the model can inspect it. Adds about 1.4 MB of context per 1024x1024 png. The file is saved to disk either way. |

The result lists the saved file paths, the model, the size, and token usage.

## Krea tools

Both tools call `POST /generate/image/krea/krea-3`, poll the job every 2 seconds, and download the result. A job that does not finish in 5 minutes, or a tool call that the client cancels, is cancelled on Krea. Failed and cancelled jobs are not billed.

### `krea_generate_image`

Text to image. Required: `prompt`.

### `krea_edit_image`

Reference images to image. Required: `prompt`, `images`. Write the prompt as an instruction: lead with the change, then add one sentence about what stays the same. With several references, name each one by what it shows, for example "Put the sneaker from the second image on the person in the first image."

| Option | Values | Default | Notes |
|---|---|---|---|
| `images` | 1 to 8 local paths or `https` URLs | required | Local files (`png`, `jpeg`, `webp`) are uploaded to Krea assets for the request and deleted after it. URLs are passed through. References over 4 MP are resized to 4 MP. With 5 or more references, each is resized to 1536 px on its long side, so send 4 or fewer for full detail. |
| `regional_edit` | boolean | `false` | `true` regenerates only the parts that must change and keeps the rest pixel-exact. Use it for local edits (recolor, add or remove an object, change text) and for chained edits on the latest output. Leave it off for global edits (restyle, relight, reframe, combine images into a new scene), which re-render the whole picture. |

There is no mask option. Krea 3 decides the edit region from the prompt.

### Shared Krea options

Only the options you set are sent, except `thinking_mode` and `resolution`, which are always sent with their defaults.

| Option | Values | Default | Notes |
|---|---|---|---|
| `prompt` | text | required | |
| `thinking_mode` | `fast`, `high` | `fast` | How much Krea 3 plans before it generates. `high` uses a stronger reasoning engine for complex or multi-step edits and for combining several references. It is slower and costs $0.02 more. |
| `resolution` | `1K`, `2K` | `2K` | Output canvas size. 2K is the native resolution. |
| `aspect_ratio` | `1:1`, `4:5`, `3:4`, `2:3`, `9:16`, `5:4`, `4:3`, `3:2`, `16:9`, `21:9` | none | Omit for automatic framing. |
| `negative_prompt` | text, up to 1024 chars | none | What to avoid. |
| `seed` | integer | random | With `n` greater than 1, variation `i` uses `seed + i`. The same seed does not guarantee the same image, because the prompt expansion step varies between runs. |
| `n` | 1 to 4 | 1 | Each variation is a separate job, billed separately. If some jobs fail, the finished images are still saved and the failures are listed in `errors`. |
| `output_dir`, `file_name`, `return_image` | | | Same as the OpenAI tools. |

Pricing per image:

| Component | 1K output | 2K output |
|---|---|---|
| Base price | $0.03 | $0.06 |
| Each 1K reference image | +$0.02 | +$0.02 |
| Each 2K reference image | +$0.07 | +$0.07 |
| `high` thinking mode | +$0.02 | +$0.02 |

The result lists the saved file paths, the model, the resolution, the aspect ratio, the thinking mode, and the Krea job IDs.
