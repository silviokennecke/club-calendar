<?php

declare(strict_types=1);

namespace App\Security\Secret;

final readonly class EncryptedColumn
{
    public function __construct(
        public string $table,
        public string $column,
        public string $idColumn,
        public string $purpose,
    ) {
    }

    public function label(): string
    {
        return $this->table.'.'.$this->column;
    }
}
