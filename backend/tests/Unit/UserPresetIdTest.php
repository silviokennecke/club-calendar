<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\Entity\User;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Uid\Uuid;

class UserPresetIdTest extends TestCase
{
    public function testAcceptsACanonicalUuidV7(): void
    {
        $id = Uuid::v7()->toRfc4122();
        $this->assertSame($id, User::withPresetId($id)->getId());
    }

    #[DataProvider('invalidIds')]
    public function testRejectsEverythingElse(string $id): void
    {
        $this->expectException(\InvalidArgumentException::class);
        User::withPresetId($id);
    }

    /** @return iterable<string, array{string}> */
    public static function invalidIds(): iterable
    {
        yield 'empty' => [''];
        yield 'garbage' => ['not-a-uuid'];
        yield 'v4' => [Uuid::v4()->toRfc4122()];
        yield 'uppercase' => [strtoupper(Uuid::v7()->toRfc4122())];
        yield 'base32' => [Uuid::v7()->toBase32()];
    }
}
