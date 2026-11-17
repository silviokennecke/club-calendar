<?php

declare(strict_types=1);

namespace App\Entity;

use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

/**
 * Per-calendar permission for a club member whose club role is below editor (typically a plain `member`): read and
 * edit events, series, templates, badges and extras of this calendar. Club membership stays required.
 */
#[ORM\Entity]
#[ORM\UniqueConstraint(name: 'uq_calendar_member_calendar_user', columns: ['calendar_id', 'user_id'])]
#[ORM\Index(name: 'idx_calendar_member_user', columns: ['user_id'])]
class CalendarMember implements UpdateAudited
{
    use Trait\HasUpdateAudit;

    #[ORM\Id]
    #[ORM\Column(length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: Calendar::class)]
    #[ORM\JoinColumn(name: 'calendar_id', nullable: false, onDelete: 'CASCADE')]
    private Calendar $calendar;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(name: 'user_id', nullable: false, onDelete: 'CASCADE')]
    private User $user;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(name: 'created_by_id', nullable: true, onDelete: 'SET NULL')]
    private ?User $createdBy;

    #[ORM\Column]
    private \DateTimeImmutable $createdAt;

    public function __construct(Calendar $calendar, User $user, ?User $createdBy)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->calendar = $calendar;
        $this->user = $user;
        $this->createdBy = $createdBy;
        $this->createdAt = new \DateTimeImmutable();
    }

    public function getId(): string
    {
        return $this->id;
    }

    public function getCalendar(): Calendar
    {
        return $this->calendar;
    }

    public function getUser(): User
    {
        return $this->user;
    }

    public function getCreatedBy(): ?User
    {
        return $this->createdBy;
    }

    public function getCreatedAt(): \DateTimeImmutable
    {
        return $this->createdAt;
    }
}
