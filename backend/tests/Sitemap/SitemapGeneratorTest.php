<?php

declare(strict_types=1);

namespace App\Tests\Sitemap;

use App\Command\SitemapGenerateCommand;
use App\Entity\CalendarFeedTargetGroup;
use App\Entity\EventTargetGroup;
use App\Enum\FeedVisibility;
use App\Sitemap\SitemapGenerator;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;
use League\Flysystem\Filesystem;
use League\Flysystem\FilesystemOperator;
use League\Flysystem\Local\LocalFilesystemAdapter;
use Psr\Clock\ClockInterface;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\Filesystem\Filesystem as SymfonyFilesystem;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

class SitemapGeneratorTest extends KernelTestCase
{
    private EntityManagerInterface $em;
    private FilesystemOperator $storage;
    private string $dir;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir().'/cc-sitemap-'.bin2hex(random_bytes(4));
        putenv('STORAGE_LOCAL_PATH='.$this->dir);
        self::bootKernel();
        $this->em = self::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);
        $this->storage = new Filesystem(new LocalFilesystemAdapter($this->dir));
    }

    protected function tearDown(): void
    {
        putenv('STORAGE_LOCAL_PATH');
        (new SymfonyFilesystem())->remove($this->dir);
        parent::tearDown();
    }

    private function generator(int $months = 12, int $maxUrls = 10000, int $batch = 1000): SitemapGenerator
    {
        $c = self::getContainer();

        return new SitemapGenerator(
            $this->storage,
            $c->get(Connection::class),
            $c->get(ClockInterface::class),
            'https://app.example',
            'https://front.example/',
            $months,
            $maxUrls,
            $batch,
        );
    }

    /** @return array{club: \App\Entity\Club, calendar: \App\Entity\Calendar} */
    private function club(): array
    {
        return TestHelper::createCalendarWithClub($this->em, self::getContainer()->get(UserPasswordHasherInterface::class));
    }

    private function published(\App\Entity\Calendar $calendar, string $when, array $o = []): \App\Entity\Event
    {
        return TestHelper::createEvent($this->em, $calendar, ['date' => $when, 'isDraft' => false] + $o);
    }

    /** @return list<string> */
    private function locs(string $file): array
    {
        $xml = new \SimpleXMLElement($this->storage->read('sitemap/'.$file));
        $xml->registerXPathNamespace('s', 'http://www.sitemaps.org/schemas/sitemap/0.9');

        return array_map('strval', $xml->xpath('//s:loc'));
    }

    public function testListsOnlyPublicFeedsAndPublishedEventsInWindow(): void
    {
        ['club' => $club, 'calendar' => $cal] = $this->club();
        $archived = TestHelper::createCalendar($this->em, $club, 'Old');
        $archived->setArchivedAt(new \DateTimeImmutable());
        $this->em->flush();

        $public = TestHelper::createFeed($this->em, $club, [$cal], FeedVisibility::PUBLIC);
        TestHelper::createFeed($this->em, $club, [$cal], FeedVisibility::CLUB);
        TestHelper::createFeed($this->em, $club, [$cal], FeedVisibility::PRIVATE);
        TestHelper::createFeed($this->em, $club, [$archived], FeedVisibility::PUBLIC);

        $ok = $this->published($cal, '+10 days');
        $overlap = $this->published($cal, '-3 days', ['name' => 'multi']);
        $overlap->setDateEnd(new \DateTimeImmutable('+1 day'));
        $this->em->flush();
        $this->published($cal, '-5 days');
        $this->published($cal, '+13 months');
        $draft = TestHelper::createEvent($this->em, $cal, ['date' => '+5 days', 'isDraft' => true]);
        $other = TestHelper::createCalendar($this->em, $club, 'Not in feed');
        $this->published($other, '+4 days');

        $result = $this->generator()->generate();

        $this->assertSame(['sitemap-1.xml'], $result->files);
        $this->assertSame(1, $result->feedCount);
        $this->assertSame(3, $result->urlCount);
        $locs = $this->locs('sitemap-1.xml');
        sort($locs);
        $expected = [
            'https://front.example/feed/'.$public->getId(),
            'https://front.example/feed/'.$public->getId().'/events/'.$ok->getId(),
            'https://front.example/feed/'.$public->getId().'/events/'.$overlap->getId(),
        ];
        sort($expected);
        $this->assertSame($expected, $locs);
        $this->assertStringNotContainsString($draft->getId(), $this->storage->read('sitemap/sitemap-1.xml'));
        $this->assertSame(['https://app.example/sitemap-1.xml'], $this->locs('sitemap.xml'));
        $this->assertStringContainsString('<sitemapindex', $this->storage->read('sitemap/sitemap.xml'));
        $this->assertMatchesRegularExpression('#<lastmod>\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ</lastmod>#', $this->storage->read('sitemap/sitemap.xml'));
    }

    public function testFeedTargetGroupFilterMatchesWebView(): void
    {
        ['club' => $club, 'calendar' => $cal] = $this->club();
        $group = TestHelper::createTargetGroup($this->em, $club, 'Youth');
        $feed = TestHelper::createFeed($this->em, $club, [$cal]);
        $link = (new CalendarFeedTargetGroup())->setFeed($feed)->setTargetGroup($group);
        $this->em->persist($link);
        $inGroup = $this->published($cal, '+3 days');
        $this->em->persist((new EventTargetGroup())->setEvent($inGroup)->setTargetGroup($group));
        $this->published($cal, '+4 days');
        $this->em->flush();

        $this->generator()->generate();

        $this->assertEqualsCanonicalizing([
            'https://front.example/feed/'.$feed->getId(),
            'https://front.example/feed/'.$feed->getId().'/events/'.$inGroup->getId(),
        ], $this->locs('sitemap-1.xml'));
    }

    public function testHorizonZeroListsFeedPagesOnly(): void
    {
        ['club' => $club, 'calendar' => $cal] = $this->club();
        $feed = TestHelper::createFeed($this->em, $club, [$cal]);
        $this->published($cal, '+3 days');

        $result = $this->generator(0)->generate();

        $this->assertSame(1, $result->urlCount);
        $this->assertSame(['https://front.example/feed/'.$feed->getId()], $this->locs('sitemap-1.xml'));
    }

    public function testNoPublicFeedsGivesValidEmptyUrlset(): void
    {
        ['club' => $club, 'calendar' => $cal] = $this->club();
        TestHelper::createFeed($this->em, $club, [$cal], FeedVisibility::CLUB);

        $result = $this->generator()->generate();

        $this->assertSame(0, $result->urlCount);
        $this->assertSame(['sitemap-1.xml'], $result->files);
        $this->assertSame([], $this->locs('sitemap-1.xml'));
        $this->assertSame(['https://app.example/sitemap-1.xml'], $this->locs('sitemap.xml'));
    }

    public function testChunkingBuildsPartsAndIndexAndDeletesStaleParts(): void
    {
        ['club' => $club, 'calendar' => $cal] = $this->club();
        $feed = TestHelper::createFeed($this->em, $club, [$cal]);
        $ids = [];
        for ($i = 1; $i <= 6; ++$i) {
            $ids[] = $this->published($cal, '+'.$i.' days')->getId();
        }
        $this->storage->write('sitemap/sitemap-9.xml', 'stale');
        $this->storage->write('sitemap/other.txt', 'keep');

        $result = $this->generator(12, 3, 2)->generate();

        $this->assertSame(['sitemap-1.xml', 'sitemap-2.xml', 'sitemap-3.xml'], $result->files);
        $this->assertSame(7, $result->urlCount);
        $all = [];
        foreach ($result->files as $file) {
            $locs = $this->locs($file);
            $this->assertLessThanOrEqual(3, count($locs));
            array_push($all, ...$locs);
        }
        $this->assertCount(7, array_unique($all));
        $this->assertSame('https://front.example/feed/'.$feed->getId(), $all[0]);
        $this->assertSame([
            'https://app.example/sitemap-1.xml',
            'https://app.example/sitemap-2.xml',
            'https://app.example/sitemap-3.xml',
        ], $this->locs('sitemap.xml'));
        $this->assertFalse($this->storage->fileExists('sitemap/sitemap-9.xml'));
        $this->assertTrue($this->storage->fileExists('sitemap/other.txt'));
        $this->assertCount(6, array_filter($all, static fn (string $u): bool => str_contains($u, '/events/')));
    }

    public function testXmlEscaping(): void
    {
        $c = self::getContainer();
        $generator = new SitemapGenerator($this->storage, $c->get(Connection::class), $c->get(ClockInterface::class), 'https://app.example/?a=1&b=2', 'https://front.example', 0);
        $generator->generate();

        $raw = $this->storage->read('sitemap/sitemap.xml');
        $this->assertStringContainsString('&amp;b=2', $raw);
        $this->assertNotFalse(simplexml_load_string($raw));
    }

    public function testInvalidHorizonFails(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->generator(-1);
    }

    public function testCommandPrintsCounts(): void
    {
        ['club' => $club, 'calendar' => $cal] = $this->club();
        TestHelper::createFeed($this->em, $club, [$cal]);

        $t = new CommandTester((new Application(self::$kernel))->find('app:sitemap:generate'));
        $this->assertSame(0, $t->execute([]));
        $this->assertStringContainsString('1 feeds, 1 URLs in 1 file(s)', $t->getDisplay());
        $this->assertFileExists($this->dir.'/sitemap/sitemap.xml');
        $this->assertInstanceOf(SitemapGenerateCommand::class, self::getContainer()->get(SitemapGenerateCommand::class));
    }
}
