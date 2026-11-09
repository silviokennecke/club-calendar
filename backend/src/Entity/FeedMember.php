<?php

declare(strict_types=1);

namespace App\Entity;

use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

/**
 * A user's access to a PRIVATE feed: handed out by staff (`assigned`) or gained by opening the feed with its
 * secret (`claimed`). Staff need no row. Not audited itself; adding or removing a row stamps the feed
 * (UpdateAuditListener).
 */
#[ORM\Entity]
#[ORM\UniqueConstraint(name: 'uq_feed_member_feed_user', columns: ['feed_id', 'user_id'])]
#[ORM\Index(name: 'idx_feed_member_user', columns: ['user_id'])]
class FeedMember
{
    public const string ASSIGNED = 'assigned';
    public const string CLAIMED = 'claimed';

    #[ORM\Id]
    #[ORM\Column(length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: CalendarFeed::class)]
    #[ORM\JoinColumn(name: 'feed_id', nullable: false, onDelete: 'CASCADE')]
    private CalendarFeed $feed;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(name: 'user_id', nullable: false, onDelete: 'CASCADE')]
    private User $user;

    #[ORM\Column(length: 10)]
    private string $source;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(name: 'created_by_id', nullable: true, onDelete: 'SET NULL')]
    private ?User $createdBy;

    #[ORM\Column]
    private \DateTimeImmutable $createdAt;

    public function __construct(CalendarFeed $feed, User $user, string $source, ?User $createdBy)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->feed = $feed;
        $this->user = $user;
        $this->source = $source;
        $this->createdBy = $createdBy;
        $this->createdAt = new \DateTimeImmutable();
    }

    public function getId(): string
    {
        return $this->id;
    }

    public function getFeed(): CalendarFeed
    {
        return $this->feed;
    }

    public function getUser(): User
    {
        return $this->user;
    }

    public function getSource(): string
    {
        return $this->source;
    }

    public function setSource(string $source): static
    {
        $this->source = $source;

        return $this;
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
