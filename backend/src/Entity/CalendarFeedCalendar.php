<?php

declare(strict_types=1);

namespace App\Entity;

use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
class CalendarFeedCalendar
{
    #[ORM\Id]
    #[ORM\ManyToOne(targetEntity: CalendarFeed::class, inversedBy: 'calendars')]
    #[ORM\JoinColumn(name: 'feed_id', onDelete: 'CASCADE')]
    private CalendarFeed $feed;

    #[ORM\Id]
    #[ORM\ManyToOne(targetEntity: Calendar::class)]
    #[ORM\JoinColumn(name: 'calendar_id', onDelete: 'CASCADE')]
    private Calendar $calendar;

    public function getFeed(): CalendarFeed
    {
        return $this->feed;
    }

    public function setFeed(CalendarFeed $feed): static
    {
        $this->feed = $feed;

        return $this;
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
}
