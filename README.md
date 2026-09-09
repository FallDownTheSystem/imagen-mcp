# imagen-mcp

Minimal MCP server for OpenAI GPT Image 2.5. Two tools, two models.

| Alias | API model | Use |
|---|---|---|
| `flare` (default) | `gpt-image-2.5-flare` | Fast, general purpose |
| `sunburst` | `gpt-image-2.5-sunburst` | Slower, higher precision |

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

Set `OPENAI_API_KEY` in the environment, or put it in a `.env` file next to `package.json`.

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
				"IMAGEN_OUTPUT_DIR": "C:/Users/me/Pictures/imagen"
			}
		}
	}
}
```

Or with a local build, use `"command": "node"` and `"args": ["path/to/imagen-mcp/dist/index.js"]`.

Claude Code one-liner:

```sh
claude mcp add imagen -e OPENAI_API_KEY=sk-... -- npx -y @falldownthesystem/imagen-mcp
```

## Tools

### `generate_image`

Text to image. Required: `prompt`.

| Option | Values | Default | Notes |
|---|---|---|---|
| `moderation` | `auto`, `low` | `auto` | Content moderation strictness. |

### `edit_image`

Reference images to image. Required: `prompt`, `images`.

| Option | Values | Default | Notes |
|---|---|---|---|
| `images` | 1 to 16 file paths | required | `png`, `jpeg`, or `webp`. Relative paths resolve against the server working directory. |
| `mask` | file path | none | PNG with alpha. Transparent areas are edited. Same dimensions as the first image. |
| `input_fidelity` | `high`, `low` | `low` | `high` preserves faces, logos, and fine detail. |

### Shared options

Only the options you set are sent to the API. The default column shows what applies when an option is omitted.

| Option | Values | Default | Notes |
|---|---|---|---|
| `prompt` | text, up to 32000 chars | required | |
| `model` | `flare`, `sunburst` | `flare` | `IMAGEN_DEFAULT_MODEL` env changes the default. |
| `size` | `auto`, `1024x1024`, `1536x1024`, `1024x1536`, `WIDTHxHEIGHT` | `auto` | Custom sizes: multiples of 16, ratio 1:3 to 3:1, long edge up to 3840. Overrides `aspect_ratio`. |
| `aspect_ratio` | `1:1`, `3:2`, `2:3`, `4:3`, `3:4`, `16:9`, `9:16`, `21:9`, `9:21` | none | Combined with `long_edge` to compute a size. |
| `long_edge` | 256 to 3840 | 1536 | Only used with `aspect_ratio`. |
| `quality` | `low`, `medium`, `high`, `xhigh`, `max`, `auto` | `auto` | Higher tiers cost more output tokens. `auto` lets the model choose. |
| `background` | `transparent`, `opaque`, `auto` | `auto` | Transparent needs `png` or `webp`. |
| `output_format` | `png`, `jpeg`, `webp` | `png` | Also sets the file extension. |
| `output_compression` | 0 to 100 | 100 | `jpeg` and `webp` only. Works like JPEG quality: lower is smaller with more artifacts. |
| `n` | 1 to 10 | 1 | Multiplies output token cost. |
| `output_dir` | directory path | `IMAGEN_OUTPUT_DIR` env, else `./output` | Relative to the server working directory. |
| `file_name` | base name without extension | timestamp plus a slug of the prompt | With `n` greater than 1, a `-1`, `-2` suffix is added. |
| `return_image` | boolean | `false` | Also return the image inline as MCP image content. |

The result lists the saved file paths, the model, the size, and token usage.
