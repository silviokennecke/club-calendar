<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Calendar;
use App\Entity\EventTemplate;
use App\Entity\EventTemplateFeature;
use App\Entity\EventTemplateProperty;
use App\Entity\EventTemplateTargetGroup;
use App\Entity\Feature;
use App\Entity\Location;
use App\Entity\Property;
use App\Entity\TargetGroup;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

readonly class EventTemplateService
{
    public function __construct(private EntityManagerInterface $em)
    {
    }

    public function listTemplates(Calendar $calendar): array
    {
        $templates = $this->em->getRepository(EventTemplate::class)->findBy(['calendar' => $calendar]);

        return array_map(fn (EventTemplate $t) => $this->serialize($t), $templates);
    }

    public function createTemplate(Calendar $calendar, array $data): array
    {
        $template = new EventTemplate();
        $template->setCalendar($calendar);
        $template->setName($data['name']);
        $template->setTimezone($data['timezone']);
        $template->setTimeBegin($data['timeBegin']);
        $template->setTimeEnd($data['timeEnd']);

        if (!empty($data['locationId'])) {
            $loc = $this->em->getRepository(Location::class)->find($data['locationId']);
            if ($loc && $loc->getCalendar()->getId() === $calendar->getId()) {
                $template->setLocation($loc);
            }
        }

        $this->em->persist($template);
        $this->syncRelations($template, $data, $calendar);
        $this->em->flush();

        return $this->serialize($template);
    }

    public function getTemplate(string $id, Calendar $calendar): array
    {
        $template = $this->findTemplate($id, $calendar);

        return $this->serialize($template);
    }

    public function updateTemplate(string $id, Calendar $calendar, array $data): array
    {
        $template = $this->findTemplate($id, $calendar);

        if (array_key_exists('name', $data)) {
            $template->setName($data['name']);
        }
        if (array_key_exists('timezone', $data)) {
            $template->setTimezone($data['timezone']);
        }
        if (array_key_exists('timeBegin', $data)) {
            $template->setTimeBegin($data['timeBegin']);
        }
        if (array_key_exists('timeEnd', $data)) {
            $template->setTimeEnd($data['timeEnd']);
        }
        if (array_key_exists('locationId', $data)) {
            if ($data['locationId']) {
                $loc = $this->em->getRepository(Location::class)->find($data['locationId']);
                $template->setLocation(($loc && $loc->getCalendar()->getId() === $calendar->getId()) ? $loc : null);
            } else {
                $template->setLocation(null);
            }
        }

        if (array_key_exists('propertyIds', $data)) {
            foreach ($template->getProperties() as $ep) {
                $this->em->remove($ep);
            }
            $template->getProperties()->clear();
            foreach ($data['propertyIds'] as $pid) {
                $prop = $this->em->getRepository(Property::class)->find($pid);
                if ($prop && $prop->getCalendar()->getId() === $calendar->getId()) {
                    $etp = new EventTemplateProperty();
                    $etp->setTemplate($template);
                    $etp->setProperty($prop);
                    $this->em->persist($etp);
                }
            }
        }
        if (array_key_exists('featureIds', $data)) {
            foreach ($template->getFeatures() as $ef) {
                $this->em->remove($ef);
            }
            $template->getFeatures()->clear();
            foreach ($data['featureIds'] as $fid) {
                $feat = $this->em->getRepository(Feature::class)->find($fid);
                if ($feat && $feat->getCalendar()->getId() === $calendar->getId()) {
                    $etf = new EventTemplateFeature();
                    $etf->setTemplate($template);
                    $etf->setFeature($feat);
                    $this->em->persist($etf);
                }
            }
        }
        if (array_key_exists('targetGroupIds', $data)) {
            foreach ($template->getTargetGroups() as $etg) {
                $this->em->remove($etg);
            }
            $template->getTargetGroups()->clear();
            foreach ($data['targetGroupIds'] as $tgid) {
                $tg = $this->em->getRepository(TargetGroup::class)->find($tgid);
                if ($tg && $tg->getCalendar()->getId() === $calendar->getId()) {
                    $ettg = new EventTemplateTargetGroup();
                    $ettg->setTemplate($template);
                    $ettg->setTargetGroup($tg);
                    $this->em->persist($ettg);
                }
            }
        }

        $this->em->flush();

        return $this->serialize($template);
    }

    public function deleteTemplate(string $id, Calendar $calendar): void
    {
        $template = $this->findTemplate($id, $calendar);
        $this->em->remove($template);
        $this->em->flush();
    }

    private function findTemplate(string $id, Calendar $calendar): EventTemplate
    {
        $template = $this->em->getRepository(EventTemplate::class)->find($id);
        if (!$template || $template->getCalendar()->getId() !== $calendar->getId()) {
            throw new NotFoundHttpException('Event template not found');
        }

        return $template;
    }

    private function syncRelations(EventTemplate $template, array $data, Calendar $calendar): void
    {
        foreach ($data['propertyIds'] ?? [] as $pid) {
            $prop = $this->em->getRepository(Property::class)->find($pid);
            if ($prop && $prop->getCalendar()->getId() === $calendar->getId()) {
                $etp = new EventTemplateProperty();
                $etp->setTemplate($template);
                $etp->setProperty($prop);
                $this->em->persist($etp);
            }
        }
        foreach ($data['featureIds'] ?? [] as $fid) {
            $feat = $this->em->getRepository(Feature::class)->find($fid);
            if ($feat && $feat->getCalendar()->getId() === $calendar->getId()) {
                $etf = new EventTemplateFeature();
                $etf->setTemplate($template);
                $etf->setFeature($feat);
                $this->em->persist($etf);
            }
        }
        foreach ($data['targetGroupIds'] ?? [] as $tgid) {
            $tg = $this->em->getRepository(TargetGroup::class)->find($tgid);
            if ($tg && $tg->getCalendar()->getId() === $calendar->getId()) {
                $ettg = new EventTemplateTargetGroup();
                $ettg->setTemplate($template);
                $ettg->setTargetGroup($tg);
                $this->em->persist($ettg);
            }
        }
    }

    public function serialize(EventTemplate $template): array
    {
        return [
            'id' => $template->getId(),
            'calendarId' => $template->getCalendar()->getId(),
            'locationId' => $template->getLocation()?->getId(),
            'name' => $template->getName(),
            'timezone' => $template->getTimezone(),
            'timeBegin' => $template->getTimeBegin(),
            'timeEnd' => $template->getTimeEnd(),
            'location' => $template->getLocation() ? [
                'id' => $template->getLocation()->getId(),
                'name' => $template->getLocation()->getName(),
                'street' => $template->getLocation()->getStreet(),
                'zip' => $template->getLocation()->getZip(),
                'city' => $template->getLocation()->getCity(),
                'country' => $template->getLocation()->getCountry(),
                'latitude' => $template->getLocation()->getLatitude(),
                'longitude' => $template->getLocation()->getLongitude(),
            ] : null,
            'properties' => $template->getProperties()->map(fn ($etp) => [
                'propertyId' => $etp->getProperty()->getId(),
                'property' => [
                    'id' => $etp->getProperty()->getId(),
                    'name' => $etp->getProperty()->getName(),
                    'icon' => $etp->getProperty()->getIcon(),
                ],
            ])->toArray(),
            'features' => $template->getFeatures()->map(fn ($etf) => [
                'featureId' => $etf->getFeature()->getId(),
                'feature' => [
                    'id' => $etf->getFeature()->getId(),
                    'name' => $etf->getFeature()->getName(),
                ],
            ])->toArray(),
            'targetGroups' => $template->getTargetGroups()->map(fn ($ettg) => [
                'targetGroupId' => $ettg->getTargetGroup()->getId(),
                'targetGroup' => [
                    'id' => $ettg->getTargetGroup()->getId(),
                    'name' => $ettg->getTargetGroup()->getName(),
                ],
            ])->toArray(),
        ];
    }
}
