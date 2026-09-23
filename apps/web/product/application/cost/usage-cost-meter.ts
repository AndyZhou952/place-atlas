export type CostCalibration = 'actual_bill' | 'usage_counter' | 'estimate';

export interface FixedMonthlyCost {
  readonly service: string;
  readonly monthlyUsd: number;
  readonly calibration: CostCalibration;
  readonly evidenceRef: string;
}

export interface VariableMonthlyCost {
  readonly provider: string;
  readonly usedUnits: number;
  readonly unitCostUsd: number;
  readonly actualCostUsdToDate?: number;
  readonly calibration: CostCalibration;
  readonly evidenceRef: string;
  readonly warnUnits: number;
  readonly hardUnits: number;
}

export interface UsageCostProjectionInput {
  readonly asOf: string;
  readonly daysObserved: number;
  readonly daysInMonth: number;
  readonly fixedCosts: readonly FixedMonthlyCost[];
  readonly variableCosts: readonly VariableMonthlyCost[];
}

export interface UsageCostMeterPolicy {
  readonly hardLimitUsd: number;
  readonly reserveUsd: number;
  readonly warnAtUsd: number;
}

interface CostComponent {
  readonly service: string;
  readonly kind: 'fixed' | 'variable';
  readonly projectedMonthlyUsd: number;
  readonly calibration: CostCalibration;
  readonly evidenceRef: string;
}

interface ProviderGate {
  readonly provider: string;
  readonly projectedUnits: number;
  readonly warnUnits: number;
  readonly hardUnits: number;
  readonly gate: 'open' | 'warning' | 'closed';
}

export interface UsageCostReport {
  readonly asOf: string;
  readonly currency: 'USD';
  readonly hardLimitUsd: number;
  readonly reserveUsd: number;
  readonly projectedSpendUsd: number;
  readonly projectedWithReserveUsd: number;
  readonly gate: 'open' | 'warning' | 'closed';
  readonly reasons: readonly string[];
  readonly calibration: 'bill_calibrated' | 'provisional';
  readonly components: readonly CostComponent[];
  readonly providerGates: readonly ProviderGate[];
}

export function createUsageCostMeter(policy: UsageCostMeterPolicy) {
  if (!isValidPolicy(policy)) {
    throw new Error('UsageCostMeter policy is invalid.');
  }

  return {
    project(input: UsageCostProjectionInput): UsageCostReport {
      if (!isValidInput(input)) return invalidReport(policy, input.asOf);

      const monthlyFactor = input.daysInMonth / input.daysObserved;
      const fixedComponents = input.fixedCosts.map(
        (cost): CostComponent => ({
          service: cost.service,
          kind: 'fixed',
          projectedMonthlyUsd: round(cost.monthlyUsd),
          calibration: cost.calibration,
          evidenceRef: cost.evidenceRef,
        }),
      );
      const variableComponents = input.variableCosts.map(
        (cost): CostComponent => ({
          service: cost.provider,
          kind: 'variable',
          projectedMonthlyUsd: round(
            (cost.actualCostUsdToDate ?? cost.usedUnits * cost.unitCostUsd) *
              monthlyFactor,
          ),
          calibration: cost.calibration,
          evidenceRef: cost.evidenceRef,
        }),
      );
      const providerGates = input.variableCosts.map((cost): ProviderGate => {
        const projectedUnits = round(cost.usedUnits * monthlyFactor);
        return {
          provider: cost.provider,
          projectedUnits,
          warnUnits: cost.warnUnits,
          hardUnits: cost.hardUnits,
          gate:
            projectedUnits > cost.hardUnits
              ? 'closed'
              : cost.warnUnits > 0 && projectedUnits >= cost.warnUnits
                ? 'warning'
                : 'open',
        };
      });
      const components = [...fixedComponents, ...variableComponents];
      const projectedSpendUsd = round(
        components.reduce(
          (total, component) => total + component.projectedMonthlyUsd,
          0,
        ),
      );
      const projectedWithReserveUsd = round(
        projectedSpendUsd + policy.reserveUsd,
      );
      const reasons = providerGates
        .filter((provider) => provider.gate === 'closed')
        .map((provider) => `provider_hard_quota_exceeded:${provider.provider}`);
      if (projectedWithReserveUsd > policy.hardLimitUsd) {
        reasons.unshift('monthly_budget_exceeded');
      }
      const hasWarning =
        projectedWithReserveUsd >= policy.warnAtUsd ||
        providerGates.some((provider) => provider.gate === 'warning');

      return {
        asOf: input.asOf,
        currency: 'USD',
        hardLimitUsd: policy.hardLimitUsd,
        reserveUsd: policy.reserveUsd,
        projectedSpendUsd,
        projectedWithReserveUsd,
        gate: reasons.length > 0 ? 'closed' : hasWarning ? 'warning' : 'open',
        reasons,
        calibration: components.every(
          (component) => component.calibration === 'actual_bill',
        )
          ? 'bill_calibrated'
          : 'provisional',
        components,
        providerGates,
      };
    },
  };
}

function isValidPolicy(policy: UsageCostMeterPolicy): boolean {
  return (
    isNonNegativeFinite(policy.hardLimitUsd) &&
    policy.hardLimitUsd > 0 &&
    isNonNegativeFinite(policy.reserveUsd) &&
    policy.reserveUsd < policy.hardLimitUsd &&
    isNonNegativeFinite(policy.warnAtUsd) &&
    policy.warnAtUsd <= policy.hardLimitUsd
  );
}

function isValidInput(input: UsageCostProjectionInput): boolean {
  return (
    !Number.isNaN(Date.parse(input.asOf)) &&
    Number.isInteger(input.daysObserved) &&
    input.daysObserved > 0 &&
    Number.isInteger(input.daysInMonth) &&
    input.daysInMonth >= input.daysObserved &&
    input.fixedCosts.every(
      (cost) =>
        hasIdentity(cost.service) &&
        isNonNegativeFinite(cost.monthlyUsd) &&
        hasIdentity(cost.evidenceRef),
    ) &&
    input.variableCosts.every(
      (cost) =>
        hasIdentity(cost.provider) &&
        hasIdentity(cost.evidenceRef) &&
        isNonNegativeFinite(cost.usedUnits) &&
        isNonNegativeFinite(cost.unitCostUsd) &&
        (cost.actualCostUsdToDate === undefined ||
          (cost.calibration === 'actual_bill' &&
            isNonNegativeFinite(cost.actualCostUsdToDate))) &&
        isNonNegativeFinite(cost.warnUnits) &&
        isNonNegativeFinite(cost.hardUnits) &&
        cost.warnUnits <= cost.hardUnits,
    )
  );
}

function invalidReport(
  policy: UsageCostMeterPolicy,
  asOf: string,
): UsageCostReport {
  return {
    asOf,
    currency: 'USD',
    hardLimitUsd: policy.hardLimitUsd,
    reserveUsd: policy.reserveUsd,
    projectedSpendUsd: 0,
    projectedWithReserveUsd: policy.reserveUsd,
    gate: 'closed',
    reasons: ['meter_input_invalid'],
    calibration: 'provisional',
    components: [],
    providerGates: [],
  };
}

function hasIdentity(value: string): boolean {
  return value.trim().length > 0 && value.length <= 256;
}

function isNonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
