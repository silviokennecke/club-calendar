<?php

declare(strict_types=1);

namespace App\Entity;

use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
class CalendarFeedTargetGroup
{
    #[ORM\Id]
    #[ORM\ManyToOne(targetEntity: CalendarFeed::class, inversedBy: 'targetGroups')]
    #[ORM\JoinColumn(name: 'feed_id', onDelete: 'CASCADE')]
    private CalendarFeed $feed;

    #[ORM\Id]
    #[ORM\ManyToOne(targetEntity: TargetGroup::class, inversedBy: 'feeds')]
    #[ORM\JoinColumn(name: 'target_group_id', onDelete: 'CASCADE')]
    private TargetGroup $targetGroup;

    public function getFeed(): CalendarFeed
    {
        return $this->feed;
    }

    public function setFeed(CalendarFeed $feed): static
    {
        $this->feed = $feed;

        return $this;
    }

    public function getTargetGroup(): TargetGroup
    {
        return $this->targetGroup;
    }

    public function setTargetGroup(TargetGroup $targetGroup): static
    {
        $this->targetGroup = $targetGroup;

        return $this;
    }
}
