<?php
declare(strict_types=1);

namespace App\DependencyInjection;

use Symfony\Component\DependencyInjection\Compiler\CompilerPassInterface;
use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\DependencyInjection\Reference;

class CachePoolAwarePass implements CompilerPassInterface
{
    public function process(ContainerBuilder $container): void
    {
        foreach ($container->getDefinitions() as $definition) {
            $class = $definition->getClass();
            if (!$class || !str_starts_with($class, 'App\\') || !class_exists($class)) {
                continue;
            }
            if (is_a($class, CachePoolAwareInterface::class, true)) {
                $definition->addMethodCall('setCache', [new Reference('cache.app')]);
            }
        }
    }
}
