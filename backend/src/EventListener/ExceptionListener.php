<?php
declare(strict_types=1);

namespace App\EventListener;

use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Event\ExceptionEvent;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\Security\Core\Exception\AccessDeniedException;
use Symfony\Component\Security\Core\Exception\AuthenticationException;
use Symfony\Component\Validator\ConstraintViolationListInterface;
use Symfony\Component\Validator\Exception\ValidationFailedException;

class ExceptionListener
{
    public function onKernelException(ExceptionEvent $event): void
    {
        $exception = $event->getThrowable();

        if ($exception instanceof ValidationFailedException) {
            $violations = $exception->getViolations();
            $detail = $this->formatViolations($violations);
            $event->setResponse($this->problemResponse(422, 'Unprocessable Entity', $detail));
            return;
        }

        if ($exception instanceof HttpExceptionInterface) {
            $status = $exception->getStatusCode();
            $event->setResponse($this->problemResponse($status, $this->statusTitle($status), $exception->getMessage()));
            return;
        }

        // Symfony security exceptions not wrapped in HttpException
        if ($exception instanceof AccessDeniedException) {
            $event->setResponse($this->problemResponse(403, 'Forbidden', $exception->getMessage()));
            return;
        }

        if ($exception instanceof AuthenticationException) {
            $event->setResponse($this->problemResponse(401, 'Unauthorized', $exception->getMessage()));
            return;
        }

        // Unknown exception: 500
        $event->setResponse($this->problemResponse(500, 'Internal Server Error', 'An unexpected error occurred.'));
    }

    private function problemResponse(int $status, string $title, string $detail): JsonResponse
    {
        return new JsonResponse([
            'type'   => 'https://tools.ietf.org/html/rfc2616#section-10',
            'title'  => $title,
            'status' => $status,
            'detail' => $detail,
        ], $status, ['Content-Type' => 'application/problem+json']);
    }

    private function formatViolations(ConstraintViolationListInterface $violations): string
    {
        $parts = [];
        foreach ($violations as $violation) {
            $parts[] = $violation->getPropertyPath() . ': ' . $violation->getMessage();
        }
        return implode('; ', $parts);
    }

    private function statusTitle(int $status): string
    {
        return match ($status) {
            400 => 'Bad Request',
            401 => 'Unauthorized',
            403 => 'Forbidden',
            404 => 'Not Found',
            405 => 'Method Not Allowed',
            409 => 'Conflict',
            422 => 'Unprocessable Entity',
            500 => 'Internal Server Error',
            503 => 'Service Unavailable',
            default => 'HTTP Error',
        };
    }
}
