<?php

declare(strict_types=1);

namespace App\Entity;

use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

/**
 * The personal subscription ("Mein Abo") of a club member: one per (user, club), a selection of feeds and target
 * groups behind a personal secret address. The secret is stored in clear like a feed's `sharedSecret` (the app
 * shows the address) and must always be compared with hash_equals. Empty target group selection = all groups.
 */
#[ORM\Entity]
#[ORM\UniqueConstraint(name: 'uq_member_subscription_club_user', columns: ['club_id', 'user_id'])]
#[ORM\Index(name: 'idx_member_subscription_user', columns: ['user_id'])]
class MemberSubscription implements UpdateAudited
{
    use Trait\HasUpdateAudit;

    #[ORM\Id]
    #[ORM\Column(length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: Club::class)]
    #[ORM\JoinColumn(name: 'club_id', nullable: false, onDelete: 'CASCADE')]
    private Club $club;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(name: 'user_id', nullable: false, onDelete: 'CASCADE')]
    private User $user;

    #[ORM\Column(length: 64)]
    private string $secret;

    #[ORM\Column]
    private \DateTimeImmutable $createdAt;

    /** @var Collection<int, MemberSubscriptionFeed> */
    #[ORM\OneToMany(targetEntity: MemberSubscriptionFeed::class, mappedBy: 'subscription', cascade: ['persist', 'remove'], orphanRemoval: true)]
    private Collection $feeds;

    /** @var Collection<int, MemberSubscriptionTargetGroup> */
    #[ORM\OneToMany(targetEntity: MemberSubscriptionTargetGroup::class, mappedBy: 'subscription', cascade: ['persist', 'remove'], orphanRemoval: true)]
    private Collection $targetGroups;

    public function __construct(Club $club, User $user)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->club = $club;
        $this->user = $user;
        $this->secret = self::newSecret();
        $this->createdAt = new \DateTimeImmutable();
        $this->feeds = new ArrayCollection();
        $this->targetGroups = new ArrayCollection();
    }

    public static function newSecret(): string
    {
        return bin2hex(random_bytes(32));
    }

    public function getId(): string
    {
        return $this->id;
    }

    public function getClub(): Club
    {
        return $this->club;
    }

    public function getUser(): User
    {
        return $this->user;
    }

    public function getSecret(): string
    {
        return $this->secret;
    }

    public function rotateSecret(): static
    {
        $this->secret = self::newSecret();

        return $this;
    }

    public function getCreatedAt(): \DateTimeImmutable
    {
        return $this->createdAt;
    }

    /** @return Collection<int, MemberSubscriptionFeed> */
    public function getFeeds(): Collection
    {
        return $this->feeds;
    }

    /** @return Collection<int, MemberSubscriptionTargetGroup> */
    public function getTargetGroups(): Collection
    {
        return $this->targetGroups;
    }
}
