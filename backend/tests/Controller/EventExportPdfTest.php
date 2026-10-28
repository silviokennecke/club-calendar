<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Calendar;
use App\Entity\Club;
use App\Entity\HolidayCalendar;
use App\Entity\HolidayEvent;
use App\Entity\User;
use App\Enum\ClubRole;
use App\Enum\HolidayType;
use App\Pdf\PdfExportService;
use App\Pdf\PdfHolidaySelection;
use App\Pdf\PdfLayout;
use App\Pdf\PdfOptions;
use App\Service\EventExportService;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;
use Symfony\Component\RateLimiter\RateLimiterFactory;

/** PDF export (`GET …/events.pdf`): access, validation, caps, rate limit, filter parity, hostile input, language, legend. */
class EventExportPdfTest extends WebTestCase
{
    private const string RANGE = 'from=2026-10-01&to=2026-10-31';

    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;
    private static TokenService $tokens;

    private User $owner;
    private Club $club;
    private Calendar $calendar;
    private string $auth;
    private string $base;

    public static function setUpBeforeClass(): void
    {
        self::$client = static::createClient();
        $container = static::getContainer();
        self::$em = $container->get(EntityManagerInterface::class);
        self::$hasher = $container->get(UserPasswordHasherInterface::class);
        self::$tokens = $container->get(TokenService::class);
    }

    protected function setUp(): void
    {
        self::$em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset(self::$em);
        ['user' => $this->owner, 'club' => $this->club, 'calendar' => $this->calendar] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $this->calendar->setName('Schießbetrieb 2026');
        $this->owner->setLanguage('de');
        self::$em->flush();
        $this->auth = TestHelper::authHeader($this->owner, self::$tokens);
        $this->base = '/api/calendars/'.$this->calendar->getId();
    }

    /** @return array{status: int, content: string, headers: array<string, list<string>>, body: mixed} */
    private function get(string $uri, ?string $auth = null): array
    {
        $r = TestHelper::jsonRequest(self::$client, 'GET', $uri, [], $auth ?? $this->auth);
        self::$em->clear();

        return $r;
    }

    private function pdf(string $query, ?string $auth = null): array
    {
        return $this->get($this->base.'/events.pdf?'.$query, $auth);
    }

    /** @param array<string, mixed> $data */
    private function create(array $data): string
    {
        $r = TestHelper::jsonRequest(self::$client, 'POST', $this->base.'/events', $data + [
            'date' => '2026-10-01', 'timeBegin' => '19:00', 'timeEnd' => '21:00', 'isDraft' => false,
        ], $this->auth);
        $this->assertSame(201, $r['status'], $r['content']);

        return $r['body']['id'];
    }

    private function userWithRole(ClubRole $role): string
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        TestHelper::addMember(self::$em, self::$em->find(Club::class, $this->club->getId()), $user, $role);

        return TestHelper::authHeader($user, self::$tokens);
    }

    /** @return array<string, mixed> view model of the signed-in owner (language and week start as stored) */
    private function model(string $layout, string $from, string $to, bool $drafts = false, ?User $user = null): array
    {
        $c = static::getContainer();
        $calendar = self::$em->find(Calendar::class, $this->calendar->getId());
        $filter = $c->get(EventExportService::class)->filter($calendar, $from, $to, $drafts ? '1' : '0', null);

        return $c->get(PdfExportService::class)->buildViewModel(
            $calendar,
            $filter,
            new PdfOptions(PdfLayout::from($layout)),
            $user ?? self::$em->find(User::class, $this->owner->getId()),
        );
    }

    /** @param list<string> $groups */
    private function html(string $layout, string $from, string $to, bool $drafts = false, ?User $user = null, array $groups = []): string
    {
        $c = static::getContainer();
        $calendar = self::$em->find(Calendar::class, $this->calendar->getId());
        $filter = $c->get(EventExportService::class)->filter($calendar, $from, $to, $drafts ? '1' : '0', $groups);

        return $c->get(PdfExportService::class)->renderHtml(
            $calendar,
            $filter,
            new PdfOptions(PdfLayout::from($layout)),
            $user ?? self::$em->find(User::class, $this->owner->getId()),
        );
    }

    // --- success ---

    public function testEveryLayoutReturnsAPdf(): void
    {
        $this->create(['name' => 'Vereinsmeisterschaft']);

        $queries = [
            'month-grid' => self::RANGE,
            'agenda' => self::RANGE,
            'quarter-overview' => 'from=2026-10-01&to=2026-12-31',
            'annual-overview' => 'from=2026-01-01&to=2026-12-31',
        ];
        foreach ($queries as $layout => $range) {
            $r = $this->pdf("$range&layout=$layout");
            $this->assertSame(200, $r['status'], "$layout: ".substr($r['content'], 0, 300));
            $this->assertSame('application/pdf', $r['headers']['content-type'][0]);
            $this->assertStringStartsWith('%PDF', $r['content']);
            $this->assertSame((string) strlen($r['content']), $r['headers']['content-length'][0]);
            $this->assertSame('attachment; filename=schiessbetrieb-2026.pdf', $r['headers']['content-disposition'][0]);
            $this->assertStringContainsString('no-store', $r['headers']['cache-control'][0]);
            $this->assertSame('nosniff', $r['headers']['x-content-type-options'][0]);
        }
    }

    public function testPaperAndOrientationAreAccepted(): void
    {
        $r = $this->pdf(self::RANGE.'&layout=agenda&paper=a3&orientation=landscape');
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertStringStartsWith('%PDF', $r['content']);
    }

    // --- access ---

    public function testAccess(): void
    {
        $q = self::RANGE.'&layout=agenda';
        $this->assertSame(401, $this->pdf($q, '')['status']);
        $this->assertSame(401, $this->get('/api/calendars/00000000-0000-0000-0000-000000000000/events.pdf?'.$q, '')['status']);

        $stranger = TestHelper::authHeader(TestHelper::createUser(self::$em, self::$hasher), self::$tokens);
        $this->assertSame(403, $this->pdf($q, $stranger)['status']);

        $this->assertSame(404, $this->get('/api/calendars/00000000-0000-0000-0000-000000000000/events.pdf?'.$q)['status']);

        $this->assertSame(200, $this->pdf($q, $this->userWithRole(ClubRole::VIEWER))['status']);
        $this->assertSame(200, $this->pdf($q, $this->userWithRole(ClubRole::EDITOR))['status']);
    }

    public function testArchivedCalendarIsAllowed(): void
    {
        self::$em->find(Calendar::class, $this->calendar->getId())->setArchivedAt(new \DateTimeImmutable());
        self::$em->flush();

        $this->assertSame(200, $this->pdf(self::RANGE.'&layout=agenda')['status']);
    }

    // --- validation ---

    /** @return iterable<string, array{string, string}> */
    public static function badQueries(): iterable
    {
        yield 'layout missing' => [self::RANGE, 'layout'];
        yield 'layout unknown' => [self::RANGE.'&layout=poster', 'layout'];
        yield 'layout array' => [self::RANGE.'&layout[]=agenda', 'layout'];
        yield 'from missing' => ['to=2026-10-31&layout=agenda', 'from'];
        yield 'to missing' => ['from=2026-10-01&layout=agenda', 'to'];
        yield 'from invalid' => ['from=01.10.2026&to=2026-10-31&layout=agenda', 'from'];
        yield 'to invalid' => ['from=2026-10-01&to=2026-02-30&layout=agenda', 'to'];
        yield 'from after to' => ['from=2026-10-31&to=2026-10-01&layout=agenda', 'to'];
        yield 'range over 366 days' => ['from=2026-01-01&to=2027-01-03&layout=agenda', 'to'];
        yield 'annual for a partial year' => ['from=2026-01-01&to=2026-12-30&layout=annual-overview', 'layout'];
        yield 'quarter for two months' => ['from=2026-10-01&to=2026-11-30&layout=quarter-overview', 'layout'];
        yield 'paper invalid' => [self::RANGE.'&layout=agenda&paper=letter', 'paper'];
        yield 'orientation invalid' => [self::RANGE.'&layout=agenda&orientation=diagonal', 'orientation'];
        yield 'includeDrafts invalid' => [self::RANGE.'&layout=agenda&includeDrafts=maybe', 'includeDrafts'];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('badQueries')]
    public function testInvalidRequestsAre400(string $query, string $field): void
    {
        $r = $this->pdf($query);
        $this->assertSame(400, $r['status'], $r['content']);
        $this->assertSame($field, $r['body']['field'] ?? null, $r['content']);
        $this->assertNotEmpty($r['body']['code']);
    }

    public function testRangeOf366DaysIsAccepted(): void
    {
        $this->assertSame(200, $this->pdf('from=2026-01-01&to=2027-01-01&layout=agenda')['status']);
    }

    public function testForeignTargetGroupIs422(): void
    {
        $otherUser = TestHelper::createUser(self::$em, self::$hasher);
        $otherClub = TestHelper::createClub(self::$em, $otherUser, 'Fremder Verein');
        $foreign = TestHelper::createTargetGroup(self::$em, $otherClub, 'Fremd')->getId();

        $r = $this->pdf(self::RANGE."&layout=agenda&targetGroupIds[]=$foreign");
        $this->assertSame(422, $r['status'], $r['content']);
        $this->assertSame('unknown_reference', $r['body']['code']);
    }

    public function testTooManyEventsIs422(): void
    {
        $this->create(['name' => 'Eins']);
        $this->create(['name' => 'Zwei']);
        $this->create(['name' => 'Drei']);

        // Production cap is PdfExportService::MAX_EVENTS; the service takes it as constructor argument
        // A fresh container: the controller of an earlier request in this one already holds the real service
        $kernel = self::$client->getKernel();
        $kernel->shutdown();
        $kernel->boot();
        $c = $kernel->getContainer()->get('test.service_container');
        $c->set(PdfExportService::class, new PdfExportService(
            $c->get(EventExportService::class),
            $c->get(\App\Ics\IcsEventReader::class),
            $c->get(\App\Pdf\EmojiImages::class),
            $c->get(EntityManagerInterface::class),
            $c->get(\Twig\Environment::class),
            $c->get(\App\Pdf\DompdfFactory::class),
            2,
        ));

        self::$client->disableReboot();
        try {
            $r = $this->pdf(self::RANGE.'&layout=agenda');
        } finally {
            self::$client->enableReboot();
        }
        $this->assertSame(422, $r['status'], $r['content']);
        $this->assertSame('too_many_events', $r['body']['code']);
        $this->assertSame('to', $r['body']['field']);
    }

    public function testRateLimit(): void
    {
        $limiter = static::getContainer()->get('limiter.pdf_export_user');
        $this->assertInstanceOf(RateLimiterFactory::class, $limiter);
        $limiter->create($this->owner->getId())->consume(1000);

        $r = $this->pdf(self::RANGE.'&layout=agenda');
        $this->assertSame(429, $r['status'], $r['content']);
        $this->assertSame('rate_limited', $r['body']['code']);
        $this->assertNotEmpty($r['headers']['retry-after'][0]);

        // checked before validation: even a malformed request is throttled
        $this->assertSame(429, $this->pdf('layout=nope')['status']);
        // other users are unaffected
        $this->assertSame(200, $this->pdf(self::RANGE.'&layout=agenda', $this->userWithRole(ClubRole::VIEWER))['status']);
    }

    // --- filter parity with events.ics ---

    public function testSameEventsAsTheIcsExport(): void
    {
        $youth = TestHelper::createTargetGroup(self::$em, $this->club, 'Jugend')->getId();
        $adults = TestHelper::createTargetGroup(self::$em, $this->club, 'Erwachsene')->getId();
        $this->create(['name' => 'Zeltlager', 'date' => '2026-09-28', 'dateEnd' => '2026-10-02', 'targetGroupIds' => [$youth]]);
        $this->create(['name' => 'Herbstfest', 'date' => '2026-10-24', 'targetGroupIds' => [$adults]]);
        $this->create(['name' => 'Vorstandssitzung', 'date' => '2026-10-07', 'isDraft' => true]);
        $this->create(['name' => 'Silvester', 'date' => '2026-12-31']);
        $this->create(['name' => 'Sommerfest', 'date' => '2026-07-04']);

        $names = ['Zeltlager', 'Herbstfest', 'Vorstandssitzung', 'Silvester', 'Sommerfest'];
        $queries = [
            self::RANGE,
            self::RANGE.'&includeDrafts=1',
            self::RANGE.'&includeDrafts=true&targetGroupIds[]='.$youth,
            'from=2026-07-01&to=2026-12-31&targetGroupIds[]='.$youth.'&targetGroupIds[]='.$adults,
            'from=2026-07-01&to=2026-12-31&includeDrafts=1',
            'from=2026-10-02&to=2026-10-02',
        ];
        foreach ($queries as $query) {
            $ics = $this->get($this->base.'/events.ics?'.$query)['content'];
            $html = $this->html('agenda', ...$this->bounds($query), drafts: str_contains($query, 'includeDrafts=1') || str_contains($query, 'includeDrafts=true'), groups: $this->groupsOf($query));
            foreach ($names as $name) {
                $this->assertSame(
                    str_contains($ics, "SUMMARY:$name"),
                    str_contains($html, $name),
                    "$name differs for $query",
                );
            }
        }
    }

    /** @return array{string, string} */
    private function bounds(string $query): array
    {
        parse_str($query, $p);

        return [$p['from'], $p['to']];
    }

    /** @return list<string> */
    private function groupsOf(string $query): array
    {
        parse_str($query, $p);

        return $p['targetGroupIds'] ?? [];
    }

    public function testDraftsOnlyWithIncludeDrafts(): void
    {
        $this->create(['name' => 'Vorstandssitzung', 'isDraft' => true]);
        $this->create(['name' => 'Training']);

        $without = $this->html('agenda', '2026-10-01', '2026-10-31');
        $this->assertStringContainsString('Training', $without);
        $this->assertStringNotContainsString('Vorstandssitzung', $without);

        $with = $this->html('agenda', '2026-10-01', '2026-10-31', drafts: true);
        $this->assertStringContainsString('Vorstandssitzung', $with);
        $this->assertStringContainsString('Entwurf', $with);

        $this->assertSame(200, $this->pdf(self::RANGE.'&layout=agenda&includeDrafts=1')['status']);
    }

    // --- hostile input ---

    public function testHostileTextIsRenderedLiterallyAndNothingIsFetched(): void
    {
        $payloads = [
            '<img src="file:///etc/passwd">',
            '<style>@font-face{font-family:x;src:url(http://127.0.0.1:1/x)}</style>',
            '<svg onload="alert(1)"><image href="data:image/svg+xml;base64,PHN2Zy8+"/></svg>',
            '<link rel="stylesheet" href="http://127.0.0.1:1/x.css">',
            '<?php echo file_get_contents("/etc/passwd"); ?>',
        ];
        $location = TestHelper::createLocation(self::$em, $this->club, '<img src="file:///etc/passwd"> Halle');
        foreach ($payloads as $i => $payload) {
            $this->create([
                'name' => "Event $i $payload",
                'note' => $payload,
                'locationId' => $location->getId(),
                'date' => sprintf('2026-10-%02d', $i + 1),
            ]);
        }

        foreach (['agenda', 'month-grid'] as $layout) {
            $html = $this->html($layout, '2026-10-01', '2026-10-31');
            if ('month-grid' === $layout) {
                // event lines are cut to the cell width, so only the escaped start of the name survives
                $this->assertStringContainsString('&lt;', $html, $layout);
            } else {
                $this->assertStringContainsString('&lt;img src=&quot;file:///etc/passwd&quot;&gt;', $html, $layout);
                $this->assertStringContainsString('&lt;link rel=', $html, $layout);
            }
            $this->assertStringNotContainsString('<img src="file:///etc/passwd"', $html, $layout);
            $this->assertStringNotContainsString('<link rel="stylesheet"', $html, $layout);
            $this->assertStringNotContainsString('<svg', $html, $layout);
            $this->assertStringNotContainsString('<?php', $html, $layout);

            $r = $this->pdf("from=2026-10-01&to=2026-10-31&layout=$layout");
            $this->assertSame(200, $r['status'], $r['content']);
            $this->assertStringStartsWith('%PDF', $r['content']);
            $this->assertGreaterThan(1000, strlen($r['content']));
            $this->assertStringNotContainsString('root:', $r['content'], 'no file content leaked into the PDF');
        }
    }

    public function testHostilePropertyIconsAreOmittedEverywhere(): void
    {
        $icons = [
            '<img src="file:///etc/passwd">',
            '../../etc/passwd',
            '🏆🎯',
            'Freitext',
            "\u{1F9FF}\u{200D}\u{1F9FF}\u{200D}\u{1F9FF}",
        ];
        $ids = [];
        foreach ($icons as $i => $icon) {
            $ids[] = TestHelper::createProperty(self::$em, $this->calendar, "Eigenschaft$i", $icon)->getId();
        }
        $this->create(['name' => 'Mit Icons', 'propertyIds' => $ids]);

        foreach (['agenda', 'month-grid'] as $layout) {
            $model = $this->model($layout, '2026-10-01', '2026-10-31');
            $this->assertSame([], $model['legend'], $layout);
            $html = $this->html($layout, '2026-10-01', '2026-10-31');
            $this->assertStringNotContainsString('<img', $html, "$layout: no box for an unresolvable icon");
            $this->assertStringNotContainsString('passwd', $html, $layout);
            $this->assertStringNotContainsString('Eigenschaft', $html, 'property names only appear through the legend');

            $r = $this->pdf("from=2026-10-01&to=2026-10-31&layout=$layout");
            $this->assertSame(200, $r['status'], $r['content']);
        }
    }

    // --- language and week start ---

    /** @return iterable<string, array{string, int, string, string}> */
    public static function preferences(): iterable
    {
        yield 'de, Monday' => ['de', 1, 'Mo', 'Oktober'];
        yield 'en, Sunday' => ['en', 0, 'Su', 'October'];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('preferences')]
    public function testLanguageAndFirstWeekdayFollowTheUser(string $language, int $firstDay, string $firstWeekday, string $month): void
    {
        $owner = self::$em->find(User::class, $this->owner->getId());
        $owner->setLanguage($language)->setFirstDayOfWeek($firstDay);
        self::$em->flush();
        $this->create(['name' => 'Entwurfstermin', 'isDraft' => true]);

        $model = $this->model('month-grid', '2026-10-01', '2026-10-31', drafts: true);
        $this->assertSame($language, $model['locale']);
        $this->assertSame($firstDay, $model['firstDayOfWeek']);
        $this->assertStringStartsWith($firstWeekday, $model['weekdays'][0]);

        $html = $this->html('month-grid', '2026-10-01', '2026-10-31', drafts: true);
        $this->assertStringContainsString($month, $html);
        $this->assertStringContainsString('class="ev dr"', $html);
        $this->assertSame(200, $this->pdf(self::RANGE.'&layout=month-grid&includeDrafts=1')['status']);
    }

    public function testMonthGridLineHasTimeEmojiTitleAndFeatures(): void
    {
        $trophy = TestHelper::createProperty(self::$em, $this->calendar, 'Wettkampf', '🏆')->getId();
        $feature = TestHelper::createFeature(self::$em, $this->calendar, 'Bo')->getId();
        $this->create(['name' => 'Pokal', 'propertyIds' => [$trophy], 'featureIds' => [$feature]]);
        $this->create(['name' => 'Ganztägig', 'isAllDay' => true, 'timeBegin' => '00:00', 'timeEnd' => '23:59', 'date' => '2026-10-02']);
        $this->create(['name' => 'Entwurf', 'isDraft' => true, 'date' => '2026-10-03']);

        $html = $this->html('month-grid', '2026-10-01', '2026-10-31', drafts: true);
        $this->assertMatchesRegularExpression('~<div class="ev">19:00 <img class="emoji" src="[^"]+"> Pokal \(Bo\)</div>~', $html);
        $this->assertMatchesRegularExpression('~<div class="ev">Ganztägig</div>~', $html);
        $this->assertMatchesRegularExpression('~<div class="ev dr">19:00 Entwurf</div>~', $html);
        $this->assertStringNotContainsString('(Entwurf)', $html);
        $this->assertSame(200, $this->pdf(self::RANGE.'&layout=month-grid&includeDrafts=1')['status']);
    }

    // --- legend ---

    public function testLegendListsOnlyUsedPropertiesAndGroupsSharedEmoji(): void
    {
        $trophy = TestHelper::createProperty(self::$em, $this->calendar, 'Wettkampf', '🏆')->getId();
        $trophy2 = TestHelper::createProperty(self::$em, $this->calendar, 'Pokal', '🏆')->getId();
        $target = TestHelper::createProperty(self::$em, $this->calendar, 'Training', '🎯')->getId();
        $unknown = TestHelper::createProperty(self::$em, $this->calendar, 'Ohne Bild', 'Freitext')->getId();
        $unused = TestHelper::createProperty(self::$em, $this->calendar, 'Ungenutzt', '😀')->getId();
        $outside = TestHelper::createProperty(self::$em, $this->calendar, 'Außerhalb', '🎉')->getId();
        $draftOnly = TestHelper::createProperty(self::$em, $this->calendar, 'Nur Entwurf', '🔥')->getId();
        $this->assertNotEmpty([$unused]);

        $this->create(['name' => 'Cup', 'propertyIds' => [$trophy, $trophy2, $unknown]]);
        $this->create(['name' => 'Übung', 'propertyIds' => [$target], 'date' => '2026-10-05']);
        $this->create(['name' => 'Spaß', 'propertyIds' => [$outside], 'date' => '2026-12-05']);
        $this->create(['name' => 'Geheim', 'propertyIds' => [$draftOnly], 'isDraft' => true]);

        $legend = $this->model('agenda', '2026-10-01', '2026-10-31')['legend'];
        $this->assertCount(2, $legend);
        $byNames = array_map(static fn (array $row): array => $row['names'], $legend);
        $this->assertContains(['Pokal', 'Wettkampf'], $byNames, 'two properties with one emoji share one row, sorted');
        $this->assertContains(['Training'], $byNames);
        foreach ($legend as $row) {
            $this->assertFileExists($row['emojiPath']);
            $this->assertStringContainsString('/assets/pdf/emoji/emoji_u', $row['emojiPath']);
        }

        $html = $this->html('agenda', '2026-10-01', '2026-10-31');
        $this->assertStringContainsString('Legende', $html);
        foreach (['Ungenutzt', 'Außerhalb', 'Nur Entwurf', 'Ohne Bild'] as $absent) {
            $this->assertStringNotContainsString($absent, $html);
        }

        $withDrafts = $this->model('agenda', '2026-10-01', '2026-10-31', drafts: true)['legend'];
        $this->assertCount(3, $withDrafts);
    }

    public function testNoLegendWithoutIcons(): void
    {
        $this->create(['name' => 'Schlicht']);

        $this->assertSame([], $this->model('agenda', '2026-10-01', '2026-10-31')['legend']);
        $this->assertStringNotContainsString('Legende', $this->html('agenda', '2026-10-01', '2026-10-31'));
    }

    // --- holidays ---

    /** @param list<array{0: string, 1: string, 2: ?string}> $events name, date, inclusive end */
    private function holidayCalendar(HolidayType $type, array $events, ?Calendar $calendar = null): string
    {
        $calendar ??= self::$em->find(Calendar::class, $this->calendar->getId());
        $hc = new HolidayCalendar($calendar, 'Ferien', 'https://example.org/h.ics');
        $hc->setType($type);
        self::$em->persist($hc);
        foreach ($events as $i => [$name, $date, $end]) {
            self::$em->persist(new HolidayEvent($hc, 'uid-'.$i.'-'.$hc->getId(), $name, new \DateTimeImmutable($date), null !== $end ? new \DateTimeImmutable($end) : null));
        }
        self::$em->flush();

        return $hc->getId();
    }

    /** @param list<string> $ids */
    private function holidayHtml(string $layout, string $from, string $to, array $ids): string
    {
        $c = static::getContainer();
        $calendar = self::$em->find(Calendar::class, $this->calendar->getId());
        $filter = $c->get(EventExportService::class)->filter($calendar, $from, $to, '0', null);
        $rows = $c->get(PdfHolidaySelection::class)->load($calendar, $ids, $filter);

        return $c->get(PdfExportService::class)->renderHtml($calendar, $filter, new PdfOptions(PdfLayout::from($layout)), self::$em->find(User::class, $this->owner->getId()), $rows);
    }

    public function testNoHolidaysByDefault(): void
    {
        $this->holidayCalendar(HolidayType::PUBLIC, [['Tag der Einheit', '2026-10-03', null]]);
        $html = $this->html('month-grid', '2026-10-01', '2026-10-31');
        $this->assertStringNotContainsString('Tag der Einheit', $html);
        $this->assertStringNotContainsString('in pub', $html);
    }

    public function testMonthGridPublicHolidayHasColourAndName(): void
    {
        // 2026-10-03 is a Saturday: the public holiday colour wins over the weekend
        $id = $this->holidayCalendar(HolidayType::PUBLIC, [['Tag der Einheit', '2026-10-03', null]]);
        $html = $this->holidayHtml('month-grid', '2026-10-01', '2026-10-31', [$id]);
        $this->assertMatchesRegularExpression('~<td class="in pub">\s*<div class="num">3</div>\s*<div class="hn">Tag der Einheit</div>~', $html);
        $this->assertStringContainsString('Feiertag', $html);
        $this->assertStringNotContainsString('Schulferien', $html);
    }

    public function testSchoolHolidayNameOnlyOnFirstVisibleDayAndWeekendWins(): void
    {
        // starts before the exported range: the first visible day (Thu 2026-10-01) carries the name
        $id = $this->holidayCalendar(HolidayType::SCHOOL, [['Herbstferien', '2026-09-28', '2026-10-05']]);
        $html = $this->holidayHtml('month-grid', '2026-10-01', '2026-10-31', [$id]);
        $this->assertSame(1, substr_count($html, 'Herbstferien'));
        $this->assertMatchesRegularExpression('~<td class="in sch">\s*<div class="num">1</div>\s*<div class="hn">Herbstferien</div>~', $html);
        $this->assertMatchesRegularExpression('~<td class="in sch">\s*<div class="num">2</div>~', $html);
        $this->assertMatchesRegularExpression('~<td class="in we">\s*<div class="num">3</div>~', $html);
        $this->assertMatchesRegularExpression('~<td class="in">\s*<div class="num">6</div>~', $html);
        $this->assertStringContainsString('Schulferien', $html);
    }

    public function testOutOfRangeStaysGrey(): void
    {
        $id = $this->holidayCalendar(HolidayType::PUBLIC, [['Tag der Einheit', '2026-10-03', null]]);
        $html = $this->holidayHtml('month-grid', '2026-10-05', '2026-10-31', [$id]);
        $this->assertMatchesRegularExpression('~<td class="out">\s*<div class="num">3</div>~', $html);
        $this->assertStringNotContainsString('Tag der Einheit', $html);
        $this->assertStringNotContainsString('Feiertag', $html);
    }

    public function testQuarterAnnualAndAgendaShowHolidays(): void
    {
        $pub = $this->holidayCalendar(HolidayType::PUBLIC, [['Neujahr', '2026-01-01', null]]);
        $sch = $this->holidayCalendar(HolidayType::SCHOOL, [['Winterferien', '2026-02-02', '2026-02-06']]);
        $this->create(['name' => 'Training', 'date' => '2026-01-01']);

        $quarter = $this->holidayHtml('quarter-overview', '2026-01-01', '2026-03-31', [$pub, $sch]);
        $this->assertStringContainsString('<tr class="pub">', $quarter);
        $this->assertStringContainsString('<tr class="sch">', $quarter);
        $this->assertSame(1, substr_count($quarter, 'Winterferien'));
        // the name only takes a free line: one event + name still fits the two-line minimum
        $this->assertStringContainsString('<div class="ln hn">Neujahr</div>', $quarter);
        $this->assertStringContainsString('Schulferien', $quarter);

        $annual = $this->holidayHtml('annual-overview', '2026-01-01', '2026-12-31', [$pub, $sch]);
        $this->assertStringContainsString('<td class="sch">3</td>', $annual);
        $this->assertStringContainsString('Feiertag', $annual);

        $agenda = $this->holidayHtml('agenda', '2026-01-01', '2026-03-31', [$pub, $sch]);
        $this->assertStringContainsString('<b>Neujahr</b>', $agenda);
        $this->assertSame(1, substr_count($agenda, '<b>Winterferien</b>'));
        $this->assertLessThan(strpos($agenda, 'Training'), strpos($agenda, 'Neujahr'));
    }

    public function testRequestWithHolidayCalendarsReturnsAPdfForEveryLayout(): void
    {
        $id = $this->holidayCalendar(HolidayType::PUBLIC, [['Tag der Einheit', '2026-10-03', null]]);
        foreach (['month-grid', 'agenda'] as $layout) {
            $r = $this->pdf(self::RANGE.'&layout='.$layout.'&holidayCalendarIds[]='.$id);
            $this->assertSame(200, $r['status'], $r['content']);
            $this->assertStringStartsWith('%PDF', $r['content']);
        }
        $r = $this->pdf('from=2026-01-01&to=2026-12-31&layout=annual-overview&holidayCalendarIds[]='.$id);
        $this->assertSame(200, $r['status']);
        $r = $this->pdf('from=2026-10-01&to=2026-12-31&layout=quarter-overview&holidayCalendarIds[]='.$id);
        $this->assertSame(200, $r['status']);
    }

    public function testUnknownOrForeignHolidayCalendarIs422(): void
    {
        $other = TestHelper::createCalendar(self::$em, $this->club, 'Andere');
        $foreign = $this->holidayCalendar(HolidayType::PUBLIC, [], $other);
        foreach ([$foreign, '00000000-0000-7000-8000-000000000000'] as $id) {
            $r = $this->pdf(self::RANGE.'&layout=agenda&holidayCalendarIds[]='.$id);
            $this->assertSame(422, $r['status']);
            $this->assertSame('unknown_reference', $r['body']['code']);
            $this->assertSame('holidayCalendarIds', $r['body']['field']);
        }
    }

    public function testMoreThan20HolidayCalendarsIs400(): void
    {
        $query = implode('&', array_map(static fn (int $i): string => 'holidayCalendarIds[]=id'.$i, range(1, 21)));
        $r = $this->pdf(self::RANGE.'&layout=agenda&'.$query);
        $this->assertSame(400, $r['status']);
        $this->assertSame('holidayCalendarIds', $r['body']['field']);
    }
}
