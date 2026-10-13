<?php

declare(strict_types=1);

namespace App\Entity;

use App\Service\SeriesRule;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

/**
 * A series of events created from one rule (design: EventSeries). The events are ordinary rows of
 * `event` with `series_id`; the rule is kept for display ("Teil einer Terminreihe") and is not
 * re-evaluated later. A series without events is removed (EventService).
 */
#[ORM\Entity]
#[ORM\Table(name: 'event_series')]
class EventSeries
{
    #[ORM\Id]
    #[ORM\Column(length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: Calendar::class)]
    #[ORM\JoinColumn(name: 'calendar_id', nullable: false, onDelete: 'CASCADE')]
    private Calendar $calendar;

    #[ORM\ManyToOne(targetEntity: EventTemplate::class)]
    #[ORM\JoinColumn(name: 'template_id', nullable: true, onDelete: 'SET NULL')]
    private ?EventTemplate $template = null;

    /** weekly | biweekly | monthly (SeriesRule::FREQUENCIES) */
    #[ORM\Column(length: 16)]
    private string $frequency;

    /** 0 = Sunday … 6 = Saturday */
    #[ORM\Column(type: 'smallint')]
    private int $weekday;

    /** monthly only: 1–4, 5 = last */
    #[ORM\Column(type: 'smallint', nullable: true)]
    private ?int $nth = null;

    #[ORM\Column(type: 'date_immutable')]
    private \DateTimeImmutable $startDate;

    /** End by date (inclusive) … */
    #[ORM\Column(type: 'date_immutable', nullable: true)]
    private ?\DateTimeImmutable $untilDate = null;

    /** … or by number of created events (exactly one of both is set). */
    #[ORM\Column(type: 'integer', nullable: true)]
    private ?int $occurrences = null;

    #[ORM\Column]
    private bool $skipHolidays = false;

    /** Extra days of each event (0 = one-day event, 1 = until the next day, …). */
    #[ORM\Column(type: 'smallint')]
    private int $durationDays = 0;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $createdAt;

    public function __construct(Calendar $calendar, SeriesRule $rule, ?EventTemplate $template = null)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->calendar = $calendar;
        $this->template = $template;
        $this->frequency = $rule->frequency;
        $this->weekday = $rule->weekday;
        $this->nth = $rule->nth;
        $this->startDate = $rule->startDate;
        $this->untilDate = $rule->until;
        $this->occurrences = $rule->count;
        $this->skipHolidays = $rule->skipHolidays;
        $this->durationDays = $rule->durationDays;
        $this->createdAt = new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
    }

    public function getId(): string
    {
        return $this->id;
    }

    public function getCalendar(): Calendar
    {
        return $this->calendar;
    }

    public function getTemplate(): ?EventTemplate
    {
        return $this->template;
    }

    public function getRule(): SeriesRule
    {
        return new SeriesRule(
            $this->frequency,
            $this->weekday,
            $this->nth,
            $this->startDate,
            $this->untilDate,
            $this->occurrences,
            $this->skipHolidays,
            $this->durationDays,
        );
    }

    public function getCreatedAt(): \DateTimeImmutable
    {
        return $this->createdAt;
    }
}
