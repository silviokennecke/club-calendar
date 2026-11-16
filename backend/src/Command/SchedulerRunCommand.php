<?php

declare(strict_types=1);

namespace App\Command;

use App\Scheduler\RunScheduledTask;
use App\Scheduler\RunScheduledTaskHandler;
use App\Scheduler\ScheduledTask;
use App\Telemetry\Telemetry;
use Symfony\Component\Console\Attribute\Argument;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Attribute\Option;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Completion\CompletionInput;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Question\ChoiceQuestion;
use Symfony\Component\Console\Style\SymfonyStyle;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Lock\LockFactory;

/**
 * Runs one scheduled task in this process through the worker's handler. Independent of SCHEDULER_ENABLED.
 * A per-task lock keeps two manual runs (any container) apart; scheduled runs on workers do not take it.
 */
#[AsCommand(name: 'app:scheduler:run', description: 'Run a scheduled task now, in this process')]
class SchedulerRunCommand
{
    private const LOCK_TTL = 3600.0;

    public function __construct(
        private readonly RunScheduledTaskHandler $handler,
        #[Autowire(service: 'app.scheduler_lock_factory')]
        private readonly LockFactory $lockFactory,
        private readonly Telemetry $telemetry,
    ) {
    }

    public function __invoke(
        SymfonyStyle $io,
        InputInterface $input,
        #[Argument(description: 'Task name, e.g. prune-security-events', suggestedValues: [self::class, 'taskNames'])]
        ?string $task = null,
        #[Option(description: 'List all tasks with schedule and description', shortcut: 'l')]
        bool $list = false,
    ): int {
        if ($list) {
            $this->renderList($io);

            return Command::SUCCESS;
        }

        if (null === $task) {
            if (!$input->isInteractive()) {
                $io->error('No task given. Valid tasks: '.implode(', ', self::taskNames()));

                return Command::FAILURE;
            }
            $task = $this->choose($io);
        }

        $scheduled = ScheduledTask::tryFrom($task);
        if (null === $scheduled) {
            $hint = $this->closest($task);
            $io->error(sprintf('Unknown task "%s".%s Valid tasks: %s', $task, null !== $hint ? sprintf(' Did you mean "%s"?', $hint) : '', implode(', ', self::taskNames())));

            return Command::FAILURE;
        }

        return $this->run($io, $scheduled);
    }

    /** @return list<string> */
    public static function taskNames(?CompletionInput $input = null): array
    {
        return array_map(static fn (ScheduledTask $t): string => $t->value, ScheduledTask::cases());
    }

    private function run(SymfonyStyle $io, ScheduledTask $task): int
    {
        $lock = $this->lockFactory->createLock('manual-task-'.$task->value, self::LOCK_TTL);
        if (!$lock->acquire()) {
            $io->error(sprintf('Task "%s" is already being run manually (here or in another container). Nothing was started.', $task->value));

            return Command::FAILURE;
        }

        $io->writeln(sprintf('Running "%s": %s', $task->value, $task->description()));
        $start = microtime(true);
        try {
            ($this->handler)(new RunScheduledTask($task));
        } catch (\Throwable $e) {
            $io->error(sprintf('Task "%s" failed after %.2f s: %s: %s', $task->value, microtime(true) - $start, $e::class, $e->getMessage()));

            return Command::FAILURE;
        } finally {
            $lock->release();
        }

        $duration = microtime(true) - $start;
        if ($task->needsTelemetry() && !$this->telemetry->isEnabled()) {
            $io->warning(sprintf('Task "%s" did nothing in %.2f s: no OTLP endpoint is configured (OTEL_EXPORTER_OTLP_ENDPOINT).', $task->value, $duration));

            return Command::SUCCESS;
        }
        $io->success(sprintf('Task "%s" finished in %.2f s.', $task->value, $duration));
        if ($task->swallowsFailures()) {
            $io->note('This task logs failures as warnings instead of failing; check the log for problems.');
        }

        return Command::SUCCESS;
    }

    private function renderList(SymfonyStyle $io): void
    {
        $io->table(
            ['Task', 'Schedule (UTC cron)', 'Description'],
            array_map(static fn (ScheduledTask $t): array => [$t->value, $t->cron(), $t->description()], ScheduledTask::cases()),
        );
    }

    private function choose(SymfonyStyle $io): string
    {
        $choices = [];
        foreach (ScheduledTask::cases() as $t) {
            $choices[$t->value] = sprintf('%s  [%s]  %s', $t->value, $t->cron(), $t->description());
        }
        $question = new ChoiceQuestion('Which task do you want to run?', $choices);
        $question->setErrorMessage('Task %s is invalid.');
        $answer = (string) $io->askQuestion($question);

        // ChoiceQuestion returns the key for associative choices, but may echo the label when typed.
        return ScheduledTask::tryFrom($answer)?->value ?? (string) (array_search($answer, $choices, true) ?: $answer);
    }

    private function closest(string $input): ?string
    {
        $best = null;
        $bestDistance = 4;
        foreach (self::taskNames() as $name) {
            $d = levenshtein($input, $name);
            if ($d < $bestDistance) {
                $best = $name;
                $bestDistance = $d;
            }
        }

        return $best;
    }
}
