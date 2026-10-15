# Ledgerline

[![CI](https://github.com/sinnercode228/ledgerline-billing/actions/workflows/ci.yml/badge.svg)](https://github.com/sinnercode228/ledgerline-billing/actions/workflows/ci.yml)

English version: [README.md](README.md)

Ledgerline — биллинг подписок на TypeScript: тарифы с пробным периодом, продление в день привязки, пересчёт при смене тарифа (proration), номера счетов без пропусков, повторные списания (dunning) и главная книга с двойной записью, через которую проходит каждое движение денег. Движок биллинга — отдельный пакет без зависимостей во время выполнения. На сервере он работает за API на Fastify с PostgreSQL, а в демо тот же движок крутится прямо в браузере на хранилище в памяти. Платежи уходят в Payrail — платёжного провайдера я выдумал и симулирую в процессе; адаптера к настоящему провайдеру в репозитории нет.

Ledgerline, Payrail и все клиенты в демо и в сиде выдуманы; код и тесты настоящие.

Демо: https://sinnercode228.github.io/ledgerline-billing/. При первом открытии страница прогоняет движок через 182 дня истории с фиксированным сидом, до 09:00 UTC сегодняшнего дня, и сохраняет результат в localStorage. Сначала нажмите «+1 неделя» в верхней панели (в английском интерфейсе «+1 week»). Полоса под ней покажет, что произошло за неделю: у Riverbend Logistics, которая на момент открытия просрочена, проходят два последних повтора, после чего долг списывается, а у Gristmill Tools кончается пробный период на карте, которую Payrail отклоняет. Потом откройте счёт Riverbend из раздела «Клиенты»: там четыре попытки оплаты и две проводки в журнале. Кнопка «Сбросить» в боковой панели начинает всё заново.

![Счёт LL-2026-000056 клиента Riverbend Logistics в демо: четыре отклонённые попытки 11, 12, 14 и 16 октября, списание долга и журнал с проводкой по счёту и проводкой на списанные долги](docs/screenshots/invoice-written-off.png)

Стек: TypeScript 5.9 на Node 22, Fastify 5, zod 4, `pg` с обычным SQL, PostgreSQL 16; React 19 и Vite 7 для дашборда; Vitest 4 и fast-check для тестов.

## Одна подписка от пробного периода до списания долга

Я прогнал этот сценарий через HTTP API с `LEDGERLINE_TEST_CLOCK=1` на базе, к которой применены миграции, но не сид. Тестовые часы — это сохранённое «сейчас», которое двигается только вперёд. `POST /v1/test-clock/advance` переводит их по одному дню и на каждом шаге выполняет всю наступившую работу ([`test-clock.ts`](packages/core/src/engine/test-clock.ts)), поэтому продление, не прошедшее в один день, повторяется на следующий раньше, чем случится что-то более позднее. Для круглых дат я сначала перевёл часы на 17 декабря 2026, 09:00 UTC; остальные маршруты описаны в [`docs/api.md`](docs/api.md).

```sh
api() { local path=$1; shift; curl -s -H "Authorization: Bearer $LEDGERLINE_API_KEY" -H 'content-type: application/json' "http://localhost:3000$path" "$@"; }
api /v1/test-clock/advance -d '{"to":"2026-12-17T09:00:00Z"}' > /dev/null
CUS=$(api /v1/customers -H 'Idempotency-Key: cus-1' -d '{"name":"Borealis Analytics","email":"billing@borealis.example.com","currency":"RUB"}' | jq -r .id)
api /v1/customers/$CUS/payment-methods -d '{"card":{"number":"4242 4242 4242 4242","expMonth":12,"expYear":2029}}'
SUB=$(api /v1/subscriptions -H 'Idempotency-Key: sub-1' -d '{"customerId":"'$CUS'","planId":"plan_starter_monthly"}' | jq -r .id)
api /v1/test-clock/advance -d '{"days":14}'   # пробный период кончается; дальше {"to": ...} на каждый шаг
```

| Дата по часам | Что сделал движок | Журнал: дебет / кредит |
|---|---|---|
| 17 дек 2026 | Подписка на Starter, 990,00 ₽ в месяц, 14 дней пробного периода. Статус `trialing`; дата привязки — конец пробного периода, 31 дек 09:00. Счёт не выставляется. | ничего |
| 31 дек | Пробный период кончился. `LL-2026-000001` за 31 дек – 31 янв, 990,00 ₽, оплачен картой 4242 в том же прогоне. | дебиторка / выручка 990,00; транзитный счёт Payrail / дебиторка 990,00 |
| 31 янв 2027 | Продление, `LL-2027-000001`: счётчик номеров свой на каждый год. Период 31 янв – 28 фев, следующий 28 фев – 31 мар: каждая граница считается от даты привязки и прижимается к длине месяца, поэтому день не сползает на 28-е. | та же пара |
| 10 фев | Переход на Team, 2 990,00 ₽ в месяц, когда осталось 18 дней из 28: счёт на пересчёт `LL-2027-000002`, 1 285,72 ₽, списан сразу. | дебиторка / выручка 1 285,72; транзитный / дебиторка 1 285,72 |
| 10 фев | Новая карта по умолчанию, `4000 0000 0000 0002`, которую Payrail отклоняет. | ничего |
| 28 фев | Продление, `LL-2027-000003`, 2 990,00 ₽: `card_declined`. Подписка `past_due`, `nextRetryAt` — 1 мар 09:00. | дебиторка / выручка 2 990,00 |
| 1 и 3 мар | Попытки 2 и 3, `scheduled_retry`, отклонены. | ничего |
| 5 мар | Попытка 4 отклонена, расписание повторов исчерпано: счёт становится `uncollectible`, подписка `canceled` с `endedAt` 5 мар. | списанные долги / дебиторка 2 990,00 |

После 5 марта на счетах учёта: выручка 6 255,72 по кредиту, транзитный счёт Payrail 3 265,72 и списанные долги 2 990,00 по дебету, дебиторка клиента 0. В оборотной ведомости по 12 511,44 с каждой стороны.

Вот что вернул `POST /v1/subscriptions/:id/plan-change/preview` перед переходом, когда ещё ничего не изменилось (поля периода и id тарифов я убрал):

```json
{
  "effect": "invoice_now", "changeAt": "2027-02-10T09:00:00.000Z",
  "credit": 63642, "charge": 192214, "net": 128572, "creditApplied": 0, "amountDue": 128572,
  "lines": [
    { "kind": "proration_credit", "description": "Unused time on Starter", "amount": -63642 },
    { "kind": "proration_charge", "description": "Remaining time on Team", "amount": 192214 }
  ]
}
```

Суммы — целые копейки. [`proration.ts`](packages/core/src/proration.ts) считает в целых секундах: в периоде 2 419 200 секунд, осталось 1 555 200. Возврат за неиспользованное время — floor(99 000 × 1 555 200 / 2 419 200) = 63 642 (точное значение 63 642,86), начисление за новый тариф — floor(299 000 × 1 555 200 / 2 419 200) = 192 214 (192 214,29). Произведение считается через `BigInt` в `mulDivFloor` ([`money.ts`](packages/core/src/money.ts)), так что остаётся точным и за пределами 2^53. Обе строки округляются вниз: полный период даёт ровно цену тарифа, а возврат никогда не больше оплаченного. `changePlan` заново делает тот же расчёт под блокировками подписки и клиента и применяет его, так что счёт получает ровно эти две строки. При понижении тарифа всё наоборот: отрицательная разница проводится как `downgrade_credit` (выручка / кредит клиента), и следующий счёт сначала тратит этот кредит, а уже потом списывает остаток с карты. В демо диалог смены тарифа показывает это разделение:

![Диалог смены тарифа для Saltmarsh Media: неиспользованное время на Starter -€1,50, оставшееся время на Team €4,83, итого €3,33, кредит клиента -€2,00, с карты сейчас €1,33](docs/screenshots/plan-change-preview.png)

Дни повторов берутся из `LEDGERLINE_DUNNING_RETRY_DAYS` (по умолчанию `1,3,5`) и отсчитываются от первой неудачи, а не от предыдущей попытки ([`dunning.ts`](packages/core/src/dunning.ts)). Повторы из-за новой карты расписание не расходуют: привязка карты или выбор другой карты по умолчанию сразу повторяет все неоплаченные счета с триггером `payment_method_updated` ([`customers.ts`](packages/core/src/engine/customers.ts)). Когда расписание кончается, `giveUp` списывает остаток долга по каждому открытому счёту подписки и завершает её ([`payment-results.ts`](packages/core/src/engine/payment-results.ts#L173-L212)).

Разбор цикла повторов, который до коммита `b8aabf0` списывал один счёт дважды, а оборотная ведомость оставалась в нуле, и инвариантов, которые это ловят: [Оборотная ведомость сходилась в ноль, а счёт списали дважды](https://github.com/sinnercode228/sinnercode228/blob/main/notes/ledgerline-balanced-but-wrong.ru.md).

## Почему оборотная ведомость всегда сходится

Счетов учёта пять видов: `receivable:<клиент>`, `customer_credit:<клиент>`, `revenue:<валюта>`, `provider_clearing:<валюта>` и `bad_debt:<валюта>`. Суммы со знаком, дебет положительный. Каждую проводку движок строит одной функцией `transfer(kind, input, debit, credit)` из [`ledger.ts`](packages/core/src/ledger.ts) — две строки на одну сумму — либо зеркально отражает уже существующую (`reversePosting`), и перед записью `assertBalanced` проверяет её ещё раз. Это защита от ошибок в самом движке. База проверяет всё заново сама, кто бы в неё ни писал ([`002_ledger_guards.sql`](server/migrations/002_ledger_guards.sql#L7-L50)):

```sql
CREATE CONSTRAINT TRIGGER journal_entries_balanced
  AFTER INSERT ON journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_entries_check_balanced();
```

Функция триггера вызывает `ledger_assert_balanced`: та считает строки операции и их сумму и бросает `check_violation` с ограничением `journal_transaction_balanced`, если строк меньше двух или сумма не ноль. CHECK не видит другие строки, а триггер, сработавший сразу, отверг бы первую же строку любой операции: после одной строки ничего не сходится. Отложенный до COMMIT, он позволяет вставлять строки по одной, а если они не сошлись, откатывается вся транзакция вместе со счетами и платежами. Второй отложенный триггер, на `journal_transactions`, ловит заголовок операции, к которому так и не добавили строк. [`ledger-constraints.test.ts`](server/test/ledger-constraints.test.ts) вручную вставляет +500 и −400: обе вставки проходят, COMMIT падает с «entries sum to 100», и ни одной строки не остаётся.

Та же миграция и [`001_schema.sql`](server/migrations/001_schema.sql) добавляют остальные правила:

- Журнал только дописывается: UPDATE, DELETE и TRUNCATE на обеих таблицах журнала дают `restrict_violation`. Исправление — зеркальная операция, у которой `reversesId` указывает на исходную.
- Одна валюта на операцию обеспечена структурой: строка журнала хранит валюту, а внешние ключи идут по `(transaction_id, currency)` и `(account_id, currency)`.
- Строки счёта менять нельзя, отложенный триггер проверяет, что они дают в сумме итог счёта, а CHECK держит `amount_due = total - credit_applied`.
- Статус платежа двигается только вперёд (`payments_status_forward_only`), а частичный индекс UNIQUE допускает не больше одного платежа в ожидании на счёт.
- Номер счёта берётся из строки-счётчика на год: `INSERT ... ON CONFLICT (year) DO UPDATE SET last_number = invoice_counters.last_number + 1 RETURNING last_number`. Строка заблокирована до COMMIT, так что параллельная финализация ждёт, а откат возвращает номер. Сценарий «numbers 20 concurrent finalizations without gaps, even when others roll back» гоняется на обоих хранилищах.
- Один счёт за период на подписку и начало периода — частичный индекс UNIQUE из миграции 003. Счета на пересчёт в него не входят: на тестовых часах две смены тарифа могут прийтись на одно мгновение.

`MemoryStore` проверяет те же правила в те же моменты. Каждая транзакция идёт на копии состояния из `structuredClone`; перед тем как заменить состояние копией, хранилище проверяет добавленные операции журнала, а при любой ошибке копия выбрасывается ([`memory-store.ts`](packages/core/src/memory/memory-store.ts)). Кроме фиксированных сценариев, [`random-walk.ts`](packages/core/src/testing/scenarios/random-walk.ts) прогоняет 240 дней на двух сидах: смены тарифов, замены карт, возвраты, ответы только через вебхуки, потерянные ответы, поздние, повторные и переставленные вебхуки, два воркера одновременно. После каждого шага проверки из [`reconcile.ts`](packages/core/src/reconcile.ts) сверяют документы с книгой: оборотную ведомость, дебиторку каждого клиента с долгом по его открытым счетам, транзитный счёт с платежами за вычетом возвратов, выручку с выставленным за вычетом кредитов и возвратов, списанные долги с остатком по счетам `uncollectible`; [`invariants.ts`](packages/core/src/testing/invariants.ts) добавляет к ним сверку каждого списания в Payrail с локальным платежом.

## Сверка работающей базы

Те же проверки работают и на живой базе. `npm run reconcile` читает книгу и документы из `LEDGERLINE_DATABASE_URL` и печатает каждое нарушение отдельной строкой, начиная с имени правила ([`server/src/reconcile.ts`](server/src/reconcile.ts)). На сиде за 120 дней:

```
$ npm run --silent reconcile
no violations in 13 customers, 13 subscriptions, 31 invoices, 37 payments and 31 accounts
```

Потом я вручную, через `psql`, добавил второе списание долга по счёту Tundra Freight Ops в статусе `uncollectible`, сбалансированное само по себе, — ровно то, что писал цикл повторов до `b8aabf0`. Оборотная ведомость по-прежнему в нуле, а команда называет оба счёта учёта, которые больше не сходятся со счетами клиентам:

```
receivable: customer Tundra Freight Ops: receivable -99000, open invoices owe 0
bad_debt: RUB bad debt 198000, uncollectible invoices owe 99000
2 violations in 13 customers, 13 subscriptions, 31 invoices, 37 payments and 31 accounts
```

Код выхода 1, если нашлось хоть одно нарушение, и 0, если нет; ошибка конфигурации или подключения тоже даёт 1, а сообщение уходит в stderr. Кроме `LEDGERLINE_DATABASE_URL`, команде ничего не нужно. Когда API запущен, `GET /v1/reconcile` отдаёт тот же отчёт в JSON по ключу API; имена правил перечислены в [`docs/api.md`](docs/api.md#ledger-and-metrics).

Что она читает: семь запросов в одной транзакции, открытой как `REPEATABLE READ READ ONLY` (`store.run(work, { readOnly: true })`), — всех клиентов, подписки, счета со строками, платежи и счета учёта, причём остатки по ним суммирует PostgreSQL, а из журнала только операции `refund` и `downgrade_credit`. При READ COMMITTED каждый запрос видит то, что закоммичено до его начала, поэтому платёж, который воркер закоммитил между двумя запросами, попал бы в один и не попал в другой и выглядел бы нарушением, которого не было. В одном снимке так не бывает, а любую запись в этой транзакции PostgreSQL отвергает. Дальше строки группируются в словари и сравниваются в памяти, так что работа растёт линейно с объёмом данных: на сиде за 120 дней сравнение занимает около 10 мс, на сиде за 730 дней (195 счетов, 202 платежа, 393 операции журнала) — около 20 мс, а из 0,2 с работы команды почти всё уходит на запуск Node. На такой объём она и рассчитана; при миллионах счетов суммы пришлось бы перенести в SQL.

Одна проверка остаётся только в тестах: каждое списание в Payrail против локального платежа. `FakePayrail` держит свои списания в памяти процесса, который их сделал, поэтому сравнить их может только тест, у которого есть сам провайдер.

## Один движок на PostgreSQL и в браузере

```mermaid
flowchart TB
    subgraph page["web/ в браузере"]
        UI["Дашборд на React"]
        DEMO["DemoApi, тот же JSON, что у /v1"]
    end
    subgraph node["server/ на Node"]
        API["Маршруты Fastify /v1"]
        WH["POST /webhooks/payrail"]
        WK["воркер, раз в 60 с"]
    end
    UI --> DEMO
    UI -. "VITE_API_URL" .-> API
    DEMO --> ENG["BillingEngine из packages/core, время передаётся в каждый вызов"]
    API --> ENG
    WH --> ENG
    WK --> ENG
    ENG --> STORE["Порт Store"]
    ENG --> PROV["Порт PaymentProvider"]
    STORE --> MEM["MemoryStore, сохраняется в localStorage"]
    STORE --> PG[("PgStore на PostgreSQL 16")]
    PROV --> FAKE["FakePayrail в процессе; relay.ts шлёт его подписанные события на маршрут вебхуков"]
```

Движок никогда не читает системные часы. Каждый метод получает `now`, а сервер передаёт либо системное время, либо, при включённых тестовых часах, время из базы ([`clock.ts`](server/src/clock.ts)). К хранилищу движок обращается только через порт `Store` ([`ports/store.ts`](packages/core/src/ports/store.ts)): `run(work)` — одна транзакция, `run(work, { readOnly: true })` — транзакция только для чтения из одного снимка, а 41 метод `StoreTx` — всё, что движок может в ней делать. Два из них делают безопасной работу нескольких воркеров на PostgreSQL: `claimDueSubscription` забирает одну подписку с наступившей работой через `FOR UPDATE OF s SKIP LOCKED`, поэтому каждый период выставляется один раз при любом числе воркеров, а `lockIdempotencyKey` берёт `pg_advisory_xact_lock`, который покрывает и ключ, для которого строки ещё нет. Все вызывающие блокируют в одном порядке — подписка, клиент, счёт, платёж, — как требует комментарий в порте. [`pg-store.ts`](server/src/store/pg-store.ts) — обычный SQL через `pg` с типизированным преобразованием каждой строки, которое аккуратно переводит столбцы `bigint` в числа.

В `packages/core` нет импортов, работающих только в Node. `no-restricted-imports` в ESLint запрещает там `node:*` и встроенные модули Node, в tsconfig стоят `types: []` и библиотека DOM, а подпись вебхуков считается через Web Crypto. Дашборд работает с интерфейсом `LedgerlineApi` ([`client.ts`](web/src/api/client.ts)), у которого две реализации: [`http-client.ts`](web/src/api/http-client.ts) для сервера и [`demo-api.ts`](web/src/demo/demo-api.ts), которая вызывает движок на `MemoryStore` с `FakePayrail` и собирает ответы теми же функциями представления, что и маршруты сервера. Демо подгружается динамическим `import()`, поэтому в сборке для сервера демо-чанка нет. Мир демо строится на генераторе id с сидом и на случайном источнике с сидом, так что все, кто откроет его в один день, получат один и тот же мир вплоть до id; после каждого изменения он сохраняет `MemoryStore.dump()` в localStorage ([`world.ts`](web/src/demo/world.ts)).

Ещё из демо: [обзор после «+1 неделя»](docs/screenshots/overview-after-a-week.png), [журнал вебхуков](docs/screenshots/webhooks.png), [просроченная подписка на телефоне, по-русски](docs/screenshots/phone-past-due-ru.png).

Что должно уметь любое хранилище, записано одним набором из 36 сценариев в [`packages/core/src/testing/scenarios`](packages/core/src/testing/scenarios). Ядро гоняет его на `MemoryStore`, сервер — на `PgStore`, каждому тесту своя свежая схема с миграциями ([`database.ts`](server/test/helpers/database.ts)).

## Вебхуки Payrail: подпись, повторы, поздние ответы

Списание разделено на две части, чтобы никакая блокировка строк не держалась во время сетевого вызова ([`charging.ts`](packages/core/src/engine/charging.ts)). `startPayment` внутри транзакции биллинга записывает платёж в статусе `pending` с ключом `ledgerline:<id счёта>:attempt:<n>`. После COMMIT `executeCharge` отправляет его в Payrail с этим ключом и применяет ответ в новой транзакции. Если вызов упал, исход неизвестен, и платёж остаётся в ожидании. В конце каждого прогона наступившей работы проход восстановления снова спрашивает, с тем же ключом, о платежах, которые висят 10 минут после последнего обращения к Payrail, и Payrail возвращает исходный платёж, а не списывает второй раз. `FakePayrail` выводит id платежа из ключа, поэтому процесс API и воркер получают одинаковые id.

Ответ API, вебхук и проход восстановления сходятся в `applyPaymentResult` ([`payment-results.ts`](packages/core/src/engine/payment-results.ts#L59-L98)). Статус двигается только вперёд, pending → failed → succeeded: тот же исход второй раз ничего не меняет, неудача после успеха сохраняется как `stale_payment_update`, а успех после неудачи применяется. В прогоне выше Payrail отвечал на каждое списание сразу, а relay ([`relay.ts`](server/src/payrail/relay.ts)) потом доставил те же семь исходов подписанными вебхуками; все семь сохранились как `duplicate_payment_update`.

`Payrail-Signature: t=<unix-секунды>,v1=<hex>[,v1=<hex>]`: каждый `v1` — HMAC-SHA256 от `<t>.<сырое тело>` ([`signature.ts`](packages/core/src/payrail/signature.ts)). Маршрут регистрирует собственный парсер, который оставляет тело в Buffer, поэтому HMAC считается по байтам, которые прислал Payrail, а не по заново сериализованному JSON ([`webhooks.ts`](server/src/http/routes/webhooks.ts)). Метка времени должна отстоять от системных часов не больше чем на 300 с, причём от настоящих, даже когда биллинг идёт по тестовым часам. Любой `v1` может совпасть с любым секретом из `LEDGERLINE_WEBHOOK_SECRET=new,old` — так секрет и меняется, — а сравнение hex не останавливается на первом несовпавшем символе. Проверенное событие вставляется с `provider_event_id` под ограничением UNIQUE и обрабатывается в той же транзакции ([`webhooks.ts`](packages/core/src/engine/webhooks.ts)): повторная доставка получает `duplicate: true` и ничего не меняет, а если обработка упала, ничего не сохраняется, и следующая доставка обрабатывается с нуля.

Вот что происходит, если Payrail уже после списания долга сообщает, что попытка 4 всё-таки прошла. За Payrail тут `openssl`; id из моего прогона, свои возьмите из `GET /v1/invoices/:id`:

```sh
body='{"id":"evt_late_1","type":"payment.succeeded","created":1800000000,"data":{"object":{"object":"payment","id":"pay_d96470687f9d85ecbb117d7b","amount":299000,"currency":"RUB","status":"succeeded","failure_code":null,"metadata":{"invoice_id":"in_b2923273bee385a188672490","attempt":"4"}}}}'
t=$(date +%s); sig=$(printf '%s.%s' "$t" "$body" | openssl dgst -sha256 -hmac "$LEDGERLINE_WEBHOOK_SECRET" | sed 's/^.*= //')
curl -s http://localhost:3000/webhooks/payrail -H 'content-type: application/json' -H "Payrail-Signature: t=$t,v1=$sig" --data-raw "$body"
# {"received":true,"duplicate":false,"outcome":"applied"}; повторно: {"received":true,"duplicate":true,"outcome":null}
# изменённая подпись: 400 signature_invalid; t старше 300 с: 400 signature_expired
```

Счёт становится `paid`. Списание долга остаётся в журнале, а после него появляются две новые операции: `payment_succeeded` (транзитный / дебиторка 2 990,00) и `reversal` (дебиторка / списанные долги 2 990,00), у которой `reversesId` указывает на списание. Подписка остаётся отменённой. Создание клиентов и подписок тоже идемпотентно: `POST /v1/customers` и `POST /v1/subscriptions` требуют `Idempotency-Key`, повтор возвращает то, что создал первый запрос, а тот же ключ с другим телом даёт `409 idempotency_conflict`.

## Известные ограничения

- **Настоящего платёжного провайдера нет.** `createRuntime` всегда создаёт `FakePayrail` ([`runtime.ts`](server/src/runtime.ts)), который держит платежи в памяти процесса. Адаптер к настоящему провайдеру должен реализовать три метода `PaymentProvider` ([`ports/provider.ts`](packages/core/src/ports/provider.ts)) и приводить события провайдера к форме, которую читает `readPaymentObject`.
- **Выручка признаётся в момент финализации счёта.** `invoice_finalized` сразу кредитует выручку; счёта доходов будущих периодов нет, поэтому годовой тариф целиком попадает в выручку в день выставления счёта.
- **Смена тарифа не меняет интервал, возвраты только полные.** С месячного на годовой — `422 interval_mismatch`; вместо этого нужно отменить подписку и оформить новую. Возврат отдаёт всё, что карта заплатила по одному оплаченному счёту, а подписка продолжает работать. В машине состояний счёта есть статус `void`, но ничто его не выставляет.
- **Просроченная подписка не продлевается, пока идут повторы.** `claimDueSubscription` берёт её только ради повторов ([`pg-store.ts`](server/src/store/pg-store.ts#L248-L262)). Если её период за это время кончился, следующий выставляется уже после восстановления, с исходными датами.

## Как запустить

Быстрее всего — [демо](https://sinnercode228.github.io/ledgerline-billing/). [`pages.yml`](.github/workflows/pages.yml) прогоняет тесты дашборда, собирает `web/` с `VITE_API_MODE=mock` и `BASE_PATH=/<repo>/` и копирует `index.html` в `404.html`. После `npm ci` то же самое локально: `VITE_API_MODE=mock npm run dev:web`, адрес http://localhost:5173.

В Docker: положите два секрета в `.env` и поднимите стек:

```sh
printf 'LEDGERLINE_API_KEY=%s\nLEDGERLINE_WEBHOOK_SECRET=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > .env
docker compose up --build
```

[`docker-compose.yml`](docker-compose.yml) поднимает PostgreSQL 16, выполняет `migrate`, затем `seed` (он пропускает базу, в которой уже есть клиенты), потом API на http://localhost:3000 и отдельный `worker`. Тестовые часы включены, если `.env` не задаёт `LEDGERLINE_TEST_CLOCK`. В образе только API; дашборд запускается через `npm ci && npm run dev:web`, ключ берётся из `.env`.

Локально, с Node 22.12 или новее и PostgreSQL 16:

```sh
git clone https://github.com/sinnercode228/ledgerline-billing.git && cd ledgerline-billing
npm ci
psql postgres://postgres:postgres@localhost:5432/postgres -c 'CREATE DATABASE ledgerline_dev'
cp .env.example .env    # задать LEDGERLINE_API_KEY и LEDGERLINE_WEBHOOK_SECRET (openssl rand -hex 32), LEDGERLINE_TEST_CLOCK=1
npm run build:server
npm run migrate         # миграции 001-003 и каталог тарифов
npm run seed            # 120 дней истории для 13 клиентов на тестовых часах
npm run serve           # API на http://localhost:3000
npm run worker          # во втором терминале: наступившая работа раз в 60 с
npm run dev:web         # в третьем: дашборд на http://localhost:5173, один раз спросит ключ API
npm run reconcile       # в любой момент: сверка книги со счетами и платежами, код выхода 1 при расхождении
```

`npm run seed -- --days 60` задаёт другую длину истории (от 1 до 730 дней). npm-скрипты читают `.env` через `node --env-file-if-exists`.

| Переменная | По умолчанию | Что делает |
|---|---|---|
| `LEDGERLINE_DATABASE_URL` | нет, обязательна | строка подключения к PostgreSQL; командам `migrate`, `seed` и `reconcile` больше ничего не нужно |
| `LEDGERLINE_API_KEY` | нет, обязательна | bearer-ключ для `/v1`; не короче 32 символов, похожий на заглушку отвергается |
| `LEDGERLINE_WEBHOOK_SECRET` | нет, обязательна | при смене секрета через запятую, `new,old`; каждый не короче 16 символов; первым подписываются события relay |
| `LEDGERLINE_DEV` | `0` | `1` разрешает пустые или слабые ключи для локальной работы |
| `LEDGERLINE_TEST_CLOCK` | `0` | `1` хранит «сейчас» в базе и включает `POST /v1/test-clock/advance`, не больше 400 дней за запрос |
| `LEDGERLINE_DUNNING_RETRY_DAYS` | `1,3,5` | дни после первой неудачи, строго по возрастанию |
| `LEDGERLINE_PAYRAIL_WEBHOOK_URL` | пусто | куда фейковый Payrail шлёт подписанные события; пусто — результаты применяются только внутри процесса |
| `LEDGERLINE_CORS_ORIGINS` | пусто | точные origin браузера через запятую |
| `LEDGERLINE_HOST`, `LEDGERLINE_PORT` | `0.0.0.0`, `3000` | |
| `LEDGERLINE_LOG_LEVEL` | `info` | уровень pino |
| `LEDGERLINE_TEST_DATABASE_URL` | пусто | только для тестов; без неё наборы на PostgreSQL пропускаются |

Сборка дашборда читает `VITE_API_MODE` (`mock` запускает движок в странице), `VITE_API_URL` (по умолчанию `http://localhost:3000`) и `BASE_PATH`.

## Тесты

```sh
psql postgres://postgres:postgres@localhost:5432/postgres -c 'CREATE DATABASE ledgerline_test'
LEDGERLINE_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/ledgerline_test npm test
npm run lint && npm run typecheck
```

241 тест Vitest в 40 файлах, посчитано по JSON-отчёту Vitest: 105 в `packages/core` (16 файлов), 87 в `server` (10 файлов) и 49 в `web` (14 файлов). Из них 72 — это 36 общих сценариев, по разу на каждом хранилище, включая два случайных блуждания. Тесты свойств на fast-check покрывают пересчёт (полный период даёт цену, возврат никогда не больше оплаченного при любой цепочке смен тарифа, строки дают итог счёта), `mulDivFloor` против точного рационального значения, календарь и оборотную ведомость. Шесть тестов в [`ledger-constraints.test.ts`](server/test/ledger-constraints.test.ts) вручную пишут строки в PostgreSQL, чтобы проверить триггеры и ключи, описанные выше. Три теста в [`reconcile.test.ts`](server/test/reconcile.test.ts) запускают команду сверки и `GET /v1/reconcile` на схеме после сида, чистой и со вторым списанием долга, вставленным вручную, и проверяют, что коммит посреди чтения не виден наполовину. HTTP-тесты идут через `inject` Fastify на обоих хранилищах: авторизация, валидация, `Idempotency-Key`, подписи верные, просроченные, подделанные и сделанные прежним секретом, лимит в 400 дней для часов и CORS. Тесты web работают в jsdom: мир демо, диалог смены тарифа, панель часов, сохранение, i18n и форматирование. Без `LEDGERLINE_TEST_DATABASE_URL` ядро и сервер выполняют 135 тестов и пропускают 45.

[`ci.yml`](.github/workflows/ci.yml) в одном job гоняет lint, `tsc -b`, тесты ядра и сервера на сервисе `postgres:16-alpine` и сборку сервера, а в другом — lint, проверку типов, тесты и обе сборки дашборда, для сервера и для демо.

---

Автор — Грешный Котик (sinnercode), беру заказы на похожие задачи: Telegram [@sinnercode](https://t.me/sinnercode). Лицензия [MIT](LICENSE).
