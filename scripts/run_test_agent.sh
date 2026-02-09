#!/bin/bash
# Wrapper script for cron to run test agent
cd /home/kaiukov/my-portfolio
/home/kaiukov/.local/bin/uv run scripts/test_agent_greeting.py
