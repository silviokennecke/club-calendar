<?php

declare(strict_types=1);

namespace App\Tests\Command;

use App\Entity\User;
use App\Export\UserDataExportService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** app:user:export */
class UserExportCommandTest extends WebTestCase
{
    private KernelBrowser $client;
    private EntityManagerInterface $em;
    private User $user;
    private string $dir;

    protected function setUp(): void
    {
        $this->client = static::createClient();
        $this->em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);
        $this->user = TestHelper::createUser($this->em, static::getContainer()->get(UserPasswordHasherInterface::class), 'export@example.com');
        $this->dir = sys_get_temp_dir().'/cc-export-'.bin2hex(random_bytes(4));
        mkdir($this->dir);
    }

    protected function tearDown(): void
    {
        foreach (glob($this->dir.'/{,.}*', GLOB_BRACE) ?: [] as $f) {
            is_file($f) && unlink($f);
        }
        @rmdir($this->dir);
        parent::tearDown();
    }

    /** @param array<string, mixed> $input */
    private function exportCmd(array $input): CommandTester
    {
        $t = new CommandTester((new Application($this->client->getKernel()))->find('app:user:export'));
        $t->execute($input, ['capture_stderr_separately' => true]);

        return $t;
    }

    public function testStdoutByEmailIsPureJson(): void
    {
        $t = $this->exportCmd(['user' => 'EXPORT@example.com']);
        $this->assertSame(Command::SUCCESS, $t->getStatusCode());
        $data = json_decode($t->getDisplay(), true, flags: JSON_THROW_ON_ERROR);
        $this->assertSame($this->user->getId(), $data['meta']['userId']);
        $this->assertStringContainsString('personal data', $t->getErrorOutput());
    }

    public function testFileByIdHasMode0600AndRecordsCliEvent(): void
    {
        $file = $this->dir.'/out.json';
        $t = $this->exportCmd(['user' => $this->user->getId(), '--output' => $file]);
        $this->assertSame(Command::SUCCESS, $t->getStatusCode());
        $this->assertSame('', $t->getDisplay());
        $this->assertSame(0600, fileperms($file) & 0777);
        $data = json_decode((string) file_get_contents($file), true, flags: JSON_THROW_ON_ERROR);
        $this->assertSame($this->user->getId(), $data['meta']['userId']);
        $this->assertSame([], glob($this->dir.'/.export-*'));

        $c = static::getContainer()->get(Connection::class);
        $this->assertSame(['cli'], $c->fetchFirstColumn("SELECT method FROM security_event WHERE user_id = ? AND type = 'data_export' AND success = 1", [$this->user->getId()]));
    }

    public function testRefusesOverwriteUnlessForce(): void
    {
        $file = $this->dir.'/out.json';
        file_put_contents($file, 'old');
        $t = $this->exportCmd(['user' => 'export@example.com', '--output' => $file]);
        $this->assertSame(Command::FAILURE, $t->getStatusCode());
        $this->assertSame('old', file_get_contents($file));

        $t = $this->exportCmd(['user' => 'export@example.com', '--output' => $file, '--force' => true]);
        $this->assertSame(Command::SUCCESS, $t->getStatusCode());
        $this->assertNotSame('old', file_get_contents($file));
    }

    public function testUnknownUserFails(): void
    {
        $t = $this->exportCmd(['user' => 'nobody@example.com']);
        $this->assertSame(Command::FAILURE, $t->getStatusCode());
        $this->assertSame('', $t->getDisplay());
    }

    public function testFailureLeavesNoFileAndNoEvent(): void
    {
        $service = $this->createStub(UserDataExportService::class);
        $service->method('chunks')->willReturnCallback(function (): \Generator {
            yield '{"a":';
            throw new \RuntimeException('boom');
        });
        static::getContainer()->set(UserDataExportService::class, $service);

        $file = $this->dir.'/out.json';
        $t = $this->exportCmd(['user' => 'export@example.com', '--output' => $file]);
        $this->assertSame(Command::FAILURE, $t->getStatusCode());
        $this->assertFileDoesNotExist($file);
        $this->assertSame([], glob($this->dir.'/.export-*'));
        $c = static::getContainer()->get(Connection::class);
        $this->assertSame(0, (int) $c->fetchOne("SELECT COUNT(*) FROM security_event WHERE type = 'data_export'"));
    }
}
