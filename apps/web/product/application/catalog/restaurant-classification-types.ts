export interface RestaurantClassification {
  readonly cuisines: readonly {
    readonly familyId: string;
    readonly categoryId?: string;
  }[];
  readonly geography: {
    readonly countryCode?: string;
    readonly subdivisionCode?: string;
    readonly subdivisionName?: string;
  };
  readonly basis: {
    readonly cuisineLabels: readonly string[];
    readonly address: string;
  };
}
