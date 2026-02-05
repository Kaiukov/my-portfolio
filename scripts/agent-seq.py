import asyncio
import os
import subprocess
import logging
from pathlib import Path
from datetime import datetime
from claude_agent_sdk import query, ClaudeAgentOptions, AgentDefinition

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

DATE = datetime.now().strftime("%Y%m%d")
PROJECT_ROOT = Path(__file__).parent.parent
LANGUAGE = "Русский"

schema = {
    "type": "object",
    "properties": {
        "reportTitle": {
            "type": "string",
            "description": "The title of the generated report"
        },
        "reportPath": {
            "type": "string",
            "description": "The file system path where the report is stored"
        },
        "reportName": {
            "type": "string",
            "description": "The filename of the report"
        }
    },
    "required": ["reportTitle", "reportPath", "reportName"]
}

logger.info(f"Starting agent run for date: {DATE}")


def run_startup_tasks():
    """Run startup tasks: git pull, clean tmp, run init script"""
    logger.info("Running startup tasks...")

    # Git pull (continue if fails)
    try:
        subprocess.run(["git", "pull"], cwd=PROJECT_ROOT, check=False, capture_output=True)
        logger.info("  ✓ Git pull completed")
    except Exception as e:
        logger.error(f"  ✗ Git pull failed: {e}")

    # Clean tmp directory
    tmp_dir = PROJECT_ROOT / "tmp"
    try:
        if tmp_dir.exists():
            for file in tmp_dir.iterdir():
                if file.is_file():
                    file.unlink()
            logger.info(f"  ✓ Cleaned {tmp_dir}")
    except Exception as e:
        logger.error(f"  ✗ Failed to clean tmp: {e}")

    # Run startup.py if exists
    startup_script = PROJECT_ROOT / ".claude" / "hooks" / "startup.py"
    if startup_script.exists():
        try:
            result = subprocess.run(
                ["uv", "run", str(startup_script)],
                cwd=PROJECT_ROOT,
                check=True,
                capture_output=True,
                text=True
            )
            logger.info("  ✓ Startup script completed")
            if result.stdout:
                logger.info(result.stdout.strip())
        except Exception as e:
            logger.error(f"  ✗ Startup script failed: {e}")
    else:
        logger.info(f"  ℹ Startup script not found at {startup_script}")


async def main():
    # Run startup tasks before agent starts
    run_startup_tasks()

    async for message in query(
        prompt=f"""You are News orchestrator. 

        All tasks should run unattended without waiting for user confirmation.

        Phase 1: Run these tasks in parallel:
        1. Use the biggest-investors-news agent to gather investor news
        2. Use the ukr-news agent to gather Ukraine news

        Phase 2: After Phase 1 is completed, 

        - Read and execute command {PROJECT_ROOT}/.claude/commands/news.md with parameters:
            - Language: {LANGUAGE}
            - Report type: Standart-daily-report
            - Output path: {PROJECT_ROOT}/reports
            - Date: {DATE}
        - Load skill "financial-report-format"

        Phase 3: Spellcheck the report
        - Edit the report to ensure it is free of errors
        - Ensure that you use {LANGUAGE} language
        - Do not mix languages
        - Do not use Chinese characters
        
        Save PATH: 
        Use {PROJECT_ROOT}/tmp/ directory for any temporary files.""",
        options=ClaudeAgentOptions(
            permission_mode="bypassPermissions",
            allowed_tools=["Read", "Write", "Edit", "Grep", "Glob", "Bash", "Task", "skill"],
            model="opus",
            mcp_servers={
                "searxng": {
                    "command": "uv",
                    "args": ["run", "--with", "mcp-searxng", "mcp-searxng"],
                    "env": {
                        "SEARXNG_BASE_URL": "http://zimaos.neon-chuckwalla.ts.net:3000"
                    }
                }
            },
            agents={
                "biggest-investors-news": AgentDefinition(
                    description="Gathers and analyzes news about major investors",
                    prompt="You gather news about biggest investors. Focus on significant investment moves and market trends.",
                    tools=["Read", "Grep", "Glob", "Bash", "Task", "mcp__searxng__*"],
                    model="haiku"
                ),
                "ukr-news": AgentDefinition(
                    description="Gathers and analyzes Ukraine-related news",
                    prompt="You gather news related to Ukraine. Focus on current events and developments.",
                    tools=["Read", "Grep", "Glob", "Bash", "Task", "mcp__searxng__*"],
                    model="haiku"
                )
            },
            output_format={
                "type": "json_schema",
                "schema": schema
            }
        )
    ):
        msg_type = type(message).__name__

        # Show content for important message types
        if msg_type == "UserMessage":
            content = getattr(message, "content", None)
            if content:
                logger.info(f"📤 USER: {content[:100]}...")
        elif msg_type == "AssistantMessage":
            content = getattr(message, "content", None)
            if content:
                logger.info(f"📥 ASSISTANT: {content[:100]}...")
        else:
            logger.info(f"Message type: {msg_type}")

        if hasattr(message, "result"):
            logger.info(f"✅ Result: {message.result}")
            print(message.result)

    logger.info("Agent run completed")


if __name__ == "__main__":
    asyncio.run(main())
