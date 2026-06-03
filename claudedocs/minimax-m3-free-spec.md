# MiniMax M3 Free — Model Spec

## 1. Summary

MiniMax M3 is a frontier coding/agentic LLM released June 1, 2026, using the novel MSA (MiniMax Sparse Attention) architecture. The `opencode/minimax-m3-free` variant provides free-tier access through OpenCode Zen for a limited time, making a near-frontier agentic model available at zero cost — though collected data may be used for training during the free period.

## 2. Specs Table

| Property | Value |
|---|---|
| **Provider** | OpenCode Zen (underlying: MiniMax) |
| **Model ID** | `opencode/minimax-m3-free` |
| **Context window (input)** | 1M tokens (guaranteed min 512K) |
| **Max output tokens** | 128K (evaluated at 128K in benchmarks; 512K in IMO test with test-time scaling) |
| **Modalities** | Text, Image, Video (native multimodal; Step 0 joint training) |
| **Tool/Function calling** | Yes — designed for agentic workflows, supports Claude Code / OpenCode scaffolding |
| **Structured output** | Yes (JSON mode, tool calls) |
| **Computer Use** | Yes (via multimodal + agentic capability) |
| **Thinking mode** | Togglable on/off (on for complex reasoning, off for latency-sensitive) |
| **Knowledge cutoff** | Unverified (not published by MiniMax) |
| **Open Source** | Weights to be released (announced June 1, 2026) |

## 3. Free-Tier Limits & Caveats

- **Availability**: "Limited time" (per OpenCode Zen pattern for free models). Not listed on the Zen pricing page as of May 31, 2026 — appears to be a recent addition.
- **Data usage**: During free period, prompts and outputs may be used to improve the model. Do not submit sensitive data. ([Zen Privacy Policy](https://opencode.ai/docs/zen/#privacy))
- **Rate limits / quotas**: Unpublished. No documented daily caps or concurrency limits for this specific model. Apply standard Zen per-account fairness.
- **Support**: Best-effort, no SLA.
- **Upgrade path**: Paid MiniMax M3 available via MiniMax Token Plan ($20–120/mo) or direct API; paid Zen M2.7/M2.5 at $0.30/$1.20 per 1M tokens.

## 4. Performance & Quality

All benchmark scores from the [MiniMax M3 blog post](https://www.minimax.io/blog/minimax-m3) (June 1, 2026). Scaffolded with Claude Code unless noted.

| Benchmark | M3 | Comparison |
|---|---|---|
| SWE-Bench Pro | 59.0% | Surpasses GPT-5.5, Gemini 3.1 Pro; approaches Opus 4.7 |
| Terminal-Bench 2.1 | 66.0% | Frontier; 128K max output, 2h timeout |
| SWE-fficiency | 34.8% | 1C2G sandbox, 2h timeout |
| KernelBench Hard | 28.8% | Blackwell GPU; 9.4× CUDA kernel speedup demo |
| MCP Atlas | 74.2% | Tool-use benchmark |
| BrowseComp | 83.5 | Surpasses Opus 4.7 (79.3) |
| PostTrainBench | 0.37 | #3 behind Opus 4.7 (0.42) and GPT-5.5 (0.39) |
| Claw-Eval | Highest | Agentic end-to-end eval |
| OmniDocBench | Above Gemini 3.1 Pro | Multimodal document understanding |

**Strengths**:
- Near-frontier coding and agentic capability at zero cost
- Massive 1M context window (MSA architecture)
- Native multimodal (image, video, computer use)
- Effective long-horizon autonomous execution (12h+ paper reproduction, 24h kernel optimization)

**Weaknesses**:
- Free tier: data may be used for training, no SLA, limited-time availability
- Latency/throughput characteristics not published for the free variant
- Slightly behind Opus 4.7 and GPT-5.5 on post-training autonomous research (PostTrainBench)

## 5. Recommended Use as an Agent Tier

| Task Type | Model | Rationale |
|---|---|---|
| **Lint, imports, ruff fixes, mechanical edits** | `deepseek/deepseek-v4-flash` | Cheapest ($0.14/$0.28 per 1M), fastest, adequate for deterministic work |
| **Simple refactors, small feature work, test writing** | `opencode/minimax-m3-free` | Frontier quality at zero cost; good for routine agentic tasks where data-sensitivity is not a concern |
| **Architecture design, complex bug fixes, reasoning-heavy tasks** | `deepseek/deepseek-v4-pro` | Stronger reasoning than flash, moderate cost, reliable |
| **Orchestration, multi-file refactors, context-heavy tasks** | `opencode/minimax-m3-free` (or M3 paid) | 1M context window excels at whole-repo awareness |
| **Very complex agentic workflows, high-stakes changes** | Codex GPT-5.x via Zen | Most capable for intricate multi-step agent tasks |

**Concrete guidance for this project's orchestrator**:
- Use `opencode/minimax-m3-free` as the default **worker agent** for routine coding tasks (simple features, test writing, refactors) — it's free and near-frontier.
- Reserve `deepseek/deepseek-v4-pro` for **planning and reasoning** (architecture decisions, bug diagnosis).
- Reserve `deepseek/deepseek-v4-flash` for **mechanical bulk work** (lint fixes, imports, type annotations) where speed/cost matter most.
- Reserve Codex GPT models for **the most complex multi-step agent sessions**.
- **Do NOT send sensitive/proprietary data** to the free tier — data may be used for training.

## 6. Sources

- [MiniMax M3 Blog Post & Benchmarks](https://www.minimax.io/blog/minimax-m3) — official benchmark numbers, architecture description, release info
- [MiniMax M3 Product Page](https://www.minimax.io/models/text/m3) — context window, multimodal, MSA details
- [OpenCode Zen Pricing & Privacy](https://opencode.ai/docs/zen/#pricing) — free model caveats, data retention policy
- [OpenCode Zen API](https://opencode.ai/zen/v1/models) — model list confirming `minimax-m3-free`
- [MiniMax Token Plan Quickstart](https://platform.minimax.io/docs/token-plan/quickstart) — API integration, subscription tiers
