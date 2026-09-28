import type {
  PlaceAssessment as CorePlaceAssessment,
  PlaceAssessmentPatch as CorePlaceAssessmentPatch,
} from '@/product/application/assessments/place-assessment';
import type {
  AtlasItem as CoreAtlasItem,
  AtlasItemEdit as CoreAtlasItemEdit,
  AtlasItemKind as CoreAtlasItemKind,
  EventSchedule as CoreEventSchedule,
  PersonalState as CorePersonalState,
  ReservationMode as CoreReservationMode,
  ReservationSnapshot as CoreReservationSnapshot,
  SourceLink as CoreSourceLink,
  TabelogSnapshot as CoreTabelogSnapshot,
  VerificationStatus as CoreVerificationStatus,
} from '@/product/application/catalog/atlas-item';
import type { VisitMedia as CoreVisitMedia } from '@/product/application/media/visit-media';
import type {
  NewVisit as CoreNewVisit,
  Visit as CoreVisit,
  VisitMutationResult as CoreVisitMutationResult,
  VisitUpdate as CoreVisitUpdate,
} from '@/product/application/visits/visit';

export type AtlasItemKind = CoreAtlasItemKind;
export type AtlasView = 'map' | 'journal';
export type AtlasKindFilter = 'all' | AtlasItemKind;
export type AtlasPersonalFilter = 'all' | 'unvisited' | 'visited';
export type PersonalState = CorePersonalState;
export type VerificationStatus = CoreVerificationStatus;
export type ReservationMode = CoreReservationMode;
export type SourceLink = CoreSourceLink;
export type TabelogSnapshot = CoreTabelogSnapshot;
export type ReservationSnapshot = CoreReservationSnapshot;
export type EventSchedule = CoreEventSchedule;
export type AtlasItem = CoreAtlasItem & {
  readonly overallComment?: string;
};
export type AtlasItemEdit = CoreAtlasItemEdit;

interface EffectiveVisitedProjection {
  readonly hasVisited: boolean;
}

interface EffectiveVisitedPatch {
  readonly hasVisited?: boolean;
}

export type PlaceAssessment = Omit<CorePlaceAssessment, 'manualVisited'> &
  EffectiveVisitedProjection;

export type PlaceAssessmentPatch = Omit<
  CorePlaceAssessmentPatch,
  'manualVisited'
> &
  EffectiveVisitedPatch;

export type VisitRecord = CoreVisit;
export type VisitMediaRecord = Pick<
  CoreVisitMedia,
  | 'id'
  | 'visitId'
  | 'itemId'
  | 'originalFilename'
  | 'contentType'
  | 'caption'
  | 'score'
  | 'displayOrder'
  | 'contentUrl'
>;
export type NewVisit = CoreNewVisit;
export type VisitUpdate = Omit<CoreVisitUpdate, 'id'>;
export type VisitCreateResult = CoreVisitMutationResult;
export type VisitMutationResult = Omit<CoreVisitMutationResult, 'visit'> &
  Partial<Pick<CoreVisitMutationResult, 'visit'>>;

export interface AtlasSummary {
  readonly saved: number;
  readonly timeSensitive: number;
}
