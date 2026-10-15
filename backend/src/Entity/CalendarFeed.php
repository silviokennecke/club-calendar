<?php

declare(strict_types=1);

namespace App\Entity;

use App\Enum\FeedVisibility;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
class CalendarFeed
{
    #[ORM\Id]
    #[ORM\Column(length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: Calendar::class, inversedBy: 'feeds')]
    #[ORM\JoinColumn(name: 'calendar_id', nullable: false, onDelete: 'CASCADE')]
    private Calendar $calendar;

    #[ORM\Column(length: 255)]
    private string $name;

    /** New feeds are CLUB ("Nur per Link"): reachable by link, not indexed. */
    #[ORM\Column(enumType: FeedVisibility::class, options: ['default' => 'CLUB'])]
    private FeedVisibility $visibility = FeedVisibility::CLUB;

    /** Opt-in for search engines; only meaningful (and only allowed) for PUBLIC feeds. */
    #[ORM\Column(options: ['default' => false])]
    private bool $searchable = false;

    #[ORM\Column(length: 255, unique: true)]
    private string $sharedSecret;

    #[ORM\OneToMany(targetEntity: CalendarFeedTargetGroup::class, mappedBy: 'feed', cascade: ['persist', 'remove'], orphanRemoval: true)]
    private Collection $targetGroups;

    public function __construct()
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->targetGroups = new ArrayCollection();
    }

    public function getId(): string
    {
        return $this->id;
    }

    public function getCalendar(): Calendar
    {
        return $this->calendar;
    }

    public function setCalendar(Calendar $calendar): static
    {
        $this->calendar = $calendar;

        return $this;
    }

    public function getName(): string
    {
        return $this->name;
    }

    public function setName(string $name): static
    {
        $this->name = $name;

        return $this;
    }

    public function getVisibility(): FeedVisibility
    {
        return $this->visibility;
    }

    public function setVisibility(FeedVisibility $visibility): static
    {
        $this->visibility = $visibility;

        return $this;
    }

    public function isSearchable(): bool
    {
        return $this->searchable;
    }

    public function setSearchable(bool $searchable): static
    {
        $this->searchable = $searchable;

        return $this;
    }

    /** Search engines may index the feed only if it is PUBLIC and opted in; everything else is noindex. */
    public function isIndexable(): bool
    {
        return FeedVisibility::PUBLIC === $this->visibility && $this->searchable;
    }

    public function getSharedSecret(): string
    {
        return $this->sharedSecret;
    }

    public function setSharedSecret(string $sharedSecret): static
    {
        $this->sharedSecret = $sharedSecret;

        return $this;
    }

    /**
     * @return Collection<int, CalendarFeedTargetGroup>
     */
    public function getTargetGroups(): Collection
    {
        return $this->targetGroups;
    }
}
