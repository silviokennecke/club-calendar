<?php

declare(strict_types=1);

namespace App\Export;

/**
 * Builds JSON incrementally: methods append to a buffer, `flush()` hands out what was written so far.
 * Every object key and array item starts on its own line; the result is plain valid JSON.
 */
final class JsonStreamWriter
{
    private const int FLAGS = JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES;

    private string $buffer = '';

    /** @var list<bool> per open container: has it received an element yet */
    private array $stack = [];

    private bool $afterKey = false;

    public function beginObject(): self
    {
        $this->buffer .= $this->separator().'{';
        $this->stack[] = false;

        return $this;
    }

    public function endObject(): self
    {
        return $this->close('}');
    }

    public function beginArray(): self
    {
        $this->buffer .= $this->separator().'[';
        $this->stack[] = false;

        return $this;
    }

    public function endArray(): self
    {
        return $this->close(']');
    }

    /** Next value (scalar, container) belongs to this key; only valid inside an object. */
    public function key(string $key): self
    {
        $this->buffer .= $this->separator().json_encode($key, self::FLAGS).':';
        $this->afterKey = true;

        return $this;
    }

    /** A scalar, null or an already complete array/object-like value. */
    public function value(mixed $value): self
    {
        $this->buffer .= $this->separator().json_encode($value, self::FLAGS);

        return $this;
    }

    public function field(string $key, mixed $value): self
    {
        return $this->key($key)->value($value);
    }

    public function flush(): string
    {
        $out = $this->buffer;
        $this->buffer = '';

        return $out;
    }

    public function size(): int
    {
        return strlen($this->buffer);
    }

    private function close(string $bracket): self
    {
        if ([] === $this->stack) {
            throw new \LogicException('No open JSON container.');
        }
        $hadElements = array_pop($this->stack);
        $this->buffer .= ($hadElements ? "\n" : '').$bracket;
        if ([] === $this->stack) {
            $this->buffer .= "\n";
        }

        return $this;
    }

    private function separator(): string
    {
        if ($this->afterKey) {
            $this->afterKey = false;

            return '';
        }
        if ([] === $this->stack) {
            return '';
        }
        $top = array_key_last($this->stack);
        $sep = $this->stack[$top] ? ",\n" : "\n";
        $this->stack[$top] = true;

        return $sep;
    }
}
