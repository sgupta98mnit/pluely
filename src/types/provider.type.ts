export interface TYPE_PROVIDER {
  id?: string;
  streaming?: boolean;
  responseContentPath?: string;
  isCustom?: boolean;
  curl: string;
  /**
   * Curated list of popular model IDs for this provider, shown in the model
   * dropdown. Optional — providers without a list (or custom providers) fall
   * back to a free-text model input. Users can always enter a custom model.
   */
  models?: string[];
}
