<?php

declare(strict_types=1);

namespace App\Tests\Service;

use App\Entity\Calendar;
use App\Entity\EventProperty;
use App\Entity\User;
use App\Exception\ApiProblemException;
use App\Pdf\PdfExportService;
use App\Pdf\PdfLayout;
use App\Pdf\PdfOptions;
use App\Service\EventExportService;
use App\Service\ExportFilter;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

class PdfExportServiceTest extends KernelTestCase
{
    private EntityManagerInterface $em;
    private PdfExportService $service;
    private EventExportService $export;
    private User $user;
    private Calendar $calendar;

    protected function setUp(): void
    {
        self::bootKernel();
        $c = static::getContainer();
        $this->em = $c->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);
        $this->service = $c->get(PdfExportService::class);
        $this->export = $c->get(EventExportService::class);
        $this->user = TestHelper::createUser($this->em, $c->get(UserPasswordHasherInterface::class));
        $this->user->setLanguage('de');
        $this->user->setFirstDayOfWeek(1);
        $club = TestHelper::createClub($this->em, $this->user);
        $this->calendar = TestHelper::createCalendar($this->em, $club);
        $this->em->flush();
    }

    private function filter(string $from = '2026-07-01', string $to = '2026-07-31', bool $drafts = false): ExportFilter
    {
        return $this->export->filter($this->calendar, $from, $to, $drafts ? '1' : '0', null);
    }

    private function agenda(): PdfOptions
    {
        return new PdfOptions(PdfLayout::Agenda);
    }

    /** @param list<\App\Entity\Property> $props */
    private function event(string $name, string $date, array $props = [], bool $draft = false, array $extra = []): \App\Entity\Event
    {
        $e = TestHelper::createEvent($this->em, $this->calendar, ['name' => $name, 'date' => $date, 'isDraft' => $draft] + $extra);
        foreach ($props as $p) {
            $this->em->persist((new EventProperty())->setEvent($e)->setProperty($p));
        }
        $this->em->flush();

        return $e;
    }

    public function testAgendaRendersPdfWithUmlautsAndEmoji(): void
    {
        $p = TestHelper::createProperty($this->em, $this->calendar, 'Fest', "\u{1F389}");
        $this->event('Schützenfest Übung', '2026-07-04', [$p], false);

        $pdf = $this->service->render($this->calendar, $this->filter(), $this->agenda(), $this->user);

        self::assertStringStartsWith('%PDF', $pdf);
        self::assertGreaterThan(1000, strlen($pdf));
        if (false !== ($out = getenv('PDF_OUT'))) {
            file_put_contents($out, $pdf);
        }
    }

    public function testGermanAndEnglishLabelsAndMonthHeading(): void
    {
        $this->event('Training', '2026-07-04');

        $de = $this->service->renderHtml($this->calendar, $this->filter(), $this->agenda(), $this->user);
        self::assertStringContainsString('Uhrzeit', $de);
        self::assertStringContainsString('Juli 2026', $de);
        self::assertStringContainsString('Sa., 04.07.2026', $de);

        $this->user->setLanguage('en');
        $en = $this->service->renderHtml($this->calendar, $this->filter(), $this->agenda(), $this->user);
        self::assertStringContainsString('Time', $en);
        self::assertStringContainsString('July 2026', $en);
        self::assertStringNotContainsString('Uhrzeit', $en);
    }

    public function testLegendListsOnlyUsedResolvableProperties(): void
    {
        $fest = TestHelper::createProperty($this->em, $this->calendar, 'Fest', "\u{1F389}");
        $ziel = TestHelper::createProperty($this->em, $this->calendar, 'Zielen', "\u{1F3AF}");
        $ziel2 = TestHelper::createProperty($this->em, $this->calendar, 'Bogen', "\u{1F3AF}");
        $odd = TestHelper::createProperty($this->em, $this->calendar, 'Seltsam', '<img src="file:///etc/passwd">');
        $unused = TestHelper::createProperty($this->em, $this->calendar, 'Unbenutzt', "\u{1F600}");
        $draftOnly = TestHelper::createProperty($this->em, $this->calendar, 'NurEntwurf', "\u{1F600}");
        $this->event('A', '2026-07-02', [$fest, $ziel, $odd]);
        $this->event('B', '2026-07-03', [$ziel2]);
        $this->event('C', '2026-07-04', [$draftOnly], true);
        unset($unused);

        $html = $this->service->renderHtml($this->calendar, $this->filter(), $this->agenda(), $this->user);

        self::assertStringContainsString('Legende', $html);
        self::assertStringContainsString('Bogen, Zielen', $html, 'same emoji shares one row, names sorted');
        self::assertStringContainsString('Fest', $html);
        self::assertStringNotContainsString('Unbenutzt', $html);
        self::assertStringNotContainsString('NurEntwurf', $html);
        self::assertStringNotContainsString('Seltsam', $html);
        self::assertStringNotContainsString('etc/passwd', $html);
        self::assertSame(2, substr_count($html, 'class="emoji-lg"'));
    }

    public function testNoLegendWithoutResolvableIcons(): void
    {
        $draftOnly = TestHelper::createProperty($this->em, $this->calendar, 'NurEntwurf', "\u{1F600}");
        $this->event('C', '2026-07-04', [$draftOnly], true);
        $this->event('D', '2026-07-05');

        $html = $this->service->renderHtml($this->calendar, $this->filter(), $this->agenda(), $this->user);

        self::assertStringNotContainsString('Legende', $html);
        self::assertStringNotContainsString('emoji-lg"', $html);
    }

    public function testDraftsAreMarkedWhenIncluded(): void
    {
        $this->event('Entwurfstermin', '2026-07-04', [], true);

        $html = $this->service->renderHtml($this->calendar, $this->filter(drafts: true), $this->agenda(), $this->user);

        self::assertStringContainsString('(Entwurf)', $html);
    }

    public function testHostileTextIsEscapedAndStillRendersPdf(): void
    {
        $payload = '<img src="file:///etc/passwd"><style>@font-face{src:url(http://127.0.0.1:1/x)}</style><?php echo 1; ?>';
        $this->event($payload, '2026-07-04');

        $html = $this->service->renderHtml($this->calendar, $this->filter(), $this->agenda(), $this->user);
        self::assertStringNotContainsString('<img src="file:///etc/passwd">', $html);
        self::assertStringContainsString('&lt;img src=', $html);

        $pdf = $this->service->render($this->calendar, $this->filter(), $this->agenda(), $this->user);
        self::assertStringStartsWith('%PDF', $pdf);
    }

    public function testMultiDayEventAppearsOnEveryDayInRange(): void
    {
        $e = $this->event('Lager', '2026-07-30', [], false, []);
        $e->setDateEnd(new \DateTimeImmutable('2026-08-02'));
        $e->setIsAllDay(true);
        $this->em->flush();

        $html = $this->service->renderHtml($this->calendar, $this->filter('2026-07-31', '2026-08-01'), $this->agenda(), $this->user);

        self::assertSame(2, substr_count($html, '>Lager<'));
        self::assertStringContainsString('Juli 2026', $html);
        self::assertStringContainsString('August 2026', $html);
        self::assertStringNotContainsString('Do., 30.07.2026', $html);
    }

    public function testRangeLongerThanCapIsRejected(): void
    {
        $this->expectException(ApiProblemException::class);
        $this->service->render($this->calendar, $this->filter('2026-01-01', '2027-06-01'), $this->agenda(), $this->user);
    }

    public function testUnavailableLayoutIsRejected(): void
    {
        try {
            $this->service->render($this->calendar, $this->filter(), new PdfOptions(PdfLayout::AnnualOverview), $this->user);
            self::fail('expected 400');
        } catch (ApiProblemException $e) {
            self::assertSame(400, $e->getStatusCode());
            self::assertSame('layout', $e->getField());
        }
    }

    public function testMissingRangeIsRejected(): void
    {
        $filter = new ExportFilter(null, null, false, []);
        $this->expectException(ApiProblemException::class);
        $this->service->render($this->calendar, $filter, $this->agenda(), $this->user);
    }

    private function month(): PdfOptions
    {
        return new PdfOptions(PdfLayout::MonthGrid);
    }

    public function testMonthGridWeekdayOrderForBothFirstDays(): void
    {
        $mon = $this->service->renderHtml($this->calendar, $this->filter(), $this->month(), $this->user);
        self::assertMatchesRegularExpression('/<th>Mo\.<\/th>\s*<th>Di\.<\/th>.*<th>So\.<\/th>/s', $mon);
        self::assertStringContainsString('Juli 2026', $mon);
        self::assertStringContainsString('table-layout: fixed', $mon);

        $this->user->setFirstDayOfWeek(0);
        $sun = $this->service->renderHtml($this->calendar, $this->filter(), $this->month(), $this->user);
        self::assertMatchesRegularExpression('/<th>So\.<\/th>\s*<th>Mo\.<\/th>/s', $sun);
    }

    public function testMonthGridPlacesEventsInCellsAndMultiDay(): void
    {
        $this->event('Training', '2026-07-04');
        $e = $this->event('Lager', '2026-07-30');
        $e->setDateEnd(new \DateTimeImmutable('2026-08-02'));
        $e->setIsAllDay(true);
        $this->em->flush();

        $model = $this->service->buildViewModel($this->calendar, $this->filter('2026-07-01', '2026-08-31'), $this->month(), $this->user);
        $cells = [];
        foreach ($model['months'] as $m) {
            foreach (array_filter(array_merge(...$m['weeks'])) as $c) {
                $cells[$c['date']] = $c;
            }
        }
        self::assertSame('Training', $cells['2026-07-04']['events'][0]['name']);
        self::assertSame([], $cells['2026-07-05']['events']);
        foreach (['2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02'] as $day) {
            self::assertSame('Lager', $cells[$day]['events'][0]['name'], $day);
        }
        self::assertSame([], $cells['2026-08-03']['events']);
        self::assertCount(2, $model['months']);
    }

    public function testMonthGridOverflowAndPdf(): void
    {
        foreach (range(1, 7) as $i) {
            $this->event("Termin $i", '2026-07-04');
        }
        $p = TestHelper::createProperty($this->em, $this->calendar, 'Fest', "\u{1F389}");
        $this->event('Mit Emoji', '2026-07-05', [$p]);

        $html = $this->service->renderHtml($this->calendar, $this->filter(), $this->month(), $this->user);
        self::assertStringContainsString('+3 weitere', $html);
        self::assertStringContainsString('Legende', $html);

        $pdf = $this->service->render($this->calendar, $this->filter(), $this->month(), $this->user);
        self::assertStringStartsWith('%PDF', $pdf);
        if (false !== ($out = getenv('PDF_OUT_MONTH'))) {
            file_put_contents($out, $this->service->render($this->calendar, $this->filter('2026-07-01', '2026-08-31'), $this->month(), $this->user));
        }
    }

    public function testQuarterOverviewHtmlPagesAndWeekdayOrder(): void
    {
        $this->event('Training', '2026-08-04');
        $quarter = new PdfOptions(PdfLayout::QuarterOverview);
        $filter = $this->filter('2026-07-01', '2026-11-30');

        $model = $this->service->buildViewModel($this->calendar, $filter, $quarter, $this->user);
        self::assertSame([3, 2], array_map('count', $model['pages']));

        $html = $this->service->renderHtml($this->calendar, $filter, $quarter, $this->user);
        self::assertStringContainsString('Juli 2026', $html);
        self::assertStringContainsString('November 2026', $html);
        self::assertStringContainsString('Training', $html);
        self::assertMatchesRegularExpression('/<th>Mo\.<\/th>\s*<th>Di\.<\/th>/', $html);
        self::assertStringContainsString('A4 landscape', $html);
        self::assertSame(3 + 3, substr_count($html, '<td class="qm">'), 'one cell per column, last page padded to three');

        $this->user->setFirstDayOfWeek(0);
        self::assertMatchesRegularExpression('/<th>So\.<\/th>\s*<th>Mo\.<\/th>/', $this->service->renderHtml($this->calendar, $filter, $quarter, $this->user));
    }

    public function testQuarterOverviewPdfGermanAndEnglishWithLegend(): void
    {
        $p = TestHelper::createProperty($this->em, $this->calendar, 'Fest', "\u{1F389}");
        $this->event('Mit Emoji', '2026-07-05', [$p]);
        $quarter = new PdfOptions(PdfLayout::QuarterOverview);
        $filter = $this->filter('2026-07-01', '2026-09-30');

        $de = $this->service->renderHtml($this->calendar, $filter, $quarter, $this->user);
        self::assertStringContainsString('Legende', $de);
        self::assertStringStartsWith('%PDF', $this->service->render($this->calendar, $filter, $quarter, $this->user));

        $this->user->setLanguage('en');
        $en = $this->service->renderHtml($this->calendar, $filter, $quarter, $this->user);
        self::assertStringContainsString('July 2026', $en);
        self::assertStringContainsString('Legend', $en);
        $pdf = $this->service->render($this->calendar, $filter, $quarter, $this->user);
        self::assertStringStartsWith('%PDF', $pdf);
        if (false !== ($out = getenv('PDF_OUT_QUARTER'))) {
            file_put_contents($out, $pdf);
        }
    }

    public function testQuarterOverviewRejectedForTwoMonths(): void
    {
        $this->expectException(ApiProblemException::class);
        $this->service->buildViewModel($this->calendar, $this->filter('2026-07-01', '2026-08-31'), new PdfOptions(PdfLayout::QuarterOverview), $this->user);
    }
}
