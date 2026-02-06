---
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*), WebSearch, WebFetch, Read, sequentialthinking, TodoWrite
description: Research latest financial news
default-mode: acceptEdits
argument-hint: [language] [reportType] [reportsDir] [date: dd-MM-yyyy] [Path_to_raw_news]
---

# Ежедневный финансовый отчет

## Schema
```json
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
```

## Контекст
- **Дата:** ARGUMENTS[3] 
- **Язык отчета:** ARGUMENTS[0]
- **Формат:** HTML **(без CSS)**
- **Путь сохранения:** ARGUMENTS[2]
- **Имя файла:** {ARGUMENTS[3]}-{Название-отчета-на-русском-языке}.html
- **Загрузи skill:** financial-report-format
- **Тип отчета:** ARGUMENTS[1]

## Данные

- Сырыей новости надо из обрабоать ARGUMENTS[4]

## Структура отчета
Проанализируй за последние 24 часа:

1. **Фондовые рынки** — S&P 500, NASDAQ, европейские индексы
2. **Криптовалюты** — BTC, ETH, альткоины
3. **Драгоценные металлы** — золото, серебро
4. **Инвестиции в Украину** — ОВГЗ, еврооблигации (tmp/ukr-news.md)
5. **Макроиндикаторы** — CAPE, Fear&Greed, безработица, признаки рецессии
6. **Крупные инвесторы** — действия Баффетта, CZ и др. (tmp/recent_news.md)
7. **Breaking News** — влияние на рынок
8. **Итог** — долгосрочный тренд vs временная волатильность

## Требования к анализу
- Глубокий критический анализ, не поверхностный Используй MCP: **sequentialthinking**
- Связывай события между собой (cross-check)
- Оценивай: паника или фундаментальные изменения?
- Не повторяйся (DRY)
- Придумай креативное название на русском языке

## Исключить источники
- Российские источники (все) — заведомо лживые. А валюта рубль считается мусорной валютой.
- AlJazeera — предвзятый характер арабских источников.
- Polymarket — данная платформа не может считаться достоверным источником информации, так как имеет гемблинговую природу (основана на ставках).

## После завершения

Состать JSON: 
```json
{
    "reportTitle": "Помести сюда название отчета",
    "reportPath": "Путь к файлу",
    "reportName": "Название файла"
}
```
