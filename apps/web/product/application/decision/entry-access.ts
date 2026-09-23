export interface EntryAccessSubject {
  readonly itemId: string;
  readonly name: string;
  readonly address: string;
}

export type WalkInAssertion =
  | {
      readonly status: 'confirmed' | 'reservation_required';
      readonly sourceUrl: string;
      readonly checkedAt: string;
      readonly policyVersion: string;
      readonly warning?: string;
    }
  | {
      readonly status: 'unknown';
      readonly warning: string;
      readonly sourceUrl?: string;
      readonly checkedAt?: string;
      readonly policyVersion?: string;
    };

export type QueueAssertion =
  | {
      readonly status: 'none_reported';
      readonly sourceUrl: string;
      readonly checkedAt: string;
      readonly policyVersion: string;
      readonly warning?: string;
    }
  | {
      readonly status: 'waiting_reported';
      readonly sourceUrl: string;
      readonly checkedAt: string;
      readonly policyVersion: string;
      readonly waitingMinutes?: number;
      readonly warning?: string;
    }
  | {
      readonly status: 'unknown';
      readonly warning: string;
      readonly sourceUrl?: string;
      readonly checkedAt?: string;
      readonly policyVersion?: string;
    };

export interface EntryAccessSnapshot {
  readonly walkInAssertion: WalkInAssertion;
  readonly queueAssertion: QueueAssertion;
}

export interface EntryAccessProvider {
  inspectWalkIn(subject: EntryAccessSubject): Promise<WalkInAssertion>;
  inspectQueue(subject: EntryAccessSubject): Promise<QueueAssertion>;
}

export interface EntryAccessVerificationPolicy {
  readonly policyVersion: string;
  readonly allowedSourceOrigins: readonly string[];
  readonly maximumAgeMs: number;
  readonly clock: { readonly now: () => Date };
}
