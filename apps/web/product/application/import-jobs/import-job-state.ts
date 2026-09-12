import type { ImportJob } from './import-job.ts';

export interface ImportJobRecordState {
  list(): Promise<readonly ImportJob[]>;
  insert(job: ImportJob): Promise<void>;
  delete(id: string): Promise<boolean>;
}
