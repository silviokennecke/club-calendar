<?php

declare(strict_types=1);

namespace App\Entity;

use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
class MemberSubscriptionFeed
{
    #[ORM\Id]
    #[ORM\ManyToOne(targetEntity: MemberSubscription::class, inversedBy: 'feeds')]
    #[ORM\JoinColumn(name: 'subscription_id', onDelete: 'CASCADE')]
    private MemberSubscription $subscription;

    #[ORM\Id]
    #[ORM\ManyToOne(targetEntity: CalendarFeed::class)]
    #[ORM\JoinColumn(name: 'feed_id', onDelete: 'CASCADE')]
    private CalendarFeed $feed;

    public function __construct(MemberSubscription $subscription, CalendarFeed $feed)
    {
        $this->subscription = $subscription;
        $this->feed = $feed;
    }

    public function getSubscription(): MemberSubscription
    {
        return $this->subscription;
    }

    public function getFeed(): CalendarFeed
    {
        return $this->feed;
    }
}
