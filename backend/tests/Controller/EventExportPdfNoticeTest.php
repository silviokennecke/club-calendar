<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Calendar;
use App\Entity\EventTargetGroup;
use App\Entity\User;
use App\Enum\EventType;
use App\Exception\ApiProblemException;
use App\Pdf\PdfExportService;
use App\Pdf\PdfLayout;
use App\Pdf\PdfOptions;
use App\Service\EventExportService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** Notices in the PDF export (all layouts but the annual overview), filter parity and the separate cap. */
class EventExportPdfNoticeTest extends KernelTestCase
{
    private EntityManagerInterface $em;
    private Calendar $calendar;
    private User $user;

    protected function setUp(): void
    {
        self::bootKernel();
        $c = static::getContainer();
        $this->em = $c->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);
        $this->user = TestHelper::createUser($this->em, $c->get(UserPasswordHasherInterface::class));
        $this->user->setLanguage('de');
        $club = TestHelper::createClub($this->em, $this->user);
        $this->calendar = TestHelper::createCalendar($this->em, $club);
        $this->em->flush();
    }

    private function notice(string $name, string $date, ?string $end = null, ?string $note = null, bool $draft = false): \App\Entity\Event
    {
        $e = TestHelper::createEvent($this->em, $this->calendar, ['name' => $name, 'date' => $date, 'isDraft' => $draft]);
        $e->setType(EventType::Notice)->setIsAllDay(true);
        if (null !== $end) {
            $e->setDateEnd(new \DateTimeImmutable($end));
        }
        $e->setNote($note);
        $this->em->flush();

        return $e;
    }

    /** @param list<string> $groups */
    private function html(string $layout, string $from, string $to, bool $drafts = false, array $groups = [], ?PdfExportService $service = null): string
    {
        $filter = static::getContainer()->get(EventExportService::class)->filter($this->calendar, $from, $to, $drafts ? '1' : '0', $groups);

        return ($service ?? static::getContainer()->get(PdfExportService::class))->renderHtml($this->calendar, $filter, new PdfOptions(PdfLayout::from($layout)), $this->user);
    }

    public function testQuarterLineFormatSingleAndRangeWithNoteCollapsed(): void
    {
        $this->notice('Schließzeit', '2026-10-05', '2026-10-09', "Halle\ngesperrt");
        $this->notice('Feiertag', '2026-11-03');

        $html = $this->html('quarter-overview', '2026-10-01', '2026-12-31');
        self::assertStringContainsString('Hinweis (05.10.2026 – 09.10.2026): Schließzeit (Halle gesperrt)', $html);
        self::assertMatchesRegularExpression('~Hinweis \(03\.11\.2026\): Feiertag</div>~', $html);
    }

    public function testMonthGridListsOnlyNoticesTouchingThatMonth(): void
    {
        $this->notice('Oktoberhinweis', '2026-10-05');
        $this->notice('Novemberhinweis', '2026-11-05');

        $html = $this->html('month-grid', '2026-10-01', '2026-11-30');
        self::assertSame(1, substr_count($html, 'Oktoberhinweis'));
        self::assertSame(1, substr_count($html, 'Novemberhinweis'));
        self::assertLessThan(strpos($html, 'Novemberhinweis'), strpos($html, 'Oktoberhinweis'));
    }

    public function testAgendaRowHasLabelRangeAllDayAndNoLocation(): void
    {
        $this->notice('Ferien', '2026-10-05', '2026-10-09', 'Zu');
        TestHelper::createEvent($this->em, $this->calendar, ['name' => 'Training', 'date' => '2026-10-05', 'isDraft' => false]);

        $html = $this->html('agenda', '2026-10-01', '2026-10-31');
        self::assertMatchesRegularExpression('~05\.10\.2026 – 09\.10\.2026</td>\s*<td>ganztägig</td>\s*<td colspan="3"><b>Hinweis:</b> Ferien \(Zu\)~', $html);
        self::assertLessThan(strpos($html, 'Training'), strpos($html, 'Ferien'));
    }

    public function testEnglishLabel(): void
    {
        $this->user->setLanguage('en');
        $this->em->flush();
        $this->notice('Closed', '2026-10-05');

        self::assertStringContainsString('Notice (', $this->html('quarter-overview', '2026-10-01', '2026-12-31'));
    }

    public function testAnnualOverviewHasNoNotices(): void
    {
        $this->notice('Geheim', '2026-10-05');

        self::assertStringNotContainsString('Geheim', $this->html('annual-overview', '2026-01-01', '2026-12-31'));
    }

    public function testDraftsOnlyWithIncludeDrafts(): void
    {
        $this->notice('Entwurfshinweis', '2026-10-05', null, null, true);

        self::assertStringNotContainsString('Entwurfshinweis', $this->html('quarter-overview', '2026-10-01', '2026-12-31'));
        $html = $this->html('quarter-overview', '2026-10-01', '2026-12-31', true);
        self::assertMatchesRegularExpression('~<div class="nt dr">Hinweis \(05\.10\.2026\): Entwurfshinweis</div>~', $html);
    }

    public function testWindowOverlapAndTargetGroupFilter(): void
    {
        $tg = TestHelper::createTargetGroup($this->em, $this->calendar->getClub(), 'Jugend');
        $a = $this->notice('Ueberlappend', '2026-09-28', '2026-10-02');
        $this->notice('Ausserhalb', '2026-12-01');
        $this->notice('Ohne Gruppe', '2026-10-10');
        $this->em->persist((new EventTargetGroup())->setEvent($a)->setTargetGroup($tg));
        $this->em->flush();

        $html = $this->html('agenda', '2026-10-01', '2026-10-31');
        self::assertStringContainsString('Ueberlappend', $html);
        self::assertStringNotContainsString('Ausserhalb', $html);

        $filtered = $this->html('agenda', '2026-10-01', '2026-10-31', false, [$tg->getId()]);
        self::assertStringContainsString('Ueberlappend', $filtered);
        self::assertStringNotContainsString('Ohne Gruppe', $filtered);
    }

    public function testNoticesDoNotCountTowardEventCapAndHaveTheirOwn(): void
    {
        $c = static::getContainer();
        $this->notice('N1', '2026-10-01');
        $this->notice('N2', '2026-10-02');
        $this->notice('N3', '2026-10-03');
        TestHelper::createEvent($this->em, $this->calendar, ['name' => 'E1', 'date' => '2026-10-04', 'isDraft' => false]);

        $make = fn (int $events, int $notices): PdfExportService => new PdfExportService(
            $c->get(EventExportService::class), $c->get(\App\Ics\IcsEventReader::class), $c->get(\App\Pdf\EmojiImages::class),
            $this->em, $c->get(\Twig\Environment::class), $c->get(\App\Pdf\DompdfFactory::class), $events, $notices,
        );

        self::assertStringContainsString('N3', $this->html('agenda', '2026-10-01', '2026-10-31', service: $make(1, 3)));

        try {
            $this->html('agenda', '2026-10-01', '2026-10-31', service: $make(1, 2));
            self::fail('notice cap not enforced');
        } catch (ApiProblemException $e) {
            self::assertSame(422, $e->getStatusCode());
            self::assertSame('too_many_events', $e->getErrorCode());
        }
    }

    public function testEveryLayoutRendersAPdfWithNotices(): void
    {
        $this->notice('Hinweis Ä', '2026-10-05', '2026-10-09', 'Notiz');
        $service = static::getContainer()->get(PdfExportService::class);
        foreach (['month-grid' => ['2026-10-01', '2026-10-31'], 'agenda' => ['2026-10-01', '2026-10-31'], 'quarter-overview' => ['2026-10-01', '2026-12-31'], 'annual-overview' => ['2026-01-01', '2026-12-31']] as $layout => [$from, $to]) {
            $filter = static::getContainer()->get(EventExportService::class)->filter($this->calendar, $from, $to, '0', []);
            $pdf = $service->render($this->calendar, $filter, new PdfOptions(PdfLayout::from($layout)), $this->user);
            self::assertStringStartsWith('%PDF', $pdf, $layout);
        }
    }
}
