import asyncio
import os
from pathlib import Path
from datetime import datetime
from claude_agent_sdk import query, ClaudeAgentOptions

# Configuration
PROJECT_ROOT = Path("/Users/oleksandrkaiukov/Code/my-portfolio")
LANGUAGE = "en"
DATE = datetime.now().strftime("%Y-%m-%d")


async def main():
    async for message in query(
        prompt=f"Read and execute: {PROJECT_ROOT}/.claude/prompts/news-orchestrator.md",
        options=ClaudeAgentOptions(
            permission_mode="bypassPermissions",
            allowed_tools=["Read", "Write", "Edit", "Grep", "Glob", "Bash", "Task", "Skill"]
        )
    ):
        print(f"[AGENT] {message}")
 


if __name__ == "__main__":
    asyncio.run(main())
