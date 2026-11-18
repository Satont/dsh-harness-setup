# Гибкая настройка моделей и автокомпакшна

## Что настраивается где

| Что | Где | Как |
|---|---|---|
| Список моделей, context window, max output, input types, API-ключи, кастомные провайдеры | **Настройки → Модели** (Settings → Models) | карточка провайдера → «Редактировать» → «Индивидуальные настройки»; поля пустые = значение из каталога (плейсхолдер `1M` / `128K` — не фактические) |
| Модель и reasoning effort на сессию | пикер модели в composer | выбор модели + Low/Medium/High/Xhigh; effort хранится в сессии |
| Модель/глубина/параллельность субагентов | **Настройки → Плагины → Subagent** | рекурсия, параллельность, модель субагентов |
| Параллельные tool calls в шаге | **Настройки → Плагины → Agent loop** | «Parallel tool calls» |
| Автокомпакшн (порог/retain/summarizer) | **нет страницы в UI** — конфиг пресета `standard` (`compaction-basic`) | генерируется скриптом ниже в `cordis.patch.yml` |
| Ручная компакция | composer `/compact` | сжать историю немедленно |

## Что уже применено

- `openai-codex` модели: **gpt-6.1-sol = 500 000 / 32 768**, остальные (gpt-6-astra, gpt-6-sol,
  gpt-6-luna, gpt-5.6-*) = **272 000 / 32 768**. Max output снижен со 128k до 32k, чтобы резерв
  ответа не съедал окно под историю.
- Reasoning levels: Low / Medium / High / Xhigh (из профиля `llm-pi-ai`).
- Автокомпакция в пресете `standard` (все новые агенты):
  **`thresholdRatio: 0.8`, `headroomTokens: 32768`, `retainRatio: 0.2`, `maxTokens: 32768`, `auto: true`**.

### Почему такие числа

Формула DSH: `триггер = floor(min(W × thresholdRatio, W − O − headroomTokens))`,
где `W` — окно контекста, `O` — зарезервированный лимит ответа. `retainRatio` задаёт, сколько
самой свежей истории остаётся дословно (доля от `W − O`).

| Модель | W | O | Триггер | Доля окна | Оставляем дословно |
|---|---:|---:|---:|---:|---:|
| GPT-6.1 Sol (`openai-codex`) | 500 000 | 32 768 | **400 000** | 80% | ~93k |
| GPT-6 / GPT-5.6 | 272 000 | 32 768 | **206 464** | 76% | ~48k |
| DeepSeek flash / v4-pro (официальный) | 1 048 576 | 262 144 | **753 664** | 72% | ~157k |
| OpenCode GO (большинство моделей) | 1 000 000 | 128 000 | **800 000** | 80% | ~174k |

Почему 80%, а не 95%: у моделей есть «context rot» — точность падает по мере заполнения окна
([Anthropic: effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)).
Claude Code по умолчанию компактит около 95%, а практические рекомендации — 50–80% в зависимости
от задачи; LangChain Deep Agents — 85%
([разбор порогов](https://raw.githubusercontent.com/agentpatterns-ai/website/refs/heads/main/context-engineering/manual-compaction-dumb-zone-mitigation.md)).
Codex ограничивает свой `model_auto_compact_token_limit` 90% окна
([RimZ agent reference](https://raw.githubusercontent.com/rimio-az/rimz/e6b2542449b431d587df59df14e7e50d64f93148/docs/reference/agent-support.md)).
80% — компромисс: ещё не поздно для качества, но и не режем контекст раньше времени.

Почему retain 20%: компакция лоссовая; слишком агрессивная теряет детали, которые всплывут позже
(это признаёт и Anthropic). 20% дают после сжатия ~48k для 272k-моделей и ~93k для 500k — свежая
работа остаётся дословной, а не только в пересказе. Для DeepSeek эффективный триггер ниже (72%),
потому что его дефолтный лимит ответа 256k резервирует много окна; если понадобится компактить
позже — уменьши `maxTokens` у DeepSeek в настройках провайдера до 64k (тогда триггер станет ~80%).

Ручная компакция `/compact` остаётся для переходов между задачами — по рекомендациям её лучше
делать до начала reasoning-тяжёлой работы, а не ждать автотриггера.

## Как менять пороги

```sh
node model-tuning/sync-standard-preset.mjs \
  --threshold-ratio 0.8 --headroom 32768 --retain-ratio 0.2 \
  --summary-max-tokens 32768 --auto true
```

Скрипт берёт установленный `dsh-web-app/presets/standard.patch.yml`, подставляет конфиг в
`compaction-basic` и перезаписывает блок между маркерами
`# >>> model-tuning:standard-preset` в `~/.dsh/profiles/web/cordis.patch.yml`
(с бэкапом). После правки — reload страницы; новые сессии подхватят настройки.

Опционально можно закрепить дешёвую модель для саммари вместо routed-модели:

```sh
node model-tuning/sync-standard-preset.mjs \
  --summarization-provider deepseek --summarization-model deepseek-chat
```

(по умолчанию саммари пишет та же модель, что и диалог — так переиспользуется тёплый кэш префикса).

## Capacities через UI

Для любого провайдера в **Настройки → Модели → Редактировать** можно переопределить
`Контекстное окно` и `Максимальное количество выходных токенов` — эти числа влияют и на
компакцию, и на то, как DSH считает заполнение контекста. Увеличение max output уменьшает
доступное окно под историю (резерв вывода вычитается из контекста).
