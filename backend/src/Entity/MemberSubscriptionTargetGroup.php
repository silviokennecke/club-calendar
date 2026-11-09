<?php

declare(strict_types=1);

namespace App\Entity;

use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
class MemberSubscriptionTargetGroup
{
    #[ORM\Id]
    #[ORM\ManyToOne(targetEntity: MemberSubscription::class, inversedBy: 'targetGroups')]
    #[ORM\JoinColumn(name: 'subscription_id', onDelete: 'CASCADE')]
    private MemberSubscription $subscription;

    #[ORM\Id]
    #[ORM\ManyToOne(targetEntity: TargetGroup::class)]
    #[ORM\JoinColumn(name: 'target_group_id', onDelete: 'CASCADE')]
    private TargetGroup $targetGroup;

    public function __construct(MemberSubscription $subscription, TargetGroup $targetGroup)
    {
        $this->subscription = $subscription;
        $this->targetGroup = $targetGroup;
    }

    public function getSubscription(): MemberSubscription
    {
        return $this->subscription;
    }

    public function getTargetGroup(): TargetGroup
    {
        return $this->targetGroup;
    }
}
