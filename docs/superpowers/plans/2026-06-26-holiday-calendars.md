# Holiday Calendars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow calendars to subscribe to external ICS holiday feeds, cache events in the DB, show them highlighted (with reduced opacity) in FullCalendar, and optionally exclude holiday dates when creating event series.

**Architecture:** A `HolidayCalendar` entity (scoped to a Calendar) stores an ICS URL; `HolidayEvent` caches parsed events. A service fetches and parses ICS on-demand (creation + manual refresh only — no background jobs). The frontend adds a second FullCalendar event source for holiday events (styled via CSS), a settings page to manage feeds, and a checkbox in the series-creation UI to skip dates that fall on holidays.

**Tech Stack:** PHP 8.4 / Symfony 8.1 / Doctrine ORM / `sabre/vobject` 4.x / Symfony HttpClient / React 19 / TypeScript / FullCalendar / Tailwind CSS / shadcn/ui

## Global Constraints

- PHP 8.4, `declare(strict_types=1)` in every PHP file
- Doctrine with `UnderscoreNamingStrategy` — entity properties become snake_case columns automatically
- MySQL 8, auto-increment integer PKs (same as all existing entities)
- All backend endpoints extend `AbstractApiController`, use `#[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]`, decode JSON with `$this->decodeJson()`, and validate DTOs with `$this->validateDto()`
- DTOs live in `backend/src/Dto/Holiday/` (namespace `App\Dto\Holiday`)
- Frontend: React 19 + TypeScript strict mode, no `any` types
- Holiday events are **read-only**: not clickable, not draggable
- Series exclusion is purely client-side — no change to the backend series creation endpoint

---

### Task 1: Backend — HolidayCalendar + HolidayEvent entities and migration

**Files:**
- Create: `backend/src/Entity/HolidayCalendar.php`
- Create: `backend/src/Entity/HolidayEvent.php`
- Create: `backend/src/Repository/HolidayCalendarRepository.php`
- Create: `backend/src/Repository/HolidayEventRepository.php`
- Create migration via `doctrine:migrations:diff`

**Interfaces:**
- Produces:
  - `HolidayCalendar(Calendar, string $name, string $url)` constructor
  - `HolidayCalendar` getters: `getId(): ?int`, `getCalendar()`, `getName()`, `setName()`, `getUrl()`, `setUrl()`, `getLastFetchedAt(): ?DateTimeImmutable`, `setLastFetchedAt()`, `getEvents(): Collection`
  - `HolidayEvent(HolidayCalendar, string $uid, string $name, DateTimeImmutable $date, ?DateTimeImmutable $dateEnd)` constructor
  - `HolidayEvent` getters: `getId(): ?int`, `getHolidayCalendar()`, `getUid(): string`, `getName(): string`, `setName()`, `getDate(): DateTimeImmutable`, `setDate()`, `getDateEnd(): ?DateTimeImmutable`, `setDateEnd()`
  - `HolidayCalendarRepository::findByCalendarId(int): HolidayCalendar[]`
  - `HolidayEventRepository::findByCalendarAndDateRange(int $calendarId, DateTimeImmutable $from, DateTimeImmutable $to): HolidayEvent[]`

- [ ] **Step 1: Create HolidayCalendar entity**

Create `backend/src/Entity/HolidayCalendar.php`:

```php
<?php
declare(strict_types=1);

namespace App\Entity;

use App\Repository\HolidayCalendarRepository;
use DateTimeImmutable;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity(repositoryClass: HolidayCalendarRepository::class)]
class HolidayCalendar
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column(type: 'integer')]
    private ?int $id = null;

    #[ORM\ManyToOne(targetEntity: Calendar::class)]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private Calendar $calendar;

    #[ORM\Column(type: 'string', length: 255)]
    private string $name;

    #[ORM\Column(type: 'string', length: 2048)]
    private string $url;

    #[ORM\Column(type: 'datetime_immutable', nullable: true)]
    private ?DateTimeImmutable $lastFetchedAt = null;

    /** @var Collection<int, HolidayEvent> */
    #[ORM\OneToMany(targetEntity: HolidayEvent::class, mappedBy: 'holidayCalendar', cascade: ['remove'])]
    private Collection $events;

    public function __construct(Calendar $calendar, string $name, string $url)
    {
        $this->calendar = $calendar;
        $this->name     = $name;
        $this->url      = $url;
        $this->events   = new ArrayCollection();
    }

    public function getId(): ?int { return $this->id; }
    public function getCalendar(): Calendar { return $this->calendar; }
    public function getName(): string { return $this->name; }
    public function setName(string $name): void { $this->name = $name; }
    public function getUrl(): string { return $this->url; }
    public function setUrl(string $url): void { $this->url = $url; }
    public function getLastFetchedAt(): ?DateTimeImmutable { return $this->lastFetchedAt; }
    public function setLastFetchedAt(?DateTimeImmutable $dt): void { $this->lastFetchedAt = $dt; }
    /** @return Collection<int, HolidayEvent> */
    public function getEvents(): Collection { return $this->events; }
}
```

- [ ] **Step 2: Create HolidayEvent entity**

Create `backend/src/Entity/HolidayEvent.php`:

```php
<?php
declare(strict_types=1);

namespace App\Entity;

use App\Repository\HolidayEventRepository;
use DateTimeImmutable;
use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity(repositoryClass: HolidayEventRepository::class)]
class HolidayEvent
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column(type: 'integer')]
    private ?int $id = null;

    #[ORM\ManyToOne(targetEntity: HolidayCalendar::class, inversedBy: 'events')]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private HolidayCalendar $holidayCalendar;

    #[ORM\Column(type: 'string', length: 500)]
    private string $uid;

    #[ORM\Column(type: 'string', length: 255)]
    private string $name;

    #[ORM\Column(type: 'date_immutable')]
    private DateTimeImmutable $date;

    #[ORM\Column(type: 'date_immutable', nullable: true)]
    private ?DateTimeImmutable $dateEnd = null;

    public function __construct(
        HolidayCalendar $holidayCalendar,
        string $uid,
        string $name,
        DateTimeImmutable $date,
        ?DateTimeImmutable $dateEnd = null,
    ) {
        $this->holidayCalendar = $holidayCalendar;
        $this->uid             = $uid;
        $this->name            = $name;
        $this->date            = $date;
        $this->dateEnd         = $dateEnd;
    }

    public function getId(): ?int { return $this->id; }
    public function getHolidayCalendar(): HolidayCalendar { return $this->holidayCalendar; }
    public function getUid(): string { return $this->uid; }
    public function getName(): string { return $this->name; }
    public function setName(string $name): void { $this->name = $name; }
    public function getDate(): DateTimeImmutable { return $this->date; }
    public function setDate(DateTimeImmutable $date): void { $this->date = $date; }
    public function getDateEnd(): ?DateTimeImmutable { return $this->dateEnd; }
    public function setDateEnd(?DateTimeImmutable $dateEnd): void { $this->dateEnd = $dateEnd; }
}
```

- [ ] **Step 3: Create repositories**

Create `backend/src/Repository/HolidayCalendarRepository.php`:

```php
<?php
declare(strict_types=1);

namespace App\Repository;

use App\Entity\HolidayCalendar;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;

class HolidayCalendarRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, HolidayCalendar::class);
    }

    /** @return HolidayCalendar[] */
    public function findByCalendarId(int $calendarId): array
    {
        return $this->createQueryBuilder('hc')
            ->where('hc.calendar = :calendarId')
            ->setParameter('calendarId', $calendarId)
            ->orderBy('hc.name', 'ASC')
            ->getQuery()
            ->getResult();
    }
}
```

Create `backend/src/Repository/HolidayEventRepository.php`:

```php
<?php
declare(strict_types=1);

namespace App\Repository;

use App\Entity\HolidayEvent;
use DateTimeImmutable;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;

class HolidayEventRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, HolidayEvent::class);
    }

    /** @return HolidayEvent[] */
    public function findByCalendarAndDateRange(int $calendarId, DateTimeImmutable $from, DateTimeImmutable $to): array
    {
        return $this->createQueryBuilder('he')
            ->join('he.holidayCalendar', 'hc')
            ->where('hc.calendar = :calendarId')
            ->andWhere('he.date <= :to')
            ->andWhere('COALESCE(he.dateEnd, he.date) >= :from')
            ->setParameter('calendarId', $calendarId)
            ->setParameter('from', $from)
            ->setParameter('to', $to)
            ->orderBy('he.date', 'ASC')
            ->getQuery()
            ->getResult();
    }
}
```

- [ ] **Step 4: Generate and run migration**

```bash
cd backend
php bin/console doctrine:migrations:diff
```

Review the generated migration — it should create `holiday_calendar` and `holiday_event` tables. Then:

```bash
php bin/console doctrine:migrations:migrate --no-interaction
php bin/console doctrine:migrations:migrate --no-interaction --env=test
```

Expected: `[notice] Migration VersionXXXX migrated successfully` for both.

- [ ] **Step 5: Commit**

```bash
git add backend/src/Entity/HolidayCalendar.php \
        backend/src/Entity/HolidayEvent.php \
        backend/src/Repository/HolidayCalendarRepository.php \
        backend/src/Repository/HolidayEventRepository.php \
        backend/migrations/
git commit -m "feat: add HolidayCalendar and HolidayEvent entities with migration"
```

---

### Task 2: Backend — HolidayCalendarService (ICS fetch, parse, store)

**Files:**
- Install: `sabre/vobject ^4.0` via Composer
- Create: `backend/src/Service/HolidayCalendarService.php`
- Create: `backend/tests/Service/HolidayCalendarServiceTest.php`

**Interfaces:**
- Consumes: `HolidayCalendar` (Task 1), `HolidayEvent` (Task 1)
- Produces: `HolidayCalendarService::fetchAndStore(HolidayCalendar $hc): int` — deletes existing events, fetches ICS, parses VEVENTs, persists `HolidayEvent` records, updates `lastFetchedAt`, returns count of stored events

Notes on date storage: ICS all-day `DTEND` is **exclusive** (`2026-12-27` = "up to but not including Dec 27"). The rest of the app stores `dateEnd` as **inclusive** (same as `dateEnd` in `Event`). So subtract 1 day from DTEND when storing.

- [ ] **Step 1: Install sabre/vobject**

```bash
cd backend && composer require sabre/vobject "^4.0"
```

Expected: package added to `composer.json` and autoloaded.

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/Service/HolidayCalendarServiceTest.php`:

```php
<?php
declare(strict_types=1);

namespace App\Tests\Service;

use App\Entity\Calendar;
use App\Entity\HolidayCalendar;
use App\Entity\HolidayEvent;
use App\Service\HolidayCalendarService;
use Doctrine\ORM\EntityManagerInterface;
use PHPUnit\Framework\TestCase;
use Symfony\Contracts\HttpClient\HttpClientInterface;
use Symfony\Contracts\HttpClient\ResponseInterface;

class HolidayCalendarServiceTest extends TestCase
{
    private const string SAMPLE_ICS = <<<ICS
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:xmas-2026@test
SUMMARY:Christmas Day
DTSTART;VALUE=DATE:20261225
DTEND;VALUE=DATE:20261227
END:VEVENT
BEGIN:VEVENT
UID:newyear-2027@test
SUMMARY:New Year's Day
DTSTART;VALUE=DATE:20270101
DTEND;VALUE=DATE:20270102
END:VEVENT
END:VCALENDAR
ICS;

    private function makeService(string $icsContent): HolidayCalendarService
    {
        $response = $this->createMock(ResponseInterface::class);
        $response->method('getContent')->willReturn($icsContent);

        $httpClient = $this->createMock(HttpClientInterface::class);
        $httpClient->method('request')->willReturn($response);

        $em = $this->createMock(EntityManagerInterface::class);
        $em->method('persist');
        $em->method('flush');
        $em->method('createQuery')->willReturn(
            new class {
                public function setParameter(string $k, mixed $v): static { return $this; }
                public function execute(): void {}
            }
        );

        return new HolidayCalendarService($httpClient, $em);
    }

    private function makeHolidayCalendar(): HolidayCalendar
    {
        $calendar = $this->createMock(Calendar::class);
        return new HolidayCalendar($calendar, 'Test', 'https://example.com/holidays.ics');
    }

    public function testFetchAndStoreReturnsTwoEvents(): void
    {
        $service = $this->makeService(self::SAMPLE_ICS);
        $count   = $service->fetchAndStore($this->makeHolidayCalendar());

        $this->assertSame(2, $count);
    }

    public function testMultiDayEventStoredAsInclusiveEnd(): void
    {
        $ics = <<<ICS
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:xmas@test
SUMMARY:Christmas
DTSTART;VALUE=DATE:20261225
DTEND;VALUE=DATE:20261227
END:VEVENT
END:VCALENDAR
ICS;

        $persisted = [];
        $response  = $this->createMock(ResponseInterface::class);
        $response->method('getContent')->willReturn($ics);
        $httpClient = $this->createMock(HttpClientInterface::class);
        $httpClient->method('request')->willReturn($response);
        $em = $this->createMock(EntityManagerInterface::class);
        $em->method('persist')->willReturnCallback(function (object $e) use (&$persisted) {
            if ($e instanceof HolidayEvent) {
                $persisted[] = $e;
            }
        });
        $em->method('flush');
        $em->method('createQuery')->willReturn(
            new class {
                public function setParameter(string $k, mixed $v): static { return $this; }
                public function execute(): void {}
            }
        );

        $hc = $this->makeHolidayCalendar();
        (new HolidayCalendarService($httpClient, $em))->fetchAndStore($hc);

        $this->assertCount(1, $persisted);
        $this->assertSame('2026-12-25', $persisted[0]->getDate()->format('Y-m-d'));
        // DTEND 2026-12-27 exclusive → stored as 2026-12-26 inclusive
        $this->assertSame('2026-12-26', $persisted[0]->getDateEnd()?->format('Y-m-d'));
    }

    public function testSingleDayEventHasNullDateEnd(): void
    {
        $ics = <<<ICS
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:holiday@test
SUMMARY:Single Day
DTSTART;VALUE=DATE:20261225
DTEND;VALUE=DATE:20261226
END:VEVENT
END:VCALENDAR
ICS;

        $persisted  = [];
        $response   = $this->createMock(ResponseInterface::class);
        $response->method('getContent')->willReturn($ics);
        $httpClient = $this->createMock(HttpClientInterface::class);
        $httpClient->method('request')->willReturn($response);
        $em = $this->createMock(EntityManagerInterface::class);
        $em->method('persist')->willReturnCallback(function (object $e) use (&$persisted) {
            if ($e instanceof HolidayEvent) {
                $persisted[] = $e;
            }
        });
        $em->method('flush');
        $em->method('createQuery')->willReturn(
            new class {
                public function setParameter(string $k, mixed $v): static { return $this; }
                public function execute(): void {}
            }
        );

        (new HolidayCalendarService($httpClient, $em))->fetchAndStore($this->makeHolidayCalendar());

        $this->assertNull($persisted[0]->getDateEnd());
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd backend && php bin/phpunit tests/Service/HolidayCalendarServiceTest.php
```

Expected: FAIL — `Class App\Service\HolidayCalendarService not found`

- [ ] **Step 4: Implement HolidayCalendarService**

Create `backend/src/Service/HolidayCalendarService.php`:

```php
<?php
declare(strict_types=1);

namespace App\Service;

use App\Entity\HolidayCalendar;
use App\Entity\HolidayEvent;
use DateTimeImmutable;
use Doctrine\ORM\EntityManagerInterface;
use Sabre\VObject;
use Symfony\Contracts\HttpClient\HttpClientInterface;

class HolidayCalendarService
{
    public function __construct(
        private readonly HttpClientInterface $httpClient,
        private readonly EntityManagerInterface $em,
    ) {}

    public function fetchAndStore(HolidayCalendar $holidayCalendar): int
    {
        $icsContent = $this->httpClient
            ->request('GET', $holidayCalendar->getUrl())
            ->getContent();

        $vcalendar = VObject\Reader::read($icsContent);

        // Delete all existing events before re-importing (handles removals from the feed)
        $this->em->createQuery('DELETE FROM App\Entity\HolidayEvent he WHERE he.holidayCalendar = :hc')
            ->setParameter('hc', $holidayCalendar)
            ->execute();

        $count = 0;
        /** @var VObject\Component\VEvent $vevent */
        foreach ($vcalendar->VEVENT as $vevent) {
            $uid     = (string) $vevent->UID;
            $summary = (string) $vevent->SUMMARY;
            $date    = new DateTimeImmutable($vevent->DTSTART->getValue());
            $date    = $date->setTime(0, 0);

            $dateEnd = null;
            if ($vevent->DTEND) {
                $rawEnd  = new DateTimeImmutable($vevent->DTEND->getValue());
                $rawEnd  = $rawEnd->setTime(0, 0);
                // ICS all-day DTEND is exclusive → subtract 1 day for inclusive storage
                $inclusive = $rawEnd->modify('-1 day');
                if ($inclusive > $date) {
                    $dateEnd = $inclusive;
                }
            } elseif ($vevent->DURATION) {
                $end = $date->add($vevent->DURATION->getDateInterval())->modify('-1 day');
                if ($end > $date) {
                    $dateEnd = $end;
                }
            }

            $this->em->persist(new HolidayEvent($holidayCalendar, $uid, $summary, $date, $dateEnd));
            $count++;
        }

        $holidayCalendar->setLastFetchedAt(new DateTimeImmutable());
        $this->em->persist($holidayCalendar);
        $this->em->flush();

        return $count;
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend && php bin/phpunit tests/Service/HolidayCalendarServiceTest.php
```

Expected: `OK (3 tests, 4 assertions)`

- [ ] **Step 6: Commit**

```bash
git add backend/src/Service/HolidayCalendarService.php \
        backend/tests/Service/HolidayCalendarServiceTest.php \
        backend/composer.json backend/composer.lock
git commit -m "feat: add HolidayCalendarService for ICS fetch and parse"
```

---

### Task 3: Backend — HolidayCalendarController + DTOs

**Files:**
- Create: `backend/src/Dto/Holiday/CreateHolidayCalendarDto.php`
- Create: `backend/src/Dto/Holiday/UpdateHolidayCalendarDto.php`
- Create: `backend/src/Controller/HolidayCalendarController.php`
- Create: `backend/tests/Controller/HolidayCalendarTest.php`

**Interfaces:**
- Consumes: `HolidayCalendarService::fetchAndStore()` (Task 2); `HolidayCalendarRepository::findByCalendarId()` (Task 1); `HolidayEventRepository::findByCalendarAndDateRange()` (Task 1)
- Produces endpoints:
  - `GET  /api/calendars/{id}/holiday-calendars` → `{id, name, url, lastFetchedAt, eventCount}[]`
  - `POST /api/calendars/{id}/holiday-calendars` → `{id, name, url, lastFetchedAt, eventCount}` (201); fetches ICS immediately
  - `PATCH /api/calendars/{id}/holiday-calendars/{hcId}` → same shape (200)
  - `DELETE /api/calendars/{id}/holiday-calendars/{hcId}` → 204
  - `POST /api/calendars/{id}/holiday-calendars/{hcId}/refresh` → same shape (200)
  - `GET  /api/calendars/{id}/holiday-events?from=YYYY-MM-DD&to=YYYY-MM-DD` → `{id, holidayCalendarId, name, date, dateEnd}[]`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/Controller/HolidayCalendarTest.php`:

```php
<?php
declare(strict_types=1);

namespace App\Tests\Controller;

use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use App\Service\TokenService;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

class HolidayCalendarTest extends WebTestCase
{
    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;
    private static TokenService $tokens;

    public static function setUpBeforeClass(): void
    {
        self::$client = static::createClient();
        $container    = static::getContainer();
        self::$em     = $container->get(EntityManagerInterface::class);
        self::$hasher = $container->get(UserPasswordHasherInterface::class);
        self::$tokens = $container->get(TokenService::class);
    }

    protected function setUp(): void
    {
        self::$em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset(self::$em);
    }

    public function testListReturnsEmptyArray(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);

        $r = TestHelper::jsonRequest(self::$client, 'GET', "/api/calendars/{$cal->getId()}/holiday-calendars", [], $auth);

        $this->assertSame(200, $r['status']);
        $this->assertSame([], $r['body']);
    }

    public function testCreateValidationRejectsEmptyName(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);

        $r = TestHelper::jsonRequest(self::$client, 'POST', "/api/calendars/{$cal->getId()}/holiday-calendars", [
            'name' => '', 'url' => 'https://example.com/holidays.ics',
        ], $auth);

        $this->assertSame(422, $r['status']);
    }

    public function testCreateValidationRejectsInvalidUrl(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);

        $r = TestHelper::jsonRequest(self::$client, 'POST', "/api/calendars/{$cal->getId()}/holiday-calendars", [
            'name' => 'Holidays', 'url' => 'not-a-url',
        ], $auth);

        $this->assertSame(422, $r['status']);
    }

    public function testDeleteReturns404ForNonExistentId(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);

        $r = TestHelper::jsonRequest(self::$client, 'DELETE', "/api/calendars/{$cal->getId()}/holiday-calendars/99999", [], $auth);

        $this->assertSame(404, $r['status']);
    }

    public function testListHolidayEventsRequiresFromAndTo(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);

        $r = TestHelper::jsonRequest(self::$client, 'GET', "/api/calendars/{$cal->getId()}/holiday-events", [], $auth);

        $this->assertSame(400, $r['status']);
    }

    public function testListHolidayEventsReturnsEmptyArray(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);

        $r = TestHelper::jsonRequest(self::$client, 'GET', "/api/calendars/{$cal->getId()}/holiday-events?from=2026-01-01&to=2026-12-31", [], $auth);

        $this->assertSame(200, $r['status']);
        $this->assertSame([], $r['body']);
    }

    public function testRefreshReturns404ForNonExistentId(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);

        $r = TestHelper::jsonRequest(self::$client, 'POST', "/api/calendars/{$cal->getId()}/holiday-calendars/99999/refresh", [], $auth);

        $this->assertSame(404, $r['status']);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && php bin/phpunit tests/Controller/HolidayCalendarTest.php
```

Expected: FAIL — routes not found (404 on all requests)

- [ ] **Step 3: Create DTOs**

Create `backend/src/Dto/Holiday/CreateHolidayCalendarDto.php`:

```php
<?php
declare(strict_types=1);

namespace App\Dto\Holiday;

use Symfony\Component\Validator\Constraints as Assert;

class CreateHolidayCalendarDto
{
    #[Assert\NotBlank]
    #[Assert\Length(min: 1, max: 255)]
    public string $name = '';

    #[Assert\NotBlank]
    #[Assert\Url]
    #[Assert\Length(max: 2048)]
    public string $url = '';
}
```

Create `backend/src/Dto/Holiday/UpdateHolidayCalendarDto.php`:

```php
<?php
declare(strict_types=1);

namespace App\Dto\Holiday;

use Symfony\Component\Validator\Constraints as Assert;

class UpdateHolidayCalendarDto
{
    #[Assert\NotBlank]
    #[Assert\Length(min: 1, max: 255)]
    public string $name = '';

    #[Assert\NotBlank]
    #[Assert\Url]
    #[Assert\Length(max: 2048)]
    public string $url = '';
}
```

- [ ] **Step 4: Implement the controller**

Create `backend/src/Controller/HolidayCalendarController.php`:

```php
<?php
declare(strict_types=1);

namespace App\Controller;

use App\Dto\Holiday\CreateHolidayCalendarDto;
use App\Dto\Holiday\UpdateHolidayCalendarDto;
use App\Entity\Calendar;
use App\Entity\HolidayCalendar;
use App\Repository\HolidayCalendarRepository;
use App\Repository\HolidayEventRepository;
use App\Security\CalendarMemberVoter;
use App\Service\HolidayCalendarService;
use DateTimeImmutable;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bridge\Doctrine\Attribute\MapEntity;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;
use Symfony\Component\Validator\Validator\ValidatorInterface;

#[Route('/api/calendars/{calendarId}/holiday-calendars')]
class HolidayCalendarController extends AbstractApiController
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly HolidayCalendarRepository $holidayCalendarRepo,
        private readonly HolidayEventRepository $holidayEventRepo,
        private readonly HolidayCalendarService $holidayCalendarService,
    ) {}

    #[Route('', methods: ['GET'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    public function list(#[MapEntity(id: 'calendarId')] Calendar $calendar): JsonResponse
    {
        $items = $this->holidayCalendarRepo->findByCalendarId($calendar->getId());
        return new JsonResponse(array_map($this->serialize(...), $items));
    }

    #[Route('', methods: ['POST'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    public function create(
        #[MapEntity(id: 'calendarId')] Calendar $calendar,
        Request $request,
        ValidatorInterface $validator,
    ): JsonResponse {
        $data = $this->decodeJson($request);
        $dto  = new CreateHolidayCalendarDto();
        $dto->name = (string) ($data['name'] ?? '');
        $dto->url  = (string) ($data['url'] ?? '');
        $this->validateDto($dto, $validator);

        $hc = new HolidayCalendar($calendar, $dto->name, $dto->url);
        $this->em->persist($hc);
        $this->em->flush();

        try {
            $this->holidayCalendarService->fetchAndStore($hc);
        } catch (\Throwable $e) {
            return new JsonResponse(['error' => 'Created but fetch failed: ' . $e->getMessage()], Response::HTTP_UNPROCESSABLE_ENTITY);
        }

        return new JsonResponse($this->serialize($hc), Response::HTTP_CREATED);
    }

    #[Route('/{hcId}', methods: ['PATCH'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    public function update(
        #[MapEntity(id: 'calendarId')] Calendar $calendar,
        int $hcId,
        Request $request,
        ValidatorInterface $validator,
    ): JsonResponse {
        $hc = $this->holidayCalendarRepo->find($hcId);
        if (!$hc || $hc->getCalendar()->getId() !== $calendar->getId()) {
            return new JsonResponse(['error' => 'Not found'], Response::HTTP_NOT_FOUND);
        }

        $data = $this->decodeJson($request);
        $dto  = new UpdateHolidayCalendarDto();
        $dto->name = (string) ($data['name'] ?? '');
        $dto->url  = (string) ($data['url'] ?? '');
        $this->validateDto($dto, $validator);

        $hc->setName($dto->name);
        $hc->setUrl($dto->url);
        $this->em->flush();

        return new JsonResponse($this->serialize($hc));
    }

    #[Route('/{hcId}', methods: ['DELETE'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    public function delete(
        #[MapEntity(id: 'calendarId')] Calendar $calendar,
        int $hcId,
    ): JsonResponse {
        $hc = $this->holidayCalendarRepo->find($hcId);
        if (!$hc || $hc->getCalendar()->getId() !== $calendar->getId()) {
            return new JsonResponse(['error' => 'Not found'], Response::HTTP_NOT_FOUND);
        }

        $this->em->remove($hc);
        $this->em->flush();

        return new JsonResponse(null, Response::HTTP_NO_CONTENT);
    }

    #[Route('/{hcId}/refresh', methods: ['POST'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    public function refresh(
        #[MapEntity(id: 'calendarId')] Calendar $calendar,
        int $hcId,
    ): JsonResponse {
        $hc = $this->holidayCalendarRepo->find($hcId);
        if (!$hc || $hc->getCalendar()->getId() !== $calendar->getId()) {
            return new JsonResponse(['error' => 'Not found'], Response::HTTP_NOT_FOUND);
        }

        try {
            $this->holidayCalendarService->fetchAndStore($hc);
        } catch (\Throwable $e) {
            return new JsonResponse(['error' => 'Refresh failed: ' . $e->getMessage()], Response::HTTP_UNPROCESSABLE_ENTITY);
        }

        return new JsonResponse($this->serialize($hc));
    }

    private function serialize(HolidayCalendar $hc): array
    {
        return [
            'id'            => $hc->getId(),
            'name'          => $hc->getName(),
            'url'           => $hc->getUrl(),
            'lastFetchedAt' => $hc->getLastFetchedAt()?->format(\DateTimeInterface::ATOM),
            'eventCount'    => $hc->getEvents()->count(),
        ];
    }
}
```

**Also add the holiday-events endpoint** in a separate controller to keep routing prefixes clean:

Create `backend/src/Controller/HolidayEventController.php`:

```php
<?php
declare(strict_types=1);

namespace App\Controller;

use App\Entity\Calendar;
use App\Repository\HolidayEventRepository;
use App\Security\CalendarMemberVoter;
use DateTimeImmutable;
use Symfony\Bridge\Doctrine\Attribute\MapEntity;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;

#[Route('/api/calendars/{calendarId}/holiday-events')]
class HolidayEventController extends AbstractApiController
{
    public function __construct(
        private readonly HolidayEventRepository $holidayEventRepo,
    ) {}

    #[Route('', methods: ['GET'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    public function list(
        #[MapEntity(id: 'calendarId')] Calendar $calendar,
        Request $request,
    ): JsonResponse {
        $from = $request->query->get('from');
        $to   = $request->query->get('to');
        if (!$from || !$to) {
            throw new BadRequestHttpException('from and to query params are required');
        }

        $events = $this->holidayEventRepo->findByCalendarAndDateRange(
            $calendar->getId(),
            new DateTimeImmutable($from),
            new DateTimeImmutable($to),
        );

        return new JsonResponse(array_map(fn ($e) => [
            'id'                => $e->getId(),
            'holidayCalendarId' => $e->getHolidayCalendar()->getId(),
            'name'              => $e->getName(),
            'date'              => $e->getDate()->format('Y-m-d'),
            'dateEnd'           => $e->getDateEnd()?->format('Y-m-d'),
        ], $events));
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend && php bin/phpunit tests/Controller/HolidayCalendarTest.php
```

Expected: `OK (6 tests, 6 assertions)`

- [ ] **Step 6: Run full backend test suite to check for regressions**

```bash
cd backend && php bin/phpunit
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/Dto/Holiday/ \
        backend/src/Controller/HolidayCalendarController.php \
        backend/src/Controller/HolidayEventController.php \
        backend/tests/Controller/HolidayCalendarTest.php
git commit -m "feat: add HolidayCalendarController with CRUD, refresh, and holiday-events endpoints"
```

---

### Task 4: Frontend — TypeScript types + API functions

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/api.ts`

**Interfaces:**
- Produces:
  - `HolidayCalendar` interface exported from `types.ts`
  - `HolidayEvent` interface exported from `types.ts`
  - Six async API functions exported from `api.ts`: `getHolidayCalendars`, `createHolidayCalendar`, `updateHolidayCalendar`, `deleteHolidayCalendar`, `refreshHolidayCalendar`, `getHolidayEvents`

- [ ] **Step 1: Add TypeScript interfaces to types.ts**

In `frontend/src/lib/types.ts`, append at the end of the file:

```ts
export interface HolidayCalendar {
  id: number
  name: string
  url: string
  lastFetchedAt: string | null
  eventCount: number
}

export interface HolidayEvent {
  id: number
  holidayCalendarId: number
  name: string
  date: string       // YYYY-MM-DD, start (inclusive)
  dateEnd: string | null  // YYYY-MM-DD, end (inclusive), null = same day as date
}
```

- [ ] **Step 2: Add API functions to api.ts**

In `frontend/src/lib/api.ts`, add the following imports at the top (alongside existing imports from `types.ts`):

```ts
import type { HolidayCalendar, HolidayEvent } from './types'
```

Then append at the end of the file:

```ts
export function getHolidayCalendars(calendarId: number): Promise<HolidayCalendar[]> {
  return apiGet<HolidayCalendar[]>(`/api/calendars/${calendarId}/holiday-calendars`)
}

export function createHolidayCalendar(
  calendarId: number,
  data: { name: string; url: string },
): Promise<HolidayCalendar> {
  return apiPost<HolidayCalendar>(`/api/calendars/${calendarId}/holiday-calendars`, data)
}

export function updateHolidayCalendar(
  calendarId: number,
  id: number,
  data: { name: string; url: string },
): Promise<HolidayCalendar> {
  return apiPatch<HolidayCalendar>(`/api/calendars/${calendarId}/holiday-calendars/${id}`, data)
}

export function deleteHolidayCalendar(calendarId: number, id: number): Promise<void> {
  return apiDelete<void>(`/api/calendars/${calendarId}/holiday-calendars/${id}`)
}

export function refreshHolidayCalendar(calendarId: number, id: number): Promise<HolidayCalendar> {
  return apiPost<HolidayCalendar>(`/api/calendars/${calendarId}/holiday-calendars/${id}/refresh`, {})
}

export function getHolidayEvents(
  calendarId: number,
  from: string,
  to: string,
): Promise<HolidayEvent[]> {
  return apiGet<HolidayEvent[]>(`/api/calendars/${calendarId}/holiday-events?from=${from}&to=${to}`)
}
```

If `api.ts` does not already import from `types.ts`, check the file first — the existing imports at the top may already bring in other types. Add only what is missing.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/api.ts
git commit -m "feat: add HolidayCalendar and HolidayEvent types and API functions"
```

---

### Task 5: Frontend — HolidayCalendarsPage (settings)

**Files:**
- Create: `frontend/src/pages/settings/HolidayCalendarsPage.tsx`
- Modify: `frontend/src/App.tsx` (add route)
- Modify: `frontend/src/components/layout/CalendarSidebar.tsx` (add nav link)

**Interfaces:**
- Consumes: `getHolidayCalendars`, `createHolidayCalendar`, `deleteHolidayCalendar`, `refreshHolidayCalendar` (Task 4); `HolidayCalendar` type (Task 4)
- Produces: Page at `/clubs/:clubId/calendars/:calendarId/settings/holiday-calendars`

- [ ] **Step 1: Create the page component**

Create `frontend/src/pages/settings/HolidayCalendarsPage.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  getHolidayCalendars,
  createHolidayCalendar,
  deleteHolidayCalendar,
  refreshHolidayCalendar,
} from '@/lib/api'
import type { HolidayCalendar } from '@/lib/types'

export default function HolidayCalendarsPage() {
  const { calendarId } = useParams<{ calendarId: string }>()
  const id = Number(calendarId)

  const [items, setItems] = useState<HolidayCalendar[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshingId, setRefreshingId] = useState<number | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', url: '' })
  const [saving, setSaving] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setItems(await getHolidayCalendars(id))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  async function handleAdd() {
    setSaving(true)
    setAddError(null)
    try {
      const created = await createHolidayCalendar(id, form)
      setItems(prev => [...prev, created])
      setShowAdd(false)
      setForm({ name: '', url: '' })
    } catch (e: unknown) {
      setAddError(e instanceof Error ? e.message : 'Failed to create')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(hcId: number) {
    if (!window.confirm('Delete this holiday calendar and all its events?')) return
    await deleteHolidayCalendar(id, hcId)
    setItems(prev => prev.filter(hc => hc.id !== hcId))
  }

  async function handleRefresh(hcId: number) {
    setRefreshingId(hcId)
    try {
      const updated = await refreshHolidayCalendar(id, hcId)
      setItems(prev => prev.map(hc => (hc.id === hcId ? updated : hc)))
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : 'Refresh failed')
    } finally {
      setRefreshingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Holiday Calendars</h1>
        <Button onClick={() => setShowAdd(true)}>Add ICS Feed</Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground">
          No holiday calendars yet. Add an ICS URL to import public holidays.
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map(hc => (
            <li key={hc.id} className="flex items-start justify-between rounded-lg border p-4">
              <div>
                <p className="font-medium">{hc.name}</p>
                <p className="text-sm text-muted-foreground break-all">{hc.url}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {hc.eventCount} events
                  {hc.lastFetchedAt &&
                    ` · Last fetched: ${new Date(hc.lastFetchedAt).toLocaleString()}`}
                </p>
              </div>
              <div className="ml-4 flex shrink-0 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={refreshingId === hc.id}
                  onClick={() => handleRefresh(hc.id)}
                >
                  {refreshingId === hc.id ? 'Refreshing…' : 'Refresh'}
                </Button>
                <Button variant="destructive" size="sm" onClick={() => handleDelete(hc.id)}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={showAdd} onOpenChange={open => { setShowAdd(open); if (!open) setAddError(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Holiday Calendar</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="hc-name">Name</Label>
              <Input
                id="hc-name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="German Public Holidays"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="hc-url">ICS URL</Label>
              <Input
                id="hc-url"
                type="url"
                value={form.url}
                onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                placeholder="https://calendar.google.com/calendar/ical/..."
              />
            </div>
            {addError && <p className="text-sm text-destructive">{addError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={saving || !form.name || !form.url}>
              {saving ? 'Adding…' : 'Add & Fetch'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

- [ ] **Step 2: Add route in App.tsx**

In `frontend/src/App.tsx`, alongside the other settings routes (after the `target-groups` route):

```tsx
import HolidayCalendarsPage from './pages/settings/HolidayCalendarsPage'
```

```tsx
<Route path="/clubs/:clubId/calendars/:calendarId/settings/holiday-calendars" element={<HolidayCalendarsPage />} />
```

- [ ] **Step 3: Add sidebar nav link**

In `frontend/src/components/layout/CalendarSidebar.tsx`, add to the `settingsNav` array (after `Locations`):

```tsx
import { CalendarDays, ..., Sun } from 'lucide-react'  // add Sun to the existing import
```

```tsx
{ label: 'Holidays', href: `${base}/settings/holiday-calendars`, icon: Sun },
```

Add it inside the `settingsNav` array after `{ label: 'Locations', ... }`.

- [ ] **Step 4: Verify TypeScript and test in browser**

```bash
cd frontend && npx tsc --noEmit
```

Start the dev server (`npm run dev:frontend`) and navigate to Settings → Holidays. Verify the page renders and the "Add ICS Feed" dialog opens.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/settings/HolidayCalendarsPage.tsx \
        frontend/src/App.tsx \
        frontend/src/components/layout/CalendarSidebar.tsx
git commit -m "feat: add HolidayCalendarsPage for managing ICS feed subscriptions"
```

---

### Task 6: Frontend — Display holiday events in FullCalendar

**Files:**
- Modify: `frontend/src/pages/CalendarPage.tsx`
- Modify: `frontend/src/index.css` (or global stylesheet — find it via `grep -r "@tailwind" frontend/src`)

**Interfaces:**
- Consumes: `getHolidayEvents(calendarId, from, to)` (Task 4)
- Produces: Holiday events rendered in FullCalendar as orange, semi-transparent, non-interactive blocks

- [ ] **Step 1: Read CalendarPage.tsx**

Read `frontend/src/pages/CalendarPage.tsx` in full to note:
1. Exactly how `fetchEvents` is structured (function signature, what state it closes over)
2. What `calendarId` variable is in scope (from `useParams` or props)
3. What imports are already at the top
4. Whether `events={fetchEvents}` or `eventSources` is currently used

- [ ] **Step 2: Add holiday CSS to global stylesheet**

Find the global CSS file:
```bash
grep -rn "@tailwind\|@layer" frontend/src/ --include="*.css" -l
```

In that file, add:

```css
.fc-holiday-event .fc-event-main {
  opacity: 0.45;
  cursor: default !important;
}
```

- [ ] **Step 3: Migrate from `events` prop to `eventSources` + add holiday source**

In `frontend/src/pages/CalendarPage.tsx`:

Add import:
```tsx
import { getHolidayEvents } from '@/lib/api'
import type { EventInput } from '@fullcalendar/core'
```

Add `fetchHolidayEvents` function (after the existing `fetchEvents` function, using the same `calendarId` variable that `fetchEvents` already uses):

```tsx
const fetchHolidayEvents = useCallback(
  async (
    info: { startStr: string; endStr: string },
    successCallback: (events: EventInput[]) => void,
    failureCallback: (error: Error) => void,
  ) => {
    try {
      const from = info.startStr.slice(0, 10)
      const to   = info.endStr.slice(0, 10)
      const holidays = await getHolidayEvents(Number(calendarId), from, to)
      successCallback(
        holidays.map(h => ({
          id: `holiday-${h.id}`,
          title: h.name,
          start: h.date,
          // FullCalendar all-day end is exclusive; add 1 day to convert from inclusive storage
          end: h.dateEnd
            ? new Date(new Date(h.dateEnd + 'T00:00:00').getTime() + 86_400_000)
                .toISOString()
                .slice(0, 10)
            : undefined,
          allDay: true,
          editable: false,
          classNames: ['fc-holiday-event'],
          extendedProps: { isHoliday: true },
        })),
      )
    } catch (e) {
      failureCallback(e instanceof Error ? e : new Error('Failed to load holidays'))
    }
  },
  [calendarId],
)
```

Replace the existing `events={fetchEvents}` prop on `<FullCalendar>` with:

```tsx
eventSources={[
  { events: fetchEvents },
  {
    events: fetchHolidayEvents,
    color: '#f97316',
    textColor: '#ffffff',
  },
]}
```

Update `eventClick` handler to skip holiday events (find the handler and add the guard at the top):

```tsx
if (info.event.extendedProps?.isHoliday) return
```

Update `eventDrop` handler (drag reschedule) to revert holiday events:

```tsx
if (info.event.extendedProps?.isHoliday) {
  info.revert()
  return
}
```

- [ ] **Step 4: Verify TypeScript**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Test in browser**

With the dev server running and a holiday calendar configured (add one manually via Settings → Holidays, or seed directly in DB), navigate to the main calendar and verify:
- Holiday events appear as orange blocks with reduced opacity
- Clicking them does nothing
- Dragging them reverts
- Normal events still work correctly

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/CalendarPage.tsx frontend/src/index.css
git commit -m "feat: display holiday events in FullCalendar with orange color and reduced opacity"
```

---

### Task 7: Frontend — Exclude holidays in series creation (EventModal)

**Files:**
- Modify: `frontend/src/components/calendar/EventModal.tsx`
- Create (or modify): `frontend/src/components/calendar/EventModal.test.tsx`

**Interfaces:**
- Consumes: `getHolidayEvents(calendarId, from, to)` (Task 4); `HolidayEvent` type (Task 4)
- Produces:
  - Exported pure function `filterDatesExcludingHolidays(dates: string[], holidays: HolidayEvent[]): string[]`
  - "Exclude holidays" checkbox in series (from-template) tab
  - When checked: fetches holiday events for the series date range, removes any generated date that falls within a holiday range, shows count of excluded dates in the preview

- [ ] **Step 1: Read EventModal.tsx**

Read `frontend/src/components/calendar/EventModal.tsx` in full to note:
1. How `calendarId` is passed in (prop or context)
2. Where `generatedDates` (or the array of generated date strings) is computed
3. Where the series date range state (`from`/`to`) lives — exact variable names
4. Where the dates preview list is rendered
5. Where the API call is made to submit the series

- [ ] **Step 2: Write failing unit test**

Create `frontend/src/components/calendar/EventModal.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { filterDatesExcludingHolidays } from './EventModal'
import type { HolidayEvent } from '@/lib/types'

describe('filterDatesExcludingHolidays', () => {
  it('removes a date that matches a single-day holiday exactly', () => {
    const holidays: HolidayEvent[] = [
      { id: 1, holidayCalendarId: 1, name: 'Christmas', date: '2026-12-25', dateEnd: null },
    ]
    expect(filterDatesExcludingHolidays(['2026-12-18', '2026-12-25'], holidays))
      .toEqual(['2026-12-18'])
  })

  it('removes dates that fall within a multi-day holiday range (inclusive both ends)', () => {
    const holidays: HolidayEvent[] = [
      { id: 1, holidayCalendarId: 1, name: 'Christmas', date: '2026-12-25', dateEnd: '2026-12-26' },
    ]
    expect(filterDatesExcludingHolidays(['2026-12-25', '2026-12-26', '2026-12-27'], holidays))
      .toEqual(['2026-12-27'])
  })

  it('keeps all dates when there are no holidays', () => {
    expect(filterDatesExcludingHolidays(['2026-12-18', '2026-12-25'], []))
      .toEqual(['2026-12-18', '2026-12-25'])
  })

  it('handles a date range spanning two separate holidays', () => {
    const holidays: HolidayEvent[] = [
      { id: 1, holidayCalendarId: 1, name: 'Christmas', date: '2026-12-25', dateEnd: null },
      { id: 2, holidayCalendarId: 1, name: 'New Year', date: '2027-01-01', dateEnd: null },
    ]
    const dates = ['2026-12-24', '2026-12-25', '2026-12-31', '2027-01-01']
    expect(filterDatesExcludingHolidays(dates, holidays))
      .toEqual(['2026-12-24', '2026-12-31'])
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd frontend && npm test -- --run --reporter=verbose EventModal
```

Expected: FAIL — `filterDatesExcludingHolidays is not a function` (not yet exported)

- [ ] **Step 4: Add filterDatesExcludingHolidays to EventModal.tsx**

In `frontend/src/components/calendar/EventModal.tsx`, add at the top of the file (after imports):

```tsx
import { getHolidayEvents } from '@/lib/api'
import type { HolidayEvent } from '@/lib/types'

export function filterDatesExcludingHolidays(
  dates: string[],
  holidays: HolidayEvent[],
): string[] {
  return dates.filter(date =>
    !holidays.some(h => {
      const end = h.dateEnd ?? h.date
      return date >= h.date && date <= end
    }),
  )
}
```

- [ ] **Step 5: Add state, effect, and derive effectiveDates**

Inside the component function, in the section that handles the "from template" / series tab, add:

```tsx
const [excludeHolidays, setExcludeHolidays] = useState(false)
const [holidays, setHolidays] = useState<HolidayEvent[]>([])
const [loadingHolidays, setLoadingHolidays] = useState(false)
```

Add an effect to fetch holidays when the toggle is enabled and a date range is set. Replace `seriesFrom` and `seriesTo` with the exact variable names from Step 1:

```tsx
useEffect(() => {
  if (!excludeHolidays || !seriesFrom || !seriesTo) {
    setHolidays([])
    return
  }
  setLoadingHolidays(true)
  getHolidayEvents(calendarId, seriesFrom, seriesTo)
    .then(setHolidays)
    .catch(() => setHolidays([]))
    .finally(() => setLoadingHolidays(false))
}, [excludeHolidays, seriesFrom, seriesTo, calendarId])
```

Derive `effectiveDates` from the existing generated dates array (replace `generatedDates` with the actual variable name from Step 1):

```tsx
const effectiveDates = excludeHolidays
  ? filterDatesExcludingHolidays(generatedDates, holidays)
  : generatedDates
```

Replace all uses of `generatedDates` in the **preview list** and **API submit call** with `effectiveDates`.

- [ ] **Step 6: Add the checkbox UI**

In the series form section, after the date range pickers and before the preview list, add:

```tsx
<div className="flex items-center gap-2">
  <input
    type="checkbox"
    id="exclude-holidays"
    checked={excludeHolidays}
    onChange={e => setExcludeHolidays(e.target.checked)}
    className="h-4 w-4 rounded border-input"
  />
  <label htmlFor="exclude-holidays" className="text-sm">
    Exclude holidays
    {loadingHolidays && (
      <span className="ml-1 text-muted-foreground">(loading…)</span>
    )}
  </label>
</div>
{excludeHolidays && generatedDates.length !== effectiveDates.length && (
  <p className="text-xs text-muted-foreground">
    {generatedDates.length - effectiveDates.length} date(s) excluded due to holidays
  </p>
)}
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
cd frontend && npm test -- --run --reporter=verbose EventModal
```

Expected: `✓ EventModal (4 tests)`

- [ ] **Step 8: Verify TypeScript**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 9: Test in browser**

With the dev server running and at least one holiday calendar with events configured:
1. Open the series creation modal (From Template tab)
2. Set a date range that includes a known holiday
3. Enable "Exclude holidays"
4. Verify the excluded count message appears and the dates preview no longer includes the holiday dates
5. Submit and verify events are created only on non-holiday dates

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/calendar/EventModal.tsx \
        frontend/src/components/calendar/EventModal.test.tsx
git commit -m "feat: add exclude-holidays toggle to series creation in EventModal"
```
