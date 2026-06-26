<?php
declare(strict_types=1);

namespace App\Entity;

use App\Repository\HolidayCalendarRepository;
use DateTimeImmutable;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity(repositoryClass: HolidayCalendarRepository::class)]
class HolidayCalendar
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column(type: 'integer')]
    private ?int $id = null;

    #[ORM\ManyToOne(targetEntity: Calendar::class)]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private Calendar $calendar;

    #[ORM\Column(type: 'string', length: 255)]
    private string $name;

    #[ORM\Column(type: 'string', length: 2048)]
    private string $url;

    #[ORM\Column(type: 'datetime_immutable', nullable: true)]
    private ?DateTimeImmutable $lastFetchedAt = null;

    /** @var Collection<int, HolidayEvent> */
    #[ORM\OneToMany(targetEntity: HolidayEvent::class, mappedBy: 'holidayCalendar', cascade: ['remove'])]
    private Collection $events;

    public function __construct(Calendar $calendar, string $name, string $url)
    {
        $this->calendar = $calendar;
        $this->name     = $name;
        $this->url      = $url;
        $this->events   = new ArrayCollection();
    }

    public function getId(): ?int { return $this->id; }
    public function getCalendar(): Calendar { return $this->calendar; }
    public function getName(): string { return $this->name; }
    public function setName(string $name): void { $this->name = $name; }
    public function getUrl(): string { return $this->url; }
    public function setUrl(string $url): void { $this->url = $url; }
    public function getLastFetchedAt(): ?DateTimeImmutable { return $this->lastFetchedAt; }
    public function setLastFetchedAt(?DateTimeImmutable $dt): void { $this->lastFetchedAt = $dt; }
    /** @return Collection<int, HolidayEvent> */
    public function getEvents(): Collection { return $this->events; }
}
