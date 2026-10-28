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

    /** dompdf writes info strings as UTF-16BE with BOM. */
    private function info(string $pdf, string $key): string
    {
        self::assertSame(1, preg_match('~/'.$key.' \(\xFE\xFF((?:[^\\\\)]|\\\\.)*)\)~s', $pdf, $m));

        return mb_convert_encoding(stripcslashes($m[1]), 'UTF-8', 'UTF-16BE');
    }

    public function testAuthorAndCreatorMetadata(): void
    {
        $this->calendar->getClub()->setName("Schuetzen\x07verein Test");
        $this->em->flush();

        $pdf = $this->service->render($this->calendar, $this->filter(), $this->agenda(), $this->user);

        self::assertSame('Schuetzen verein Test', $this->info($pdf, 'Author'));
        self::assertMatchesRegularExpression('~^Club Calendar( \(http[^)]*\))?$~', $this->info($pdf, 'Creator'));
        self::assertStringContainsString('/Producer', $pdf);
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
        self::assertSame('Training', $cells['2026-07-04']['events'][0]['title']);
        self::assertSame([], $cells['2026-07-05']['events']);
        foreach (['2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02'] as $day) {
            self::assertSame('Lager', $cells[$day]['events'][0]['title'], $day);
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

    public function testCiHeaderBarAndWeekendClassesInMonthAnnualAndAgenda(): void
    {
        // 2026-07-04 is a Saturday, 2026-07-06 a Monday
        $this->event('Samstag', '2026-07-04');
        $this->event('Montag', '2026-07-06');

        $month = $this->service->renderHtml($this->calendar, $this->filter(), $this->month(), $this->user);
        self::assertSame(1, substr_count($month, 'id="pagehead"'), 'fixed header repeats on every page');
        self::assertStringNotContainsString('<h1>', $month);
        self::assertStringContainsString('<div class="bar">Juli 2026</div>', $month);
        self::assertSame(8, substr_count($month, 'class="in we"'), '4 Saturdays and 4 Sundays in July 2026');
        self::assertMatchesRegularExpression('/<td class="in we">\s*<div class="num">4<\/div>/', $month);
        self::assertMatchesRegularExpression('/<td class="in">\s*<div class="num">6<\/div>/', $month);

        $annual = $this->service->renderHtml($this->calendar, $this->filter('2026-01-01', '2026-12-31'), new PdfOptions(PdfLayout::AnnualOverview), $this->user);
        self::assertSame(1, substr_count($annual, 'id="pagehead"'));
        self::assertSame(13, substr_count($annual, 'class="bar'), '12 month headings and the event list heading');
        self::assertStringContainsString('<div class="bar mname">Januar</div>', $annual);
        self::assertStringContainsString('<td class="we">3</td>', $annual);
        self::assertStringContainsString('<td class="no">2</td>', $annual);
        self::assertStringContainsString('<tr class="we">', $annual);

        $agenda = $this->service->renderHtml($this->calendar, $this->filter(), $this->agenda(), $this->user);
        self::assertSame(1, substr_count($agenda, 'id="pagehead"'));
        self::assertStringNotContainsString('<h1>', $agenda);
        self::assertStringContainsString('<div class="bar month">Juli 2026</div>', $agenda);
        self::assertMatchesRegularExpression('/<tr class="we">\s*<td class="dc">Sa\., 04\.07\.2026/', $agenda);
        self::assertMatchesRegularExpression('/<tr class="wd">\s*<td class="dc">Mo\., 06\.07\.2026/', $agenda);
    }

    public function testQuarterOverviewHtmlDayRowsHeaderOnEveryPageAndLandscape(): void
    {
        $this->event('Training', '2026-08-04');
        $quarter = new PdfOptions(PdfLayout::QuarterOverview);
        $filter = $this->filter('2026-07-01', '2026-11-30');

        $model = $this->service->buildViewModel($this->calendar, $filter, $quarter, $this->user);
        self::assertSame([3, 2], array_map(static fn (array $p): int => count($p['months']), $model['pages']));

        $html = $this->service->renderHtml($this->calendar, $filter, $quarter, $this->user);
        self::assertStringContainsString('Juli 2026', $html);
        self::assertStringContainsString('November 2026', $html);
        self::assertStringContainsString('Training', $html);
        self::assertStringContainsString('A4 landscape', $html);
        self::assertStringNotContainsString('<h1>', $html, 'the first-page header of the base is replaced');
        self::assertSame(2, substr_count($html, 'class="col hd club"'), 'club header on every page');
        self::assertSame(2, substr_count($html, 'class="col hd cal"'));
        self::assertSame(3 + 2, substr_count($html, 'class="bar"'));
        self::assertSame(5 * 31, substr_count($html, '<tr class="we"') + substr_count($html, '<tr class="wd"') + substr_count($html, '<tr class="grey"'), 'one row per grid day');
        self::assertStringContainsString('<tr class="we">', $html);
        self::assertStringContainsString('18:00', $html);
    }

    public function testQuarterOverviewLineHasTimeEmojiTitleAndFeatures(): void
    {
        $p = TestHelper::createProperty($this->em, $this->calendar, 'Fest', "\u{1F389}");
        $f = TestHelper::createFeature($this->em, $this->calendar, 'Bonusschießen');
        $e = $this->event('Schützenfest', '2026-07-04', [$p]);
        $this->em->persist((new \App\Entity\EventFeature())->setEvent($e)->setFeature($f));
        $this->em->flush();

        $html = $this->service->renderHtml($this->calendar, $this->filter('2026-07-01', '2026-09-30'), new PdfOptions(PdfLayout::QuarterOverview), $this->user);
        self::assertMatchesRegularExpression('/18:00 <img class="emoji" src="[^"]+emoji_u1f389\.png"> Schützenfest \(Bonusschießen\)/u', $html);
    }

    public function testQuarterOverviewLegendPerPageOnlyForThatPage(): void
    {
        $fest = TestHelper::createProperty($this->em, $this->calendar, 'Fest', "\u{1F389}");
        $ziel = TestHelper::createProperty($this->em, $this->calendar, 'Schießen', "\u{1F3AF}");
        $this->event('Julifest', '2026-07-05', [$fest]);
        $this->event('Oktoberschießen', '2026-10-05', [$ziel]);

        $quarter = new PdfOptions(PdfLayout::QuarterOverview);
        $filter = $this->filter('2026-07-01', '2026-12-31');
        $model = $this->service->buildViewModel($this->calendar, $filter, $quarter, $this->user);
        self::assertSame([], $model['legend'], 'no global legend for this layout');
        self::assertSame([['Fest']], array_column($model['pages'][0]['legend'], 'names'));
        self::assertSame([['Schießen']], array_column($model['pages'][1]['legend'], 'names'));

        $html = $this->service->renderHtml($this->calendar, $filter, $quarter, $this->user);
        self::assertSame(2, substr_count($html, 'class="legend"'));
        self::assertStringNotContainsString('<h2>', $html);
    }

    public function testQuarterOverviewPdfGermanAndEnglishWithoutLegendWhenNoIcons(): void
    {
        $this->event('Ohne Icon', '2026-07-05');
        $quarter = new PdfOptions(PdfLayout::QuarterOverview);
        $html = $this->service->renderHtml($this->calendar, $this->filter('2026-07-01', '2026-09-30'), $quarter, $this->user);
        self::assertStringNotContainsString('class="legend"', $html);
    }

    public function testQuarterOverviewPdfGermanAndEnglishWithLegend(): void
    {
        $p = TestHelper::createProperty($this->em, $this->calendar, 'Fest', "\u{1F389}");
        $this->event('Mit Emoji', '2026-07-05', [$p]);
        $quarter = new PdfOptions(PdfLayout::QuarterOverview);
        $filter = $this->filter('2026-07-01', '2026-09-30');

        $de = $this->service->renderHtml($this->calendar, $filter, $quarter, $this->user);
        self::assertStringContainsString('class="legend"', $de);
        self::assertStringContainsString('Zeitraum', $de);
        self::assertStringStartsWith('%PDF', $this->service->render($this->calendar, $filter, $quarter, $this->user));

        $this->user->setLanguage('en');
        $en = $this->service->renderHtml($this->calendar, $filter, $quarter, $this->user);
        self::assertStringContainsString('July 2026', $en);
        self::assertStringContainsString('Period', $en);
        self::assertStringContainsString('>We<', $en);
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

    public function testAnnualOverviewHtmlWeekdayOrderAndMarkedDays(): void
    {
        $this->event('Sommerfest', '2026-07-04');
        $annual = new PdfOptions(PdfLayout::AnnualOverview);
        $filter = $this->filter('2026-01-01', '2026-12-31');

        $model = $this->service->buildViewModel($this->calendar, $filter, $annual, $this->user);
        self::assertCount(12, $model['months']);

        $html = $this->service->renderHtml($this->calendar, $filter, $annual, $this->user);
        self::assertStringContainsString('Juli', $html);
        self::assertStringContainsString('Sommerfest', $html);
        self::assertStringContainsString('Termine', $html);
        self::assertStringContainsString('A4 landscape', $html);
        self::assertSame(1, substr_count($html, '<td class="has">'));
        self::assertMatchesRegularExpression('/<th>Mo<\/th>\s*<th>Di<\/th>/', $html);

        $this->user->setFirstDayOfWeek(0);
        self::assertMatchesRegularExpression('/<th>So<\/th>\s*<th>Mo<\/th>/', $this->service->renderHtml($this->calendar, $filter, $annual, $this->user));
    }

    public function testAnnualOverviewPdfGermanEnglishAndPapers(): void
    {
        $p = TestHelper::createProperty($this->em, $this->calendar, 'Fest', "\u{1F389}");
        $this->event('Mit Emoji', '2026-07-05', [$p]);
        $filter = $this->filter('2026-01-01', '2026-12-31');

        foreach (['de', 'en'] as $lang) {
            $this->user->setLanguage($lang);
            foreach (['a4', 'a3'] as $paper) {
                $options = new PdfOptions(PdfLayout::AnnualOverview, $paper);
                self::assertStringStartsWith('%PDF', $this->service->render($this->calendar, $filter, $options, $this->user));
            }
        }
        $html = $this->service->renderHtml($this->calendar, $filter, new PdfOptions(PdfLayout::AnnualOverview, 'a3'), $this->user);
        self::assertStringContainsString('Legend', $html);
        self::assertStringContainsString('A3 landscape', $html);
        if (false !== ($out = getenv('PDF_OUT_ANNUAL'))) {
            file_put_contents($out, $this->service->render($this->calendar, $filter, new PdfOptions(PdfLayout::AnnualOverview), $this->user));
        }
    }

    public function testAnnualOverviewRejectedForPartialYear(): void
    {
        foreach ([['2026-01-01', '2026-12-30'], ['2026-02-01', '2027-01-31'], ['2026-01-01', '2026-06-30']] as [$from, $to]) {
            try {
                $this->service->buildViewModel($this->calendar, $this->filter($from, $to), new PdfOptions(PdfLayout::AnnualOverview), $this->user);
                self::fail("$from..$to must be rejected");
            } catch (ApiProblemException $e) {
                self::assertSame(400, $e->getStatusCode());
            }
        }
    }

    public function testQuarterOverviewWithOverfullMonthHasNoBlankPage(): void
    {
        foreach (range(1, 30) as $i) {
            $this->event("Training $i", '2026-11-17');
        }
        foreach (range(1, 30) as $i) {
            $this->event("Probe $i", '2026-11-24');
        }
        $quarter = new PdfOptions(PdfLayout::QuarterOverview);
        $filter = $this->filter('2026-10-01', '2026-12-31', true);

        $pages = count($this->service->buildViewModel($this->calendar, $filter, $quarter, $this->user)['pages']);
        $pdf = $this->service->render($this->calendar, $filter, $quarter, $this->user);

        self::assertSame(2, $pages);
        self::assertSame($pages, preg_match_all('#/Type\s*/Page\b#', $pdf), 'dompdf must not push the whole table to an extra page');
    }
}
