import type { ImportJob } from './import-job.ts';
import type { ImportJobRecordState } from './import-job-state.ts';

export class InMemoryImportJobState implements ImportJobRecordState {
  readonly #jobs: ImportJob[];

  constructor(jobs: readonly ImportJob[] = []) {
    this.#jobs = [...jobs];
  }

  async list(): Promise<readonly ImportJob[]> {
    return [...this.#jobs];
  }

  async insert(job: ImportJob): Promise<void> {
    this.#jobs.push(job);
  }

  async delete(id: string): Promise<boolean> {
    const index = this.#jobs.findIndex((job) => job.id === id);
    if (index < 0) return false;
    this.#jobs.splice(index, 1);
    return true;
  }
}
