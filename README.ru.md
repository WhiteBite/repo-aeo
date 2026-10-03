# repo-aeo — Repo Discoverability Kit (RDK)

[English](README.md) | **Русский**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

Делает любой репозиторий, npm-пакет и docs-сайт **находимым и рекомендуемым**
для людей, AI-агентов и поисковых систем.

RDK измеряет discoverability вашего репозитория, чинит то, что чинится
автоматически, и не даёт показателю деградировать в CI. Это инструмент, который
направляют на репо, которое *хорошее, но невидимое*.

Аудит выполняет **44 проверки менее чем за 300 мс офлайн** на этом репозитории
(замер через `rdk audit --format json`, поле `duration_ms`) и не имеет **ни одной
рантайм-зависимости**, поэтому `npx` остаётся быстрым, а цепочка поставок — маленькой.

## Быстрый старт

**Требования:** Node.js >= 18

```bash
# 1. add RDK to your repository
npm install --save-dev repo-aeo

# 2. scaffold the config and the missing files
npx repo-aeo init --apply

# 3. see the score and the prioritised fix list
npx repo-aeo audit

# 4. run the test suite
npm test
```

Настройка за две минуты для репозитория, которым вы пока не владеете: склонировать,
запустить `npx repo-aeo init --apply`, затем `npx repo-aeo audit`. Всё, что пишет CLI,
оформляется как просматриваемый дифф — он никогда не публикует, не тегает и не делает
force-push. Единственное исключение живёт в CI: опциональный autofix-job делает
force-push в свою датированную бот-ветку `rdk/autofix-<date>` и открывает PR на ревью.

## Способы использования

Ничего не форкается и не устанавливается насовсем. Выберите поверхность под
свой сценарий — каждая тянет движок по требованию:

| Задача | Команда | Что появится в вашем репо |
| --- | --- | --- |
| CI-гейт на каждый pull request | `uses: WhiteBite/rdk-discoverability@v1` в воркфлоу | `.github/workflows/rdk.yml` (~6 строк) |
| Разовый аудит из терминала | `npx repo-aeo audit` | ничего, пока не запустите `rdk init` |
| Мониторинг для AI-агента | `claude mcp add rdk -- npx repo-aeo-mcp serve` | ничего (конфиг клиента) |
| Скилл в OpenCode/Claude/Codex | `npx repo-aeo skill install` | ничего (симлинк) |

Решите остаться — в репозитории появятся ровно два файла: воркфлоу выше и
`.discoverability/project.yml` — сгенерированный источник правды для ваших
метаданных. Два репозитория RDK (движок и обёртка экшена) остаются нашими:
это фабрика, а не зависимость, которую вы таскаете с собой.

## Проблема

Вы выпустили хороший пакет, но его никто не находит: поиск npm хоронит
его на далёких страницах, AI-ассистенты рекомендуют лидеров, а README
90 строк рассказывает философию проекта до первого запускаемого примера.

Починить один раз — полдела. Вторая половина — не дать деградировать:
через полгода контрибьютор «причёсывает» README баннером и оглавлением,
quickstart уезжает за 60-ю строку, тесты остаются зелёными — и пакет
снова тихо исчезает из поиска и AI-ответов. Никто не заметит: в CI
никто не следит за discoverability.

RDK превращает это в тестируемое свойство: аудит локально, гейт в CI
на каждый pull request.

## Для кого это

- Мейнтейнеры, которые публикуют npm-пакет впервые.
- Команды, чья библиотека хорошая, но невидима в AI-ответах, npm-поиске и GitHub-поиске.
- Авторы агентских инструментов, которым нужно, чтобы их репо было готово к работе с кодинг-агентами из коробки.
- Исследователи и OSS-проекты, которым нужны цитационные и open-discovery метаданные.

## Что вы получаете

Три слоя, потому что разового скрипта недостаточно:

| Слой | Что это | Где |
| --- | --- | --- |
| **Repo Kit** | `.discoverability/project.yml` как единственный источник правды, плюс шаблоны и генераторы | `.discoverability/`, `packages/rdk-cli/src/generate/` |
| **Skillpack** | Инструкции для агентов с прогрессивным раскрытием: аудит → план → патч → проверка → распространение | `skills/repo-discoverability/` |
| **Automation** | [GitHub Action](https://github.com/WhiteBite/rdk-discoverability) на `pull_request`, `workflow_dispatch` и еженедельный cron; собственный CI репозитория догфудит его | `.github/workflows/rdk-audit.yml` |
| **Monitoring** | MCP-сервер с 9 преимущественно read-only инструментами, историей тренда и живыми пробами GitHub / сайта / npms | `packages/repo-aeo-mcp/` |

## Команды

```bash
npx repo-aeo init          # create .discoverability/project.yml + minimal safe files
npx repo-aeo audit         # score 0-100 + findings (json | markdown | github-comment)
npx repo-aeo fix           # preview safe autofixes; --apply to write them
npx repo-aeo npm-surface   # package.json publish surface + npm pack --dry-run
npx repo-aeo github-sync   # push description/homepage/topics (needs --apply --ack --reason --plan-digest)
npx repo-aeo submit        # предложить проект в curated-списки (нужны --apply --ack --reason --plan-digest)
npx repo-aeo skill install # link the agent skill into OpenCode/Claude/Codex skill dirs

npx repo-aeo-mcp serve # the same engine as an MCP server: 9 read-mostly tools
claude mcp add rdk -- npx repo-aeo-mcp serve
docker run -i repo-aeo-mcp serve
```

Каждая операция записи требует явного флага. `audit` работает только на чтение и
офлайн; `--online` добавляет проверку ссылок и живые метаданные GitHub.

## Примеры

### 1. Оценить репозиторий

```bash
$ npx repo-aeo audit            # measured on fixtures/demo-repo, offline
score: 52/100 (grade F) · checks: 20/43 passed · findings: 10 error, 13 warn, 10 info (19 autofixable) · mode: offline (use --online for link + GitHub checks)
```

### 2. Починить то, что безопасно чинится

```bash
$ npx repo-aeo fix --dry-run     # review the diff
$ npx repo-aeo fix --apply       # 16 files: README sections, AGENTS.md draft, llms.txt, CITATION.cff, ...
```

### 3. Проверить publish-поверхность

```bash
$ npx repo-aeo npm-surface --pack
| exports | conditions: import, require; subpaths: . |
⚠️ present in the repo but not in the tarball: llms.txt
```

### 4. Не дать деградировать в CI

```yaml
# .github/workflows/rdk.yml — в ВАШЕМ репозитории
- uses: actions/checkout@v4
- uses: WhiteBite/rdk-discoverability@v1
  with:
    min_score: ${{ vars.RDK_MIN_SCORE || 0 }}
```

GitHub сам скачивает экшен, экшен сам тянет движок из npm — ничего
устанавливать и форкать не нужно. Это тот же экшен, который гоняет CI
самого repo-aeo.

Сам CLI никогда не делает force-push; опциональный autofix-job воркфлоу (под гейтом
`safety.allow_autofix`) force-pushит только свою датированную бот-ветку
`rdk/autofix-<date>` и открывает PR на ревью.

### 5. Мониторить непрерывно

```bash
$ npx repo-aeo-mcp score
Discoverability score: 100/100 (grade A)
checks passed: 44/44 - errors 0 - warnings 0 - autofixable 0
trend: no history yet
```

Первый запуск фиксирует оценку; каждый последующий печатает дельту вместо неё
(например, `trend: 90 -> 96 (up)`).

### 6. Научить агента делать это самому

```text
skills/repo-discoverability/SKILL.md → description triggers on
"make repo discoverable", "add topics", "improve README for users and agents",
"prepare npm metadata", "generate AGENTS.md", "optimize for AI search",
"run a distribution campaign", "submit to awesome lists"
```

## Сценарии использования

- Оценить discoverability репозитория и получить приоритизированный список исправлений.
- Генерировать и поддерживать `AGENTS.md`, `llms.txt` и `llms-full.txt` для репо.
- Подготовить метаданные `package.json`, exports и содержимое тарболла перед релизом на npm.
- Заполнить описание, homepage и 8–20 topics GitHub из одного конфиг-файла.
- Не дать discoverability деградировать с помощью еженедельного аудита GitHub Action.
- Запустить кампанию по распространению: подготовить записи для релевантных curated-списков, отправить ревьюибельные PR и вести их учёт в `.discoverability/submissions.json`.
- Следить за оценкой, npm search score и сигналами GitHub из MCP-клиента или cron-задачи.

## Discoverability Score

Шесть взвешенных осей, перенормированных по осям, применимым к вашему проекту:

| Ось | Вес | Покрывает |
| --- | --- | --- |
| GitHub metadata | 20 | description, homepage, 8–20 topics |
| README primitives | 25 | первый успешный путь, 2–5 примеров, секции для аудитории, утверждения с источниками |
| Agent readiness | 15 | `AGENTS.md` с рабочими командами, правила do/don't |
| npm readiness | 20 | description, keywords, exports, types, гигиена тарболла |
| Docs readiness | 12 | `llms.txt`, JSON-LD, здоровье ссылок |
| Trust & hygiene | 8 | LICENSE, SECURITY.md, CONTRIBUTING.md, CODEOWNERS, отсутствие утечек секретов |

Оценки: A ≥ 90 · B ≥ 80 · C ≥ 70 · D ≥ 55 · F ниже. Полная модель:
[`docs/scoring.md`](./docs/scoring.md).

## Почему стоит выбрать это

- **Один конфиг-файл управляет всем.** `.discoverability/project.yml` питает
  README, `AGENTS.md`, `llms.txt`, npm-метаданные и GitHub topics — расхождений
  между ними нет.
- **Одинаковый аудит локально и в CI.** Поставляется как CLI, агентский скилл и
  GitHub Action, поэтому человек и агент гоняют идентичные проверки.
- **По умолчанию только аудит.** Запись требует явного флага; публикация, тегание
  и релизы полностью вне скоупа и требуют ACK-строку от человека.
- **Детерминированные генераторы.** Ноль рантайм-зависимостей, LLM в контуре нет:
  каждая сгенерированная строка трассируется до конфига или до файла в репо.

## Как RDK соотносится с аналогами

Большинство инструментов в этой области привязаны к **развёрнутому сайту**
(llms.txt-валидаторы, GEO-грейдеры, Lighthouse), к **опубликованному пакету**
(npms.io) или к **сборке документации** (генераторы фреймворков). RDK привязан
к **git working tree**: он аудирует и чинит сам репозиторий до того, как что-то
задеплоено или опубликовано.

### Прямые аналоги: репо-локальные грейдеры артефактов и генераторы

| Инструмент | Единица анализа | Оценки | Генерирует | Валидирует | Пишет в GitHub | Агентский интерфейс | CI |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **RDK (этот репо)** | git working tree | рубрика 0-100, 6 осей | llms.txt, llms-full.txt, AGENTS.md, JSON-LD, CITATION.cff, шаблоны | свежесть, структура, пробы ссылок (`--online`) | guarded sync (ack + reason + preview) | MCP-сервер + агентский скилл | marketplace Action |
| [repo-health-radar](https://github.com/xxrraa/repo-health-radar) | git working tree | 0-100 + буквенная оценка, 6 осей для человеческого мейнтейнера | - | 35 проверок (доки, CI, готовность к релизу, активность) | - | - | composite Action |
| [GitHub community profile](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/about-community-profiles-for-public-repositories) | репо, hosted checklist | чеклист | - | наличие + поддерживаемое расположение trust-файлов | - | - | встроено в github.com |
| [standard-readme](https://github.com/RichardLitt/standard-readme) + [remark preset](https://github.com/RichardLitt/standard-readme-preset) | README.md | pass/fail lint | только скаффолд | спецификация секций для человеческих читателей | - | - | remark CLI |
| [readme-score](https://github.com/clayallsopp/readme-score), [ReadmeAI](https://github.com/eli64s/readme-ai), README templates | README.md | прокси насыщенности (блоки кода, картинки) | README, написанный LLM | - | - | - | - |
| [cffinit](https://github.com/citation-file-format/cff-initializer-javascript) / [cffconvert](https://github.com/citation-file-format/cffconvert) | CITATION.cff | - | CFF через человеческую форму / конвертации форматов | JSON-схемы с зафиксированной версией | - | - | [reject-only gate](https://github.com/citation-file-format/cffconvert-github-action) |
| [codemeta-generator](https://github.com/codemeta/codemeta-generator) | страница GitHub-репо | - | CodeMeta JSON-LD | JSON-LD context | - | - | - |
| [npms.io](https://npms.io/about) | опубликованный пакет | quality/maintenance/popularity | - | - | - | - | - |
| [Repomix](https://github.com/yamadashy/repomix) / [ai-digest](https://github.com/khromov/ai-digest) | содержимое репо | - | один упакованный контекст-файл | поиск секретов перед выводом | - | потребление через CLI/MCP | - |

### Смежная территория: сайты, индексы и агентский контекст

| Инструмент | Единица анализа | Оценки | Генерирует | Валидирует | Пишет в GitHub | Агентский интерфейс | CI |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [Lighthouse Agentic Browsing](https://developer.chrome.com/docs/lighthouse/agentic-browsing/llms-txt) | развёрнутый сайт | pass/fail аудиты | - | наличие llms.txt, H1, ссылки | - | - | через Lighthouse CI |
| [llms-txt-hub](https://github.com/thedaviddias/llms-txt-hub) / [llms-txt-check](https://github.com/portdeveloper/llms-txt-check) | развёрнутый сайт | - | - | наличие на момент визита; заявления файла против того, что отдаёт сайт | - | браузерное расширение | - |
| Генераторы фреймворков ([Starlight](https://github.com/delucis/starlight-llms-txt), [mkdocs](https://github.com/pawamoy/mkdocs-llmstxt), Docusaurus, Mintlify) / [firecrawl](https://github.com/firecrawl/llmstxt-generator) | сборка доков или краул | - | llms.txt (+ full) на этапе сборки | - | - | - | docs-пайплайн |
| [agentmarkup](https://github.com/agentmarkup/agentmarkup) | сборка сайта | - | llms.txt, JSON-LD, markdown-зеркала | да, на сборке | - | - | шаг сборки |
| [geo-score](https://github.com/jianruntech/geo-score) и GEO-скиллы / [Searchstack](https://github.com/alexpospekhov/searchstack-aeo) | развёрнутый сайт / внешние AI-движки | рубрика 0-100 | - | краулиабилити, разметка, цитаты; видимость бренда в AI-ответах | - | скиллпак | cron |
| [DeepWiki](https://deepwiki.com) и [open-source](https://github.com/AsyncFuncAI/deepwiki-open) [клоны](https://github.com/AIDotNet/OpenDeepWiki) | публичное репо, hosted | - | автовики и диаграммы | - | - | remote MCP | - |
| [Context7](https://github.com/upstash/context7) / [mcpdoc](https://github.com/langchain-ai/mcpdoc) | сторонние доки | - | - | - | - | потребление llms.txt через MCP | - |
| [OpenSSF Scorecard](https://github.com/ossf/scorecard), Socket, Snyk | репо / зависимости, безопасность | 0-10 агрегат с весами риска | - | риск цепочки поставок | только результаты | Socket MCP | scorecard-action |
| [CHAOSS](https://github.com/chaoss/metrics) / [libraries.io](https://github.com/librariesio/libraries.io) | события сообщества / индекс пакетов | каталог метрик, без композита | дашборды | - | - | - | self-hosted платформа |

Ортогональны по замыслу: Scorecard оценивает, насколько репо безопасно потреблять,
community standards оценивают онбординг людей, паковщики сериализуют контент,
DeepWiki хостит сгенерированную вики, а CHAOSS меряет поведение сообщества во
времени. Ни один из них не чинит репозиторий; RDK никого из них не заменяет.

### Где RDK намеренно уже

- **Никакого пакинга кодовой базы.** Repomix и ai-digest отдают репо одним
  контекст-файлом; RDK указывает агентам на правильные файлы (llms.txt, AGENTS.md)
  вместо сериализации содержимого.
- **Никакой валидации CFF-схем.** RDK генерирует заглушку CITATION.cff; сверять её
  с версионированной схемой — работа cffconvert, а история фикса там — reject в CI,
  никогда не rewrite.
- **Одна корневая пара llms.txt.** Никаких корпусов по путям или секциям, как
  секционированные файлы `llms-full.txt` у Ray или пер-продуктовые варианты Cloudflare.
- **Репо-локальные проверки llms.txt.** «Совпадает ли развёрнутый сайт с файлом» —
  это только MCP-инструмент и проба `--online`, а не полный diff сайта против файла,
  как у llms-txt-check.
- **npms.io берётся, а не вычисляется.** Если npms.io исчезнет, npm-ось откатится
  только на метаданные реестра.
- **ACK-строка — переиспользуемая константа.** Упорная модель её наберёт;
  одноразовые токены, привязанные к аргументам (как в зрелых write-gated MCP-серверах),
  закрывают эту дыру плотнее. Компенсирующие контроли здесь — preview по умолчанию
  и журнал причин.
- **Рубрика эвристична, а не наблюдательна.** 96/100 означает, что репо проходит
  проверки, а не то, что оно кого-то обходит в общепопуляционной модели вроде npms.io.
- **Нет оси активности или принятия.** repo-health-radar и CHAOSS оценивают
  отзывчивость мейнтейнеров, ритм релизов и разнообразие контрибьюторов по истории
  событий; RDK скорит только артефакты, поэтому хорошо задокументированное мёртвое
  репо получит здесь высокий балл.
- **Нет измерения видимости в движках.** Searchstack опрашивает Google, AI Overviews
  и чат-ассистентов о вашем бренде; RDK умеет лишь сделать репо читабельным, но
  никогда не наблюдает, как движки его ранжируют.
- **Осведомлённость о расположении trust-файлов — задача GitHub.** Community profile
  принимает CODE_OF_CONDUCT в `.github/`, в корне или в `docs/`; проверки RDK смотрят
  на фиксированные пути.

### Что llms.txt доказуемо даёт

Потребляется агентами **по требованию**: [спека](https://llmstxt.org) говорит, что
файл «used on demand, when an agent needs information about a topic while assisting
a user», для инференса, а не для обучения. OpenClaw поставляет discovery llms.txt
как дефолтное поведение агентов с 2026-02; Chrome в
[Lighthouse Agentic Browsing](https://developer.chrome.com/docs/lighthouse/agentic-browsing/llms-txt)
скорит сайты по нему; Cloudflare, Mintlify, GitBook, Wix и Yoast публикуют или
генерируют его как экосистемную конвенцию, а инструменты вроде
[mcpdoc](https://github.com/langchain-ai/mcpdoc) скармливают его IDE-агентам.

Чего он **не** даёт: ни GPTBot, ни ClaudeBot, ни PerplexityBot, ни Google-Extended,
ни Bingbot не документируют запрос `/llms.txt` при обучении или краулинге для
индексации — на их официальных bot-страницах об нём нет ни слова. Защимо ценное —
агенты времени инференса, инструменты чтения репозиториев и описанные выше аудиты
discoverability, а не трафик краулеров.

### Где RDK впереди

- Единственный инструмент из перечисленных, чья единица анализа — working tree:
  всё чинится до первого деплоя или публикации. Ближайший близнец,
  repo-health-radar, делит форму (zero-dep CLI, marketplace-экшен, min-score гейт),
  но грейдит оси человеческого мейнтейнера и не возит ни autofix, ни MCP-сервер,
  ни агентские артефакты.
- README primitives скорятся под потребление агентами (детектируемость команды
  установки, размещение quickstart, парсимая структура); существующие числовые
  грейдеры README наоборот, поощряют человеческую презентацию.
- Кросс-источниковая согласованность (конфиг vs package.json vs GitHub vs README)
  не имеет аналогов; менеджеры topics — это write-only обёртки.
- Идемпотентность двойного запуска (`rdk fix` дважды не даёт диффа) — протестированный
  гейт, тогда как codemod-экосистемы относятся к этому как к фольклору.
- Write-guarded MCP-инструмент с логированием причин и tool annotations на каждом
  инструменте, в пакете с нулевыми рантайм-зависимостями, который аудирует полностью офлайн.

## Статус

Активно разрабатывается. v0.1 возит CLI, скилл, Action **и** MCP-сервер.
IDE-упаковка — следующая
([roadmap issues](https://github.com/WhiteBite/repo-aeo/issues)).

## Карта репозитория

| Путь | Назначение |
| --- | --- |
| `packages/rdk-cli/` | пакет `repo-aeo` (без зависимостей) |
| `packages/repo-aeo-mcp/` | MCP-сервер `repo-aeo-mcp` (9 инструментов, stdio, Dockerfile) |
| `skills/repo-discoverability/` | SKILL.md + references + скрипты для кодинг-агентов |
| `.github/workflows/` | CI: аудит discoverability на PR (догфудит marketplace-экшен) и tag-driven релиз |
| `fixtures/demo-repo/` | демо-репозиторий до/после |
| `docs/` | архитектура, конфигурация, скоринг, MCP-план, ссылки |
| `REPORT.md` | реальный вывод аудита и образец PR-комментария |

## Лицензия

MIT — см. [LICENSE](./LICENSE). Цитационные метаданные: [CITATION.cff](./CITATION.cff).
