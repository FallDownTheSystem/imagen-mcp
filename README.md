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

### `edit_image`

Reference images to image. Required: `prompt`, `images` (1 to 16 file paths). Optional `mask` (PNG with alpha) and `input_fidelity` (`high` or `low`).

### Shared options

| Option | Values | Notes |
|---|---|---|
| `model` | `flare`, `sunburst` | |
| `size` | `auto`, `1024x1024`, `1536x1024`, `1024x1536`, `WIDTHxHEIGHT` | Multiples of 16, ratio 1:3 to 3:1, long edge up to 3840. Overrides `aspect_ratio`. |
| `aspect_ratio` | `1:1`, `3:2`, `2:3`, `4:3`, `3:4`, `16:9`, `9:16`, `21:9`, `9:21` | Combined with `long_edge` (default 1536) to compute a size. |
| `quality` | `low`, `medium`, `high`, `xhigh`, `max`, `auto` | |
| `background` | `transparent`, `opaque`, `auto` | Transparent needs `png` or `webp`. |
| `output_format` | `png`, `jpeg`, `webp` | |
| `output_compression` | 0 to 100 | `jpeg` and `webp` only. Works like JPEG quality: lower is smaller with more artifacts. Default 100. |
| `n` | 1 to 10 | |
| `moderation` | `auto`, `low` | `generate_image` only. |
| `output_dir`, `file_name` | paths | Where to save. |
| `return_image` | boolean | Also return the image inline as MCP image content. |

The result lists the saved file paths, the model, the size, and token usage.
