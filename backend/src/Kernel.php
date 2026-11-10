<?php

declare(strict_types=1);

namespace App;

use App\DependencyInjection\CachePoolAwarePass;
use App\Doctrine\Type\EncryptedSecretType;
use App\Security\Secret\SecretCipher;
use Symfony\Bundle\FrameworkBundle\Kernel\MicroKernelTrait;
use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\HttpKernel\Kernel as BaseKernel;

class Kernel extends BaseKernel
{
    use MicroKernelTrait;

    public function boot(): void
    {
        parent::boot();
        // DBAL types are static singletons: hand them a lazy way to reach the (public) cipher service
        EncryptedSecretType::useCipherProvider(fn (): SecretCipher => $this->getContainer()->get(SecretCipher::class));
    }

    protected function build(ContainerBuilder $container): void
    {
        $container->addCompilerPass(new CachePoolAwarePass());
    }

    /**
     * @return list<string> An array of allowed values for APP_ENV
     */
    private function getAllowedEnvs(): array
    {
        return ['prod', 'dev', 'test'];
    }
}
