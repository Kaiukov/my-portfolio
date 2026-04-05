#!/bin/bash
#
# Download HDRezka stream to ZimaOS media server.
# Usage: ./scripts/download_to_zima.sh <url> [filename] [quality] [season] [episode]
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Config
PROJECT_ROOT="/root/hdrezka"
ZIMAOS_IP="${ZIMAOS_IP:-100.127.254.31}"
ZIMAOS_USER="kaiukov"
DOWNLOADS_PATH="/media/sdb/mp2tb/media/downloads"

# Get arguments
URL="$1"
FILENAME="${2:-downloaded_video.mp4}"
QUALITY="${3:-720p}"
SEASON="${4:-}"
EPISODE="${5:-}"

if [[ -z "$URL" ]]; then
    echo -e "${RED}Error: URL is required${NC}"
    echo "Usage: $0 <url> [filename] [quality] [season] [episode]"
    exit 1
fi

echo -e "${GREEN}HDRezka Download Script${NC}"
echo "URL: $URL"
echo "Filename: $FILENAME"
echo "Quality: $QUALITY"
echo ""

# Step 1: Get stream URL
echo -e "${YELLOW}[1/4] Getting stream URL...${NC}"
cd "$PROJECT_ROOT"
STREAM_OUTPUT=$(/root/.local/bin/uv run python scripts/get_stream.py "$URL" "$QUALITY" $SEASON $EPISODE)

if [[ $? -ne 0 ]]; then
    echo -e "${RED}Failed to get stream URL${NC}"
    exit 1
fi

VIDEO_URL=$(echo "$STREAM_OUTPUT" | grep -oP '(?<="video_url": ")[^"]*')
SUBTITLES=$(echo "$STREAM_OUTPUT" | grep -oP '(?<="subtitles": )[^,}]*')

if [[ -z "$VIDEO_URL" ]]; then
    echo -e "${RED}No video URL found${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Stream URL obtained${NC}"
if [[ "$SUBTITLES" != "null" ]]; then
    echo -e "${GREEN}✓ Subtitles available: $SUBTITLES${NC}"
else
    echo -e "${YELLOW}⚠ No subtitles available${NC}"
fi
echo ""

# Step 2: Download to ZimaOS staging
echo -e "${YELLOW}[2/4] Downloading to ZimaOS staging...${NC}"
FULL_PATH="$DOWNLOADS_PATH/$FILENAME"
LOG_FILE="/tmp/wget_${FILENAME// /_}.log"

ssh "$ZIMAOS_USER@$ZIMAOS_IP" \
    "nohup wget -O '$FULL_PATH' '$VIDEO_URL' > '$LOG_FILE' 2>&1 &" \
    && echo -e "${GREEN}✓ Download started in background${NC}" \
    || { echo -e "${RED}Failed to start download${NC}"; exit 1; }

echo ""

# Step 3: Monitor download
echo -e "${YELLOW}[3/4] Monitoring download progress...${NC}"
sleep 2

while true; do
    PROGRESS=$(ssh "$ZIMAOS_USER@$ZIMAOS_IP" "tail -1 '$LOG_FILE' 2>/dev/null | grep -oP '\d+%' || echo ''")
    if [[ -n "$PROGRESS" ]]; then
        echo -ne "\rProgress: $PROGRESS   "
    fi

    # Check if download completed
    if ssh "$ZIMAOS_USER@$ZIMAOS_IP" "test -f '$FULL_PATH' && ! grep -q 'Downloaded:' '$LOG_FILE'"; then
        break
    fi

    sleep 2
done

echo ""
echo -e "${GREEN}✓ Download completed${NC}"
echo ""

# Step 4: File info
echo -e "${YELLOW}[4/4] File information:${NC}"
ssh "$ZIMAOS_USER@$ZIMAOS_IP" "ls -lh '$FULL_PATH'"

echo ""
echo -e "${GREEN}Done! File ready at: $FULL_PATH${NC}"
echo ""
echo "Next steps:"
echo "  1. Move to correct media folder (anime/movie/series)"
echo "  2. Clean up temp log: ssh $ZIMAOS_USER@$ZIMAOS_IP \"rm -f '$LOG_FILE'\""
