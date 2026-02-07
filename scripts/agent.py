import asyncio
import os
import subprocess
import logging
import json
import urllib.request
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
WEBHOOK_URL = os.getenv("REPORT_WEBHOOK_URL", "https://n8n.neon-chuckwalla.ts.net/webhook/dailyreport")

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


def find_latest_report(reports_dir: Path) -> Path | None:
    """Find the most recently modified .html report in the reports directory."""
    html_files = sorted(
        reports_dir.glob("*.html"),
        key=lambda f: f.stat().st_mtime,
        reverse=True,
    )
    return html_files[0] if html_files else None


def send_report_to_webhook(report_path: Path) -> str | None:
    """Send report to webhook URL using stdlib urllib."""
    if not WEBHOOK_URL:
        logger.info("  ℹ WEBHOOK_URL not set, skipping webhook send")
        return None

    if not report_path.exists():
        logger.error(f"  ✗ Report file not found: {report_path}")
        return None

    try:
        html_content = report_path.read_text(encoding="utf-8")

        payload = json.dumps({
            "reportTitle": report_path.stem,
            "reportName": report_path.name,
            "date": DATE,
            "content": html_content,
        }).encode("utf-8")

        req = urllib.request.Request(
            WEBHOOK_URL,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
            if resp.status < 300:
                logger.info(f"  ✓ Report sent to webhook ({resp.status}): {body}")
                return body
            else:
                logger.error(f"  ✗ Webhook returned {resp.status}: {body}")
                return None

    except urllib.error.HTTPError as e:
        logger.error(f"  ✗ Webhook HTTP error {e.code}: {e.read().decode()}")
    except urllib.error.URLError as e:
        logger.error(f"  ✗ Webhook connection error: {e.reason}")
    except TimeoutError:
        logger.error("  ✗ Webhook request timed out")
    except Exception as e:
        logger.error(f"  ✗ Unexpected error: {e}")
    return None


async def main():
    # Run startup tasks before agent starts
    run_startup_tasks()

    async for message in query(
        prompt=f"""# News orchestrator
        All futher command must run unattended and do not wait confirmation from user to continue.

        ## Phase 1: Preparation phase 

        ### Skills
        - Load SKILL: financial-report-format

        ## Phase 2: Run simultaniosly (IMPORTANT: ENSURE THEN AGENT RUNNING. OTHERWISE IT WILL BE USELESS)
        - Sub-Agent: biggest-investors-news (use MCP mcp__searxng__web_search)
        - Sub-Agent: ukr-news (use MCP mcp__searxng__web_search)

        ## Phase 3: Run when phase 2 is completed 
        - Command: {PROJECT_ROOT}/.claude/commands/news.md (/news [{LANGUAGE}] [Standart-daily-report] [{PROJECT_ROOT}/reports] [date: {DATE}])

        ## Phase 4: Run when phase 3 is completed (IMPORTANT: Run Sub-agent for general-purpose)
        1. Find all english works in the report
        2. Translate to `{LANGUAGE}` language, except names of companies and people.
        3. Do not mix languages in the final report
        4. Use `financial-report-format` skill vocabulary

        ## Path
        - {PROJECT_ROOT}/tmp/ use for temporary files/""",
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

    # Find latest report in reports/ and send to webhook
    reports_dir = PROJECT_ROOT / "reports"
    latest = find_latest_report(reports_dir)

    if latest:
        logger.info(f"📄 Latest report: {latest.name}")
        logger.info(f"📤 Sending report to webhook...")
        webhook_response = send_report_to_webhook(latest)
        if webhook_response:
            logger.info(f"✅ Webhook delivered successfully")
        else:
            logger.error("❌ Webhook delivery failed")
    else:
        logger.warning("⚠️ No .html reports found in reports/")

    logger.info("Agent run completed")


if __name__ == "__main__":
    asyncio.run(main())
