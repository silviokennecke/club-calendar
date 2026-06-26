<?php
declare(strict_types=1);

namespace App\Entity;

use App\Repository\HolidayEventRepository;
use DateTimeImmutable;
use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity(repositoryClass: HolidayEventRepository::class)]
class HolidayEvent
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column(type: 'integer')]
    private ?int $id = null;

    #[ORM\ManyToOne(targetEntity: HolidayCalendar::class, inversedBy: 'events')]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private HolidayCalendar $holidayCalendar;

    #[ORM\Column(type: 'string', length: 500)]
    private string $uid;

    #[ORM\Column(type: 'string', length: 255)]
    private string $name;

    #[ORM\Column(type: 'date_immutable')]
    private DateTimeImmutable $date;

    #[ORM\Column(type: 'date_immutable', nullable: true)]
    private ?DateTimeImmutable $dateEnd = null;

    public function __construct(
        HolidayCalendar $holidayCalendar,
        string $uid,
        string $name,
        DateTimeImmutable $date,
        ?DateTimeImmutable $dateEnd = null,
    ) {
        $this->holidayCalendar = $holidayCalendar;
        $this->uid             = $uid;
        $this->name            = $name;
        $this->date            = $date;
        $this->dateEnd         = $dateEnd;
    }

    public function getId(): ?int { return $this->id; }
    public function getHolidayCalendar(): HolidayCalendar { return $this->holidayCalendar; }
    public function getUid(): string { return $this->uid; }
    public function getName(): string { return $this->name; }
    public function setName(string $name): void { $this->name = $name; }
    public function getDate(): DateTimeImmutable { return $this->date; }
    public function setDate(DateTimeImmutable $date): void { $this->date = $date; }
    public function getDateEnd(): ?DateTimeImmutable { return $this->dateEnd; }
    public function setDateEnd(?DateTimeImmutable $dateEnd): void { $this->dateEnd = $dateEnd; }
}
