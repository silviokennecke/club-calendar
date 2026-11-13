<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Messenger\Transport\InMemory\InMemoryTransport;

class MessengerTransportsTest extends KernelTestCase
{
    public function testAsyncAndFailedTransportsExistAndAreInMemoryInTests(): void
    {
        self::bootKernel();
        $c = self::getContainer();

        $this->assertInstanceOf(InMemoryTransport::class, $c->get('messenger.transport.async'));
        $this->assertInstanceOf(InMemoryTransport::class, $c->get('messenger.transport.failed'));
    }
}
