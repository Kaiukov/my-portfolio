---
description: "Daily portfolio analysis"
argument-hint: [path-to-news-report]
---

# Инструкции
Проанализировать портфолио, вывести сильные и слабые места, дай рекомендации. Напиши репорт очень кратко.


## Задачи
- [ ] прочитай новостную сводку за последние 24 часа: "$ARGUMENTS"
- [ ] Используй "bash tree ."
- [ ] Используй Sample.md n Template.md как образец репорта
- [ ] Загрузи SKILL: "portfolio-cli"
- [ ] Запустить "bash uv run python -m src.cli summary"
- [ ] Запустить "bash uv run python -m src.cli cash"
- [ ] Запустить "bash uv run python -m src.cli allocation"
- [ ] Проанализировать и написать репорт
- [ ] Сохранить репорт в папку "reports/"
- [ ] Формат репорта .html, паттерн названия: {yyyy-MM-dd}-{Остроумное_название_на_русском}.html (Не используй CSS), Напиши в терминале путь куда ты сохранил репорт прим.: Репорт сохранён: "PATH" 
- [ ] Язык: Русский