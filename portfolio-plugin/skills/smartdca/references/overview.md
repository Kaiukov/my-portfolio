# Smart DCA Overview

This skill does one monthly job:

1. Check 4 market parameters
2. Decide the regime from those market parameters
3. Evaluate each asset separately
4. Return how much to buy of each asset this month

Read the reference files in this order:

1. `config.md` for budget and asset allocation percentages
2. `workflow.md` for the decision flow
3. `rules.md` for the investment logic
4. `data-sources.md` for macro and technical data
5. `portfolio.md` for portfolio checks
6. `output.md` for the final response format

Use the rules file as the source of truth. If anything conflicts, `rules.md` wins.
