<?php

declare(strict_types=1);

namespace App\Tests\Service;

use App\Entity\Calendar;
use App\Exception\ApiProblemException;
use App\Service\EventExportService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

class EventExportQueryTest extends KernelTestCase
{
    private EventExportService $service;
    private Calendar $calendar;
    private string $groupId;

    protected function setUp(): void
    {
        self::bootKernel();
        $c = static::getContainer();
        $em = $c->get(EntityManagerInterface::class);
        DatabaseResetter::reset($em);
        $user = TestHelper::createUser($em, $c->get(UserPasswordHasherInterface::class));
        $club = TestHelper::createClub($em, $user);
        $this->calendar = TestHelper::createCalendar($em, $club);
        $this->groupId = TestHelper::createTargetGroup($em, $club)->getId();
        $this->service = $c->get(EventExportService::class);
    }

    private function dql(mixed $from = null, mixed $to = null, mixed $drafts = null, mixed $groups = null): string
    {
        $filter = $this->service->filter($this->calendar, $from, $to, $drafts, $groups);

        return $this->service->buildQuery($this->calendar, $filter)->getDQL();
    }

    public function testNoFilterPublishedOnly(): void
    {
        self::assertSame(
            'SELECT e FROM App\Entity\Event e WHERE e.calendar = :calendar AND e.isDraft = false',
            $this->dql(),
        );
    }

    public function testRange(): void
    {
        self::assertSame(
            'SELECT e FROM App\Entity\Event e WHERE e.calendar = :calendar AND e.isDraft = false AND COALESCE(e.dateEnd, e.date) >= :from AND e.date <= :to',
            $this->dql('2026-01-01', '2026-03-31'),
        );
    }

    public function testDrafts(): void
    {
        self::assertSame('SELECT e FROM App\Entity\Event e WHERE e.calendar = :calendar', $this->dql(null, null, 'true'));
        self::assertSame($this->dql(), $this->dql(null, null, '0'));
    }

    public function testTargetGroups(): void
    {
        $dql = $this->dql(null, null, null, [$this->groupId]);
        self::assertStringContainsString('EXISTS (SELECT etg FROM App\Entity\EventTargetGroup etg WHERE etg.event = e AND etg.targetGroup IN (:tgIds))', $dql);

        $filter = $this->service->filter($this->calendar, null, null, null, $this->groupId);
        self::assertSame([$this->groupId], $filter->groupIds);
    }

    public function testInvalidInputIs400(): void
    {
        foreach ([
            ['from' => 'nope'],
            ['from' => '2026-02-01', 'to' => '2026-01-01'],
            ['includeDrafts' => 'maybe'],
            ['targetGroupIds' => 5],
        ] as $args) {
            try {
                $this->service->filter($this->calendar, $args['from'] ?? null, $args['to'] ?? null, $args['includeDrafts'] ?? null, $args['targetGroupIds'] ?? null);
                self::fail('Expected 400');
            } catch (ApiProblemException $e) {
                self::assertSame(400, $e->getStatusCode());
            }
        }
    }

    public function testUnknownTargetGroupIs422(): void
    {
        try {
            $this->service->filter($this->calendar, null, null, null, ['00000000-0000-7000-8000-000000000000']);
            self::fail('Expected 422');
        } catch (ApiProblemException $e) {
            self::assertSame(422, $e->getStatusCode());
        }
    }

    public function testTooManyTargetGroupsIs400(): void
    {
        $ids = array_map(fn ($i) => sprintf('00000000-0000-7000-8000-%012d', $i), range(1, EventExportService::MAX_TARGET_GROUPS + 1));
        try {
            $this->service->filter($this->calendar, null, null, null, $ids);
            self::fail('Expected 400');
        } catch (ApiProblemException $e) {
            self::assertSame(400, $e->getStatusCode());
        }
    }
}
