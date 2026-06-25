<?php
declare(strict_types=1);

namespace App\EventListener;

use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Event\ExceptionEvent;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\Validator\ConstraintViolationListInterface;
use Symfony\Component\Validator\Exception\ValidationFailedException;

class ExceptionListener
{
    public function onKernelException(ExceptionEvent $event): void
    {
        $exception = $event->getThrowable();

        // Unwrap ValidationFailedException to get ConstraintViolationList
        if ($exception instanceof ValidationFailedException) {
            $violations = $exception->getViolations();
            $detail = $this->formatViolations($violations);
            $response = $this->problemResponse(422, 'Unprocessable Entity', $detail);
            $event->setResponse($response);
            return;
        }

        if ($exception instanceof HttpExceptionInterface) {
            $status = $exception->getStatusCode();
            $title = $this->statusTitle($status);
            $response = $this->problemResponse($status, $title, $exception->getMessage());
            $event->setResponse($response);
            return;
        }

        // Unknown exception: 500
        $response = $this->problemResponse(500, 'Internal Server Error', 'An unexpected error occurred.');
        $event->setResponse($response);
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
