# Task: Fix issue #253 — Dashboard responsive design full pass

You are already inside the dedicated worktree at `/Users/oleksandrkaiukov/Code/mpc-253` on branch `fix/issue-253-dashboard-responsive`.
Do NOT create another branch or worktree.

Issue: GitHub #253 — Dashboard responsive design — mobile + desktop full pass.
Repo: `Kaiukov/my-portfolio`

Goal:
Make `portfolio-dashboard/index.html` pass the responsive requirements for phone, tablet, and desktop.

Context from orchestrator audit:
- Current dashboard is live at `https://portfolio-dashboard-prod.kayukov2010.workers.dev`
- Current implementation file is `portfolio-dashboard/index.html`
- Existing responsive behavior is limited to:
  - `.cols` becomes one column below 880px
  - `.metrics` becomes 2 columns below 680px
- Audit found these main gaps:
  1. Touch targets too small (`.tab` buttons around 41x26, not 44x44)
  2. Holdings table remains desktop-style on phone
  3. Risk/performance and summary sections are still too dense on phone
  4. Legends are row-dense and not mobile-optimized
  5. Small-screen spacing/padding not meaningfully adapted
  6. Desktop is acceptable but can be improved while preserving max-width readability

Requirements to satisfy from #253:
1. Layout
- Adapt CSS grid/flex for screens < 768px
- Cards stack into a single column on mobile
- Spacing/padding reduced on small screens

2. Metrics and numbers
- No clipping / overlap
- Fonts remain readable on phone
- Tables / metric grids become vertical or mobile-friendly

3. Charts and visualizations
- Sector allocation bar + legend work on narrow screens
- Splitbar remains readable
- Legends can wrap cleanly

4. Navigation / interaction
- Buttons/links touch-friendly, min 44x44
- No horizontal scroll on phone
- Keep bundle simple; avoid overengineering

5. Desktop
- Wide screens remain clean and readable
- Preserve constrained content width

Implementation guidance:
- Prefer targeted CSS/HTML refactor in `portfolio-dashboard/index.html`
- Keep the single-file dashboard architecture unless a small helper extraction is clearly justified
- Preserve existing data behavior; this is primarily a presentation/responsive task
- Avoid changing financial calculations or API shape
- If useful, convert the holdings table to a mobile card/list presentation on narrow screens while keeping desktop table for larger widths
- Ensure legends and metric groups stack cleanly on phone widths
- Increase interactive control sizes to touch-friendly dimensions

Verification expectations:
- Run relevant local checks
- If there is an easy local way to render or preview, use it
- Capture evidence that the layout works at approximately:
  - phone: 375x812 or similar
  - tablet: 768x1024 or similar
  - desktop: 1920x1080 or similar
- If you use Playwright screenshots, keep them in `.orchestrator/` in this worktree

Git / PR instructions:
1. Make the fix
2. Run the narrowest meaningful verification you can plus any relevant project checks
3. `git add -A`
4. Commit with a conventional message
5. `git push -u origin fix/issue-253-dashboard-responsive`
6. Open a PR against `main`
7. In the PR body, include `Closes #253`
8. At the end, report back with:
   - changed files
   - verification run
   - branch name
   - PR URL

Important:
- Do not stop before commit/push/PR
- If blocked, explain the blocker precisely and include command output evidence
