interface FetchHandler<Environment> {
  fetch(
    request: Request,
    environment: Environment,
    context: ExecutionContext,
  ): Response | Promise<Response>;
}

interface OwnerPocEnvironment {
  readonly DB: D1Database;
}

export function createOwnerPocWorker<Environment extends OwnerPocEnvironment>(
  fetchHandler: FetchHandler<Environment>,
  cleanup: (database: D1Database, now: Date) => Promise<unknown>,
) {
  return {
    fetch(
      request: Request,
      environment: Environment,
      context: ExecutionContext,
    ) {
      return fetchHandler.fetch(request, environment, context);
    },
    scheduled(
      controller: ScheduledController,
      environment: Environment,
      context: ExecutionContext,
    ) {
      context.waitUntil(
        cleanup(environment.DB, new Date(controller.scheduledTime)),
      );
    },
  } satisfies ExportedHandler<Environment>;
}
