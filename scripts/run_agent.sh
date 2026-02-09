#!/bin/bash
# Wrapper script for cron to run main agent
cd /home/kaiukov/my-portfolio
/home/kaiukov/.local/bin/uv run scripts/agent.py
