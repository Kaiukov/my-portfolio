#!/usr/bin/env python3
"""
Simple test agent that generates a greeting and sends it to webhook.
Purpose: Test claude_agent_sdk with minimal token usage.
"""
import asyncio
import os
import json
import logging
import urllib.request
from pathlib import Path
from datetime import datetime
from claude_agent_sdk import query, ClaudeAgentOptions

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
    handlers=[
        logging.FileHandler('/home/kaiukov/my-portfolio/logs/test_agent.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).parent.parent
WEBHOOK_URL = os.getenv("REPORT_WEBHOOK_URL", "https://n8n.neon-chuckwalla.ts.net/webhook/dailyreport")
TIMESTAMP = datetime.now().strftime("%Y%m%d_%H%M%S")


def save_greeting_to_html(greeting: str) -> Path:
    """Save greeting to an HTML file."""
    reports_dir = PROJECT_ROOT / "reports"
    reports_dir.mkdir(exist_ok=True)

    html_file = reports_dir / f"greeting_{TIMESTAMP}.html"

    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Greeting</title>
    <style>
        body {{ font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; }}
        .container {{ max-width: 600px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }}
        h1 {{ color: #333; }}
        .timestamp {{ color: #666; font-size: 12px; }}
        .greeting {{ background: #e8f4f8; padding: 15px; border-left: 4px solid #2196F3; margin: 20px 0; font-size: 16px; }}
    </style>
</head>
<body>
    <div class="container">
        <h1>🎯 Test Agent Greeting</h1>
        <p class="timestamp">Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
        <div class="greeting">
            {greeting}
        </div>
        <p><small>This is a test message from the simple greeting agent.</small></p>
    </div>
</body>
</html>
"""

    html_file.write_text(html_content, encoding='utf-8')
    logger.info(f"✓ Greeting saved to {html_file.name}")
    return html_file


def send_to_webhook(html_file: Path, greeting: str) -> bool:
    """Send greeting to webhook."""
    if not WEBHOOK_URL:
        logger.info("ℹ WEBHOOK_URL not set, skipping webhook send")
        return True

    try:
        html_content = html_file.read_text(encoding='utf-8')

        payload = json.dumps({
            "reportTitle": "Test Greeting",
            "reportName": html_file.name,
            "greeting": greeting,
            "timestamp": datetime.now().isoformat(),
            "content": html_content,
        }).encode('utf-8')

        req = urllib.request.Request(
            WEBHOOK_URL,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read().decode('utf-8')
            if resp.status < 300:
                logger.info(f"✓ Webhook sent successfully ({resp.status})")
                return True
            else:
                logger.error(f"✗ Webhook returned {resp.status}: {body}")
                return False

    except urllib.error.HTTPError as e:
        logger.error(f"✗ Webhook HTTP error {e.code}: {e.read().decode()}")
        return False
    except urllib.error.URLError as e:
        logger.error(f"✗ Webhook connection error: {e.reason}")
        return False
    except Exception as e:
        logger.error(f"✗ Unexpected error: {e}")
        return False


async def main():
    logger.info("=== Test Agent Started ===")

    greeting_response = None

    # Simple greeting prompt to minimize token usage
    async for message in query(
        prompt="""Pick ONE random friendly greeting from this list and return ONLY that phrase:
- Hello! 👋
- Hi there! 😊
- Greetings! 🎉
- Hey! 🙌
- Welcome! ✨

Just the greeting, nothing else.""",
        options=ClaudeAgentOptions(
            permission_mode="bypassPermissions",
            allowed_tools=[],
            model="haiku"  # Use Haiku for minimal token usage
        )
    ):
        msg_type = type(message).__name__

        if msg_type == "AssistantMessage":
            content = getattr(message, "content", None)
            if content:
                logger.info(f"Assistant response received")
                greeting_response = content

        if hasattr(message, "result") and message.result:
            logger.info(f"Final result: {message.result}")
            greeting_response = message.result

    if greeting_response:
        # Convert to string and clean up
        greeting_text = str(greeting_response).strip()

        logger.info(f"Greeting: {greeting_text}")

        # Save to HTML
        html_file = save_greeting_to_html(greeting_text)

        # Send to webhook
        webhook_success = send_to_webhook(html_file, greeting_text)

        if webhook_success:
            logger.info("✅ Test agent completed successfully")
        else:
            logger.warning("⚠️ Test agent completed with webhook error")
    else:
        logger.error("❌ Failed to generate greeting")


if __name__ == "__main__":
    asyncio.run(main())
