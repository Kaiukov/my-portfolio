<background>
Ты Python-разработчик, специализирующийся на финансовых расчётах и DuckDB. Задача: исправить баги и доработать portfolio_db проект для корректного расчёта daily return rate с разделением investment return и cash flow impact.

Проект находится в /Users/oleksandrkaiukov/Code/my-portfolio/portfolio_db/
План миграции: /Users/oleksandrkaiukov/Library/Mobile Documents/iCloud~md~obsidian/Documents/Notes/Duckdb migration.md
</background>

<setup>
1. Прочитай план миграции из Obsidian: Duckdb migration.md
2. Изучи текущую структуру проекта portfolio_db/ (calculator.py, database.py, portfolio_service.py, price_service.py, cli.py)
3. Найди все места где используется CASH EUR, CASH GBP, CASH USD
4. Проанализируй текущую формулу TWR в calculator.py (строки 217-225)
</setup>

<tasks>
1. Исправить баг TWR в calculator.py: переместить строку 'adjusted_base += cash_flow_impact' ПОСЛЕ расчёта investment_return (строка 223), не до

2. Мигрировать формат CASH на Yahoo Finance формат:
   - CASH USD -> USD (базовая валюта, rate = 1.0)
   - CASH EUR -> EURUSD=X
   - CASH GBP -> GBPUSD=X
   - Обновить все проверки asset.startswith('CASH') на новый формат

3. Добавить функцию get_asset_type(ticker) в calculator.py:
   - USD -> cash_base
   - *USD=X -> cash_fx
   - *-USD -> crypto
   - *.L -> stock_gbp
   - *.DE -> stock_eur
   - остальное -> stock_usd

4. Обновить _calculate_portfolio_value() для работы с новым форматом:
   - USD: quantity * 1.0
   - EURUSD=X, GBPUSD=X: quantity * fx_rate
   - Акции .L/.DE: quantity * price * fx_rate

5. Исправить _get_daily_cash_flow() - конвертировать cash flow в USD:
   - DEPOSIT на EURUSD=X должен конвертироваться через курс
   - Сейчас EUR депозит считается как USD (баг)

6. Обновить database.py - добавить SQL миграцию для существующих данных:
   - UPDATE transactions SET asset = 'USD' WHERE asset = 'CASH USD'
   - UPDATE transactions SET asset = 'EURUSD=X' WHERE asset = 'CASH EUR'
   - UPDATE transactions SET asset = 'GBPUSD=X' WHERE asset = 'CASH GBP'

7. Обновить portfolio_service.py - метод discover_assets_and_currencies():
   - Убрать отдельную логику для FX currencies
   - Использовать единый подход через get_asset_type()

8. Добавить unit тесты в tests/test_calculator.py:
   - Тест TWR: deposit 1000 USD, рост актива 10%, проверить investment_return = 10%
   - Тест FX: deposit 1000 EUR при курсе 1.10, проверить portfolio_value = 1100 USD
   - Тест cash_flow: deposit задним числом не должен искажать historical returns
</tasks>

<testing>
1. Запустить тесты: cd /Users/oleksandrkaiukov/Code/my-portfolio && uv run pytest portfolio_db/tests/ -v
2. Проверить CLI: uv run python -m portfolio_db report --format json | head -50
3. Проверить что investment_return отличается от portfolio_daily_return при наличии deposits
4. Проверить что EURUSD=X корректно конвертируется в USD
</testing>

Output <promise>COMPLETE</promise> when all tasks are done.