# Credit models and BYOK catalog

Verified 2026-10-31 from the live [OpenRouter models API](https://openrouter.ai/api/v1/models). USD prices are `pricing.prompt/completion × 1_000_000`; no cache discounts. This is a recommendation for issue #69 / ADR 0003, **not owner approval to fix the Credit models**.

## Credit candidates

| OpenRouter id | Input $/1M | Output $/1M | Context | Vision | File/PDF* | Reasoning |
|---|---:|---:|---:|---|---|---|
| `qwen/qwen3.7-flash` | 0.03 | 0.13 | 1,000,000 | Yes | No | Yes |
| `openai/gpt-oss-20b` | 0.018 | 0.09 | 131,072 | No | No | Yes |
| `mistralai/mistral-nemo` | 0.029 | 0.03 | 131,072 | No | No | No |
| `google/gemma-4-26b-a4b-it` | 0.0675 | 0.225 | 262,144 | Yes | No | Yes |
| `deepseek/deepseek-v4-flash` | 0.091 | 0.182 | 1,048,576 | No | No | Yes |
| `google/gemini-2.5-flash-lite` | 0.1 | 0.4 | 1,048,576 | Yes | Yes | Yes |
| `openai/gpt-6-luna` | 0.1 | 0.5 | 1,050,000 | Yes | Yes | Yes |
| `anthropic/claude-haiku-5.5` | 0.1 | 0.5 | 1,000,000 | Yes | Yes | Yes |

*File/PDF means the API advertises `file` input, not arbitrary document support. Vision comes from `image`; reasoning and effort come from `supported_parameters`. A No for files does not prohibit OpenRouter-side PDF extraction. [PDF docs](https://openrouter.ai/docs/guides/overview/multimodal/pdfs) describe native PDF handling versus the file-parser plugin; extraction/OCR may add cost. Validate the selected endpoint and attachment path before setting a catalog `pdf` flag. Images alone do not prove native PDF support.

## Proposed shortlist

- `qwen/qwen3.7-flash`: **$0.0001230 per typical Reply**, $0.001230 for ten Replies.
- `openai/gpt-6-luna`: **$0.0004500 per typical Reply**, $0.004500 for ten Replies.
- `anthropic/claude-haiku-5.5`: **$0.0004500 per typical Reply**, $0.004500 for ten Replies.

These offer a low-cost general-chat choice and two mainstream provider alternatives. This is a cost/capability screening, **not a measured quality or latency ranking**: the models API has no comparable time-to-first-token or throughput measurements. Benchmark chat quality and latency before approval; cheaper Nemo, Gemma and GPT-OSS candidates remain alternatives. Reasoning output can exceed the assumed 600 billed output tokens; cap it and disable/reduce reasoning where supported. Long Chat history, tool calls, PDF parsing, provider-specific price tiers and retries change these estimates. Ten Credits do not impose a dollar ceiling without token limits.

## Proposed curated BYOK catalog

| OpenRouter id | Input $/1M | Output $/1M | Context | Vision | File/PDF* | Reasoning | Effort |
|---|---:|---:|---:|---|---|---|---|
| `openai/gpt-6.1-sol` | 2 | 10 | 1,050,000 | Yes | Yes | Yes | Yes |
| `openai/gpt-6-luna` | 0.1 | 0.5 | 1,050,000 | Yes | Yes | Yes | Yes |
| `anthropic/claude-sonnet-5.5` | 2 | 10 | 1,000,000 | Yes | Yes | Yes | Yes |
| `anthropic/claude-haiku-5.5` | 0.1 | 0.5 | 1,000,000 | Yes | Yes | Yes | Yes |
| `google/gemini-4-argon` | 2 | 10 | 1,048,576 | Yes | Yes | Yes | Yes |
| `google/gemini-3.8-flash` | 0.825 | 4.125 | 1,048,576 | Yes | Yes | Yes | Yes |
| `x-ai/grok-4.7` | 2 | 6 | 500,000 | Yes | Yes | Yes | Yes |
| `deepseek/deepseek-v4.1-flash` | 0.045 | 0.5 | 1,048,576 | Yes | No | Yes | Yes |
| `meta-llama/llama-4-maverick` | 0.1875 | 0.6525 | 524,288 | Yes | No | No | No |
| `qwen/qwen3.8-flash` | 0.15 | 0.47 | 1,000,000 | Yes | No | Yes | No |
| `qwen/qwen3.8-max-prime` | 4 | 12 | 1,000,000 | Yes | No | Yes | Yes |
| `mistralai/mistral-large-4-0` | 0.7 | 2.1 | 1,048,576 | Yes | No | Yes | Yes |

All entries existed in the fetched snapshot; exclude `:free`, `:batch`, image-output and specialist coding variants from general Chat defaults. A supported effort parameter does not establish valid effort values: read the model's `reasoning.supported_efforts` and endpoint capabilities; do not send a universal enum. Refresh cached metadata and detect removed IDs rather than silently substituting another model.

Reproduce the table with `curl -fsSL https://openrouter.ai/api/v1/models`; select exact IDs from `.data`, inspect `.architecture.input_modalities`, `.supported_parameters`, `.reasoning`, `.context_length`, and `.pricing`. The live API is the source of all table cells, not provider-name assumptions.

Snapshot provenance: fetched with curl during this research on 2026-10-31 UTC; raw payload SHA-256 `aa0fd20f5d4075b005484b628313bc0b408b9eda01fe7feeaac8d9beebe7aced`. Tables intentionally retain selected fields only; the API is mutable, so a later fetch may differ. Typical Reply arithmetic is `1_500 × prompt_price_per_token + 600 × completion_price_per_token`.
